# Clawhub Rate Limit Visibility

Adds transparent rate limit visibility to Clawhub APIs so consumers always know their quota status.

## Features

- Standard X-RateLimit-* response headers on every API response
- GET /rate-limit/status endpoint to check current quota
- Minimal web dashboard at /dashboard showing remaining quota
- Configurable per-user and global rate limits
- Redis-backed sliding window counter

## Quick Start

bash
npm install
# Start Redis first
docker run -d -p 6379:6379 redis:7-alpine

# Run the server
cp .env.example .env
npm start


## Configuration

Edit .env:

| Variable | Default | Description |
|---|---|---|
| PORT | 3000 | Server port |
| REDIS_URL | redis://localhost:6379 | Redis connection |
| RATE_LIMIT_WINDOW_SEC | 60 | Window size in seconds |
| RATE_LIMIT_MAX_REQUESTS | 100 | Max requests per window |

## Rate Limit Headers

Every response includes:

| Header | Description |
|---|---|
| X-RateLimit-Limit | Max requests allowed in window |
| X-RateLimit-Remaining | Requests remaining |
| X-RateLimit-Reset | Unix timestamp when window resets |
| Retry-After | Seconds until retry (only on 429) |

## API

### GET /rate-limit/status

Returns current rate limit state for the authenticated user.

json
{
  "limit": 100,
  "remaining": 87,
  "reset": 1743000000,
  "windowSec": 60
}


### GET /dashboard

Browser-friendly dashboard showing quota in real time.

## Architecture

Request → identifyUser → slidingWindowCounter (Redis) → setHeaders → route/429


Uses a Redis sorted set sliding window algorithm for accurate, distributed rate counting.