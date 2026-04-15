// GET /api/activity/stats — aggregate metrics dashboard payload.
// Consumed (eventually) by Omniat website; also useful for monitoring.
const { pool } = require('../db');

async function activityStatsHandler(req, reply) {
  try {
    // git_stats aggregate — previously filtered `updated_at > 24h` which dropped
    // any project whose sync had lapsed, causing totals to swing wildly as jobs
    // came in and out of the window. The aggregate should not depend on per-row
    // sync freshness; the sync cadence is a separate problem to fix.
    const gitStatsQ = pool.query(
      `SELECT
         COALESCE(SUM(commits_7d), 0) AS total_commits,
         COALESCE(SUM(lines_7d), 0) AS total_lines,
         COALESCE(SUM(commits_prev_7d), 0) AS prev_commits,
         COALESCE(SUM(lines_prev_7d), 0) AS prev_lines,
         MAX(updated_at) AS last_stats_update
       FROM git_stats`,
    );

    const projectCountQ = pool.query(
      `SELECT COUNT(DISTINCT project_name) AS total FROM (
         SELECT DISTINCT project_name FROM sessions
         UNION SELECT DISTINCT project_name FROM git_stats
         UNION SELECT DISTINCT project_name FROM activity_events
       ) all_projects
       WHERE project_name NOT LIKE 'agent-%'`,
    );

    // activeSessions = live-right-now, matching the "running right now" copy on Omniat.
    // 10min window + drop 'blocked' (stuck != running). Aggregates (last_active,
    // total_hours) still use the 24h window for dashboard context.
    const sessionStatsQ = pool.query(
      `SELECT
         COUNT(*) FILTER (
           WHERE status IN ('working','waiting-for-user')
             AND last_activity > NOW() - INTERVAL '10 minutes'
         ) AS active_count,
         MAX(last_activity) AS last_active,
         COALESCE(SUM(EXTRACT(EPOCH FROM (last_activity - started_at)) / 3600), 0) AS total_hours
       FROM sessions
       WHERE last_activity > NOW() - INTERVAL '24 hours'`,
    );

    // Recent events — last 7 days, most recent first. Previous diversity query
    // (ROW_NUMBER <= 10 per project, no time filter) pulled ancient events from
    // dormant projects (config/xero) while capping fresh activity from active
    // ones. Now just the most recent across all projects in the last 7 days;
    // the website's downstream filter (operation + project allowlist) picks
    // what surfaces publicly. Limit is generous (1000) because most raw events
    // are filtered out by the website — we need headroom so enough survive.
    const eventsQ = pool.query(
      `SELECT session_id, project_name, operation, detail, created_at
       FROM activity_events
       WHERE created_at > NOW() - INTERVAL '7 days'
       ORDER BY created_at DESC
       LIMIT 1000`,
    );

    const pulseRowsQ = pool.query(
      `SELECT date_trunc('hour', created_at) AS hour, COUNT(*) AS count
       FROM activity_events
       WHERE created_at > NOW() - INTERVAL '24 hours'
       GROUP BY date_trunc('hour', created_at)
       ORDER BY hour ASC`,
    );

    const lastEventQ = pool.query(`SELECT MAX(created_at) AS last_event FROM activity_events`);

    const [gitStatsR, projectCountR, sessionStatsR, eventsR, pulseRowsR, lastEventR] =
      await Promise.all([gitStatsQ, projectCountQ, sessionStatsQ, eventsQ, pulseRowsQ, lastEventQ]);

    const stats = gitStatsR.rows[0] || {};
    const sessions = sessionStatsR.rows[0] || {};
    const lastEventAt = lastEventR.rows[0]?.last_event;

    // Build 24 hourly buckets in order
    const pulse = [];
    const now = new Date();
    for (let i = 23; i >= 0; i--) {
      const hour = new Date(now);
      hour.setMinutes(0, 0, 0);
      hour.setHours(hour.getHours() - i);
      const match = pulseRowsR.rows.find(
        (r) =>
          new Date(r.hour).getHours() === hour.getHours() &&
          new Date(r.hour).getDate() === hour.getDate(),
      );
      pulse.push({ hour: hour.toISOString(), count: match ? parseInt(match.count) : 0 });
    }

    // Opportunistic cleanup (1 in 50 requests)
    if (Math.random() < 0.02) {
      pool
        .query(`DELETE FROM activity_events WHERE created_at < NOW() - INTERVAL '7 days'`)
        .catch((e) => req.log.warn({ err: e.message }, 'cleanup failed'));
    }

    // Opportunistic session reaper (1 in 50 requests).
    // Sessions pulse every few seconds; anything 15+ min stale is dead.
    // Transitions them to 'disconnected' so activeSessions stops counting ghosts.
    if (Math.random() < 0.02) {
      pool
        .query(
          `UPDATE sessions
             SET status = 'disconnected'
           WHERE status IN ('working','waiting-for-user','blocked')
             AND last_activity < NOW() - INTERVAL '15 minutes'`,
        )
        .catch((e) => req.log.warn({ err: e.message }, 'session reaper failed'));
    }

    return reply.send({
      metrics: {
        commitsThisWeek: parseInt(stats.total_commits) || 0,
        linesThisWeek: parseInt(stats.total_lines) || 0,
        lastWeekCommits: parseInt(stats.prev_commits) || 0,
        lastWeekLines: parseInt(stats.prev_lines) || 0,
        totalProjects: parseInt(projectCountR.rows[0]?.total) || 0,
        activeSessions: parseInt(sessions.active_count) || 0,
        hoursTracked: Math.round(parseFloat(sessions.total_hours) || 0),
        lastActiveAt: lastEventAt || sessions.last_active || stats.last_stats_update || null,
      },
      recentEvents: eventsR.rows.map((e) => ({
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
    req.log.error({ err: err.message }, 'stats query failed');
    return reply.code(500).send({ error: 'Failed to fetch stats' });
  }
}

module.exports = activityStatsHandler;
