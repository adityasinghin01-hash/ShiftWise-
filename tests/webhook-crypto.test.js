// tests/webhook-crypto.test.js
// T-02: Negative testing for AES-256-GCM encrypt/decrypt in webhookService.
// Validates that tampered IV, bad auth tag, truncated ciphertext, and
// malformed input are all rejected with clear error messages.

const crypto = require('crypto');

// Set a valid WEBHOOK_SECRET_KEY before requiring the service
const TEST_KEY = crypto.randomBytes(32).toString('hex');
process.env.WEBHOOK_SECRET_KEY = TEST_KEY;

// Force the lazy key cache to reset by re-requiring the module
// We need to clear the module cache so the new env var is picked up
delete require.cache[require.resolve('../services/webhookService')];
const { encryptSecret, decryptSecret } = require('../services/webhookService');

describe('Webhook Crypto: encryptSecret / decryptSecret', () => {
  const testSecret = 'whsec_test_secret_value_1234567890';

  it('should encrypt and decrypt a secret successfully (round-trip)', () => {
    const encrypted = encryptSecret(testSecret);

    // Format: iv:authTag:ciphertext (all hex, colon-separated)
    const parts = encrypted.split(':');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toMatch(/^[0-9a-f]+$/i); // IV
    expect(parts[1]).toMatch(/^[0-9a-f]+$/i); // Auth tag
    expect(parts[2]).toMatch(/^[0-9a-f]+$/i); // Ciphertext

    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(testSecret);
  });

  it('should produce different ciphertexts for the same input (random IV)', () => {
    const enc1 = encryptSecret(testSecret);
    const enc2 = encryptSecret(testSecret);
    expect(enc1).not.toBe(enc2); // Different IVs → different output
  });
});

describe('Webhook Crypto: decryptSecret negative cases', () => {
  let validEncrypted;

  beforeAll(() => {
    validEncrypted = encryptSecret('known_test_value');
  });

  // ── Input validation ────────────────────────────────────

  it('should throw on null input', () => {
    expect(() => decryptSecret(null)).toThrow('non-empty string');
  });

  it('should throw on undefined input', () => {
    expect(() => decryptSecret(undefined)).toThrow('non-empty string');
  });

  it('should throw on empty string', () => {
    expect(() => decryptSecret('')).toThrow('non-empty string');
  });

  it('should throw on non-string input', () => {
    expect(() => decryptSecret(12345)).toThrow('non-empty string');
  });

  // ── Malformed format ────────────────────────────────────

  it('should throw on missing parts (no colons)', () => {
    expect(() => decryptSecret('deadbeef')).toThrow('malformed');
  });

  it('should throw on too many parts (4 colons)', () => {
    expect(() => decryptSecret('aa:bb:cc:dd')).toThrow('malformed');
  });

  it('should throw on only two parts', () => {
    expect(() => decryptSecret('aa:bb')).toThrow('malformed');
  });

  // ── Invalid hex in components ───────────────────────────

  it('should throw on non-hex IV', () => {
    const [, authTag, ciphertext] = validEncrypted.split(':');
    expect(() => decryptSecret(`ZZZZZZ:${authTag}:${ciphertext}`)).toThrow('invalid IV');
  });

  it('should throw on odd-length IV', () => {
    const [, authTag, ciphertext] = validEncrypted.split(':');
    expect(() => decryptSecret(`abc:${authTag}:${ciphertext}`)).toThrow('invalid IV');
  });

  it('should throw on non-hex auth tag', () => {
    const [iv, , ciphertext] = validEncrypted.split(':');
    expect(() => decryptSecret(`${iv}:GGGGGG:${ciphertext}`)).toThrow('invalid authTag');
  });

  it('should throw on odd-length auth tag', () => {
    const [iv, , ciphertext] = validEncrypted.split(':');
    expect(() => decryptSecret(`${iv}:abc:${ciphertext}`)).toThrow('invalid authTag');
  });

  it('should throw on non-hex ciphertext', () => {
    const [iv, authTag] = validEncrypted.split(':');
    expect(() => decryptSecret(`${iv}:${authTag}:XXXXXX`)).toThrow('invalid ciphertext');
  });

  it('should throw on odd-length ciphertext', () => {
    const [iv, authTag] = validEncrypted.split(':');
    expect(() => decryptSecret(`${iv}:${authTag}:abc`)).toThrow('invalid ciphertext');
  });

  // ── Tampered data (GCM integrity) ──────────────────────

  it('should throw on tampered IV (GCM authentication failure)', () => {
    const [iv, authTag, ciphertext] = validEncrypted.split(':');
    // Flip a byte in the IV
    const tamperedIv = flipHexByte(iv, 0);
    expect(() => decryptSecret(`${tamperedIv}:${authTag}:${ciphertext}`)).toThrow();
  });

  it('should throw on tampered auth tag', () => {
    const [iv, authTag, ciphertext] = validEncrypted.split(':');
    const tamperedTag = flipHexByte(authTag, 0);
    expect(() => decryptSecret(`${iv}:${tamperedTag}:${ciphertext}`)).toThrow();
  });

  it('should throw on tampered ciphertext', () => {
    const [iv, authTag, ciphertext] = validEncrypted.split(':');
    const tamperedCiphertext = flipHexByte(ciphertext, 0);
    expect(() => decryptSecret(`${iv}:${authTag}:${tamperedCiphertext}`)).toThrow();
  });

  it('should throw on truncated ciphertext', () => {
    const [iv, authTag, ciphertext] = validEncrypted.split(':');
    // Remove last 4 hex chars (2 bytes)
    const truncated = ciphertext.slice(0, -4);
    expect(() => decryptSecret(`${iv}:${authTag}:${truncated}`)).toThrow();
  });

  it('should throw on truncated auth tag', () => {
    const [iv, authTag, ciphertext] = validEncrypted.split(':');
    // GCM auth tag must be exactly 16 bytes (32 hex). Truncating breaks it.
    const truncatedTag = authTag.slice(0, 16); // 8 bytes instead of 16
    expect(() => decryptSecret(`${iv}:${truncatedTag}:${ciphertext}`)).toThrow();
  });

  it('should throw on swapped IV and ciphertext', () => {
    const [iv, authTag, ciphertext] = validEncrypted.split(':');
    // Swap IV and ciphertext positions
    expect(() => decryptSecret(`${ciphertext}:${authTag}:${iv}`)).toThrow();
  });

  // ── Empty component edge cases ─────────────────────────

  it('should throw on empty IV component', () => {
    const [, authTag, ciphertext] = validEncrypted.split(':');
    expect(() => decryptSecret(`:${authTag}:${ciphertext}`)).toThrow('invalid IV');
  });

  it('should throw on empty auth tag component', () => {
    const [iv, , ciphertext] = validEncrypted.split(':');
    expect(() => decryptSecret(`${iv}::${ciphertext}`)).toThrow('invalid authTag');
  });

  it('should throw on empty ciphertext component', () => {
    const [iv, authTag] = validEncrypted.split(':');
    expect(() => decryptSecret(`${iv}:${authTag}:`)).toThrow('invalid ciphertext');
  });
});

