// scripts/reconcile-subscriptions.js
//
// H12 FIX: Reconciliation job for users whose default free subscription was
// not created at signup (pendingSubscriptionCreation === true).
//
// Can be called two ways:
//   1. From server.js after DB connects (lazy, non-blocking startup sweep)
//   2. As a standalone CLI: node scripts/reconcile-subscriptions.js
//
// Idempotent — safe to run multiple times; createDefaultFreeSubscription
// uses findOneAndUpdate with $setOnInsert so it won't duplicate subscriptions.

'use strict';

const logger = require('../config/logger');

/**
 * Reconcile all users with pendingSubscriptionCreation=true.
 * Runs as a background task — errors are logged, not thrown.
 *
 * @param {object} opts
 * @param {number} [opts.batchSize=50]   - Users processed per batch
 * @param {boolean} [opts.standalone]    - true when called from CLI
 */
const reconcileSubscriptions = async ({ batchSize = 50, standalone = false } = {}) => {
  // Lazy-require models so this module can be imported before Mongoose connects
  const User = require('../models/User');
  const { createDefaultFreeSubscription } = require('../services/subscriptionService');

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let cursor;

  try {
    cursor = User.find({ pendingSubscriptionCreation: true }).select('_id email').lean().cursor();

    for await (const user of cursor) {
      processed++;
      try {
        const sub = await createDefaultFreeSubscription(user._id);
        await User.findByIdAndUpdate(user._id, {
          activeSubscription: sub._id,
          pendingSubscriptionCreation: false,
        });
        succeeded++;
      } catch (err) {
        failed++;
        logger.error('reconcileSubscriptions: failed for user', {
          userId: user._id,
          error: err.message,
        });
      }

      // Yield to the event loop every batchSize users to avoid blocking
      if (processed % batchSize === 0) {
        await new Promise((r) => setImmediate(r));
      }
    }

    const summary = `Reconciliation complete: ${succeeded} fixed, ${failed} failed, ${processed} total`;
    if (standalone) {
      console.log(`✅ ${summary}`);
    } else {
      logger.info(summary, { succeeded, failed, processed });
    }
  } catch (err) {
    logger.error('reconcileSubscriptions: unexpected error', { error: err.message });
    if (standalone) {
      console.error('❌ Reconciliation failed:', err.message);
    }
  } finally {
    // M9 FIX (Wave 4): always release the cursor — earlier code leaked it on
    // the error path, which can hold an open server-side cursor on the DB.
    if (cursor) {
      try {
        await cursor.close();
      } catch (closeErr) {
        logger.error('reconcileSubscriptions: cursor close failed', {
          error: closeErr.message,
        });
      }
    }
  }
};

module.exports = reconcileSubscriptions;

// ── CLI entry point ─────────────────────────────────────
if (require.main === module) {
  require('dotenv').config();
  const mongoose = require('mongoose');

  (async () => {
    if (!process.env.MONGO_URI) {
      console.error('❌ MONGO_URI is required');
      process.exit(1);
    }
    try {
      await mongoose.connect(process.env.MONGO_URI);
      await reconcileSubscriptions({ standalone: true });
    } catch (err) {
      console.error('❌ Fatal:', err.message);
      process.exit(1);
    } finally {
      await mongoose.connection.close();
    }
  })();
}
