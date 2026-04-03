const { neon } = require('@neondatabase/serverless');
const { withAuth } = require('../middleware/auth');

module.exports = withAuth(async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sql = neon(process.env.DATABASE_URL);
  const hours = Math.min(parseInt(req.query.hours) || 24, 168);

  try {
    // Latest rate limit snapshot per session
    const current = await sql`
      SELECT DISTINCT ON (session_id)
        rl.session_id, rl.model, rl.tokens_used, rl.tokens_remaining,
        rl.context_window, rl.context_remaining, rl.reset_at, rl.recorded_at,
        s.project_name, s.status AS session_status
      FROM rate_limits rl
      LEFT JOIN sessions s ON s.id = rl.session_id
      WHERE rl.recorded_at > NOW() - INTERVAL '1 hour' * ${hours}
      ORDER BY rl.session_id, rl.recorded_at DESC
    `;

    // Aggregate usage over time window
    const aggregate = await sql`
      SELECT
        model,
        SUM(tokens_used) AS total_tokens,
        COUNT(*) AS sample_count,
        MIN(recorded_at) AS earliest,
        MAX(recorded_at) AS latest
      FROM rate_limits
      WHERE recorded_at > NOW() - INTERVAL '1 hour' * ${hours}
      GROUP BY model
    `;

    return res.status(200).json({
      current: current.map(r => ({
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
      aggregate: aggregate.map(a => ({
        model: a.model,
        totalTokens: parseInt(a.total_tokens) || 0,
        sampleCount: parseInt(a.sample_count) || 0,
        earliest: a.earliest,
        latest: a.latest,
      })),
      window: `${hours}h`,
    });
  } catch (err) {
    console.error('Rate limits query error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch rate limits' });
  }
});
