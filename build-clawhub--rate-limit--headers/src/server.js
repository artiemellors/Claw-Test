const express = require("express");
const { rateLimiter } = require("./rateLimiter");
const { createDashboardHtml } = require("./dashboard");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(rateLimiter);

app.get("/rate-limit/status", (req, res) => {
 res.json(req.rateLimit);
});

app.get("/dashboard", (_req, res) => {
 res.type("html").send(createDashboardHtml());
});

app.get("/api/example", (_req, res) => {
 res.json({ message: "OK", timestamp: Date.now() });
});

app.listen(PORT, () => console.log(Clawhub rate-limit server on :${PORT}));