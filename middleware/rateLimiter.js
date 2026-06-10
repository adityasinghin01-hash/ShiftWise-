// middleware/rateLimiter.js

const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { Ratelimit } = require('@upstash/ratelimit');
const { Redis } = require('@upstash/redis');
const logger = require('../config/logger');

// In test mode, all rate limiters are no-ops to prevent Upstash Redis
// state from accumulating across tests and causing false 429s / flaky failures.
//
// E1 FIX (Wave 4.3): also check JEST_WORKER_ID. tests/jest.setup.js does
// `dotenv.config({ override: true })` which can clobber NODE_ENV with the
// value from .env (typically 'development'), making the NODE_ENV check
// alone unreliable. JEST_WORKER_ID is set by Jest itself and dotenv can't
// touch it. Same pattern used in services/webhookService.js (B8).
if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
  const noOp = (_req, _res, next) => next();
  module.exports = {
    globalLimiter: noOp,
    authLimiter: noOp,
    strictLimiter: noOp,
    apiLimiter: noOp,
  };
} else {
  let useRedis = false;
  let upstashLimiters = null;

  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    useRedis = true;
    upstashLimiters = {
      global: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(200, '15 m'),
        prefix: 'rl:global',
      }),
      auth: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(10, '15 m'),
        prefix: 'rl:auth',
      }),
      strict: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(20, '15 m'),
        prefix: 'rl:strict',
      }),
      api: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(1000, '15 m'),
        prefix: 'rl:api',
      }),
    };
    logger.info('Rate limiter: using Upstash Redis');
  } else {
    logger.warn('Rate limiter: falling back to in-memory store');
  }

  const makeRedisMiddleware = (
    limiterKey,
    fallbackMax,
    windowMs,
    keyGenerator = ipKeyGenerator
  ) => {
    const fallback = rateLimit({
      windowMs,
      max: fallbackMax,
      keyGenerator: keyGenerator,
      standardHeaders: true,
      legacyHeaders: false,
      message: { success: false, message: 'Too many requests. Please try again later.' },
    });

    if (!useRedis) {
      return fallback;
    }

    return async (req, res, next) => {
      try {
        const identifier = keyGenerator(req);
        const { success, limit, remaining, reset } =
          await upstashLimiters[limiterKey].limit(identifier);
        res.setHeader('RateLimit-Limit', limit);
        res.setHeader('RateLimit-Remaining', remaining);
        res.setHeader('RateLimit-Reset', new Date(reset).toISOString());
        if (!success) {
          logger.warn({ message: 'Rate limit exceeded', identifier, url: req.originalUrl });
          return res
            .status(429)
            .json({ success: false, message: 'Too many requests. Please try again later.' });
        }
        next();
      } catch (err) {
        logger.error({ message: 'Upstash error', error: err.message });
        next();
      }
    };
  };

  const globalLimiter = makeRedisMiddleware('global', 200, 15 * 60 * 1000);
  const authLimiter = makeRedisMiddleware('auth', 10, 15 * 60 * 1000);
  const strictLimiter = makeRedisMiddleware('strict', 20, 15 * 60 * 1000);

  // API Limiter — tracks by hashed API key (never raw) or falls back to IP.
  // SECURITY: Raw API key is never stored in logs, response headers, or rate-limit stores.
  const apiLimiter = makeRedisMiddleware('api', 1000, 15 * 60 * 1000, (req) => {
    const rawKey = req.header('X-API-Key');
    if (rawKey) {
      const hashed = crypto.createHash('sha256').update(rawKey).digest('hex').substring(0, 16);
      return `api:${hashed}`;
    }
    return ipKeyGenerator(req);
  });

  module.exports = { globalLimiter, authLimiter, strictLimiter, apiLimiter };
}
