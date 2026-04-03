const { neon } = require('@neondatabase/serverless');
const { withAuth } = require('../middleware/auth');

/**
 * POST /api/pulse — The one endpoint.
 * Receives all data from hooks/collectors and upserts into the appropriate tables.
 *
 * Body shape:
 * {
 *   sessionId: string (required),
 *   projectName: string (required),
 *   projectPath?: string,
 *   hostname?: string,
 *   model?: string,
 *   contextRemaining?: number,
 *   mode?: string,
 *   status?: string,
 *   statusMessage?: string,
 *   metadata?: object,
 *   events?: [{ operation, detail, timestamp }],
 *   rateLimit?: { tokensUsed, tokensRemaining, contextWindow, contextRemaining, resetAt },
 *   gitStats?: { commits7d, lines7d, commitsPrev7d, linesPrev7d }
 * }
 */
module.exports = withAuth(async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sql = neon(process.env.DATABASE_URL);
  const {
    sessionId,
    projectName,
    projectPath,
    hostname,
    model,
    contextRemaining,
    mode,
    status,
    statusMessage,
    metadata,
    events,
    rateLimit,
    gitStats,
  } = req.body;

  if (!sessionId || !projectName) {
    return res.status(400).json({ error: 'Missing sessionId or projectName' });
  }

  const results = {};

  try {
    // 1. Upsert session
    await sql`
      INSERT INTO sessions (id, project_path, project_name, hostname, model, context_remaining, mode, status, status_message, metadata)
      VALUES (
        ${sessionId},
        ${projectPath || projectName},
        ${projectName},
        ${hostname || null},
        ${model || null},
        ${contextRemaining != null ? contextRemaining : null},
        ${mode || null},
        ${status || 'active'},
        ${statusMessage || ''},
        ${metadata ? JSON.stringify(metadata) : '{}'}
      )
      ON CONFLICT (id)
      DO UPDATE SET
        last_activity = NOW(),
        hostname = COALESCE(${hostname || null}, sessions.hostname),
        model = COALESCE(${model || null}, sessions.model),
        context_remaining = COALESCE(${contextRemaining != null ? contextRemaining : null}, sessions.context_remaining),
        mode = COALESCE(${mode || null}, sessions.mode),
        status = COALESCE(${status || null}, sessions.status),
        status_message = COALESCE(${statusMessage || null}, sessions.status_message),
        metadata = COALESCE(${metadata ? JSON.stringify(metadata) : null}, sessions.metadata)
    `;
    results.session = 'upserted';

    // 2. Upsert project
    await sql`
      INSERT INTO projects (path, name, last_activity, current_status)
      VALUES (${projectPath || projectName}, ${projectName}, NOW(), ${status || 'active'})
      ON CONFLICT (path)
      DO UPDATE SET
        last_activity = NOW(),
        current_status = ${status || 'active'}
    `;
    results.project = 'upserted';

    // 3. Ingest events (if provided)
    if (events && Array.isArray(events) && events.length > 0) {
      let ingested = 0;
      for (const evt of events) {
        if (!evt.operation) continue;
        const ts = evt.timestamp ? new Date(evt.timestamp).toISOString() : new Date().toISOString();
        await sql`
          INSERT INTO activity_events (session_id, project_name, operation, detail, created_at)
          VALUES (${sessionId}, ${projectName}, ${evt.operation}, ${(evt.detail || '').slice(0, 200)}, ${ts})
        `;
        ingested++;
      }
      results.events = ingested;
    }

    // 4. Record rate limit (if provided)
    if (rateLimit) {
      await sql`
        INSERT INTO rate_limits (session_id, model, tokens_used, tokens_remaining, context_window, context_remaining, reset_at)
        VALUES (
          ${sessionId},
          ${model || rateLimit.model || 'unknown'},
          ${rateLimit.tokensUsed || 0},
          ${rateLimit.tokensRemaining || null},
          ${rateLimit.contextWindow || null},
          ${rateLimit.contextRemaining || null},
          ${rateLimit.resetAt ? new Date(rateLimit.resetAt).toISOString() : null}
        )
      `;
      results.rateLimit = 'recorded';
    }

    // 5. Upsert git stats (if provided)
    if (gitStats) {
      await sql`
        INSERT INTO git_stats (project_name, commits_7d, lines_7d, commits_prev_7d, lines_prev_7d, updated_at)
        VALUES (${projectName}, ${gitStats.commits7d || 0}, ${gitStats.lines7d || 0}, ${gitStats.commitsPrev7d || 0}, ${gitStats.linesPrev7d || 0}, NOW())
        ON CONFLICT (project_name)
        DO UPDATE SET
          commits_7d = ${gitStats.commits7d || 0},
          lines_7d = ${gitStats.lines7d || 0},
          commits_prev_7d = ${gitStats.commitsPrev7d || 0},
          lines_prev_7d = ${gitStats.linesPrev7d || 0},
          updated_at = NOW()
      `;
      results.gitStats = 'upserted';
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('Pulse error:', err.message);
    return res.status(500).json({ error: 'Failed to process pulse', detail: err.message });
  }
});
