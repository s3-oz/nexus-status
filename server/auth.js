// Fastify preHandler for API-key auth. Matches existing x-api-key contract.
async function requireApiKey(req, reply) {
  const key = req.headers['x-api-key'];
  const expected = process.env.NEXUS_STATUS_API_KEY;
  if (!expected) {
    // Fail closed — never run without a configured key.
    return reply.code(500).send({ error: 'Server misconfigured: no API key set' });
  }
  if (!key || key !== expected) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
}

module.exports = { requireApiKey };
