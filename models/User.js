// models/User.js
// Full User schema per ARCHITECTURE_MAP §2.
// Includes: identity, verification, password reset, security, sessions.

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { roles } = require('../config/roles');

// P-03: Maximum number of concurrent refresh tokens per user.
// Oldest tokens are evicted when the limit is exceeded, limiting both
// memory bloat and the stolen-token attack surface.
const MAX_REFRESH_TOKENS = 10;

const userSchema = new mongoose.Schema(
  {
    // ── Identity ──────────────────────────────────────────
    email: {
      type: String,
      required: true,
      unique: true, // H13 FIX: `unique: true` already builds an index; dropping
      // the redundant `index: true` to avoid Mongoose's duplicate-index warning.
      lowercase: true,
      trim: true,
    },

    password: {
      type: String,
      required: function () {
        return this.provider === 'local';
      },
      select: false, // Task 23: Never leaked in queries unless explicitly requested
    },

    provider: {
      type: String,
      enum: ['local', 'google'],
      default: 'local',
    },

    name: {
      type: String,
      trim: true,
      maxlength: 100,
    },

    picture: {
      type: String, // Google profile picture URL
      maxlength: 2048,
    },

    // ── Role & Moderation ─────────────────────────────────
    role: {
      type: String,
      enum: Object.values(roles), // ['user', 'moderator', 'admin', 'superadmin']
      default: roles.USER,
    },

    isBanned: {
      type: Boolean,
      default: false,
    },

    // ── Subscription ─────────────────────────────────────
    activeSubscription: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subscription',
      default: null,
    },
    pendingSubscriptionCreation: {
      type: Boolean,
      default: true,
    },

    // ── Verification ──────────────────────────────────────
    isVerified: {
      type: Boolean,
      default: false,
    },

    verificationToken: {
      type: String, // Task 25: SHA-256 hash of the raw token (NEVER raw — fixes B-03)
    },

    verificationTokenExpiry: {
      type: Date,
    },

    // ── Password Reset ────────────────────────────────────
    resetToken: {
      type: String, // Task 25: SHA-256 hash of the raw token
    },

    resetTokenExpiry: {
      type: Date,
    },

    // ── OTP (for forgot-password flow) ───────────────────────
    otpCode: {
      type: String, // SHA-256 hash of the 6-digit code
    },

    otpExpiry: {
      type: Date,
    },

    // LOW-02 FIX: Per-user OTP brute-force counter.
    // Rate limiters work per-IP — an attacker using a proxy pool bypasses them.
    // This counter blocks OTP verification for a specific user after 5 failures,
    // forcing them to request a new OTP (which resets the counter).
    otpFailedAttempts: {
      type: Number,
      default: 0,
    },

    otpLockUntil: {
      type: Date, // OTP verification locked until this timestamp after too many failures
    },

    // ── Pending Email Change ─────────────────────────────
    pendingEmail: {
      type: String,
      lowercase: true,
      trim: true,
    },
    pendingEmailToken: {
      type: String, // SHA-256 hash of the raw token
    },
    pendingEmailExpiry: {
      type: Date,
    },

    // ── Step-up Auth ─────────────────────────────────────
    lastAuthAt: {
      type: Date,
    },

    // ── MFA ──────────────────────────────────────────────
    mfaEnabled: {
      type: Boolean,
      default: false,
    },
    mfaSecret: {
      type: String, // AES-256-GCM encrypted TOTP secret
    },
    backupCodes: [
      {
        codeHash: { type: String, required: true },
        usedAt: { type: Date },
      },
    ],

    // ── Security ──────────────────────────────────────────
    failedLoginAttempts: {
      type: Number,
      default: 0,
    },

    lockUntil: {
      type: Date, // Account locked until this timestamp
    },

    // ── Sessions ─────────────────────────────────────────
    // Task 24: Array of objects, not raw strings (fixes B-04/old structure)
    refreshTokens: [
      {
        tokenHash: {
          type: String, // SHA-256 hash of the JWT refresh token
          required: true,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
        deviceInfo: {
          type: String, // User-Agent string or 'unknown'
          default: 'unknown',
        },
        // H3 FIX: Track which tokens are 30-day rememberMe sessions so the
        // pre-save prune doesn't kill them at the default 7-day mark.
        rememberMe: {
          type: Boolean,
          default: false,
        },
      },
    ],
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
  }
);

// ── Indexes ────────────────────────────────────────────────
// P-01: Sparse indexes — only index documents where the field is actually set.
// This avoids indexing the vast majority of users who have null tokens,
// keeping the index small and lookups fast.
userSchema.index({ verificationToken: 1 }, { sparse: true });
userSchema.index({ resetToken: 1 }, { sparse: true });

// ── Pre-Save Hooks ─────────────────────────────────────────
// Task 26: bcrypt 12 rounds, ONLY runs when password is modified.
// Fixes B-04: no double-hashing on second save since isModified check returns false.
userSchema.pre('save', async function () {
  if (!this.isModified('password')) {
    return;
  }
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
});

// P-03: Cap the refreshTokens array to MAX_REFRESH_TOKENS (10).
// Runs on every save. When over the limit, the oldest entries (front of array)
// are evicted so only the 10 most recent sessions are retained.
userSchema.pre('save', function () {
  if (this.refreshTokens && this.refreshTokens.length > MAX_REFRESH_TOKENS) {
    this.refreshTokens = this.refreshTokens.slice(-MAX_REFRESH_TOKENS);
  }
});

// INFO-04 FIX: Prune expired refresh tokens on save.
// Tokens older than their actual JWT lifetime can never pass jwt.verify() again,
// so removing them keeps the array lean.
//
// H3 FIX: Use a per-token cutoff instead of a single global one. Sessions
// created with rememberMe=true have a 30-day JWT expiry; pruning them at the
// default 7-day cutoff would silently log those users out.
const STANDARD_REFRESH_MS = (() => {
  const raw = process.env.REFRESH_TOKEN_EXPIRES || '7d';
  const match = raw.match(/^(\d+)([dhms])$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const multipliers = { d: 86400000, h: 3600000, m: 60000, s: 1000 };
  return parseInt(match[1], 10) * (multipliers[match[2]] || 86400000);
})();
const REMEMBER_ME_REFRESH_MS = 30 * 24 * 60 * 60 * 1000; // 30d

userSchema.pre('save', function () {
  if (this.refreshTokens && this.refreshTokens.length > 0) {
    const now = Date.now();
    const before = this.refreshTokens.length;
    this.refreshTokens = this.refreshTokens.filter((t) => {
      if (!t.createdAt) return false;
      const maxAge = t.rememberMe ? REMEMBER_ME_REFRESH_MS : STANDARD_REFRESH_MS;
      return now - new Date(t.createdAt).getTime() < maxAge;
    });
    if (this.refreshTokens.length < before) {
      this.markModified('refreshTokens');
    }
  }
});

// ── Instance Methods ──────────────────────────────────────
// Task 27: Compare candidate password against stored hash.
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model('User', userSchema);

module.exports = User;
