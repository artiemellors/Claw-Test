const Redis = require("ioredis");

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
const WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW_SEC || "60", 10);
const MAX = parseInt(process.env.RATE_LIMIT_MAX || "100", 10);

function getKey(req) {
 const user = req.headers["x-api-key"] || req.ip;
 return rl:${user};
}

async function rateLimiter(req, res, next) {
 const key = getKey(req);
 const now = Date.now();
 const windowStart = now - WINDOW  1000;

 const pipeline = redis.pipeline();
 pipeline.zremrangebyscore(key, 0, windowStart);
 pipeline.zadd(key, now, ${now}:${Math.random()});
 pipeline.zcard(key);
 pipeline.expire(key, WINDOW);
 const results = await pipeline.exec();

 const used = results[2][1];
 const remaining = Math.max(0, MAX - used);
 const reset = Math.ceil(now / 1000) + WINDOW;

 req.rateLimit = { limit: MAX, remaining, reset, window: WINDOW, used };

 res.set({
   "X-RateLimit-Limit": String(MAX),
   "X-RateLimit-Remaining": String(remaining),
   "X-RateLimit-Reset": String(reset),
   "X-RateLimit-Window": String(WINDOW),
 });

 if (remaining <= 0) {
   res.set("Retry-After", String(WINDOW));
   return res.status(429).json({
     error: "Rate limit exceeded",
     ...req.rateLimit,
   });
 }

 next();
}

module.exports = { rateLimiter };