#!/usr/bin/env node

// scripts/security-audit.js
// Pre-deployment security audit — validates environment configuration.
// Run: node scripts/security-audit.js
// Exits with code 1 if any check fails.

require('dotenv').config({ override: false });

const passed = [];
const failed = [];
const warnings = [];

// ── Helpers ──────────────────────────────────────────────

const check = (name, condition, message) => {
  if (condition) {
    passed.push(name);
  } else {
    failed.push(`${name}: ${message}`);
  }
};

const warn = (name, condition, message) => {
  if (!condition) {
    warnings.push(`${name}: ${message}`);
  }
};

// ── Required Environment Variables ──────────────────────

const REQUIRED_VARS = [
  'MONGO_URI',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'WEBHOOK_SECRET_KEY',
  'API_KEY_SALT',
  'NODE_ENV',
  // These are only checked outside test mode (not needed to run the test suite)
  ...(process.env.NODE_ENV !== 'test'
    ? ['BREVO_API_KEY', 'CLIENT_URL', 'OTP_SECRET', 'CSRF_SECRET']
    : []),
];

console.log('\n🔒 Security Audit — Adv_Backend\n');
console.log('═'.repeat(50));
console.log('1. Required Environment Variables');
console.log('─'.repeat(50));

for (const varName of REQUIRED_VARS) {
  const value = process.env[varName];
  check(varName, value && value.trim().length > 0, 'Not set or empty');
}

// ── Specific Format Validations ─────────────────────────

console.log('\n' + '─'.repeat(50));
console.log('2. Secret Format Validation');
console.log('─'.repeat(50));

// WEBHOOK_SECRET_KEY must be exactly 64 hex characters (32 bytes)
const webhookKey = process.env.WEBHOOK_SECRET_KEY || '';
check(
  'WEBHOOK_SECRET_KEY format',
  /^[0-9a-f]{64}$/i.test(webhookKey),
  `Must be exactly 64 hex characters (got ${webhookKey.length} chars)`
);

// API_KEY_SALT must be at least 32 characters
const apiKeySalt = process.env.API_KEY_SALT || '';
check(
  'API_KEY_SALT length',
  apiKeySalt.length >= 32,
  `Must be at least 32 characters (got ${apiKeySalt.length})`
);

// JWT_ACCESS_SECRET must be at least 32 characters
const jwtAccess = process.env.JWT_ACCESS_SECRET || '';
check(
  'JWT_ACCESS_SECRET length',
  jwtAccess.length >= 32,
  `Must be at least 32 characters (got ${jwtAccess.length})`
);

// JWT_REFRESH_SECRET must be at least 32 characters
const jwtRefresh = process.env.JWT_REFRESH_SECRET || '';
check(
  'JWT_REFRESH_SECRET length',
  jwtRefresh.length >= 32,
  `Must be at least 32 characters (got ${jwtRefresh.length})`
);

// ── Warnings (non-blocking) ─────────────────────────────

console.log('\n' + '─'.repeat(50));
console.log('3. Production Readiness');
console.log('─'.repeat(50));

warn(
  'NODE_ENV',
  process.env.NODE_ENV === 'production',
  `Expected "production", got "${process.env.NODE_ENV || '(not set)'}"`
);

warn(
  'MONGO_URI',
  process.env.MONGO_URI && !process.env.MONGO_URI.includes('localhost'),
  'Using localhost — should be a remote URI in production'
);

warn(
  'CLIENT_URL',
  process.env.CLIENT_URL && process.env.CLIENT_URL.startsWith('https://'),
  'CLIENT_URL should use HTTPS in production'
);

// ── Summary ─────────────────────────────────────────────

console.log('\n' + '═'.repeat(50));
console.log('SUMMARY');
console.log('═'.repeat(50));

console.log(`\n  ✅ Passed:   ${passed.length}`);
console.log(`  ❌ Failed:   ${failed.length}`);
console.log(`  ⚠️  Warnings: ${warnings.length}`);

if (passed.length > 0) {
  console.log('\n── Passed ──');
  for (const p of passed) {
    console.log(`  ✅ ${p}`);
  }
}

if (failed.length > 0) {
  console.log('\n── Failed ──');
  for (const f of failed) {
    console.log(`  ❌ ${f}`);
  }
}

if (warnings.length > 0) {
  console.log('\n── Warnings ──');
  for (const w of warnings) {
    console.log(`  ⚠️  ${w}`);
  }
}

console.log('\n' + '═'.repeat(50));

if (failed.length > 0) {
  console.log('❌ AUDIT FAILED — fix the above issues before deploying.\n');
  process.exit(1);
} else {
  console.log('✅ AUDIT PASSED — all checks passed.\n');
  process.exit(0);
}
