const { neon } = require('@neondatabase/serverless');
const { withAuth } = require('../../middleware/auth');

module.exports = withAuth(async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sql = neon(process.env.DATABASE_URL);
  const days = Math.min(parseInt(req.query.days) || 7, 30);

  try {
    // Daily event counts
    const dailyEvents = await sql`
      SELECT
        date_trunc('day', created_at)::date AS day,
        COUNT(*) AS total_events,
        COUNT(DISTINCT project_name) AS active_projects,
        COUNT(DISTINCT session_id) AS unique_sessions
      FROM activity_events
      WHERE created_at > NOW() - INTERVAL '1 day' * ${days}
      GROUP BY date_trunc('day', created_at)::date
      ORDER BY day ASC
    `;

    // Daily session hours
    const dailySessions = await sql`
      SELECT
        date_trunc('day', started_at)::date AS day,
        COUNT(*) AS sessions_started,
        COALESCE(SUM(EXTRACT(EPOCH FROM (last_activity - started_at)) / 3600), 0) AS hours_tracked
      FROM sessions
      WHERE started_at > NOW() - INTERVAL '1 day' * ${days}
      GROUP BY date_trunc('day', started_at)::date
      ORDER BY day ASC
    `;

    // Operation breakdown for the period
    const opBreakdown = await sql`
      SELECT
        operation,
        COUNT(*) AS count
      FROM activity_events
      WHERE created_at > NOW() - INTERVAL '1 day' * ${days}
      GROUP BY operation
      ORDER BY count DESC
      LIMIT 20
    `;

    // Project activity ranking
    const projectRanking = await sql`
      SELECT
        project_name,
        COUNT(*) AS event_count,
        MAX(created_at) AS last_event
      FROM activity_events
      WHERE created_at > NOW() - INTERVAL '1 day' * ${days}
      GROUP BY project_name
      ORDER BY event_count DESC
      LIMIT 15
    `;

    // Focus score: ratio of events in top project vs total
    const totalEvents = dailyEvents.reduce((sum, d) => sum + parseInt(d.total_events), 0);
    const topProject = projectRanking[0];
    const focusScore = totalEvents > 0 && topProject
      ? Math.round((parseInt(topProject.event_count) / totalEvents) * 100)
      : 0;

    return res.status(200).json({
      days: dailyEvents.map(d => {
        const sessionDay = dailySessions.find(s => s.day === d.day) || {};
        return {
          date: d.day,
          events: parseInt(d.total_events) || 0,
          activeProjects: parseInt(d.active_projects) || 0,
          uniqueSessions: parseInt(d.unique_sessions) || 0,
          sessionsStarted: parseInt(sessionDay.sessions_started) || 0,
          hoursTracked: Math.round(parseFloat(sessionDay.hours_tracked) || 0),
        };
      }),
      operations: opBreakdown.map(o => ({
        operation: o.operation,
        count: parseInt(o.count) || 0,
      })),
      projectRanking: projectRanking.map(p => ({
        projectName: p.project_name,
        eventCount: parseInt(p.event_count) || 0,
        lastEvent: p.last_event,
      })),
      focusScore,
      window: `${days}d`,
    });
  } catch (err) {
    console.error('Trends query error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch trends' });
  }
});
