const { neon } = require('@neondatabase/serverless');
const { withAuth } = require('../../middleware/auth');

module.exports = withAuth(async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sql = neon(process.env.DATABASE_URL);
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const project = req.query.project || null;

  try {
    const events = project
      ? await sql`
          SELECT id, session_id, project_name, operation, detail, created_at
          FROM activity_events
          WHERE project_name = ${project}
          ORDER BY created_at DESC
          LIMIT ${limit}
        `
      : await sql`
          SELECT id, session_id, project_name, operation, detail, created_at
          FROM activity_events
          ORDER BY created_at DESC
          LIMIT ${limit}
        `;

    return res.status(200).json({
      events: events.map(e => ({
        id: e.id,
        sessionId: e.session_id,
        projectName: e.project_name,
        operation: e.operation,
        detail: e.detail,
        timestamp: e.created_at,
      })),
    });
  } catch (err) {
    console.error('Events query error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch events' });
  }
});
