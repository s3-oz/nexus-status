function withAuth(handler) {
  return async (req, res) => {
    const apiKey = req.headers['x-api-key'];

    if (!apiKey || apiKey !== process.env.NEXUS_STATUS_API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    return handler(req, res);
  };
}

module.exports = { withAuth };
