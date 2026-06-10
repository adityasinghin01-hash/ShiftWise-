// routes/v1/verification.routes.js
// Verification routes — verify-email, resend-verification, check-verification-status.
// Mounted at /api/v1/ by the v1 router.

const express = require('express');
const router = express.Router();
const verificationController = require('../../controllers/verificationController');
const { authLimiter, strictLimiter } = require('../../middleware/rateLimiter');

// GET /api/verify-email?token=<rawToken> — no per-route limiter (global only)
router.get('/verify-email', verificationController.verifyEmail);

// GET /api/v1/verify-new-email?token=... — email change verification
router.get('/verify-new-email', verificationController.verifyNewEmail);

// POST /api/resend-verification — authLimiter (prevents email spam)
router.post('/resend-verification', authLimiter, verificationController.resendVerification);

// GET /api/check-verification-status?email=<email>
// H5 FIX (Wave 4): apply strictLimiter (20 req / 15 min per IP) so the
// "is this account verified" oracle can't be abused for bulk enumeration.
// The endpoint stays public because the mobile login flow needs it after a
// 401 — but the global limiter alone (200 req / 15 min) was too generous.
router.get(
  '/check-verification-status',
  strictLimiter,
  verificationController.checkVerificationStatus
);

module.exports = router;
