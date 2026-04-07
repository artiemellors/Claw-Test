const { checkAndIncrement } = require('../lib/rateCounter');

function identifyUser(req) {
 return req.headers['x-api-key'] || req.ip;
}

async function rateLimiter(req, res, next) {
 const userId = identifyUser(req);
 const key = rl:${userId};

 try {
   const info = await checkAndIncrement(key);

   // Always attach headers for visibility
   res.set('X-RateLimit-Limit', String(info.limit));
   res.set('X-RateLimit-Remaining', String(info.remaining));
   res.set('X-RateLimit-Reset', String(info.resetAt));

   // Stash for status endpoint
   req.rateLimitInfo = info;

   if (info.remaining <= 0 && info.count > info.limit) {
     const retryAfter = Math.max(1, info.resetAt - Math.ceil(Date.now() / 1000));
     res.set('Retry-After', String(retryAfter));
     return res.status(429).json({
       error: 'Too Many Requests',
       limit: info.limit,
       remaining: 0,
       resetAt: info.resetAt,
       retryAfter,
     });
   }

   next();
 } catch (err) {
   console.error('Rate limiter error:', err.message);
   next(); // fail open
 }
}

module.exports = { rateLimiter };