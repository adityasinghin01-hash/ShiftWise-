// tests/api-hardening.test.js
// TDD RED: Verifies API hardening fixes across multiple concerns.

const fs = require('fs');
const path = require('path');

describe('COEP Header Conflict — Task 4.3', () => {
  test('securityHeaders must NOT set Cross-Origin-Embedder-Policy', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'middleware', 'securityHeaders.js'),
      'utf-8'
    );
    expect(source).not.toMatch(/Cross-Origin-Embedder-Policy/);
  });
});

describe('Hardcoded Emails Removed — Task 4.4', () => {
  test('config.js must NOT contain hardcoded email addresses as fallbacks', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'config', 'config.js'), 'utf-8');
    // Should not have email@domain as a fallback default
    const lines = source.split('\n');
    const fallbackLines = lines.filter((line) => /\|\|\s*['"].*@.*\.com['"]/.test(line));
    expect(fallbackLines).toEqual([]);
  });
});

describe('Missing Env Vars in .env.example — Task 4.5', () => {
  test('.env.example must include UPSTASH vars', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf-8');
    expect(source).toMatch(/UPSTASH_REDIS_REST_URL/);
    expect(source).toMatch(/UPSTASH_REDIS_REST_TOKEN/);
  });

  test('.env.example must include BREVO_SENDER_EMAIL', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf-8');
    expect(source).toMatch(/BREVO_SENDER_EMAIL/);
  });
});
