require('dotenv').config();
const express = require('express');
const { rateLimiter } = require('./middleware/rateLimiter');
const { statusRoute } = require('./routes/status');
const { dashboardRoute } = require('./routes/dashboard');
const { redis } = require('./lib/redis');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(rateLimiter);

app.get('/rate-limit/status', statusRoute);
app.get('/dashboard', dashboardRoute);

// Example protected route
app.get('/api/resource', (req, res) => {
 res.json({ data: 'Hello from Clawhub!' });
});

app.listen(PORT, () => console.log(Clawhub listening on :${PORT}));

process.on('SIGTERM', () => redis.quit());