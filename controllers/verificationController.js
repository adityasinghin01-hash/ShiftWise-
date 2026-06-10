// controllers/verificationController.js
// Handles: verifyEmail, resendVerification, checkVerificationStatus.
// M9 FIX: HTML pages now come from templates/email.js

const logger = require('../config/logger');
const crypto = require('crypto');
const validator = require('validator');
const User = require('../models/User');
const hashToken = require('../utils/hashToken');
const { sendVerificationEmail } = require('../services/emailService');
const { emit } = require('../services/webhookService');
const { WEBHOOK_EVENTS } = require('../config/webhookEvents');
const t = require('../templates/email');

const VERIFICATION_TOKEN_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

const verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).send(t.verificationExpired());
    }

    const user = await User.findOne({
      verificationToken: hashToken(token),
      verificationTokenExpiry: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).send(t.verificationExpired());
    }

    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpiry = undefined;
    await user.save();

    emit(
      WEBHOOK_EVENTS.USER_VERIFIED,
      { id: user._id, name: user.name, role: user.role },
      user._id
    );

    const source = req.query.source || 'app';
    return res.send(source === 'web' ? t.emailVerifiedWeb() : t.emailVerifiedApp());
  } catch (error) {
    next(error);
  }
};

const resendVerification = async (req, res, next) => {
  try {
    const email = req.body.email?.toLowerCase()?.trim();
    const GENERIC = 'If an account exists and is unverified, a verification email has been sent.';

    if (!email || !validator.isEmail(email)) {
      return res.status(400).json({ message: 'Please provide a valid email address' });
    }

    const user = await User.findOne({ email });
    if (!user || user.isVerified) {
      return res.status(200).json({ success: true, message: GENERIC });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    user.verificationToken = hashToken(rawToken);
    user.verificationTokenExpiry = Date.now() + VERIFICATION_TOKEN_EXPIRY;
    await user.save();

    try {
      await sendVerificationEmail(email, rawToken);
      logger.info('Verification email sent (resend)', { email });
    } catch (err) {
      logger.error('Verification email send failed (resend)', { email, error: err.message });
    }

    return res.status(200).json({ success: true, message: GENERIC });
  } catch (error) {
    next(error);
  }
};

// H4 FIX (Wave 4): the response already collapses "no user" and "user exists
// but unverified" into the same `isVerified: false`, so the only remaining
// oracle is "is this email a VERIFIED account". That's a much smaller leak
// than full registration enumeration. We accept it because the mobile login
// flow needs this information when login returns 401, and we can't gate it
// behind auth (an unverified user has no token). Defense is moved to the
// route layer with a strict per-IP rate limiter (see verification.routes.js).
const checkVerificationStatus = async (req, res, next) => {
  try {
    const email = req.query.email?.toLowerCase()?.trim();

    if (!email || !validator.isEmail(email)) {
      return res.status(400).json({ message: 'Please provide a valid email address' });
    }

    const user = await User.findOne({ email }).select('isVerified');
    return res.status(200).json({ success: true, isVerified: !!(user && user.isVerified) });
  } catch (error) {
    next(error);
  }
};

module.exports = { verifyEmail, resendVerification, checkVerificationStatus, verifyNewEmail };

// ── Verify New Email (email-change flow) ─────────────────
// GET /api/v1/verify-new-email?token=... — completes email change
async function verifyNewEmail(req, res, next) {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).send(t.verificationExpired());
    }

    const user = await User.findOne({
      pendingEmailToken: hashToken(token),
      pendingEmailExpiry: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).send(t.verificationExpired());
    }

    if (!user.pendingEmail) {
      return res.status(400).send(t.verificationExpired());
    }

    // Update email and clear pending fields
    user.email = user.pendingEmail;
    user.pendingEmail = undefined;
    user.pendingEmailToken = undefined;
    user.pendingEmailExpiry = undefined;
    // Security: invalidate all refresh tokens (new email = new identity)
    user.refreshTokens = [];
    await user.save();

    return res.send(t.emailVerifiedWeb());
  } catch (error) {
    next(error);
  }
}
