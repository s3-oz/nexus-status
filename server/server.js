// Fastify entrypoint for nexus-status v2 (Mini-hosted).
// Reads DATABASE_URL and NEXUS_STATUS_API_KEY from env (or .env file via dotenv).
// Exposes the 5 original endpoints plus /api/health.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Fastify = require('fastify');

const { requireApiKey } = require('./auth');
const pulseHandler = require('./routes/pulse');
const sessionsHandler = require('./routes/sessions');
const rateLimitsHandler = require('./routes/rate-limits');
const activityEventsHandler = require('./routes/activity-events');
const activityStatsHandler = require('./routes/activity-stats');
const dailyTrendsHandler = require('./routes/daily-trends');
const healthHandler = require('./routes/health');

const PORT = parseInt(process.env.PORT) || 3457;
const HOST = process.env.HOST || '0.0.0.0';

function build() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport: process.env.NODE_ENV === 'production'
        ? undefined
        : { target: 'pino-pretty', options: { singleLine: true } },
    },
    bodyLimit: 1024 * 1024, // 1MB — pulse payloads are small
  });

  // Health — no auth
  app.get('/api/health', healthHandler);
  app.get('/health', healthHandler); // convenience

  // Authed group
  app.register(async (authed) => {
    authed.addHook('preHandler', requireApiKey);

    authed.post('/api/pulse', pulseHandler);
    authed.get('/api/sessions', sessionsHandler);
    authed.get('/api/rate-limits', rateLimitsHandler);
    authed.get('/api/activity/events', activityEventsHandler);
    authed.get('/api/activity/stats', activityStatsHandler);
    authed.get('/api/daily/trends', dailyTrendsHandler);
  });

  return app;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('FATAL: DATABASE_URL not set');
    process.exit(1);
  }
  if (!process.env.NEXUS_STATUS_API_KEY) {
    console.error('FATAL: NEXUS_STATUS_API_KEY not set');
    process.exit(1);
  }

  const app = build();
  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info({ port: PORT, host: HOST }, 'nexus-status v2 listening');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { build };
