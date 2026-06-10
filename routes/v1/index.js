// routes/v1/index.js
// Central v1 API router — mounts all versioned route modules.
// Mounted at /api/v1 in app.js.
// Health check stays unversioned at /api/health (for Render probe).

const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');
const verificationRoutes = require('./verification.routes');
const passwordRoutes = require('./password.routes');
const userRoutes = require('./user.routes');
const adminRoutes = require('./admin.routes');
const subscriptionRoutes = require('./subscription.routes');
const apiKeyRoutes = require('./apikeys.routes');
const webhookRoutes = require('./webhooks.routes');
const mfaRoutes = require('./mfa.routes');

// ── Auth ─────────────────────────────────────────────────
router.use('/', authRoutes);

// ── Verification ─────────────────────────────────────────
router.use('/', verificationRoutes);

// ── Password ─────────────────────────────────────────────
router.use('/password', passwordRoutes);

// ── User (protected) ────────────────────────────────────
router.use('/', userRoutes);

// ── Admin ────────────────────────────────────────────────
router.use('/admin', adminRoutes);

// ── Subscriptions ────────────────────────────────────────
router.use('/subscriptions', subscriptionRoutes);

// ── API Keys ─────────────────────────────────────────────
router.use('/apikeys', apiKeyRoutes);

// ── Webhooks ─────────────────────────────────────────────
router.use('/webhooks', webhookRoutes);

// ── MFA ──────────────────────────────────────────────────
router.use('/mfa', mfaRoutes);

module.exports = router;
