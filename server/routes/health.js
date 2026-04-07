// GET /api/health — self-monitoring endpoint.
// No auth required (intentional — nexus-monitor needs to ping without secrets).
// Reports DB reachability, last pulse age, session count.
const { pool } = require('../db');

async function healthHandler(req, reply) {
  const start = Date.now();
  try {
    const { rows } = await pool.query(
      `SELECT
         COUNT(*) AS session_count,
         EXTRACT(EPOCH FROM (NOW() - MAX(last_activity))) * 1000 AS last_pulse_age_ms
       FROM sessions`,
    );
    const dbLatencyMs = Date.now() - start;
    const row = rows[0] || {};
    return reply.send({
      ok: true,
      dbLatencyMs,
      sessionCount: parseInt(row.session_count) || 0,
      lastPulseAgeMs: row.last_pulse_age_ms != null ? parseInt(row.last_pulse_age_ms) : null,
      version: '2.0.0',
      host: process.env.HOSTNAME || null,
    });
  } catch (err) {
    return reply.code(503).send({ ok: false, error: err.message });
  }
}

module.exports = healthHandler;
