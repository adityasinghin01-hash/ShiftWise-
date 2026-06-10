// config/config.js
// Exports all environment-based configuration values.
// In production, dotenv is NOT loaded — env vars come from Render dashboard.

if (process.env.NODE_ENV !== 'production') {
  const path = require('path');
  require('dotenv').config({ path: path.resolve(__dirname, '../.env'), override: false });
}

const config = {
  PORT: process.env.PORT || 5001,
  NODE_ENV: process.env.NODE_ENV || 'development',
  BASE_URL: process.env.BASE_URL || 'http://localhost:5001',
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:3000',
  MONGO_URI: process.env.MONGO_URI,

  // CORS — comma-separated string parsed into array
  // Throws in production if not set — prevents accidental open-CORS deployments
  ALLOWED_ORIGINS: (() => {
    if (!process.env.ALLOWED_ORIGINS) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('ALLOWED_ORIGINS must be set in production');
      }
      return ['http://localhost:3000', 'http://localhost:5001'];
    }
    return process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
  })(),

  // JWT
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  ACCESS_TOKEN_EXPIRES: process.env.ACCESS_TOKEN_EXPIRES || '15m',
  REFRESH_TOKEN_EXPIRES: process.env.REFRESH_TOKEN_EXPIRES || '7d',

  // API Keys
  API_KEY_SALT: process.env.API_KEY_SALT,

  // Email — Brevo HTTP API
  BREVO_API_KEY: process.env.BREVO_API_KEY,
  BREVO_SENDER_EMAIL: process.env.BREVO_SENDER_EMAIL || '',
  BREVO_SENDER_NAME: process.env.BREVO_SENDER_NAME || 'Auth System',
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || '',

  // Google OAuth
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_WEB_CLIENT_ID: process.env.GOOGLE_WEB_CLIENT_ID,

  // reCAPTCHA
  RECAPTCHA_SECRET: process.env.RECAPTCHA_SECRET,
  RECAPTCHA_SCORE_THRESHOLD: (() => {
    // H1 FIX: `parseFloat(x) || 0.5` returns 0.5 when env is "0", which is a valid
    // operator value (effectively disable the threshold). Use Number.isFinite to
    // accept 0 as a real value.
    const parsed = parseFloat(process.env.RECAPTCHA_SCORE_THRESHOLD);
    return Number.isFinite(parsed) ? parsed : 0.5;
  })(),
  RECAPTCHA_TIMEOUT_MS: (() => {
    const parsed = parseInt(process.env.RECAPTCHA_TIMEOUT_MS, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 5000;
  })(),

  // Webhook
  WEBHOOK_SECRET_KEY: process.env.WEBHOOK_SECRET_KEY,

  // CSRF
  CSRF_SECRET: process.env.CSRF_SECRET,

  // MFA encryption key — must be separate from WEBHOOK_SECRET_KEY (key separation).
  // Required in production — startup throws if unset.
  MFA_SECRET: process.env.MFA_SECRET,

  // JWT key rotation
  JWT_KEY_ID: process.env.JWT_KEY_ID || 'v1',
  JWT_KEY_ID_PREV: process.env.JWT_KEY_ID_PREV,
  JWT_ACCESS_SECRET_PREV: process.env.JWT_ACCESS_SECRET_PREV,
  JWT_REFRESH_SECRET_PREV: process.env.JWT_REFRESH_SECRET_PREV,

  // MED-02 FIX: OTP HMAC secret — must be separate from JWT secrets.
  // hashToken.js falls back to JWT_ACCESS_SECRET if this is unset, which violates
  // the cryptographic key separation principle. Required explicitly in production.
  OTP_SECRET: process.env.OTP_SECRET,

  // Verification token expiry
  VERIFICATION_TOKEN_EXPIRY: process.env.VERIFICATION_TOKEN_EXPIRY || '24h',
};

// S-04 FIX: Production fail-fast validator.
// Called from server.js on startup (before accepting traffic).
// Also exported so tests can validate the function directly.
// Throwing here kills the process immediately with a clear error message
// rather than silently serving requests with undefined secrets.
const PRODUCTION_REQUIRED_VARS = [
  'MONGO_URI',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'API_KEY_SALT',
  'BREVO_API_KEY',
  'RECAPTCHA_SECRET',
  'WEBHOOK_SECRET_KEY',
  // MED-02 FIX: OTP_SECRET required — prevents silent fallback to JWT_ACCESS_SECRET.
  // Without this, a missing OTP_SECRET in production causes HMAC key sharing between
  // OTP hashing and JWT signing, violating cryptographic key separation.
  'OTP_SECRET',
  // SECURITY.md §7: CSRF_SECRET must be separate from JWT secrets.
  'CSRF_SECRET',
  // Key separation: MFA_SECRET must not fall back to WEBHOOK_SECRET_KEY.
  'MFA_SECRET',
];

config.validateProductionConfig = function validateProductionConfig() {
  const missing = PRODUCTION_REQUIRED_VARS.filter((k) => !config[k]);
  if (missing.length) {
    throw new Error(`FATAL: Missing required env vars in production: ${missing.join(', ')}`);
  }
};

module.exports = config;
