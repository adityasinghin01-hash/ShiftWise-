// services/subscriptionService.js
// Core subscription business logic: default plan assignment, limit enforcement, usage tracking.
//
// USAGE NOTE — `enforceLimit`, `trackUsage`, and `rolloverSubscriptionPeriod`
// are exported for application code that wants to enforce or report on a
// user's plan quota. The boilerplate's built-in routes don't use them
// (see middleware/planMiddleware.js header for why); they exist for
// downstream apps to call from their own controllers / middleware.
// `createDefaultFreeSubscription` IS used internally — it's called from
// signup and from scripts/reconcile-subscriptions.js.

const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');
const logger = require('../config/logger');

/**
 * Creates a default free subscription for a newly registered user.
 * Called during signup (authController).
 * @param {string} userId - The MongoDB ObjectId of the new user.
 * @returns {Object} The created subscription document.
 */
const createDefaultFreeSubscription = async (userId) => {
  const freePlan = await Plan.findOne({ name: 'free', isActive: true });

  if (!freePlan) {
    logger.error('Free plan not found in database — cannot assign default subscription.');
    throw new Error('Free plan not configured. Please run the seed-plans script.');
  }

  // Check if user already has an active subscription (idempotent)
  const now = new Date();

  try {
    const subscription = await Subscription.findOneAndUpdate(
      { userId, status: 'active' },
      {
        $setOnInsert: {
          userId,
          planId: freePlan._id,
          status: 'active',
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), // 30 days
          cancelAtPeriodEnd: false,
          usage: { apiCalls: 0, storage: 0 },
        },
      },
      { upsert: true, returnDocument: 'after' }
    );

    logger.info(`Default free subscription ensured for user ${userId}`);
    return subscription;
  } catch (err) {
    // If duplicate key error (11000) race condition occurs, return existing
    if (err.code === 11000) {
      logger.info(`User ${userId} already has an active subscription — returning existing.`);
      return await Subscription.findOne({ userId, status: 'active' });
    }
    throw err;
  }
};

/**
 * C5 FIX: Rolls over a subscription to the next billing period when
 * currentPeriodEnd has passed, resetting usage counters to zero.
 *
 * Wave 4 / C4 FIX: rollover is now atomic. The findOneAndUpdate filter
 * pins on the OLD currentPeriodEnd, so two concurrent rollovers can't both
 * advance the period — only one writer wins. The other call sees an
 * already-rolled subscription and returns it unchanged.
 *
 * Called lazily from enforceLimit so that even without a scheduled cron
 * job, the first API call after a period ends triggers the reset correctly.
 *
 * @param {object} subscription - Mongoose document (must have currentPeriodEnd)
 * @returns {object} The (possibly updated) subscription document
 */
const rolloverSubscriptionPeriod = async (subscription) => {
  const now = new Date();
  if (subscription.currentPeriodEnd >= now) {
    return subscription; // period still active — nothing to do
  }

  // Advance the period by 30-day increments until it's in the future.
  // Using increments handles the case where multiple periods were missed
  // (e.g. service was down for 60 days).
  const MS_30_DAYS = 30 * 24 * 60 * 60 * 1000;
  let newStart = new Date(subscription.currentPeriodEnd);
  let newEnd = new Date(newStart.getTime() + MS_30_DAYS);
  while (newEnd < now) {
    newStart = newEnd;
    newEnd = new Date(newStart.getTime() + MS_30_DAYS);
  }

  // C4 FIX: include the old currentPeriodEnd in the filter so only one
  // concurrent caller can win the rollover. If another writer already
  // advanced the period, this returns null and we re-fetch the latest.
  const updated = await Subscription.findOneAndUpdate(
    { _id: subscription._id, currentPeriodEnd: subscription.currentPeriodEnd },
    {
      $set: {
        currentPeriodStart: newStart,
        currentPeriodEnd: newEnd,
        'usage.apiCalls': 0,
        'usage.storage': 0,
      },
    },
    { returnDocument: 'after' }
  );

  if (updated) {
    logger.info(`Subscription period rolled over for user ${subscription.userId}`, {
      subscriptionId: subscription._id,
      newPeriodStart: newStart,
      newPeriodEnd: newEnd,
    });
    return updated;
  }

  // Lost the race — another caller already advanced the period.
  // Return the current, freshly-fetched subscription state.
  const latest = await Subscription.findById(subscription._id);
  return latest || subscription;
};

