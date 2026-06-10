// config/webhookEvents.js
// Defines all supported webhook event types as constants.
// Used across the webhook system for validation, registration, and dispatch.

const WEBHOOK_EVENTS = Object.freeze({
  USER_CREATED: 'user.created',
  USER_VERIFIED: 'user.verified',
  SUBSCRIPTION_CREATED: 'subscription.created',
  SUBSCRIPTION_UPGRADED: 'subscription.upgraded',
  SUBSCRIPTION_CANCELLED: 'subscription.cancelled',
  APIKEY_CREATED: 'apikey.created',
  APIKEY_REVOKED: 'apikey.revoked',
  APIKEY_ROTATED: 'apikey.rotated',
  // M-11 FIX: Add test event so testWebhook deliveries appear in consumer filters
  // and pass any validation that checks against VALID_EVENTS.
  WEBHOOK_TEST: 'webhook.test',
});

/** Set of all valid event strings — used for O(1) validation lookups */
const VALID_EVENTS = new Set(Object.values(WEBHOOK_EVENTS));

module.exports = { WEBHOOK_EVENTS, VALID_EVENTS };
