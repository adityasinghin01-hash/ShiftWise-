// middleware/requestLogger.js
// Morgan HTTP request logger — pipes to central Winston logger.
// Includes request ID for log correlation.

const morgan = require('morgan');
const logger = require('../config/logger');

// ── Morgan → Winston bridge ──────────────────────────────
const stream = { write: (message) => logger.http(message.trim()) };

// Skip health check to reduce noise
const skip = (req) => req.originalUrl === '/api/health';

// Custom token: request ID from requestId middleware
morgan.token('request-id', (req) => req.id || '-');

// HIGH-04 FIX: Custom sanitized-url token.
// Routes that carry one-time tokens as query params (verify-email, reset-password)
// must NOT have their full query string written to logs — that would expose live
// tokens to anyone with log access (Render dashboard, log drains, etc.).
// We log only the path (no query string) for these sensitive endpoints.
//
// Audit any new token-bearing GET endpoint and add its prefix here.
const SENSITIVE_PATH_PREFIXES = ['/api/v1/verify-email', '/api/v1/password/reset-password'];

morgan.token('safe-url', (req) => {
  const isSensitive = SENSITIVE_PATH_PREFIXES.some((prefix) => req.originalUrl.startsWith(prefix));
  // For sensitive paths: log path only, strip query string
  return isSensitive ? req.path : req.originalUrl;
});

const httpLogger = morgan(
  ':request-id :method :safe-url :status :res[content-length] - :response-time ms [:remote-addr]',
  { stream, skip }
);

module.exports = { httpLogger };
