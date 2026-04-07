# Clawhub Rate Limit Visibility

Adds transparent rate limit visibility to Clawhub APIs so consumers always know their quota status.

## Features

- Standard X-RateLimit-* response headers on every API response
- GET /rate-limit/status endpoint to check current quota
- Minimal web dashboard to visualize remaining quota
- Configurable per-user and per-endpoint limits
- Redis-backed sliding window counter

## Quick Start

bash
npm install
# Start Redis first (docker or local)
docker run -d -p 6379:6379 redis:7-alpine
# Run the server
npm start


Server starts on http://localhost:3000.

## Configuration

Set via environment variables:

| Variable | Default | Description |
|---|---|---|
| PORT | 3000 | Server port |
| REDIS_URL | redis://localhost:6379 | Redis connection URL |
| RATE_LIMIT_WINDOW_SEC | 60 | Sliding window in seconds |
| RATE_LIMIT_MAX | 100 | Max requests per window |

## API

### Any endpoint — Response Headers

Every response includes:

X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1712524620
X-RateLimit-Window: 60
Retry-After: 12          (only when limit exceeded)


### GET /rate-limit/status

Returns current quota as JSON:

json
{
  "limit": 100,
  "remaining": 87,
  "reset": 1712524620,
  "window": 60,
  "used": 13
}


### GET /dashboard

Minimal HTML dashboard showing quota in real-time.

### GET /api/example

Sample protected endpoint for testing.

## Architecture

Client → Express middleware (rateLimiter) → Route handler
              ↓
         Redis (sliding window counter)
              ↓
         Injects X-RateLimit-* headers


## License

MIT