const express = require("express");
const app = express();
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const mongoose = require("mongoose");

const allowedOrigins = [
  'http://localhost:3000',
  'https://password-website.onrender.com',
  'https://stashr-client.onrender.com',
  'https://stashr-v2-frontend.onrender.com',
  'https://stashr.ggnhome.com',
  'https://stashr.tanush.qd.je',
  'https://password-manager-server-10od.onrender.com',
  'https://stashr-home-automation.onrender.com',
  'https://stashr-home-automation-gk9p.onrender.com',
  'https://stashr-home-automation-eore.onrender.com'
];

// Chrome extension origins are exact (chrome-extension://<id>); list them in EXTENSION_ORIGINS.
// A wildcard entry never matched anything, so it was removed.
if (process.env.EXTENSION_ORIGINS)
{
  process.env.EXTENSION_ORIGINS.split(",").map((o) => o.trim()).filter((o) => o.startsWith("chrome-extension://")).forEach((o) => allowedOrigins.push(o));
}

// Extra origins can be supplied as a comma separated list (CLIENT_ORIGINS)
if (process.env.CLIENT_ORIGINS)
{
  process.env.CLIENT_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .forEach((origin) =>
    {
      if (!allowedOrigins.includes(origin)) allowedOrigins.push(origin);
    });
}

// Render / most PaaS sit behind a proxy: needed for per-IP rate limiting.
app.set("trust proxy", 1);
app.disable("x-powered-by");

// Security headers. This is a JSON API, so the strictest defaults apply.
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  referrerPolicy: { policy: "no-referrer" }
}));

app.use(cors({
  origin: function (origin, callback)
  {
    // No origin => same-origin call, curl, or an uptime/cron pinger
    if (!origin || allowedOrigins.includes(origin))
    {
      callback(null, true);
    }
    else
    {
      // Reject the CORS headers, but never throw: a bad origin must not
      // take the whole request down with a 500.
      callback(null, false);
    }
  },
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "Accept", "X-Client", "X-Client-Id", "X-Statement-Password"]
}));
app.use(compression()); // gzip JSON: the vault and Render lists are large and the free instance has a thin pipe
app.use(cookieParser());

const STARTED_AT = new Date();

app.use(express.json({ limit: "1mb" }));

// Request log for diagnosis: only failures (4xx/5xx) and slow requests, never bodies, cookies or query strings.
app.use((req, res, next) =>
{
  const started = Date.now();
  res.on("finish", () =>
  {
    const ms = Date.now() - started;
    if (res.statusCode >= 400 || ms > 3000) console.log(`[req] ${req.method} ${req.path} -> ${res.statusCode} in ${ms}ms`);
  });
  next();
});

/* ─────────────────────────────────────────────
   HEALTH CHECKS
   Public, unauthenticated and dependency free so
   an external cron job (cron-job.org, UptimeRobot,
   Render cron, ...) can keep the free-tier instance
   awake and alert when it is down.
───────────────────────────────────────────── */
const DB_STATES = ["disconnected", "connected", "connecting", "disconnecting"];

const buildHealthPayload = () =>
{
  const dbState = mongoose.connection ? mongoose.connection.readyState : 0;
  const memory = process.memoryUsage();

  return {
    status: "ok",
    service: "password-manager-api",
    message: "Server is awake and healthy 💗",
    update: 462075, // changed on every deploy so /health shows which version is live
    uptime: Number(process.uptime().toFixed(2)),
    startedAt: STARTED_AT.toISOString(),
    timestamp: new Date().toISOString(),
    database: {
      state: DB_STATES[dbState] || "unknown",
      connected: dbState === 1
    },
    memory: {
      rssMb: Number((memory.rss / 1024 / 1024).toFixed(2)),
      heapUsedMb: Number((memory.heapUsed / 1024 / 1024).toFixed(2))
    },
    env: process.env.NODE_ENV || "development"
  };
};

const healthHandler = (req, res) =>
{
  res.set("Cache-Control", "no-store");
  return res.status(200).json(buildHealthPayload());
};

// Primary health endpoint + the aliases uptime services commonly use
app.get("/health", healthHandler);
app.head("/health", (req, res) => res.status(200).end());
app.get("/healthz", healthHandler);
app.get("/api/health", healthHandler);

// Liveness is process-only; readiness also requires the primary database connection.
app.get("/livez", (req, res) => {
  res.set("Cache-Control", "no-store");
  return res.status(200).json({ status: "ok", service: "password-manager-api", uptime: Number(process.uptime().toFixed(2)), timestamp: new Date().toISOString() });
});
// A short, one-way fingerprint of SECRET_KEY: servers that show the same value accept each other's sign-in tokens.
// (It reveals nothing usable about the key itself.)
const sessionKeyFingerprint = () => {
  const key = process.env.SECRET_KEY;
  if (!key) return "missing";
  return require("crypto").createHmac("sha256", "stashr-session-key-check").update(String(key)).digest("hex").slice(0, 12);
};
app.get("/readyz", (req, res) => {
  const ready = mongoose.connection?.readyState === 1;
  res.set("Cache-Control", "no-store");
  return res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "not_ready",
    service: "password-manager-api",
    dependencies: { database: ready ? "connected" : "unavailable" },
    sessionKey: sessionKeyFingerprint(),
    timestamp: new Date().toISOString()
  });
});
app.get("/ping", (req, res) =>
{
  res.set("Cache-Control", "no-store");
  res.status(200).send("pong");
});

// Root route so a cron job hitting "/" also gets a 200 instead of a 404
app.get("/", (req, res) =>
{
  res.set("Cache-Control", "no-store");
  res.status(200).json({
    status: "ok",
    message: "Stashr API is running.",
    health: "/health"
  });
});

// Mobile update endpoints: release metadata and APK download redirect.
app.use("/api/mobile-updates", require("./router/mobileUpdates"));
app.use("/api/app-rollout", require("./router/appRollout"));
app.use("/api/ota", require("./router/ota"));

// LINKING THE ROUTER FILES 
app.use(require("./router/homeShare"));   // the public live-location link (no login; a secret address)
app.use(require("./router/routing"));

// 404 for anything unmatched
app.use((req, res) =>
{
  res.status(404).json({ error: "Route not found." });
});

// CENTRAL ERROR HANDLER - keeps the process alive on bad requests
app.use((err, req, res, next) =>
{
  console.error("Unhandled request error:", err.message);
  if (res.headersSent) return next(err);
  if (err.type === "entity.parse.failed" || err.type === "entity.too.large")
  {
    return res.status(err.status || 400).json({ error: "Invalid request body." });
  }
  res.status(500).json({ error: "There was an internal error. Sorry for the inconvenience." });
});

module.exports = app;
