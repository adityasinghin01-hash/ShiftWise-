// routes/v1/user.routes.js
// User routes — profile, dashboard (protected).
// Mounted at /api/v1/ by the v1 router.

const express = require('express');
const router = express.Router();
const userController = require('../../controllers/userController');
const { protect } = require('../../middleware/authMiddleware');
const { requireRecentAuth } = require('../../middleware/stepUpAuth');
const { getCsrfToken } = require('../../middleware/csrfMiddleware');
const { authLimiter } = require('../../middleware/rateLimiter');

// GET /api/v1/csrf-token — get CSRF token for web clients
router.get('/csrf-token', protect(), getCsrfToken);

// GET /api/profile
router.get('/profile', protect(), userController.getProfile);
// GET /api/dashboard
router.get('/dashboard', protect(), userController.getDashboard);
// M5: GET /api/v1/sessions — list active sessions
router.get('/sessions', protect(), userController.listSessions);
// M5: DELETE /api/v1/sessions/:sessionId — revoke one session
router.delete('/sessions/:sessionId', protect(), userController.revokeSession);
// DELETE /api/v1/sessions — revoke all other sessions (keep current)
router.delete('/sessions', protect(), userController.revokeAllOtherSessions);
// POST /api/v1/change-email — initiate email change (requires step-up)
router.post(
  '/change-email',
  protect(),
  authLimiter,
  requireRecentAuth(10),
  userController.changeEmail
);
// POST /api/v1/reauth — re-authenticate for step-up
router.post('/reauth', protect(), userController.reauth);

module.exports = router;
