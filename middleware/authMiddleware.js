// middleware/authMiddleware.js
// JWT access token verification — attaches full DB user to req.user.
// API key auth is NOT implicitly enabled here — routes that need it must
// mount apiKeyMiddleware explicitly as a separate middleware.

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const config = require('../config/config');
const logger = require('../config/logger');

/**
 * Pure JWT-only auth guard.
 * API key authentication is handled by apiKeyMiddleware on a per-route basis.
 */
const protect = () => {
  return async (req, res, next) => {
    const authHeader = req.headers.authorization;

    // ── No Bearer token present ──────────────────────────────
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // SECURITY: Warn and ignore API keys sent via query string
      if (req.query.apiKey) {
        logger.warn(
          'API key passed in query string — ignored for security. Use X-API-Key header or dedicated API key routes.',
          {
            ip: req.ip,
            url: req.originalUrl,
          }
        );
      }

      return res.status(401).json({ message: 'Unauthorized — no Bearer token provided' });
    }

    // ── Bearer token flow ────────────────────────────────────
    const token = authHeader.split(' ')[1];

    try {
      // MED-01 FIX: Explicitly pin algorithm to prevent algorithm confusion attacks.
      // Without this, a future library regression could accept 'none' or allow RS256 confusion.
      const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });

      // Fetch FULL user from DB — not stale JWT payload
      const user = await User.findById(decoded.id).select('-password');

      if (!user) {
        return res.status(401).json({ message: 'Unauthorized — user not found' });
      }

      // C-01 FIX: Block banned users at the auth layer before any route logic runs
      if (user.isBanned) {
        return res.status(403).json({ message: 'Forbidden — account suspended' });
      }

      // M-01 FIX: Block unverified users from protected routes
      if (!user.isVerified) {
        return res.status(403).json({ message: 'Forbidden — email not verified' });
      }

      req.user = user; // Full Mongoose document, not JWT payload
      req.authType = 'jwt'; // Explicitly mark the auth context

      next();
    } catch (err) {
      // L-07 FIX: Log JWT errors for diagnostics (never expose stack to client)
      logger.warn('JWT verification failed', { name: err.name, ip: req.ip });
      const msg =
        err.name === 'TokenExpiredError'
          ? 'Unauthorized — token expired'
          : 'Unauthorized — invalid token';
      return res.status(401).json({ message: msg });
    }
  };
};

module.exports = { protect };
