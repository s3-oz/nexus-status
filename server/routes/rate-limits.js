// GET /api/rate-limits — latest rate limit snapshot per session + aggregate window.
const { pool } = require('../db');

async function rateLimitsHandler(req, reply) {
  const hours = Math.min(parseInt(req.query.hours) || 24, 168);

  try {
    const current = await pool.query(
      `SELECT DISTINCT ON (session_id)
         rl.session_id, rl.model, rl.tokens_used, rl.tokens_remaining,
         rl.context_window, rl.context_remaining, rl.reset_at, rl.recorded_at,
         s.project_name, s.status AS session_status
       FROM rate_limits rl
       LEFT JOIN sessions s ON s.id = rl.session_id
       WHERE rl.recorded_at > NOW() - ($1 || ' hours')::interval
       ORDER BY rl.session_id, rl.recorded_at DESC`,
      [hours],
    );

    const aggregate = await pool.query(
      `SELECT
         model,
         SUM(tokens_used) AS total_tokens,
         COUNT(*) AS sample_count,
         MIN(recorded_at) AS earliest,
         MAX(recorded_at) AS latest
       FROM rate_limits
       WHERE recorded_at > NOW() - ($1 || ' hours')::interval
       GROUP BY model`,
      [hours],
    );

    return reply.send({
      current: current.rows.map((r) => ({
        sessionId: r.session_id,
        projectName: r.project_name,
        sessionStatus: r.session_status,
        model: r.model,
        tokensUsed: r.tokens_used,
        tokensRemaining: r.tokens_remaining,
        contextWindow: r.context_window,
        contextRemaining: r.context_remaining,
        resetAt: r.reset_at,
        recordedAt: r.recorded_at,
      })),
      aggregate: aggregate.rows.map((a) => ({
        model: a.model,
        totalTokens: parseInt(a.total_tokens) || 0,
        sampleCount: parseInt(a.sample_count) || 0,
        earliest: a.earliest,
        latest: a.latest,
      })),
      window: `${hours}h`,
    });
  } catch (err) {
    req.log.error({ err: err.message }, 'rate-limits query failed');
    return reply.code(500).send({ error: 'Failed to fetch rate limits' });
  }
}

module.exports = rateLimitsHandler;
