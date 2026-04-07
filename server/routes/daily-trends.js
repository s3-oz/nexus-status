// GET /api/daily/trends — per-day event + session metrics over N days.
const { pool } = require('../db');

async function dailyTrendsHandler(req, reply) {
  const days = Math.min(parseInt(req.query.days) || 7, 30);

  try {
    const dailyEventsQ = pool.query(
      `SELECT
         date_trunc('day', created_at)::date AS day,
         COUNT(*) AS total_events,
         COUNT(DISTINCT project_name) AS active_projects,
         COUNT(DISTINCT session_id) AS unique_sessions
       FROM activity_events
       WHERE created_at > NOW() - ($1 || ' days')::interval
       GROUP BY date_trunc('day', created_at)::date
       ORDER BY day ASC`,
      [days],
    );

    const dailySessionsQ = pool.query(
      `SELECT
         date_trunc('day', started_at)::date AS day,
         COUNT(*) AS sessions_started,
         COALESCE(SUM(EXTRACT(EPOCH FROM (last_activity - started_at)) / 3600), 0) AS hours_tracked
       FROM sessions
       WHERE started_at > NOW() - ($1 || ' days')::interval
       GROUP BY date_trunc('day', started_at)::date
       ORDER BY day ASC`,
      [days],
    );

    const opBreakdownQ = pool.query(
      `SELECT operation, COUNT(*) AS count
       FROM activity_events
       WHERE created_at > NOW() - ($1 || ' days')::interval
       GROUP BY operation ORDER BY count DESC LIMIT 20`,
      [days],
    );

    const projectRankingQ = pool.query(
      `SELECT project_name, COUNT(*) AS event_count, MAX(created_at) AS last_event
       FROM activity_events
       WHERE created_at > NOW() - ($1 || ' days')::interval
       GROUP BY project_name ORDER BY event_count DESC LIMIT 15`,
      [days],
    );

    const [dailyEventsR, dailySessionsR, opBreakdownR, projectRankingR] = await Promise.all([
      dailyEventsQ, dailySessionsQ, opBreakdownQ, projectRankingQ,
    ]);

    const totalEvents = dailyEventsR.rows.reduce((sum, d) => sum + parseInt(d.total_events), 0);
    const topProject = projectRankingR.rows[0];
    const focusScore = totalEvents > 0 && topProject
      ? Math.round((parseInt(topProject.event_count) / totalEvents) * 100)
      : 0;

    return reply.send({
      days: dailyEventsR.rows.map((d) => {
        const sessionDay =
          dailySessionsR.rows.find((s) => String(s.day) === String(d.day)) || {};
        return {
          date: d.day,
          events: parseInt(d.total_events) || 0,
          activeProjects: parseInt(d.active_projects) || 0,
          uniqueSessions: parseInt(d.unique_sessions) || 0,
          sessionsStarted: parseInt(sessionDay.sessions_started) || 0,
          hoursTracked: Math.round(parseFloat(sessionDay.hours_tracked) || 0),
        };
      }),
      operations: opBreakdownR.rows.map((o) => ({
        operation: o.operation,
        count: parseInt(o.count) || 0,
      })),
      projectRanking: projectRankingR.rows.map((p) => ({
        projectName: p.project_name,
        eventCount: parseInt(p.event_count) || 0,
        lastEvent: p.last_event,
      })),
      focusScore,
      window: `${days}d`,
    });
  } catch (err) {
    req.log.error({ err: err.message }, 'trends query failed');
    return reply.code(500).send({ error: 'Failed to fetch trends' });
  }
}

module.exports = dailyTrendsHandler;