/**
 * Checks if a user's usage is within their plan limit for a given key.
 * @param {string} userId - The user's MongoDB ObjectId.
 * @param {string} limitKey - The limit to check (e.g., 'apiCallsPerMonth').
 * @param {number} [amount=1] - The amount to reserve/increment.
 * @returns {{ allowed: boolean, currentUsage: number, limit: number }}
 */
const enforceLimit = async (userId, limitKey, amount = 1) => {
  let subscription = await Subscription.findOne({
    userId,
    status: 'active',
  }).populate('planId');

  if (!subscription || !subscription.planId) {
    return { allowed: false, currentUsage: 0, limit: 0, reason: 'No active subscription' };
  }

  // C5 FIX: Lazily roll over the billing period if it has expired.
  // Without this, usage counters never reset and users hit their monthly
  // limit permanently after the first full month.
  subscription = await rolloverSubscriptionPeriod(subscription);

  const limit = subscription.planId.limits[limitKey];

  // -1 = unlimited
  if (limit === -1) {
    return { allowed: true, currentUsage: 0, limit: -1 };
  }

  const usageKeyMap = {
    apiCallsPerMonth: 'apiCalls',
    storageGB: 'storage',
  };

  const usageField = usageKeyMap[limitKey];
  if (!usageField) {
    return { allowed: false, currentUsage: 0, limit, reason: 'Unsupported rate-limited key' };
  }

  const maxAllowed = limitKey === 'storageGB' ? limit * 1024 : limit;
  const updateFields = `usage.${usageField}`;

  // Atomic conditional increment: only reserve if enough quota remains
  const updatedSub = await Subscription.findOneAndUpdate(
    {
      _id: subscription._id,
      status: 'active',
      [updateFields]: { $lte: maxAllowed - amount },
    },
    { $inc: { [updateFields]: amount } },
    { returnDocument: 'after' }
  );

  if (updatedSub) {
    return {
      allowed: true,
      currentUsage: updatedSub.usage[usageField],
      limit,
      remaining: Math.max(0, maxAllowed - updatedSub.usage[usageField]),
    };
  } else {
    // The increment would exceed the limit — fetch current value to return exactly where they are at
    const currentSub = await Subscription.findById(subscription._id);
    const currentUsage = currentSub.usage[usageField];
    return {
      allowed: false,
      currentUsage,
      limit,
      remaining: Math.max(0, maxAllowed - currentUsage),
    };
  }
};

/**
 * Increments a usage counter for the user's active subscription.
 * @param {string} userId - The user's MongoDB ObjectId.
 * @param {string} usageKey - The usage field to increment (e.g., 'apiCalls', 'storage').
 * @param {number} [amount=1] - The amount to increment by.
 * @returns {Object|null} The updated subscription or null if not found.
 */
const trackUsage = async (userId, usageKey, amount = 1) => {
  const allowedKeys = ['apiCalls', 'storage'];
  if (!allowedKeys.includes(usageKey)) {
    throw new Error(`Invalid usageKey. Must be one of: ${allowedKeys.join(', ')}`);
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('amount must be a positive integer greater than 0');
  }

  const updateField = `usage.${usageKey}`;

  const subscription = await Subscription.findOneAndUpdate(
    { userId, status: 'active' },
    { $inc: { [updateField]: amount } },
    { returnDocument: 'after' }
  );

  if (!subscription) {
    logger.warn(`trackUsage: No active subscription found for user ${userId}`);
    return null;
  }

  return subscription;
};

module.exports = {
  createDefaultFreeSubscription,
  enforceLimit,
  trackUsage,
  rolloverSubscriptionPeriod,
};
