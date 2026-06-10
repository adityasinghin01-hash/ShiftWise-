// middleware/stepUpAuth.js
// Step-up authentication — requires recent auth for sensitive operations.
// AUTH_PATTERNS.md §7.4

/**
 * Factory that returns middleware requiring user.lastAuthAt to be within maxAgeMinutes.
 * @param {number} maxAgeMinutes - Maximum age of lastAuthAt in minutes (default 10)
 */
const requireRecentAuth = (maxAgeMinutes = 10) => {
  return (req, res, next) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const lastAuth = user.lastAuthAt;
    if (!lastAuth) {
      return res.status(403).json({
        code: 'step_up_required',
        message: 'Please re-authenticate to perform this action',
      });
    }

    const parsedTime = new Date(lastAuth).getTime();
    const now = Date.now();
    // Reject NaN, Infinity, or future timestamps (clock skew / tampered value)
    if (!Number.isFinite(parsedTime) || parsedTime > now) {
      return res.status(403).json({
        code: 'step_up_required',
        message: 'Please re-authenticate to perform this action',
      });
    }

    const ageMs = now - parsedTime;
    const maxAgeMs = maxAgeMinutes * 60 * 1000;

    if (ageMs > maxAgeMs) {
      return res.status(403).json({
        code: 'step_up_required',
        message: 'Please re-authenticate to perform this action',
      });
    }

    next();
  };
};

module.exports = { requireRecentAuth };
