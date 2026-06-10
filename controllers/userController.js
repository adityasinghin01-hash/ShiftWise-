// controllers/userController.js
// Handles: getProfile, getDashboard, listSessions, revokeSession.
// Per ARCHITECTURE_MAP §4: User Routes (Protected).

const User = require('../models/User');
const crypto = require('crypto');
const validator = require('validator');
const hashToken = require('../utils/hashToken');
const { sendEmail } = require('../services/emailService');
const config = require('../config/config');

const PENDING_EMAIL_TOKEN_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

// ── Get Profile ──────────────────────────────────────────
// GET /api/profile — protected by `protect` middleware
// req.user is a full Mongoose document fetched from DB by protect middleware.
const getProfile = async (req, res, next) => {
  try {
    const user = req.user;

    return res.status(200).json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        name: user.name || null,
        picture: user.picture || null,
        provider: user.provider,
        isVerified: user.isVerified,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ── Get Dashboard ────────────────────────────────────────
// GET /api/dashboard — protected
const getDashboard = async (req, res, next) => {
  try {
    const user = req.user;

    return res.status(200).json({
      success: true,
      email: user.email,
      isVerified: user.isVerified,
      activeSessions: user.refreshTokens.length,
    });
  } catch (error) {
    next(error);
  }
};

// ── List active sessions ─────────────────────────────────
// M5: GET /api/v1/sessions
// Returns all active refresh token sessions (device + created-at only, no hashes)
const listSessions = async (req, res, next) => {
  try {
    const sessions = req.user.refreshTokens.map((t) => ({
      id: t._id,
      deviceInfo: t.deviceInfo,
      createdAt: t.createdAt,
    }));
    return res.status(200).json({ success: true, count: sessions.length, sessions });
  } catch (err) {
    next(err);
  }
};

// ── Revoke a single session ───────────────────────────────
// M5: DELETE /api/v1/sessions/:sessionId
//
// C3 FIX (Wave 4): atomic $pull instead of read-filter-save. The previous
// implementation read req.user.refreshTokens, filtered out one entry, and
// rewrote the whole array. A concurrent login on another device between
// the read and the save would silently drop the new session. $pull is
// atomic in MongoDB and only touches the targeted sub-document.
const revokeSession = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    if (!sessionId || !/^[0-9a-fA-F]{24}$/.test(sessionId)) {
      return res.status(400).json({ success: false, message: 'Invalid session ID' });
    }

    const result = await User.updateOne(
      { _id: req.user._id, 'refreshTokens._id': sessionId },
      { $pull: { refreshTokens: { _id: sessionId } } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    return res.status(200).json({ success: true, message: 'Session revoked' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getProfile,
  getDashboard,
  listSessions,
  revokeSession,
  revokeAllOtherSessions,
  changeEmail,
  reauth,
};

// ── Revoke all other sessions ─────────────────────────────
// DELETE /api/v1/sessions — keeps the current session, wipes all others
async function revokeAllOtherSessions(req, res, next) {
  try {
    const { refreshToken: currentToken } = req.body;
    if (!currentToken) {
      return res.status(400).json({ success: false, message: 'Current refresh token required' });
    }
    const currentHash = hashToken(currentToken);

    // Atomic $pull removes all tokens whose hash ≠ currentHash (keep only current session)
    await User.updateOne(
      { _id: req.user._id },
      { $pull: { refreshTokens: { tokenHash: { $ne: currentHash } } } }
    );
    return res.status(200).json({ success: true, message: 'All other sessions revoked' });
  } catch (err) {
    next(err);
  }
}

// ── Change Email (initiate) ───────────────────────────────
// POST /api/v1/change-email — sends verification to NEW email
async function changeEmail(req, res, next) {
  try {
    const { newEmail } = req.body;
    if (!newEmail || !validator.isEmail(newEmail)) {
      return res.status(400).json({ success: false, message: 'Valid email required' });
    }
    const normalizedEmail = newEmail.toLowerCase().trim();

    // AUTH_PATTERNS.md §6.6: Never reveal whether email exists.
    // Fire-and-forget: only send email if address is actually available.
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(200).json({
        success: true,
        message: 'If this email is available, a verification email has been sent.',
      });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const user = req.user;
    const oldEmail = user.email;

    user.pendingEmail = normalizedEmail;
    user.pendingEmailToken = hashToken(rawToken);
    user.pendingEmailExpiry = Date.now() + PENDING_EMAIL_TOKEN_EXPIRY;
    await user.save();

    // Send verification to NEW email
    const verifyUrl = `${config.BASE_URL}/api/v1/verify-new-email?token=${rawToken}`;
    await sendEmail({
      to: normalizedEmail,
      subject: 'Verify Your New Email Address',
      text: `Verify your new email: ${verifyUrl}\n\nExpires in 24 hours.`,
      html: `<p>Click <a href="${verifyUrl}">here</a> to verify your new email address.</p><p>Expires in 24 hours.</p>`,
    });

    // Fire-and-forget warning to OLD email
    setImmediate(async () => {
      try {
        await sendEmail({
          to: oldEmail,
          subject: 'Email Change Requested',
          text: `Someone has requested to change your account email to ${normalizedEmail}. If this wasn't you, please secure your account immediately.`,
          html: `<p>Someone has requested to change your account email to <strong>${normalizedEmail}</strong>.</p><p>If this wasn't you, please secure your account immediately.</p>`,
        });
      } catch (_) {
        /* ignore */
      }
    });

    return res.status(200).json({
      success: true,
      message: 'If this email is available, a verification email has been sent.',
    });
  } catch (err) {
    next(err);
  }
}

// ── Re-authenticate (step-up) ─────────────────────────────
// POST /api/v1/reauth — verifies password (+ TOTP if MFA enabled), updates lastAuthAt
async function reauth(req, res, next) {
  try {
    const { password, totpCode } = req.body;
    const user = await User.findById(req.user._id).select('+password +mfaSecret');

    if (!password) {
      return res.status(400).json({ success: false, message: 'Password required' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid password' });
    }

    // AUTH_PATTERNS.md §7.4: step-up must verify all enabled factors
    if (user.mfaEnabled) {
      if (!totpCode) {
        return res
          .status(400)
          .json({ success: false, code: 'totp_required', message: 'TOTP code required' });
      }
      const { authenticator } = require('otplib');
      const { decryptMfaSecret } = require('./mfaController');
      const rawSecret = decryptMfaSecret(user.mfaSecret);
      if (!authenticator.verify({ token: totpCode, secret: rawSecret })) {
        return res.status(401).json({ success: false, message: 'Invalid TOTP code' });
      }
    }

    user.lastAuthAt = new Date();
    await user.save();

    return res.status(200).json({ success: true, message: 'Re-authenticated successfully' });
  } catch (err) {
    next(err);
  }
}
