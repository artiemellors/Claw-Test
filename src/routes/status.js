function statusRoute(req, res) {
 const info = req.rateLimitInfo;
 if (!info) return res.status(503).json({ error: 'Rate limit info unavailable' });

 res.json({
   limit: info.limit,
   remaining: info.remaining,
   reset: info.resetAt,
   windowSec: parseInt(process.env.RATELIMIT_WINDOW_SEC, 10) || 60,
 });
}

module.exports = { statusRoute };