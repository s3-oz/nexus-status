// POST /api/pulse — heartbeat endpoint called by nexus-pulse.js every ~5s.
// Accepts honest v2 status fields (status enum, waiting_on, last_user_input_at,
// last_assistant_message_at). Unknown fields are ignored.
const { pool } = require('../db');

const VALID_STATUSES = new Set([
  'working', 'waiting-for-user', 'idle', 'blocked', 'disconnected',
]);

async function pulseHandler(req, reply) {
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
    waitingOn,
    lastUserInputAt,
    lastAssistantMessageAt,
    metadata,
    events,
    rateLimit,
    gitStats,
  } = req.body || {};

  if (!sessionId || !projectName) {
    return reply.code(400).send({ error: 'Missing sessionId or projectName' });
  }

  // Enforce status enum; default to 'working' for backwards compat with any
  // straggler using the v1 'active' string.
  let normalizedStatus = status;
  if (normalizedStatus === 'active') normalizedStatus = 'working';
  if (normalizedStatus && !VALID_STATUSES.has(normalizedStatus)) {
    return reply.code(400).send({ error: `Invalid status: ${normalizedStatus}` });
  }

  const results = {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Upsert session
    await client.query(
      `INSERT INTO sessions (
         id, project_path, project_name, hostname, model, context_remaining,
         mode, status, status_message, waiting_on,
         last_user_input_at, last_assistant_message_at, metadata
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET
         last_activity = NOW(),
         hostname                  = COALESCE($4,  sessions.hostname),
         model                     = COALESCE($5,  sessions.model),
         context_remaining         = COALESCE($6,  sessions.context_remaining),
         mode                      = COALESCE($7,  sessions.mode),
         status                    = COALESCE($8,  sessions.status),
         status_message            = COALESCE($9,  sessions.status_message),
         waiting_on                = $10,
         last_user_input_at        = COALESCE($11, sessions.last_user_input_at),
         last_assistant_message_at = COALESCE($12, sessions.last_assistant_message_at),
         metadata                  = COALESCE($13, sessions.metadata)`,
      [
        sessionId,
        projectPath || projectName,
        projectName,
        hostname || null,
        model || null,
        contextRemaining != null ? contextRemaining : null,
        mode || null,
        normalizedStatus || 'working',
        statusMessage || '',
        waitingOn || null,
        lastUserInputAt || null,
        lastAssistantMessageAt || null,
        metadata ? JSON.stringify(metadata) : '{}',
      ],
    );
    results.session = 'upserted';

    // 2. Upsert project aggregate
    await client.query(
      `INSERT INTO projects (path, name, last_activity, current_status)
       VALUES ($1, $2, NOW(), $3)
       ON CONFLICT (path) DO UPDATE SET
         last_activity = NOW(),
         current_status = $3`,
      [projectPath || projectName, projectName, normalizedStatus || 'working'],
    );
    results.project = 'upserted';

    // 3. Ingest activity events
    if (events && Array.isArray(events) && events.length > 0) {
      let ingested = 0;
      for (const evt of events) {
        if (!evt.operation) continue;
        const ts = evt.timestamp ? new Date(evt.timestamp).toISOString() : new Date().toISOString();
        await client.query(
          `INSERT INTO activity_events (session_id, project_name, operation, detail, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [sessionId, projectName, evt.operation, (evt.detail || '').slice(0, 200), ts],
        );
        ingested++;
      }
      results.events = ingested;
    }

    // 4. Rate limit snapshot
    if (rateLimit) {
      await client.query(
        `INSERT INTO rate_limits (
           session_id, model, tokens_used, tokens_remaining,
           context_window, context_remaining, reset_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          sessionId,
          model || rateLimit.model || 'unknown',
          rateLimit.tokensUsed || 0,
          rateLimit.tokensRemaining || null,
          rateLimit.contextWindow || null,
          rateLimit.contextRemaining || null,
          rateLimit.resetAt ? new Date(rateLimit.resetAt).toISOString() : null,
        ],
      );
      results.rateLimit = 'recorded';
    }

    // 5. Git stats upsert
    if (gitStats) {
      await client.query(
        `INSERT INTO git_stats (project_name, commits_7d, lines_7d, commits_prev_7d, lines_prev_7d, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (project_name) DO UPDATE SET
           commits_7d = $2,
           lines_7d = $3,
           commits_prev_7d = $4,
           lines_prev_7d = $5,
           updated_at = NOW()`,
        [
          projectName,
          gitStats.commits7d || 0,
          gitStats.lines7d || 0,
          gitStats.commitsPrev7d || 0,
          gitStats.linesPrev7d || 0,
        ],
      );
      results.gitStats = 'upserted';
    }

    await client.query('COMMIT');
    return reply.send({ ok: true, results });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    req.log.error({ err: err.message }, 'pulse failed');
    return reply.code(500).send({ error: 'Failed to process pulse', detail: err.message });
  } finally {
    client.release();
  }
}

module.exports = pulseHandler;
