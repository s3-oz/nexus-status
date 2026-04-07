// Shared pg.Pool for all routes. Single connection pool for the whole process.
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  // Log but don't crash — Fastify will surface query errors per-request.
  console.error('[db] pool error:', err.message);
});

module.exports = { pool };
