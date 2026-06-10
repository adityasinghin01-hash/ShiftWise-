// controllers/passwordController.js
// Handles: forgotPassword, resetPassword, sendOtp, verifyOtp.
// M19 FIX: renderResetPage removed — dead code. Email links point to frontend
// hash route (${CLIENT_URL}/#reset-password?token=...) not to this server.
// M9 FIX: HTML pages now come from templates/email.js

const logger = require('../config/logger');
const crypto = require('crypto');
const validator = require('validator');
const User = require('../models/User');
const hashToken = require('../utils/hashToken');
const { hashOtp } = require('../utils/hashToken');
const validatePassword = require('../utils/passwordValidator');
const { sendPasswordResetEmail, sendOtpEmail } = require('../services/emailService');

const RESET_TOKEN_EXPIRY = 15 * 60 * 1000; // 15 minutes
const GENERIC_RESET = 'If an account exists with this email, a password reset link has been sent.';
const GENERIC_OTP = 'If an account exists, a reset code has been sent.';

const forgotPassword = async (req, res, next) => {
  try {
    const email = req.body.email?.toLowerCase()?.trim();
    if (!email || !validator.isEmail(email)) {
      return res.status(400).json({ message: 'Please provide a valid email address' });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(200).json({ success: true, message: GENERIC_RESET });

    const rawToken = crypto.randomBytes(32).toString('hex');
    user.resetToken = hashToken(rawToken);
    user.resetTokenExpiry = Date.now() + RESET_TOKEN_EXPIRY;
    await user.save();

    // H2 FIX (Wave 4): fire-and-forget email send so a slow Brevo call cannot
    // delay the response and turn into a timing oracle ("known email" path is
    // slow because it sends; "unknown email" returns instantly). Now both
    // paths return at the same speed; failures are logged but never bubble
    // up to the caller.
    setImmediate(async () => {
      try {
        await sendPasswordResetEmail(email, rawToken);
        logger.info('Password reset email sent', { email });
      } catch (err) {
        logger.error('Password reset email failed', { email, error: err.message });
      }
    });

    return res.status(200).json({ success: true, message: GENERIC_RESET });
  } catch (error) {
    next(error);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ message: 'Token and new password are required' });
    }

    const user = await User.findOne({
      resetToken: hashToken(token),
      resetTokenExpiry: { $gt: Date.now() },
    }).select('+password');
    if (!user) return res.status(400).json({ message: 'Invalid or expired reset token' });

    const check = validatePassword(newPassword, user.email);
    if (!check.isValid) return res.status(400).json({ message: check.errors[0] });

    // Check new password is not the same as the current one
    if (user.password) {
      const isSame = await user.comparePassword(newPassword);
      if (isSame) {
        return res
          .status(400)
          .json({ message: 'New password must be different from your current password.' });
      }
    }

    user.password = newPassword;
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;
    // H7 FIX: clear OTP fields so stale OTP can't be replayed
    user.otpCode = undefined;
    user.otpExpiry = undefined;
    user.otpFailedAttempts = 0;
    user.otpLockUntil = undefined;
    user.failedLoginAttempts = 0;
    user.lockUntil = undefined;
    user.refreshTokens = [];
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Password reset successful. Please log in with your new password.',
    });
  } catch (error) {
    next(error);
  }
};

const sendOtp = async (req, res, next) => {
  try {
    const email = req.body.email?.toLowerCase()?.trim();
    if (!email || !validator.isEmail(email)) {
      return res.status(400).json({ message: 'Please provide a valid email address' });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(200).json({ success: true, message: GENERIC_OTP });

    const rawOtp = crypto.randomInt(100000, 1000000).toString();
    user.otpCode = hashOtp(rawOtp);
    user.otpExpiry = Date.now() + 15 * 60 * 1000;
    user.otpFailedAttempts = 0;
    user.otpLockUntil = undefined;
    await user.save();

    try {
      await sendOtpEmail(email, rawOtp);
      logger.info('OTP email sent', { email });
    } catch (err) {
      logger.error('OTP email failed', { email, error: err.message });
    }

    return res.status(200).json({ success: true, message: GENERIC_OTP });
  } catch (error) {
    next(error);
  }
};

const MAX_OTP_ATTEMPTS = 5;
const OTP_LOCK_MS = 15 * 60 * 1000;

const verifyOtp = async (req, res, next) => {
  try {
    const email = req.body.email?.toLowerCase()?.trim();
    const otp = req.body.otp?.trim();
    if (!email || !otp) return res.status(400).json({ message: 'Email and OTP are required' });

    const lockUser = await User.findOne({ email });
    if (lockUser?.otpLockUntil && lockUser.otpLockUntil > Date.now()) {
      const sec = Math.ceil((lockUser.otpLockUntil - Date.now()) / 1000);
      return res.status(429).json({
        message: `Too many failed OTP attempts. Try again in ${sec} seconds, or request a new code.`,
      });
    }

    const user = await User.findOne({
      email,
      otpCode: hashOtp(otp),
      otpExpiry: { $gt: Date.now() },
    });

    if (!user) {
      if (lockUser) {
        lockUser.otpFailedAttempts = (lockUser.otpFailedAttempts || 0) + 1;
        if (lockUser.otpFailedAttempts >= MAX_OTP_ATTEMPTS) {
          lockUser.otpLockUntil = new Date(Date.now() + OTP_LOCK_MS);
          lockUser.otpCode = undefined;
          lockUser.otpExpiry = undefined;
        }
        await lockUser.save();
      }
      return res.status(400).json({ message: 'Invalid or expired code. Please try again.' });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    user.resetToken = hashToken(rawToken);
    user.resetTokenExpiry = Date.now() + 15 * 60 * 1000;
    user.otpCode = undefined;
    user.otpExpiry = undefined;
    user.otpFailedAttempts = 0;
    user.otpLockUntil = undefined;
    await user.save();

    return res.status(200).json({ success: true, resetToken: rawToken });
  } catch (error) {
    next(error);
  }
};

module.exports = { forgotPassword, resetPassword, sendOtp, verifyOtp };
