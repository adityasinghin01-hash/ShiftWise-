// routes/v1/mfa.routes.js
const express = require('express');
const router = express.Router();
const mfa = require('../../controllers/mfaController');
const { protect } = require('../../middleware/authMiddleware');
const { requireRecentAuth } = require('../../middleware/stepUpAuth');
const { authLimiter } = require('../../middleware/rateLimiter');

// Setup — initiate MFA (generates secret + QR)
router.post('/setup', protect(), requireRecentAuth(10), mfa.setup);
// Verify setup — confirm TOTP code, activate MFA + get backup codes
router.post('/verify-setup', protect(), mfa.verifySetup);
// Disable MFA (requires TOTP or backup code + step-up)
router.post('/disable', protect(), requireRecentAuth(10), mfa.disable);
// Regenerate backup codes (requires step-up)
router.post('/backup-codes', protect(), requireRecentAuth(10), mfa.regenerateBackupCodes);
// MFA login second step (no auth required — takes mfaToken)
router.post('/login', authLimiter, mfa.mfaLogin);

module.exports = router;
