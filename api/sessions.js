const { neon } = require('@neondatabase/serverless');
const { withAuth } = require('../middleware/auth');

module.exports = withAuth(async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sql = neon(process.env.DATABASE_URL);
  const status = req.query.status || 'active';
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);

  try {
    const sessions = status === 'all'
      ? await sql`
          SELECT * FROM sessions
          ORDER BY last_activity DESC
          LIMIT ${limit}
        `
      : await sql`
          SELECT * FROM sessions
          WHERE status = ${status}
          ORDER BY last_activity DESC
          LIMIT ${limit}
        `;

    return res.status(200).json({ sessions });
  } catch (err) {
    console.error('Sessions query error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});