describe('Webhook Crypto: WEBHOOK_SECRET_KEY validation', () => {
  // Use _resetEncryptionKey to clear the cached key without module cache busting
  // (babel-jest compiles modules differently, so delete require.cache is unreliable)
  const { _resetEncryptionKey } = require('../services/webhookService');

  afterEach(() => {
    // Always restore a valid key and reset the cache after each test
    process.env.WEBHOOK_SECRET_KEY = TEST_KEY;
    _resetEncryptionKey();
  });

  it('should reject keys shorter than 64 hex chars', () => {
    process.env.WEBHOOK_SECRET_KEY = 'abcdef1234'; // Too short (10 chars)
    _resetEncryptionKey(); // Force getEncryptionKey() to re-read env

    expect(() => encryptSecret('test')).toThrow('64-character hex');
  });

  it('should reject non-hex key strings', () => {
    process.env.WEBHOOK_SECRET_KEY = 'Z'.repeat(64); // 64 chars but not hex
    _resetEncryptionKey(); // Force getEncryptionKey() to re-read env

    expect(() => encryptSecret('test')).toThrow('64-character hex');
  });
});

// ── Utility ──────────────────────────────────────────────

/**
 * Flip a single byte in a hex string at the given byte offset.
 * This guarantees the tampered value is different from the original.
 */
function flipHexByte(hex, byteOffset) {
  const chars = hex.split('');
  const idx = byteOffset * 2;
  if (idx + 1 >= chars.length) {
    // Flip the last byte instead
    const lastIdx = chars.length - 2;
    const original = parseInt(chars[lastIdx] + chars[lastIdx + 1], 16);
    const flipped = (original ^ 0xff).toString(16).padStart(2, '0');
    chars[lastIdx] = flipped[0];
    chars[lastIdx + 1] = flipped[1];
  } else {
    const original = parseInt(chars[idx] + chars[idx + 1], 16);
    const flipped = (original ^ 0xff).toString(16).padStart(2, '0');
    chars[idx] = flipped[0];
    chars[idx + 1] = flipped[1];
  }
  return chars.join('');
}
