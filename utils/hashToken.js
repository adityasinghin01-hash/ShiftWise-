// utils/hashToken.js
// SHA-256 hashing for all token types: verification, reset, and refresh.
// One function, used everywhere — fixes B-03 (inconsistent hashing).
// ARCHITECTURE_MAP §5: Token Hashing Utility.

const crypto = require('crypto');
const config = require('../config/config');

/**
 * hashToken — plain SHA-256 for high-entropy tokens (32+ random bytes).
 * Suitable for: verification tokens, reset tokens, refresh tokens, API keys.
 * NOT suitable for low-entropy values like OTP codes — use hashOtp() instead.
 *
 * @param {string} token - The raw token string to hash.
 * @returns {string} Hex-encoded SHA-256 digest.
 */
const hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

/**
 * hashOtp — HMAC-SHA256 for low-entropy values such as 6-digit OTP codes.
 *
 * L-06 FIX: Plain SHA-256 of a 6-digit OTP has only 900,000 possible outputs
 * and is trivially precomputable into a rainbow table in milliseconds.
 * HMAC with the server secret (OTP_SECRET or JWT_ACCESS_SECRET) makes the
 * output space secret-dependent, rendering precomputation infeasible without
 * knowledge of the key.
 *
 * @param {string} otp - The raw OTP code (e.g. "482910").
 * @returns {string} Hex-encoded HMAC-SHA256 digest.
 */
const hashOtp = (otp) => {
  const key = config.OTP_SECRET || config.JWT_ACCESS_SECRET;
  return crypto.createHmac('sha256', key).update(String(otp)).digest('hex');
};

module.exports = hashToken;
module.exports.hashOtp = hashOtp;
