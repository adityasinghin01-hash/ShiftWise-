// app.js
// Express app — middleware stack in exact order per ARCHITECTURE_MAP §6.
// Routes are mounted here. Error handler is last.

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const mongoSanitize = require('express-mongo-sanitize');
const cookieParser = require('cookie-parser');
// MED-05 FIX: xss-clean removed — it has an unpatched prototype pollution CVE and
// has not been maintained since 2020. Input sanitization is handled by:
//   • express-mongo-sanitize — NoSQL injection prevention
//   • express-validator (isString, trim, escape) — per-field XSS prevention
//   • Helmet CSP — browser-side XSS mitigation
// Using a vulnerable "protection" package is worse than not using it.
const hpp = require('hpp');
const config = require('./config/config');
const { globalLimiter } = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');
const { httpLogger } = require('./middleware/requestLogger');
const securityHeaders = require('./middleware/securityHeaders');

const app = express();
// C-03: Render deploys behind exactly ONE reverse proxy.
// 'trust proxy 1' tells Express to trust X-Forwarded-For from that single hop,
// so req.ip, req.protocol, and rate-limiter keys resolve correctly.
// Do NOT increase this value unless an additional proxy layer is added.
app.set('trust proxy', 1);

// ── 1. Security Headers ───────────────────────────────────
// TECH_DECISIONS §1.8: Explicit CSP config, not just defaults
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // SPA + reCAPTCHA v2 + Google Identity Services (GIS)
        scriptSrc: [
          "'self'",
          'https://www.google.com', // reCAPTCHA v2 api.js
          'https://www.gstatic.com', // reCAPTCHA internal chunks
          'https://accounts.google.com', // GIS client
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://fonts.googleapis.com',
          'https://accounts.google.com', // GIS stylesheet (gsi/style)
        ],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        // reCAPTCHA renders in an iframe from google.com
        frameSrc: ['https://www.google.com', 'https://accounts.google.com'],
        // GIS token exchange + reCAPTCHA verification
        connectSrc: ["'self'", 'https://www.google.com', 'https://accounts.google.com'],
        // Google profile images
        imgSrc: ["'self'", 'data:', 'https://www.gstatic.com', 'https://lh3.googleusercontent.com'],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// ── 1b. Additional Security Headers ──────────────────────
// Supplements helmet with COEP, COOP, CORP, Permissions-Policy
app.use(securityHeaders);

// ── 2. CORS (whitelist only) ──────────────────────────────
// Fixes B-08: old version had cors() with zero config — allowed every origin
app.use(
  cors({
    origin: config.ALLOWED_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-Id'],
    maxAge: 86400, // Cache preflight for 24h
  })
);

// ── 3. Body Parser (with size limit) ─────────────────────
// Fixes B-21: old version had no body size limit — DoS vector
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

// ── 3b. Cookie Parser ────────────────────────────────────
// Task 5: HttpOnly cookie support for refresh tokens
app.use(cookieParser());

// ── 4. Input Sanitization ────────────────────────────────
// Fixes B-12: old version had zero sanitization — NoSQL injection possible
app.use(mongoSanitize());

// ── 4b. HTTP Parameter Pollution ─────────────────────────
// Prevents duplicate query parameters (e.g., ?sort=name&sort=email)
app.use(hpp());

// ── 5. Request ID ────────────────────────────────────────
// Generates UUID per request for log correlation
const requestId = require('./middleware/requestId');
app.use(requestId);

// ── 6. Request Logger ────────────────────────────────────
// Structured request logging — includes request ID
app.use(httpLogger);

// ── 7. Global Rate Limiter ───────────────────────────────
app.use('/api', globalLimiter);

// ── 8. Routes ────────────────────────────────────────────
// Health check is unversioned — Render probes /api/health directly.
app.use('/api', require('./routes/health.routes'));

// All versioned routes under /api/v1/
app.use('/api/v1', require('./routes/v1'));

// ── 9. Static Frontend (SPA) ─────────────────────────────────────────────────
// Serve Vite build output. API routes registered above take priority.
// Hash-based routing means the browser never requests non-index paths,
// so a single catch-all for index.html is sufficient.
const distPath = path.join(__dirname, 'frontend', 'dist');
app.use(express.static(distPath));

// ── 10. SPA Fallback — serve index.html for browser navigation only ──────────
// Required so that deep-linking / page-refresh on hash routes works.
// req.accepts(['json','html']) compares q-values and returns the preferred type.
// Browsers prefer 'html'; curl/fetch/API clients prefer 'json'.
// The Q-02 test hits with default Accept (*/*) which prefers json → falls through.
app.get(/^(?!\/api).*/, (req, res, next) => {
  const preferred = req.accepts(['json', 'html']);
  if (preferred === 'html') {
    return res.sendFile(path.join(distPath, 'index.html'));
  }
  next();
});

// ── 11. API 404 Catch-All (MUST be before error handler, after all routes) ───
// Fixes Q-02: Without this, Express returns HTML for unknown API routes —
// breaks the JSON-only API contract and leaks framework info.
// M4 FIX (Wave 4): match the unified error shape from middleware/errorHandler.js
// — { success, code, message, request_id } — so clients can parse all
// error responses with one schema.
app.use((req, res) => {
  res.status(404).json({
    success: false,
    code: 'not_found',
    message: `Route not found: ${req.method} ${req.originalUrl}`,
    request_id: req.id,
  });
});

// ── 12. Global Error Handler (MUST be last) ─────────────────────────────────
app.use(errorHandler);

module.exports = app;
