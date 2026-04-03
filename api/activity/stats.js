const { neon } = require('@neondatabase/serverless');
const { withAuth } = require('../../middleware/auth');

module.exports = withAuth(async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sql = neon(process.env.DATABASE_URL);

  try {
    // Git stats — aggregated across all projects
    const gitStats = await sql`
      SELECT
        COALESCE(SUM(commits_7d), 0) AS total_commits,
        COALESCE(SUM(lines_7d), 0) AS total_lines,
        COALESCE(SUM(commits_prev_7d), 0) AS prev_commits,
        COALESCE(SUM(lines_prev_7d), 0) AS prev_lines,
        MAX(updated_at) AS last_stats_update
      FROM git_stats
      WHERE updated_at > NOW() - INTERVAL '24 hours'
    `;

    // Total projects (all unique ever tracked, excluding agent- prefixed)
    const projectCount = await sql`
      SELECT COUNT(DISTINCT project_name) AS total FROM (
        SELECT DISTINCT project_name FROM sessions
        UNION
        SELECT DISTINCT project_name FROM git_stats
        UNION
        SELECT DISTINCT project_name FROM activity_events
      ) all_projects
      WHERE project_name NOT LIKE 'agent-%'
    `;

    // Session metrics — active in last 24h
    const sessionStats = await sql`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('active', 'working', 'needs-input')) AS active_count,
        MAX(last_activity) AS last_active,
        COALESCE(SUM(EXTRACT(EPOCH FROM (last_activity - started_at)) / 3600), 0) AS total_hours
      FROM sessions
      WHERE last_activity > NOW() - INTERVAL '24 hours'
    `;

    // Recent events with diversity (latest N per project)
    const events = await sql`
      WITH ranked AS (
        SELECT session_id, project_name, operation, detail, created_at,
          ROW_NUMBER() OVER (PARTITION BY project_name ORDER BY created_at DESC) AS rn
        FROM activity_events
      )
      SELECT session_id, project_name, operation, detail, created_at
      FROM ranked
      WHERE rn <= 10
      ORDER BY created_at DESC
      LIMIT 50
    `;

    // 24-hour pulse
    const pulseRows = await sql`
      SELECT
        date_trunc('hour', created_at) AS hour,
        COUNT(*) AS count
      FROM activity_events
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY date_trunc('hour', created_at)
      ORDER BY hour ASC
    `;

    const pulse = [];
    const now = new Date();
    for (let i = 23; i >= 0; i--) {
      const hour = new Date(now);
      hour.setMinutes(0, 0, 0);
      hour.setHours(hour.getHours() - i);
      const hourStr = hour.toISOString();
      const match = pulseRows.find(r =>
        new Date(r.hour).getHours() === hour.getHours() &&
        new Date(r.hour).getDate() === hour.getDate()
      );
      pulse.push({ hour: hourStr, count: match ? parseInt(match.count) : 0 });
    }

    // Most recent event timestamp
    const lastEvent = await sql`
      SELECT MAX(created_at) AS last_event FROM activity_events
    `;

    const stats = gitStats[0] || {};
    const sessions = sessionStats[0] || {};
    const lastEventAt = lastEvent[0]?.last_event;

    // Periodic cleanup (1 in 50 requests)
    if (Math.random() < 0.02) {
      sql`DELETE FROM activity_events WHERE created_at < NOW() - INTERVAL '7 days'`.catch(e => {
        console.error('Cleanup error:', e.message);
      });
    }

    return res.status(200).json({
      metrics: {
        commitsThisWeek: parseInt(stats.total_commits) || 0,
        linesThisWeek: parseInt(stats.total_lines) || 0,
        lastWeekCommits: parseInt(stats.prev_commits) || 0,
        lastWeekLines: parseInt(stats.prev_lines) || 0,
        totalProjects: parseInt(projectCount[0]?.total) || 0,
        activeSessions: parseInt(sessions.active_count) || 0,
        hoursTracked: Math.round(parseFloat(sessions.total_hours) || 0),
        lastActiveAt: lastEventAt || sessions.last_active || stats.last_stats_update || null,
      },
      recentEvents: events.map(e => ({
        sessionId: e.session_id,
        projectName: e.project_name,
        operation: e.operation,
        detail: e.detail,
        timestamp: e.created_at,
      })),
      pulse,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Stats query error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }
});
