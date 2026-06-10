// middleware/apiKeyMiddleware.js
// Securely authenticates API requests via key, matching JWT behavior for downstream controllers.

const crypto = require('crypto');
const ApiKey = require('../models/ApiKey');
const User = require('../models/User');
const config = require('../config/config');
const logger = require('../config/logger');

// ── Pending Updates Tracking ────────────────────────────────────
// Fire-and-forget usage updates are tracked so callers (graceful shutdown,
// test harness) can await completion via drainPendingUpdates().
const pendingUpdates = new Set();

/**
 * Validates incoming API key, checks scopes, and attaches the user.
 * Built as a factory to optionally require certain scopes.
 */
const apiKeyMiddleware = (requiredScope = null) => {
  return async (req, res, next) => {
    try {
      // SECURITY: Only accept API keys from the X-API-Key header.
      // Query string auth is rejected to prevent key leakage in server logs and referer headers.
      if (req.query.apiKey) {
        return res.status(400).json({
          success: false,
          message: 'API keys via query string are not supported. Use the X-API-Key header.',
        });
      }

      const rawKey = req.header('X-API-Key');

      if (!rawKey) {
        return res.status(401).json({
          success: false,
          message: 'Access denied. No API key provided.',
        });
      }

      // Fail fast if API_KEY_SALT is not configured — prevents running with a default/empty salt
      if (!config.API_KEY_SALT) {
        logger.error(
          'CRITICAL: API_KEY_SALT is not configured. API key authentication is disabled.'
        );
        return res.status(500).json({
          success: false,
          message: 'Server configuration error. Contact administrator.',
        });
      }

      // HMAC SHA-256 for secure comparison against DB
      const hash = crypto.createHmac('sha256', config.API_KEY_SALT).update(rawKey).digest('hex');

      // Find key and verify it's active
      const apiKeyDoc = await ApiKey.findOne({ keyHash: hash, isActive: true });

      if (!apiKeyDoc) {
        return res.status(401).json({
          success: false,
          message: 'Invalid or inactive API key.',
        });
      }

      // Validate key expiration
      if (apiKeyDoc.expiresAt && apiKeyDoc.expiresAt < new Date()) {
        return res.status(401).json({
          success: false,
          message: 'API key has expired.',
        });
      }

      // Verify requested scope vs key scopes
      if (requiredScope && !apiKeyDoc.scopes.includes(requiredScope)) {
        return res.status(403).json({
          success: false,
          message: `Forbidden. Custom API key scope required: ${requiredScope}`,
        });
      }

      // Ensure the user account exists and is not banned/unverified.
      // H10 FIX: match JWT auth behavior (protect()) which blocks both banned
      // and unverified users. An API key created by a verified user should be
      // rejected if the user later becomes unverified (rare but possible).
      const user = await User.findById(apiKeyDoc.userId);
      if (!user || user.isBanned) {
        return res.status(403).json({
          success: false,
          message: 'User account is inactive or banned.',
        });
      }
      if (!user.isVerified) {
        return res.status(403).json({
          success: false,
          message: 'User email not verified.',
        });
      }

      // Attach identical JWT-style object so controllers don't break
      req.user = user;
      req.apiKey = apiKeyDoc;
      req.authType = 'apikey';

      // Proceed to the next middleware/controller immediately.
      // Usage stats are updated asynchronously below — acceptable trade-off
      // for latency. Use drainPendingUpdates() during shutdown to flush.
      next();

      // Fire-and-forget: background usage stats update
      const updatePromise = ApiKey.updateOne(
        { _id: apiKeyDoc._id },
        {
          $inc: { usageCount: 1 },
          $set: { lastUsedAt: new Date() },
        }
      )
        .catch((err) =>
          logger.error(`Failed to update API key stats for ID ${apiKeyDoc._id}:`, err)
        )
        .finally(() => pendingUpdates.delete(updatePromise));

      pendingUpdates.add(updatePromise);
    } catch (error) {
      logger.error('API Key Middleware Error:', error);
      // Delegate to centralized error handler instead of responding directly
      next(error);
    }
  };
};

/**
 * Await all in-flight usage stat updates.
 * Call during graceful shutdown or after test suites to prevent lost writes.
 */
const drainPendingUpdates = () => Promise.all(pendingUpdates);

module.exports = apiKeyMiddleware;
module.exports.drainPendingUpdates = drainPendingUpdates;
