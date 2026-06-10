// models/Webhook.js
// Stores registered webhook endpoints. Secrets are stored as AES-256-GCM encrypted — never in plaintext.

const mongoose = require('mongoose');
const validatorLib = require('validator');
const { VALID_EVENTS } = require('../config/webhookEvents');

const webhookSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    url: {
      type: String,
      required: [true, 'Webhook URL is required.'],
      validate: {
        validator: (v) =>
          validatorLib.isURL(v, {
            protocols: ['https'],
            require_protocol: true,
            require_tld: true,
          }),
        message: 'Webhook URL must be a valid HTTPS URL with a domain.',
      },
    },
    events: {
      type: [String],
      required: [true, 'At least one event is required.'],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: 'Events array must contain at least one event.',
      },
    },
    encryptedSecret: {
      type: String,
      required: [true, 'Webhook secret is required.'],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    description: {
      type: String,
      maxlength: [255, 'Description cannot exceed 255 characters.'],
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

// Shared event validation helper
const validateEvents = (events) => {
  const invalidEvents = events.filter((e) => !VALID_EVENTS.has(e));
  if (invalidEvents.length > 0) {
    const err = new Error(`Invalid webhook event(s): ${invalidEvents.join(', ')}`);
    err.name = 'ValidationError';
    throw err;
  }
};

// Pre-save hook: validate every event against the canonical VALID_EVENTS set
webhookSchema.pre('save', async function () {
  validateEvents(this.events);
});

// Pre-update hooks: validate events when updating via findOneAndUpdate or updateOne
webhookSchema.pre('findOneAndUpdate', function () {
  const update = this.getUpdate();
  const events = update?.events || update?.$set?.events;
  if (events) {
    validateEvents(events);
  }
});

webhookSchema.pre('updateOne', function () {
  const update = this.getUpdate();
  const events = update?.events || update?.$set?.events;
  if (events) {
    validateEvents(events);
  }
});

// Compound index for emit() query: { userId, isActive: true, events: event }
webhookSchema.index({ userId: 1, isActive: 1, events: 1 });

const Webhook = mongoose.model('Webhook', webhookSchema);

module.exports = Webhook;
