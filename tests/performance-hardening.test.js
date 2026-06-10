// tests/performance-hardening.test.js
// TDD RED: Performance & Code-Quality hardening suite.
// Covers: P-01 (sparse indexes), P-03 (refreshTokens cap),
//         P-04 (TTL index), Q-02 (404 handler), Q-04 (RBAC comment),
//         Q-01 (validation helper).

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../app');

// ─────────────────────────────────────────────────────────────────────────────
// P-01: Sparse indexes on verificationToken & resetToken
// Rationale: Null tokens (most users) bloat a regular index by storing all
// null entries. Sparse indexes only index documents that have the field set.
// ─────────────────────────────────────────────────────────────────────────────
describe('P-01 — Sparse indexes on verificationToken & resetToken', () => {
  const userModelSrc = fs.readFileSync(path.join(__dirname, '..', 'models', 'User.js'), 'utf-8');

  test('verificationToken field must have sparse: true index', () => {
    // Should find: userSchema.index({ verificationToken: 1 }, { sparse: true })
    expect(userModelSrc).toMatch(
      /userSchema\.index\(\s*\{\s*verificationToken\s*:\s*1\s*\}\s*,\s*\{\s*sparse\s*:\s*true\s*\}\s*\)/
    );
  });

  test('resetToken field must have sparse: true index', () => {
    // Should find: userSchema.index({ resetToken: 1 }, { sparse: true })
    expect(userModelSrc).toMatch(
      /userSchema\.index\(\s*\{\s*resetToken\s*:\s*1\s*\}\s*,\s*\{\s*sparse\s*:\s*true\s*\}\s*\)/
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P-03: Cap refreshTokens array to 10 entries (session-hijack surface reduction)
// Rationale: Unbounded arrays grow forever — each login adds an entry.
// Capping to 10 prevents memory bloat and limits the stolen-token attack surface.
// ─────────────────────────────────────────────────────────────────────────────
describe('P-03 — refreshTokens array capped at 10 per user', () => {
  const userModelSrc = fs.readFileSync(path.join(__dirname, '..', 'models', 'User.js'), 'utf-8');

  test('User.js must implement a refreshTokens cap mechanism', () => {
    // Look for the cap logic — slicing to 10 in a pre-save or instance method
    // Accept either: .slice(-10) or .splice(0, ...) or MAX_REFRESH_TOKENS
    const hasCap =
      /MAX_REFRESH_TOKENS\s*=\s*10/.test(userModelSrc) ||
      /refreshTokens.*\.slice\(-10\)/.test(userModelSrc) ||
      /refreshTokens.*slice\(.*-10\)/.test(userModelSrc);
    expect(hasCap).toBe(true);
  });

  test('refreshTokens cap constant must be 10', () => {
    // Explicit constant for readability & single-source-of-truth
    expect(userModelSrc).toMatch(/MAX_REFRESH_TOKENS\s*=\s*10/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P-04: TTL index on WebhookDelivery (auto-expire after 30 days)
// Rationale: Delivery records are audit logs, not permanent. Without a TTL,
// the collection grows unbounded. 30 days satisfies audit needs without bloat.
// ─────────────────────────────────────────────────────────────────────────────
describe('P-04 — TTL index on WebhookDelivery (30 days)', () => {
  const webhookDeliverySrc = fs.readFileSync(
    path.join(__dirname, '..', 'models', 'WebhookDelivery.js'),
    'utf-8'
  );

  test('WebhookDelivery must declare a TTL index on createdAt', () => {
    // Should find: webhookDeliverySchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 })
    // 30 days = 30 * 24 * 60 * 60 = 2592000 seconds
    expect(webhookDeliverySrc).toMatch(
      /webhookDeliverySchema\.index\(\s*\{\s*createdAt\s*:\s*1\s*\}\s*,\s*\{\s*expireAfterSeconds\s*:\s*2592000\s*\}\s*\)/
    );
  });

  test('TTL value 2592000 (30 days in seconds) must appear in WebhookDelivery.js', () => {
    // The literal 2592000 must be present (either inlined or via constant)
    expect(webhookDeliverySrc).toMatch(/2592000/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Q-02: 404 catch-all route in app.js
// Rationale: Without a catch-all, Express returns its default HTML 404 page,
// leaking framework info and breaking the consistent JSON API contract.
// ─────────────────────────────────────────────────────────────────────────────
describe('Q-02 — 404 catch-all returns JSON', () => {
  test('GET /api/v1/nonexistent-route returns 404 JSON', async () => {
    const res = await request(app).get('/api/v1/this-route-does-not-exist-9999');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('message');
    expect(res.body.message).toMatch(/not found/i);
  });

  test('POST /api/nonexistent-route returns 404 JSON not HTML', async () => {
    const res = await request(app).post('/api/completely-unknown-endpoint-8888');
    expect(res.status).toBe(404);
    expect(res.type).toMatch(/json/);
    expect(res.body).toHaveProperty('success', false);
  });

  test('404 response must not contain Express default HTML', async () => {
    const res = await request(app).get('/unknown-path-xyz-1234');
    // Must not be HTML (Express default error page)
    expect(res.type).not.toMatch(/html/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Q-04: Fix duplicate step "2" comment in rbacMiddleware.js
// Rationale: Two consecutive blocks are both labelled "// 2." — confusing.
// The second should be "// 2b." or "// 3." (sequential).
// ─────────────────────────────────────────────────────────────────────────────
describe('Q-04 — rbacMiddleware has no duplicate step numbering', () => {
  const rbacSrc = fs.readFileSync(
    path.join(__dirname, '..', 'middleware', 'rbacMiddleware.js'),
    'utf-8'
  );

  test('rbacMiddleware.js must not have two identical "// 2." step comments', () => {
    // Count occurrences of "// 2." at the start of a comment line
    const matches = rbacSrc.match(/\/\/ 2\./g);
    // There should be at most 1 (or zero if renumbered)
    expect(matches ? matches.length : 0).toBeLessThanOrEqual(1);
  });

  test('All step comments in rbacMiddleware.js must be sequentially numbered', () => {
    // Extract step numbers like "// 0.", "// 1.", "// 2.", "// 3.", "// 4."
    const stepMatches = [...rbacSrc.matchAll(/\/\/ (\d+)\./g)].map((m) => parseInt(m[1], 10));
    // Sort and ensure no duplicates
    const sorted = [...stepMatches].sort((a, b) => a - b);
    const unique = [...new Set(sorted)];
    expect(sorted).toEqual(unique);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Q-01: Centralized validation helper to eliminate copy-paste
// Rationale: The same 3-line validationResult pattern is copy-pasted in 6+
// controller files. A single helper reduces mutation surface and enforces
// a consistent 400 JSON shape project-wide.
// ─────────────────────────────────────────────────────────────────────────────
describe('Q-01 — Centralized handleValidationErrors helper', () => {
  test('utils/handleValidation.js must exist', () => {
    const helperPath = path.join(__dirname, '..', 'utils', 'handleValidation.js');
    expect(fs.existsSync(helperPath)).toBe(true);
  });

  test('handleValidationErrors must be exported from utils/handleValidation.js', () => {
    const helper = require('../utils/handleValidation');
    expect(typeof helper.handleValidationErrors).toBe('function');
  });

  test('handleValidationErrors returns false when validation passes (no errors)', () => {
    const { handleValidationErrors } = require('../utils/handleValidation');
    // Mock express-validator result — simulate valid request
    const mockValidationResult = { isEmpty: () => true, array: () => [] };
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    // Helper should return false (meaning "did NOT send error response — continue")
    const result = handleValidationErrors(mockValidationResult, mockRes);
    expect(result).toBe(false); // false = "no error was sent, caller should continue"
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  test('handleValidationErrors sends 400 and returns true when errors exist', () => {
    const { handleValidationErrors } = require('../utils/handleValidation');
    const mockValidationResult = {
      isEmpty: () => false,
      array: () => [{ msg: 'Email is required' }],
    };
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    const result = handleValidationErrors(mockValidationResult, mockRes);
    expect(result).toBe(true); // true = "error was sent, caller should return"
    // M11 FIX: validation errors now return 422 Unprocessable Entity
    expect(mockRes.status).toHaveBeenCalledWith(422);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        code: 'validation_failed',
        message: 'Email is required',
      })
    );
  });

  test('webhookController.js must import handleValidationErrors', () => {
    const controllerSrc = fs.readFileSync(
      path.join(__dirname, '..', 'controllers', 'webhookController.js'),
      'utf-8'
    );
    expect(controllerSrc).toMatch(/handleValidationErrors/);
  });

  test('webhookController.js must NOT use the raw isEmpty() guard (anti-pattern dedup check)', () => {
    const controllerSrc = fs.readFileSync(
      path.join(__dirname, '..', 'controllers', 'webhookController.js'),
      'utf-8'
    );
    // The OLD anti-pattern was:  if (!errors.isEmpty()) { return res.status(400)... }
    // After refactor all such raw blocks must be replaced by handleValidationErrors(errors, res).
    // NOTE: validationResult(req) calls are still expected — they produce the errors
    // object that is passed INTO the helper. Only the raw isEmpty() guard must be gone.
    const rawGuards = (controllerSrc.match(/if\s*\(\s*!errors\.isEmpty\(\)\s*\)/g) || []).length;
    expect(rawGuards).toBe(0);
  });
});
