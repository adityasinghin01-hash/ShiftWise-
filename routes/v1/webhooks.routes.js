// routes/v1/webhooks.routes.js
// Routes for webhook management — CRUD, delivery history, and test dispatch.

const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const { protect } = require('../../middleware/authMiddleware');
const { strictLimiter } = require('../../middleware/rateLimiter');
const {
  createWebhook,
  listWebhooks,
  getWebhook,
  updateWebhook,
  deleteWebhook,
  getDeliveryHistory,
  testWebhook,
} = require('../../controllers/webhookController');
// HIGH-05 FIX: Import the canonical event list so validation is the single source of truth.
// Previously events were only isString()-checked, allowing any arbitrary string (including
// future internal events like 'user.admin_promoted') to be stored as subscriptions.
const { WEBHOOK_EVENTS } = require('../../config/webhookEvents');
const ALLOWED_EVENTS = Object.values(WEBHOOK_EVENTS);
// HIGH-02 FIX: Block private/internal IP ranges in webhook URLs (SSRF prevention).
// express-validator's isURL() only checks protocol/TLD — IP addresses bypass require_tld.
// validateWebhookUrl() explicitly blocks 127.x, 10.x, 192.168.x, 169.254.x, ::1, etc.
const { validateWebhookUrl } = require('../../utils/isPrivateUrl');

// ── Validation Rules ─────────────────────────────────────

const createValidation = [
  body('url')
    .notEmpty()
    .withMessage('URL is required.')
    .isString()
    .withMessage('URL must be a string.')
    .isURL({ protocols: ['https'], require_protocol: true, require_tld: true })
    .withMessage('Webhook URL must be a valid HTTPS URL with a domain.')
    .custom((url) => {
      const result = validateWebhookUrl(url);
      if (!result.valid) throw new Error(result.reason);
      return true;
    }),
  body('events')
    .isArray({ min: 1 })
    .withMessage('Events must be an array with at least one event.'),
  body('events.*')
    .isString()
    .withMessage('Each event must be a string.')
    .isIn(ALLOWED_EVENTS)
    .withMessage(`Each event must be one of: ${ALLOWED_EVENTS.join(', ')}.`),
  body('description')
    .optional()
    .isString()
    .withMessage('Description must be a string.')
    .isLength({ max: 255 })
    .withMessage('Description cannot exceed 255 characters.'),
];

const updateValidation = [
  body('url')
    .optional()
    .isString()
    .withMessage('URL must be a string.')
    .isURL({ protocols: ['https'], require_protocol: true, require_tld: true })
    .withMessage('Webhook URL must be a valid HTTPS URL with a domain.')
    .custom((url) => {
      const result = validateWebhookUrl(url);
      if (!result.valid) throw new Error(result.reason);
      return true;
    }),
  body('events')
    .optional()
    .isArray({ min: 1 })
    .withMessage('Events must be an array with at least one event.'),
  body('events.*')
    .isString()
    .withMessage('Each event must be a string.')
    .isIn(ALLOWED_EVENTS)
    .withMessage(`Each event must be one of: ${ALLOWED_EVENTS.join(', ')}.`),
  body('isActive').optional().isBoolean().withMessage('isActive must be a boolean.'),
  body('description')
    .optional()
    .isString()
    .withMessage('Description must be a string.')
    .isLength({ max: 255 })
    .withMessage('Description cannot exceed 255 characters.'),
];

const idValidation = [param('id').isMongoId().withMessage('Invalid webhook ID.')];

// ── Middleware ────────────────────────────────────────────

// All webhook routes require JWT authentication
router.use(protect());

// ── Routes ───────────────────────────────────────────────

router.post('/', createValidation, createWebhook);
router.get('/', listWebhooks);
router.get('/:id', idValidation, getWebhook);
router.patch('/:id', [...idValidation, ...updateValidation], updateWebhook);
router.delete('/:id', idValidation, deleteWebhook);
router.get('/:id/deliveries', idValidation, getDeliveryHistory);
router.post('/:id/test', idValidation, strictLimiter, testWebhook);

module.exports = router;
