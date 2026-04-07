// GET /api/activity/events — recent tool operations.
const { pool } = require('../db');

async function activityEventsHandler(req, reply) {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const project = req.query.project || null;

  try {
    const { rows } = project
      ? await pool.query(
          `SELECT id, session_id, project_name, operation, detail, created_at
           FROM activity_events
           WHERE project_name = $1
           ORDER BY created_at DESC
           LIMIT $2`,
          [project, limit],
        )
      : await pool.query(
          `SELECT id, session_id, project_name, operation, detail, created_at
           FROM activity_events
           ORDER BY created_at DESC
           LIMIT $1`,
          [limit],
        );

    return reply.send({
      events: rows.map((e) => ({
        id: e.id,
        sessionId: e.session_id,
        projectName: e.project_name,
        operation: e.operation,
        detail: e.detail,
        timestamp: e.created_at,
      })),
    });
  } catch (err) {
    req.log.error({ err: err.message }, 'events query failed');
    return reply.code(500).send({ error: 'Failed to fetch events' });
  }
}

module.exports = activityEventsHandler;
