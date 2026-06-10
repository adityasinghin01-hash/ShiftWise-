// services/apiKeyService.js
// Handles secure generation, plan enforcement, and atomic rotation of API keys.

const crypto = require('crypto');
const mongoose = require('mongoose');
const ApiKey = require('../models/ApiKey');
const Subscription = require('../models/Subscription');
const config = require('../config/config');

const KEY_PREFIX = 'sk_live_';

/**
 * Generate a new raw key, extract UI prefix, and create the HMAC SHA-256 hash.
 * Throws if API_KEY_SALT is not configured — prevents running with a default/empty salt.
 */
const generateKeyData = () => {
  // Fail fast if salt is missing — critical security requirement
  if (!config.API_KEY_SALT) {
    throw new Error('API_KEY_SALT is required. Cannot hash API keys without a configured salt.');
  }

  // Generate secure random bytes (e.g., 48 base64 characters, filtering non-alphanumerics)
  const rawSecret = crypto
    .randomBytes(36)
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '');
  const rawKey = `${KEY_PREFIX}${rawSecret}`;

  // The prefix saved to DB is the first 8 characters after 'sk_live_'
  const prefixHash = rawSecret.substring(0, 8);
  const storedPrefix = `${KEY_PREFIX}${prefixHash}`;

  // HMAC SHA-256 Hash
  const keyHash = crypto.createHmac('sha256', config.API_KEY_SALT).update(rawKey).digest('hex');

  return { rawKey, storedPrefix, keyHash };
};

/**
 * Create a new API key while enforcing plan limitations.
 *
 * D1 FIX (Wave 4.2 — corrected): atomic count + create using
 * `session.withTransaction()` + a write to the SHARED Subscription doc
 * (`$currentDate` on `updatedAt`) so two concurrent creates actually
 * conflict on a shared write target. Without that shared write, both
 * transactions' `countDocuments` see the same snapshot, both inserts go
 * through, and the user ends up with N+2 keys despite a limit of N+1.
 *
 * Requires a replica set / sharded cluster.
 */
exports.createApiKey = async (userId, name, scopes = ['api:read']) => {
  // Verify user plan and limits (outside transaction — read-only)
  const activeSub = await Subscription.findOne({ userId, status: 'active' }).populate('planId');
  if (!activeSub || !activeSub.planId) {
    const err = new Error('User does not have an active subscription');
    err.statusCode = 403;
    throw err;
  }

  const { maxApiKeys } = activeSub.planId.limits;

  // Generate keys securely (will throw if salt is missing)
  const { rawKey, storedPrefix, keyHash } = generateKeyData();

  let apiKeyDoc;
  let limitState = null;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // Touch the subscription doc to force a conflict between concurrent
      // creators on the same user. Without this, the count + insert below
      // doesn't share any write target with another concurrent transaction
      // and the limit can be exceeded.
      await Subscription.findOneAndUpdate(
        { _id: activeSub._id },
        { $currentDate: { updatedAt: true } },
        { session }
      );

      if (maxApiKeys !== -1) {
        const currentActiveKeys = await ApiKey.countDocuments({ userId, isActive: true }).session(
          session
        );
        if (currentActiveKeys >= maxApiKeys) {
          limitState = {
            currentActiveKeys,
            limit: maxApiKeys,
            planDisplayName: activeSub.planId.displayName,
          };
          const err = new Error('plan-limit-reached');
          err.code = 'PLAN_LIMIT';
          throw err;
        }
      }

      const [created] = await ApiKey.create(
        [
          {
            userId,
            name,
            keyHash,
            keyPrefix: storedPrefix,
            scopes,
          },
        ],
        { session }
      );
      apiKeyDoc = created;
    });
  } catch (error) {
    if (error.code === 'PLAN_LIMIT' && limitState) {
      const err = new Error(
        `Plan limit reached: Maximum of ${limitState.limit} API key(s) allowed on the ${limitState.planDisplayName} plan.`
      );
      err.statusCode = 429;
      throw err;
    }
    throw error;
  } finally {
    session.endSession();
  }

  return { rawKey, apiKeyDoc };
};

/**
 * Replace an active API Key with a newly generated one atomically.
 *
 * H9 NOTE: Uses a MongoDB transaction. Transactions only work on a replica set
 * or sharded cluster. On a standalone mongod the transaction call will throw
 * (caught and surfaced to the caller). Production deployments must run against
 * a replica set; document this in deploy docs.
 */
exports.rotateApiKey = async (userId, oldKeyId) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const oldKey = await ApiKey.findOne({ _id: oldKeyId, userId, isActive: true }).session(session);

    if (!oldKey) {
      const err = new Error('API Key not found or already inactive');
      err.statusCode = 404;
      throw err;
    }

    // Deactivate old key
    oldKey.isActive = false;
    await oldKey.save({ session });

    // Generate and create identically configured replacement
    const { rawKey, storedPrefix, keyHash } = generateKeyData();

    // M3 FIX: keep the user's chosen name stable across rotations instead of
    // accumulating "(Rotated) (Rotated) (Rotated)" suffixes. Strip a prior
    // suffix if present so the underlying name is preserved.
    const baseName = oldKey.name.replace(/\s*\(Rotated\)$/, '');

    const [newApiKeyDoc] = await ApiKey.create(
      [
        {
          userId,
          name: `${baseName} (Rotated)`,
          keyHash,
          keyPrefix: storedPrefix,
          scopes: oldKey.scopes,
        },
      ],
      { session }
    );

    await session.commitTransaction();
    return { rawKey, newApiKeyDoc };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};
