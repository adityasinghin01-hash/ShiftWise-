// models/Subscription.js
// Subscription schema linking a user to a plan.
// Tracks status, billing period, cancellation, and real-time usage.

const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plan',
      required: true,
    },

    status: {
      type: String,
      enum: ['active', 'cancelled', 'past_due', 'trialing'],
      default: 'active',
    },

    currentPeriodStart: {
      type: Date,
      required: true,
    },

    currentPeriodEnd: {
      type: Date,
      required: true,
      validate: {
        validator: function (v) {
          return this.currentPeriodStart ? v >= this.currentPeriodStart : true;
        },
        message: 'currentPeriodEnd must be greater than or equal to currentPeriodStart',
      },
    },

    cancelAtPeriodEnd: {
      type: Boolean,
      default: false,
    },

    usage: {
      apiCalls: { type: Number, default: 0, min: [0, 'usage.apiCalls cannot be negative'] },
      storage: { type: Number, default: 0, min: [0, 'usage.storage cannot be negative'] }, // in MB
    },
  },
  {
    timestamps: true,
  }
);

// Compound index: one active subscription per user
subscriptionSchema.index(
  { userId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } }
);

const Subscription = mongoose.model('Subscription', subscriptionSchema);

module.exports = Subscription;
