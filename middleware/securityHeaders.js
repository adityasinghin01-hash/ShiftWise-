// middleware/securityHeaders.js
// Additional security headers beyond what Helmet provides.
// Hardens responses against clickjacking, MIME sniffing, XSS,
// and cross-origin information leaks.

const logger = require('../config/logger');

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  // S-05 FIX: '1; mode=block' is deprecated — causes XSS in old IE.
  // Modern browsers ignore this header; security enforced via CSP (helmet).
  'X-XSS-Protection': '0',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

const securityHeaders = (_req, res, next) => {
  for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(header, value);
  }

  // In non-production environments, verify all headers were actually set
  if (process.env.NODE_ENV !== 'production') {
    res.on('finish', () => {
      for (const header of Object.keys(SECURITY_HEADERS)) {
        if (!res.getHeader(header)) {
          logger.warn(`Security header missing from response: ${header}`, {
            url: _req.originalUrl,
            method: _req.method,
          });
        }
      }
    });
  }

  next();
};

module.exports = securityHeaders;
