// GET /api/sessions — list sessions. Consumed by TaskFlow.
// Response shape matches v1 for the fields TaskFlow reads.
const { pool } = require('../db');

async function sessionsHandler(req, reply) {
  const status = req.query.status || 'all';
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);

  try {
    const { rows } = status === 'all'
      ? await pool.query(
          `SELECT * FROM sessions ORDER BY last_activity DESC LIMIT $1`,
          [limit],
        )
      : await pool.query(
          `SELECT * FROM sessions WHERE status = $1 ORDER BY last_activity DESC LIMIT $2`,
          [status, limit],
        );

    return reply.send({ sessions: rows });
  } catch (err) {
    req.log.error({ err: err.message }, 'sessions query failed');
    return reply.code(500).send({ error: 'Failed to fetch sessions' });
  }
}

module.exports = sessionsHandler;
