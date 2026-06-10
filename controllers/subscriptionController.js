const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');
const logger = require('../config/logger');
const mongoose = require('mongoose');
const User = require('../models/User');
const { emit } = require('../services/webhookService');
const { WEBHOOK_EVENTS } = require('../config/webhookEvents');

// M-10 FIX: Single source of truth for plan hierarchy.
// Order matters — higher index = higher tier.
const PLAN_TIERS = ['free', 'pro', 'enterprise'];

/**
 * @route   GET /api/v1/subscriptions/plans
 * @desc    List all active plans
 * @access  Public
 */
exports.listPlans = async (req, res, next) => {
  try {
    const plans = await Plan.find({ isActive: true }).select('-__v').sort({ price: 1 });

    res.status(200).json({
      success: true,
      count: plans.length,
      data: plans,
    });
  } catch (err) {
    logger.error('Error in listPlans:', err);
    next(err);
  }
};

/**
 * @route   GET /api/v1/subscriptions/current
 * @desc    Get current user's active subscription with plan details
 * @access  Private
 */
exports.getCurrentPlan = async (req, res, next) => {
  try {
    const subscription = await Subscription.findOne({
      userId: req.user.id,
      status: 'active',
    }).populate('planId', '-__v');

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'No active subscription found.',
      });
    }

    res.status(200).json({
      success: true,
      data: {
        subscription: {
          id: subscription._id,
          status: subscription.status,
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          usage: subscription.usage,
        },
        plan: subscription.planId,
      },
    });
  } catch (err) {
    logger.error('Error in getCurrentPlan:', err);
    next(err);
  }
};

/**
 * @route   PUT /api/v1/subscriptions/change
 * @desc    Upgrade or downgrade user's plan
 * @access  Private
 */
exports.changePlan = async (req, res, next) => {
  try {
    const { planName } = req.body;

    if (!planName || !PLAN_TIERS.includes(planName)) {
      return res.status(400).json({
        success: false,
        message: `Invalid plan name. Must be one of: ${PLAN_TIERS.join(', ')}.`,
      });
    }

    // Find the target plan
    const targetPlan = await Plan.findOne({ name: planName, isActive: true });
    if (!targetPlan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found or is no longer active.',
      });
    }

    // Find the user's current active subscription
    const currentSub = await Subscription.findOne({
      userId: req.user.id,
      status: 'active',
    }).populate('planId');

    if (!currentSub) {
      return res.status(404).json({
        success: false,
        message: 'No active subscription to change.',
      });
    }

    // Prevent changing to the same plan
    if (currentSub.planId._id.toString() === targetPlan._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'You are already on this plan.',
      });
    }

    // H-05 FIX: Determine upgrade vs downgrade using plan tier index, not price.
    // Price-based comparison breaks for same-price plans or future price changes.
    const currentTier = PLAN_TIERS.indexOf(currentSub.planId.name);
    const targetTier = PLAN_TIERS.indexOf(targetPlan.name);
    const isUpgrade = targetTier > currentTier;
    const now = new Date();

    const session = await mongoose.startSession();
    session.startTransaction();

    let newSub;
    try {
      // Cancel current subscription
      currentSub.status = 'cancelled';
      await currentSub.save({ session });

      // Create new subscription with fresh billing period
      const [createdSub] = await Subscription.create(
        [
          {
            userId: req.user.id,
            planId: targetPlan._id,
            status: 'active',
            currentPeriodStart: now,
            currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), // 30 days
            cancelAtPeriodEnd: false,
            usage: { apiCalls: 0, storage: 0 },
          },
        ],
        { session }
      );

      newSub = createdSub;

      // Update user's activeSubscription reference
      await User.findByIdAndUpdate(req.user.id, { activeSubscription: newSub._id }, { session });

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }

    logger.info(
      `User ${req.user.id} ${isUpgrade ? 'upgraded' : 'downgraded'} from '${currentSub.planId.name}' to '${targetPlan.name}'`
    );

    res.status(200).json({
      success: true,
      message: `Plan ${isUpgrade ? 'upgraded' : 'downgraded'} to ${targetPlan.displayName}.`,
      data: {
        subscription: {
          id: newSub._id,
          status: newSub.status,
          currentPeriodStart: newSub.currentPeriodStart,
          currentPeriodEnd: newSub.currentPeriodEnd,
          usage: newSub.usage,
        },
        plan: {
          name: targetPlan.name,
          displayName: targetPlan.displayName,
          price: targetPlan.price,
          limits: targetPlan.limits,
        },
      },
    });

    // Emit webhook events AFTER response — never block the client
    setImmediate(() => {
      try {
        const webhookPayload = {
          subscriptionId: newSub._id,
          previousPlan: currentSub.planId.name,
          newPlan: targetPlan.name,
          price: targetPlan.price,
        };

        if (isUpgrade) {
          emit(WEBHOOK_EVENTS.SUBSCRIPTION_UPGRADED, webhookPayload, req.user.id);
        } else {
          emit(
            WEBHOOK_EVENTS.SUBSCRIPTION_CANCELLED,
            {
              subscriptionId: currentSub._id,
              plan: currentSub.planId.name,
              reason: 'downgrade',
            },
            req.user.id
          );
          emit(WEBHOOK_EVENTS.SUBSCRIPTION_CREATED, webhookPayload, req.user.id);
        }
      } catch (err) {
        logger.error('Webhook emit failed in changePlan', { error: err.message });
      }
    });
  } catch (err) {
    logger.error('Error in changePlan:', err);
    next(err);
  }
};

/**
 * @route   GET /api/v1/subscriptions/usage
 * @desc    Get usage summary against plan limits
 * @access  Private
 */
exports.getUsageSummary = async (req, res, next) => {
  try {
    const subscription = await Subscription.findOne({
      userId: req.user.id,
      status: 'active',
    }).populate('planId', '-__v');

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'No active subscription found.',
      });
    }

    const plan = subscription.planId;
    const limits = plan.limits;

    const usageSummary = {
      apiCalls: {
        used: subscription.usage.apiCalls,
        limit: limits.apiCallsPerMonth,
        remaining:
          limits.apiCallsPerMonth === -1
            ? 'unlimited'
            : Math.max(0, limits.apiCallsPerMonth - subscription.usage.apiCalls),
      },
      storage: {
        usedMB: subscription.usage.storage,
        limitGB: limits.storageGB,
        remainingMB:
          limits.storageGB === -1
            ? 'unlimited'
            : Math.max(0, limits.storageGB * 1024 - subscription.usage.storage),
      },
      maxApiKeys: limits.maxApiKeys,
      webhooksAllowed: limits.webhooksAllowed === -1 ? 'unlimited' : limits.webhooksAllowed,
    };

    res.status(200).json({
      success: true,
      data: {
        plan: plan.name,
        billingPeriod: {
          start: subscription.currentPeriodStart,
          end: subscription.currentPeriodEnd,
        },
        usage: usageSummary,
      },
    });
  } catch (err) {
    logger.error('Error in getUsageSummary:', err);
    next(err);
  }
};
