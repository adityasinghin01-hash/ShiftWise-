// middleware/recaptchaMiddleware.js
// Verifies Google reCAPTCHA token on signup and login.
// Dev bypass: when NODE_ENV=development AND token='dev-bypass', skips verification.
// TECH_DECISIONS §2.1: reCAPTCHA on BOTH signup AND login (fixes B-13).
//
// S-02 FIX: Secret passed via POST body (application/x-www-form-urlencoded),
//           NOT as a URL query param — prevents secret leakage in access logs.
// S-03 FIX: Enforce reCAPTCHA v3 score threshold (< 0.5 = bot) to prevent
//           low-confidence tokens from bypassing bot protection.
const config = require('../config/config');
const logger = require('../config/logger');

const verifyRecaptcha = async (req, res, next) => {
  const { recaptchaToken } = req.body;

  // Bypass in non-production environments to avoid hitting Google's network.
  // Both test and development: only bypass with the magic string.
  // This keeps the "missing token → 400" validation path active for unit tests.
  if (
    (config.NODE_ENV === 'test' || config.NODE_ENV === 'development') &&
    recaptchaToken === 'dev-bypass'
  ) {
    return next();
  }

  if (!recaptchaToken) {
    return res.status(400).json({ message: 'reCAPTCHA token is required' });
  }

  // Abort the Google API call if it takes longer than RECAPTCHA_TIMEOUT_MS
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.RECAPTCHA_TIMEOUT_MS);

  try {
    // S-02: Use POST body — secret never appears in URL/logs
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${encodeURIComponent(config.RECAPTCHA_SECRET)}&response=${encodeURIComponent(recaptchaToken)}`,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await response.json();

    // S-03: Check success AND configurable score threshold for reCAPTCHA v3.
    // score is only present in v3; v2 omits it (treated as passing).
    if (
      !data.success ||
      (data.score !== undefined && data.score < config.RECAPTCHA_SCORE_THRESHOLD)
    ) {
      return res.status(400).json({ message: 'reCAPTCHA verification failed' });
    }

    next();
  } catch (error) {
    clearTimeout(timer);
    if (error.name === 'AbortError') {
      logger.error('reCAPTCHA verification timed out', { timeout: config.RECAPTCHA_TIMEOUT_MS });
      return res.status(503).json({ message: 'reCAPTCHA service unavailable' });
    }
    logger.error('reCAPTCHA verification error', { error: error.message });
    return res.status(500).json({ message: 'reCAPTCHA verification error' });
  }
};

module.exports = { verifyRecaptcha };
