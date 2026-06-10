// tests/hash-and-password.test.js
// Coverage for hashToken.js (hashToken + hashOtp) and passwordValidator.js.
// These functions were uncovered, causing the ./utils/ coverage thresholds to fail.

describe('hashToken utility', () => {
  let hashToken, hashOtp;

  beforeAll(() => {
    hashToken = require('../utils/hashToken');
    hashOtp = require('../utils/hashToken').hashOtp;
  });

  // ── hashToken (plain SHA-256) ─────────────────────────────────────────────

  test('returns a 64-char hex string for a normal token', () => {
    const result = hashToken('abc123');
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  test('is deterministic — same input always produces same hash', () => {
    expect(hashToken('token')).toBe(hashToken('token'));
  });

  test('produces different output for different inputs', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });

  test('handles empty string without throwing', () => {
    expect(() => hashToken('')).not.toThrow();
    expect(hashToken('')).toMatch(/^[0-9a-f]{64}$/);
  });

  // ── hashOtp (HMAC-SHA256) ─────────────────────────────────────────────────

  test('hashOtp returns a 64-char hex string for a 6-digit OTP', () => {
    const result = hashOtp('482910');
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  test('hashOtp is deterministic for the same OTP', () => {
    expect(hashOtp('123456')).toBe(hashOtp('123456'));
  });

  test('hashOtp produces different output for different OTPs', () => {
    expect(hashOtp('111111')).not.toBe(hashOtp('222222'));
  });

  test('hashOtp output differs from plain hashToken output for the same value', () => {
    // HMAC uses a key — should never equal plain SHA-256 for the same input
    expect(hashOtp('123456')).not.toBe(hashToken('123456'));
  });

  test('hashOtp coerces numeric OTPs to strings without throwing', () => {
    // In case a caller passes a number instead of string
    expect(() => hashOtp(482910)).not.toThrow();
  });
});

// ── passwordValidator ─────────────────────────────────────────────────────────

describe('passwordValidator', () => {
  let validatePassword;

  beforeAll(() => {
    validatePassword = require('../utils/passwordValidator');
  });

  test('accepts a strong password', () => {
    const result = validatePassword('SecureP@ss1234');
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('rejects password shorter than minimum length', () => {
    const result = validatePassword('Ab1!');
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('rejects password with no uppercase letter', () => {
    const result = validatePassword('secure@pass1234');
    expect(result.isValid).toBe(false);
  });

  test('rejects password with no lowercase letter', () => {
    const result = validatePassword('SECURE@PASS1234');
    expect(result.isValid).toBe(false);
  });

  test('rejects password with no digit', () => {
    const result = validatePassword('SecureP@ssword');
    expect(result.isValid).toBe(false);
  });

  test('rejects password with no special character', () => {
    const result = validatePassword('SecurePass1234');
    expect(result.isValid).toBe(false);
  });

  test('rejects empty string', () => {
    const result = validatePassword('');
    expect(result.isValid).toBe(false);
  });

  test('returns errors array when invalid', () => {
    const result = validatePassword('weak');
    expect(Array.isArray(result.errors)).toBe(true);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
