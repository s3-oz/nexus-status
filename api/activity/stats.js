const { neon } = require('@neondatabase/serverless');
const { withAuth } = require('../../middleware/auth');

module.exports = withAuth(async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sql = neon(process.env.DATABASE_URL);

  try {
    // Git stats — aggregated across all projects.
    // The previous `updated_at > 24h` filter silently dropped projects whose
    // git_stats row hadn't re-synced in a day, causing totals to swing wildly
    // (e.g. 118 → 60 → 2 commits as sync jobs lapsed). The sync cadence is a
    // separate problem to fix; the aggregate should not depend on it.
    const gitStats = await sql`
      SELECT
        COALESCE(SUM(commits_7d), 0) AS total_commits,
        COALESCE(SUM(lines_7d), 0) AS total_lines,
        COALESCE(SUM(commits_prev_7d), 0) AS prev_commits,
        COALESCE(SUM(lines_prev_7d), 0) AS prev_lines,
        MAX(updated_at) AS last_stats_update
      FROM git_stats
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

    // Recent events — last 7 days, most recent first. The previous diversity
    // query (ROW_NUMBER <= 10 per project, no time filter) pulled ancient
    // events from dormant projects (config/xero) while capping fresh activity
    // from active projects (nexus, research). Now just returns the most recent
    // events across all projects in the last 7 days; the website's downstream
    // filter (operation allowlist + project allowlist) picks what surfaces.
    const events = await sql`
      SELECT session_id, project_name, operation, detail, created_at
      FROM activity_events
      WHERE created_at > NOW() - INTERVAL '7 days'
      ORDER BY created_at DESC
      LIMIT 200
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
