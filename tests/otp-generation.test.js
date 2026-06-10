// tests/otp-generation.test.js
// TDD RED: Verifies OTP generation is cryptographically secure and produces 6-digit codes.

const fs = require('fs');
const path = require('path');

const PASSWORD_CONTROLLER_PATH = path.join(__dirname, '..', 'controllers', 'passwordController.js');

describe('OTP Generation — Security Audit', () => {
  let source;

  beforeAll(() => {
    source = fs.readFileSync(PASSWORD_CONTROLLER_PATH, 'utf-8');
  });

  test('source file must NOT contain Math.random', () => {
    expect(source).not.toMatch(/Math\.random/);
  });

  test('source file must use crypto.randomInt for OTP generation', () => {
    expect(source).toMatch(/crypto\.randomInt/);
  });

  test('OTP range must produce exactly 6 digits (100000–999999)', () => {
    // The call should be crypto.randomInt(100000, 1000000)
    expect(source).toMatch(/randomInt\s*\(\s*100000\s*,\s*1000000\s*\)/);
  });
});
