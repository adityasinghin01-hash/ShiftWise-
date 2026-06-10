// middleware/planMiddleware.js
//
// Optional plan-gating middleware for consumer apps.
//
// USAGE — these helpers are NOT wired into any built-in route. The boilerplate
// ships them as ready-to-use middleware that downstream apps can mount on
// THEIR own protected endpoints. Two reasons they're not used in-tree:
//   1. Plan limits (`apiCallsPerMonth`, `storageGB`) only matter when there's
//      something to count. Counting requires application-specific business
//      logic that the boilerplate can't predict.
//   2. Forcing a plan check on every endpoint would be wrong for the auth /
//      profile / admin routes that ship in this repo.
//
// Example:
//
//   const { requirePlan, checkLimit } = require('./middleware/planMiddleware');
//   const { authorize } = require('./middleware/rbacMiddleware');
//
//   // Pro+ only, with API-call quota enforcement and request counting:
//   router.post('/projects/:id/render',
//     protect(),
//     requirePlan('pro', 'enterprise'),
//     checkLimit('apiCallsPerMonth'),
//     renderController.run);
//
// On exceeded limits, checkLimit returns 429 with the current usage in the body.
// `req.subscription` and `req.plan` are attached by requirePlan and re-used by
// checkLimit on the same chain to avoid a redundant DB query.
//
// MUST be executed after authMiddleware.js — both helpers read req.user.id.

const Subscription = require('../models/Subscription');
const logger = require('../config/logger');
const { enforceLimit } = require('../services/subscriptionService');

/**
 * Middleware factory that restricts access to users on specific plans.
 * @param {...string} allowedPlans - Plan names that are allowed (e.g., 'pro', 'enterprise').
 */
const requirePlan = (...allowedPlans) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const subscription = await Subscription.findOne({
        userId: req.user.id,
        status: 'active',
      }).populate('planId');

      if (!subscription || !subscription.planId) {
        logger.warn(`Plan check failed: No active subscription for user ${req.user.id}`);
        return res.status(403).json({
          success: false,
          message: 'No active subscription found. Please subscribe to a plan.',
        });
      }

      if (!allowedPlans.includes(subscription.planId.name)) {
        logger.warn(
          `Plan check failed: User ${req.user.id} on '${subscription.planId.name}' plan — requires [${allowedPlans.join(', ')}]`
        );
        return res.status(403).json({
          success: false,
          message: `This feature requires a ${allowedPlans.join(' or ')} plan.`,
          currentPlan: subscription.planId.name,
        });
      }

      // Attach subscription and plan to request for downstream use
      req.subscription = subscription;
      req.plan = subscription.planId;
      next();
    } catch (err) {
      logger.error('Error in requirePlan middleware:', err);
      next(err);
    }
  };
};

/**
 * Middleware factory that checks if a user has exceeded a specific plan limit.
 * @param {string} limitKey - The limit to check (e.g., 'apiCallsPerMonth', 'maxApiKeys', 'webhooksAllowed').
 */
const checkLimit = (limitKey) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      // Reuse subscription from requirePlan if available, otherwise fetch fresh.
      // This prevents a redundant DB query when both middlewares are chained.
      let subscription = req.subscription;
      if (!subscription) {
        subscription = await Subscription.findOne({
          userId: req.user.id,
          status: 'active',
        }).populate('planId');
      }

      if (!subscription || !subscription.planId) {
        return res.status(403).json({
          success: false,
          message: 'No active subscription found.',
        });
      }

      const plan = subscription.planId;
      // Fail closed on unknown/invalid limitKey from schema
      if (plan.limits[limitKey] === undefined) {
        logger.error(
          `Middleware misconfiguration: Limit key '${limitKey}' not found in plan limits`
        );
        return res.status(500).json({ success: false, message: 'Internal server error' });
      }

      // Atomic check and increment via service
      const result = await enforceLimit(req.user.id, limitKey, 1);

      if (!result.allowed) {
        // If it's a key that cannot be checked/incremented per-request (like maxApiKeys)
        if (result.reason === 'Unsupported rate-limited key') {
          logger.error(
            `Middleware misconfiguration: checkLimit used for unsupported key '${limitKey}'. This limit should be checked at resource creation time.`
          );
          return res.status(500).json({ success: false, message: 'Internal server error' });
        }

        // Normal limit exceeded
        logger.warn(
          `Limit exceeded: User ${req.user.id} hit ${limitKey} limit (${result.currentUsage}/${result.limit})`
        );
        return res.status(429).json({
          success: false,
          message: `Plan limit reached for ${limitKey}. Please upgrade your plan.`,
          limit: result.limit,
          currentUsage: result.currentUsage,
          currentPlan: plan.name,
        });
      }

      req.subscription = subscription;
      req.plan = plan;
      next();
    } catch (err) {
      logger.error('Error in checkLimit middleware:', err);
      next(err);
    }
  };
};

module.exports = { requirePlan, checkLimit };
