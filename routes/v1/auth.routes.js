// routes/v1/auth.routes.js
// Auth routes — signup, login, google-login, logout, refresh-token.
// Mounted at /api/v1/ by the v1 router.

const express = require('express');
const router = express.Router();
const authController = require('../../controllers/authController');
const { authLimiter, strictLimiter } = require('../../middleware/rateLimiter');
const { verifyRecaptcha } = require('../../middleware/recaptchaMiddleware');
const { schemas } = require('../../middleware/validate');

// POST /api/v1/signup
router.post('/signup', strictLimiter, schemas.signup, verifyRecaptcha, authController.signup);

// POST /api/v1/login
// H1 FIX (Wave 1): verifyRecaptcha was missing from login. The comment in
// recaptchaMiddleware.js claimed "BOTH signup AND login (fixes B-13)" but the
// middleware was only wired to /signup. Added here permanently.
router.post('/login', authLimiter, schemas.login, verifyRecaptcha, authController.login);

// POST /api/v1/google-login
router.post('/google-login', authLimiter, schemas.googleLogin, authController.googleLogin);

// POST /api/v1/google-signup
router.post('/google-signup', authLimiter, schemas.googleLogin, authController.googleSignup);

// POST /api/v1/logout
router.post('/logout', authController.logout);

// POST /api/v1/refresh-token
router.post('/refresh-token', authLimiter, schemas.refreshToken, authController.refreshToken);

module.exports = router;
