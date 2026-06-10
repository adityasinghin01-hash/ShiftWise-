// tests/token-expiry.test.js
// TDD RED: Verifies verification token expiry is consistently 24 hours across all controllers.

const fs = require('fs');
const path = require('path');

const AUTH_CONTROLLER_PATH = path.join(__dirname, '..', 'controllers', 'authController.js');
const VERIFICATION_CONTROLLER_PATH = path.join(
  __dirname,
  '..',
  'controllers',
  'verificationController.js'
);

describe('Verification Token Expiry — Consistency Check', () => {
  let authSource, verificationSource;

  beforeAll(() => {
    authSource = fs.readFileSync(AUTH_CONTROLLER_PATH, 'utf-8');
    verificationSource = fs.readFileSync(VERIFICATION_CONTROLLER_PATH, 'utf-8');
  });

  test('authController VERIFICATION_TOKEN_EXPIRY must be 24 hours (86400000 ms)', () => {
    // 24 * 60 * 60 * 1000 = 86400000
    expect(authSource).toMatch(
      /VERIFICATION_TOKEN_EXPIRY\s*=\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/
    );
  });

  test('verificationController VERIFICATION_TOKEN_EXPIRY must be 24 hours (86400000 ms)', () => {
    expect(verificationSource).toMatch(
      /VERIFICATION_TOKEN_EXPIRY\s*=\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/
    );
  });

  test('both controllers must define the same expiry constant', () => {
    const extractExpiry = (src) => {
      const match = src.match(/VERIFICATION_TOKEN_EXPIRY\s*=\s*([^;]+)/);
      return match ? match[1].trim() : null;
    };

    const authExpiry = extractExpiry(authSource);
    const verificationExpiry = extractExpiry(verificationSource);

    expect(authExpiry).toBeTruthy();
    expect(verificationExpiry).toBeTruthy();
    expect(authExpiry).toBe(verificationExpiry);
  });
});
