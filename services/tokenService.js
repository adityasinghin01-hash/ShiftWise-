// services/tokenService.js
// JWT token generation — access tokens (15m) and refresh tokens (7d/30d).
// ARCHITECTURE_MAP §5: Token Architecture.
// Each token includes a random `jti` to guarantee uniqueness even within the same second.
//
// H7 + L FIX (Wave 4): Both access and refresh tokens carry only `id` and `jti`
// (refresh adds `rememberMe`). Previously they embedded `email`, `role`, and
// `isVerified` — all of which can become stale between sign and verify.
// `protect()` always reloads the full user from DB, so the JWT only needs to
// identify whose record to load. Smaller payload = smaller token, no
// information leakage to the client, and no stale-claim bugs.

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config/config');

const generateAccessToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      jti: crypto.randomBytes(16).toString('hex'), // Ensures uniqueness
    },
    config.JWT_ACCESS_SECRET,
    { expiresIn: config.ACCESS_TOKEN_EXPIRES }
  );
};

const generateRefreshToken = (user, rememberMe = false) => {
  const expiresIn = rememberMe ? '30d' : config.REFRESH_TOKEN_EXPIRES;

  return jwt.sign(
    {
      id: user._id,
      rememberMe,
      jti: crypto.randomBytes(16).toString('hex'), // Ensures uniqueness
    },
    config.JWT_REFRESH_SECRET,
    { expiresIn }
  );
};

module.exports = { generateAccessToken, generateRefreshToken };
