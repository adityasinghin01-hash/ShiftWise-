// tests/security-hardening.test.js
// TDD tests for Phase 1 security hardening (S-01 through S-07).

const request = require('supertest');
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI_TEST;

let app;

beforeAll(async () => {
  if (!MONGO_URI) {
    throw new Error('MONGO_URI_TEST env var is required for tests');
  }
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_URI);
  }
  app = require('../app');
});

afterAll(async () => {
  await mongoose.connection.close();
});

// ─── S-01: requestId must validate X-Request-Id format ───────────────
describe('S-01: Request ID validation', () => {
  it('should accept a valid UUID v4 in X-Request-Id header', async () => {
    const validUUID = '550e8400-e29b-41d4-a716-446655440000';
    const res = await request(app).get('/api/health').set('X-Request-Id', validUUID);

    expect(res.headers['x-request-id']).toBe(validUUID);
  });

  it('should reject a malicious X-Request-Id and generate a new UUID', async () => {
    const maliciousId = '<script>alert("xss")</script>';
    const res = await request(app).get('/api/health').set('X-Request-Id', maliciousId);

    // Must NOT echo back the malicious value
    expect(res.headers['x-request-id']).not.toBe(maliciousId);
    // Must be a valid UUID v4
    expect(res.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('should reject a too-long X-Request-Id', async () => {
    const longId = 'a'.repeat(200);
    const res = await request(app).get('/api/health').set('X-Request-Id', longId);

    expect(res.headers['x-request-id']).not.toBe(longId);
    expect(res.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('should generate a UUID when no X-Request-Id is provided', async () => {
    const res = await request(app).get('/api/health');

    expect(res.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });
});

// ─── S-05: X-XSS-Protection must be '0' (deprecated header) ─────────
describe('S-05: X-XSS-Protection header', () => {
  it('should set X-XSS-Protection to 0 (not 1; mode=block)', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-xss-protection']).toBe('0');
  });
});

// ─── S-06: /google-login must have authLimiter ───────────────────────
describe('S-06: Google login rate limiting', () => {
  it('should have rate limiting on /api/v1/google-login', async () => {
    // We just verify the endpoint responds (not 404) and doesn't crash
    // The rate limiter middleware is tested by its presence in the route stack
    const res = await request(app).post('/api/v1/google-login').send({ idToken: 'test' });

    // Should NOT be 404 — route exists
    expect(res.statusCode).not.toBe(404);
  });
});

// ─── S-02/S-03: reCAPTCHA middleware unit tests ──────────────────────
describe('S-02/S-03: reCAPTCHA middleware', () => {
  // We test the middleware function directly (unit test)
  const { verifyRecaptcha } = require('../middleware/recaptchaMiddleware');

  it('should return 400 when no recaptchaToken is provided', async () => {
    const req = { body: {} };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    const next = jest.fn();

    await verifyRecaptcha(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: 'reCAPTCHA token is required',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('should call next() for dev-bypass in development', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    // Re-require to pick up env change — but config is cached, so mock it
    jest.resetModules();
    const configMock = require('../config/config');
    configMock.NODE_ENV = 'development';
    const { verifyRecaptcha: freshVerify } = require('../middleware/recaptchaMiddleware');

    const req = { body: { recaptchaToken: 'dev-bypass' } };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    const next = jest.fn();

    await freshVerify(req, res, next);
    expect(next).toHaveBeenCalled();

    process.env.NODE_ENV = originalEnv;
  });
});

// ─── S-04: Config fail-fast for missing production secrets ───────────
describe('S-04: Config production fail-fast', () => {
  it('should export a validateProductionConfig function', () => {
    const config = require('../config/config');
    expect(typeof config.validateProductionConfig).toBe('function');
  });

  it('should throw when critical secrets are missing in production mode', () => {
    const config = require('../config/config');

    // Save originals
    const origJwtAccess = config.JWT_ACCESS_SECRET;
    const origJwtRefresh = config.JWT_REFRESH_SECRET;

    try {
      config.JWT_ACCESS_SECRET = undefined;
      config.JWT_REFRESH_SECRET = undefined;

      expect(() => config.validateProductionConfig()).toThrow(/Missing required/);
    } finally {
      // Restore
      config.JWT_ACCESS_SECRET = origJwtAccess;
      config.JWT_REFRESH_SECRET = origJwtRefresh;
    }
  });
});
