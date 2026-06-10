// routes/v1/subscription.routes.js
// Routes for the subscription & plan system.

const express = require('express');
const router = express.Router();
const { protect: authMiddleware } = require('../../middleware/authMiddleware');
const { authorize } = require('../../middleware/rbacMiddleware');
const { permissions } = require('../../config/roles');
const subscriptionController = require('../../controllers/subscriptionController');

// ── GET /api/v1/subscriptions/plans — Public
router.get('/plans', subscriptionController.listPlans);

// ── All routes below require authentication ──────────────
router.use(authMiddleware());

// ── GET /api/v1/subscriptions/current — Private
router.get('/current', subscriptionController.getCurrentPlan);

// ── PUT /api/v1/subscriptions/change — Admin only (PAYMENT GATE)
// MED-06 FIX: This endpoint has NO payment verification — it directly upgrades
// the user's subscription in the DB. Until a payment gateway (Stripe etc.) is
// integrated and verified server-side, this must be restricted to superadmin only
// to prevent free-tier users from upgrading themselves to paid plans.
// When payment integration is complete: remove authorize() and replace with
// a payment-token verification step that validates a charge before plan change.
router.put('/change', authorize(permissions.SYSTEM_CONFIG), subscriptionController.changePlan);

// ── GET /api/v1/subscriptions/usage — Private
router.get('/usage', subscriptionController.getUsageSummary);

module.exports = router;
