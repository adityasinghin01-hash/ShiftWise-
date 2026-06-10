// models/WebhookDelivery.js
// Tracks every webhook dispatch attempt for auditing, debugging, and retry scheduling.

const mongoose = require('mongoose');

const webhookDeliverySchema = new mongoose.Schema(
  {
    webhookId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Webhook',
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    event: {
      type: String,
      required: [true, 'Event name is required.'],
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: [true, 'Payload is required.'],
    },
    responseStatus: {
      type: Number,
      default: null,
    },
    responseBody: {
      type: String,
      maxlength: [1000, 'Response body is truncated to 1000 characters.'],
      default: null,
    },
    error: {
      type: String,
      default: null,
    },
    attempt: {
      type: Number,
      default: 1,
      min: 1,
    },
    success: {
      type: Boolean,
      required: true,
      default: false,
    },
    deliveredAt: {
      type: Date,
      default: Date.now,
    },
    nextRetryAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Delivery history for a specific webhook (newest first)
webhookDeliverySchema.index({ webhookId: 1, deliveredAt: -1 });

// Dashboard stats — successful vs failed deliveries per user
webhookDeliverySchema.index({ userId: 1, success: 1 });

// Retry worker — matches query { success: false, nextRetryAt: { $lte: now } }
webhookDeliverySchema.index({ success: 1, nextRetryAt: 1 });

// P-04: TTL index — auto-expire delivery records after 30 days.
// 30 days = 30 * 24 * 60 * 60 = 2592000 seconds.
// MongoDB's background TTL thread removes expired documents periodically.
// This prevents the delivery collection from growing unbounded over time.
webhookDeliverySchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 });

const WebhookDelivery = mongoose.model('WebhookDelivery', webhookDeliverySchema);

module.exports = WebhookDelivery;
