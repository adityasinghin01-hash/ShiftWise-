// middleware/requestId.js
// Generates a unique UUID for every incoming request.
// Attaches to req.id and sets X-Request-Id response header.
// Used by requestLogger (Morgan) and errorHandler for log correlation.
//
// S-01 FIX: Validate incoming X-Request-Id against UUID v4 format.
// Untrusted client values are rejected to prevent log injection attacks.
// Only canonical UUID v4 format is accepted; all others get a fresh UUID.

const { v4: uuidv4 } = require('uuid');

// UUID v4 regex: 8-4-4-4-12 hex, version digit = 4, variant bits = 8/9/a/b
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const requestId = (req, res, next) => {
  const incoming = req.headers['x-request-id'];
  // Normalise to lowercase so log correlation is case-insensitive safe.
  const id = incoming && UUID_V4_RE.test(incoming) ? incoming.toLowerCase() : uuidv4();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
};

module.exports = requestId;
