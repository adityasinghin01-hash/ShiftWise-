// models/Plan.js
// Plan schema for the subscription system.
// Defines plan tiers, pricing, features, and resource limits.

const mongoose = require('mongoose');

const planSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      enum: ['free', 'pro', 'enterprise'],
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    displayName: {
      type: String,
      required: true,
      trim: true,
    },

    price: {
      type: Number,
      required: true,
      min: 0,
    },

    currency: {
      type: String,
      default: 'USD',
      uppercase: true,
    },

    billingPeriod: {
      type: String,
      enum: ['monthly', 'yearly', 'lifetime'],
      default: 'monthly',
    },

    features: {
      type: [String],
      default: [],
    },

    limits: {
      apiCallsPerMonth: {
        type: Number,
        required: true,
        validate: {
          validator: (v) => v === -1 || v >= 0,
          message: 'apiCallsPerMonth must be -1 (unlimited) or >= 0',
        },
      },
      maxApiKeys: {
        type: Number,
        required: true,
        min: [0, 'maxApiKeys must be >= 0'],
      },
      webhooksAllowed: {
        type: Number,
        required: true,
        validate: {
          validator: (v) => v === -1 || v >= 0,
          message: 'webhooksAllowed must be -1 (unlimited) or >= 0',
        },
      },
      storageGB: {
        type: Number,
        required: true,
        min: [0, 'storageGB must be >= 0'],
      },
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

const Plan = mongoose.model('Plan', planSchema);

module.exports = Plan;
