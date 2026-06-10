// routes/health.routes.js
// Health check endpoints — lightweight probe + deep diagnostic.
// Mounted at /api (unversioned) so Render can probe /api/health without versioning.

const express = require('express');
const mongoose = require('mongoose');
const os = require('os');
const router = express.Router();

// ── GET /api/health ──────────────────────────────────────
// Lightweight — no DB calls. Render probes this every 30s.
// Must respond fast (<100ms) even if DB is connecting.
router.get('/health', (req, res) => {
  return res.status(200).json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// ── GET /api/health/deep ─────────────────────────────────
// Full diagnostic — checks MongoDB, memory, readiness.
// Use for debugging, dashboards, and alerting.
// Returns 200 if all healthy, 503 if degraded.
router.get('/health/deep', async (req, res) => {
  const checks = {
    database: 'unknown',
    memory: {},
    server: {},
  };
  let isHealthy = true;

  // ── MongoDB ──────────────────────────────────────────
  try {
    const dbStates = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    const readyState = mongoose.connection.readyState;
    checks.database = dbStates[readyState] || 'unknown';

    if (readyState === 1) {
      // M5 FIX (Wave 4): cap the ping at 2s so a wedged connection can't hang
      // the health probe and cascade into orchestrator timeouts.
      const start = Date.now();
      const PING_TIMEOUT_MS = 2000;
      await Promise.race([
        mongoose.connection.db.admin().ping(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('ping timeout')), PING_TIMEOUT_MS)
        ),
      ]);
      checks.databaseResponseMs = Date.now() - start;
    } else {
      isHealthy = false;
    }
  } catch (err) {
    checks.database = 'error';
    checks.databaseError = err.message;
    isHealthy = false;
  }

  // ── Memory ───────────────────────────────────────────
  const mem = process.memoryUsage();
  const totalMem = os.totalmem();
  checks.memory = {
    rss: `${Math.round(mem.rss / 1024 / 1024)}MB`,
    heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
    heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024)}MB`,
    external: `${Math.round(mem.external / 1024 / 1024)}MB`,
    systemTotal: `${Math.round(totalMem / 1024 / 1024)}MB`,
    rssPercent: `${((mem.rss / totalMem) * 100).toFixed(1)}%`,
  };

  // Flag if RSS exceeds 512MB (Render free tier limit)
  if (mem.rss > 512 * 1024 * 1024) {
    checks.memory.warning = 'RSS exceeds 512MB — approaching memory limit';
    isHealthy = false;
  }

  // ── Server Info ──────────────────────────────────────
  checks.server = {
    nodeVersion: process.version,
    platform: process.platform,
    uptime: `${Math.floor(process.uptime())}s`,
    pid: process.pid,
    isReady: req.app.locals.isReady,
  };

  // Overall readiness check
  if (!req.app.locals.isReady) {
    isHealthy = false;
  }

  return res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    checks,
  });
});

module.exports = router;
