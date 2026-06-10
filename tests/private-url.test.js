// tests/private-url.test.js
// Unit tests for utils/isPrivateUrl.js — HIGH-02 / HIGH-03 SSRF & DNS rebinding protection.

const { isPrivateHost, validateWebhookUrl } = require('../utils/isPrivateUrl');

// ── isPrivateHost ────────────────────────────────────────────────────────────

describe('isPrivateHost', () => {
  // IPv4 private ranges
  it.each([
    ['127.0.0.1', 'IPv4 loopback'],
    ['127.255.255.255', 'IPv4 loopback high'],
    ['10.0.0.1', 'RFC-1918 10.x'],
    ['10.255.255.255', 'RFC-1918 10.x high'],
    ['172.16.0.1', 'RFC-1918 172.16.x'],
    ['172.31.255.255', 'RFC-1918 172.31.x high'],
    ['192.168.0.1', 'RFC-1918 192.168.x'],
    ['192.168.255.255', 'RFC-1918 192.168.x high'],
    ['169.254.169.254', 'AWS IMDS link-local'],
    ['169.254.0.1', 'link-local low'],
    ['0.0.0.0', 'unspecified'],
  ])('blocks %s (%s)', (ip) => {
    expect(isPrivateHost(ip)).toBe(true);
  });

  // IPv6 private ranges
  it.each([
    ['::1', 'IPv6 loopback'],
    ['::', 'IPv6 unspecified'],
    ['fc00::1', 'IPv6 ULA fc'],
    ['fd12:3456::1', 'IPv6 ULA fd'],
    ['fe80::1', 'IPv6 link-local'],
  ])('blocks %s (%s)', (ip) => {
    expect(isPrivateHost(ip)).toBe(true);
  });

  // Named private hosts
  it.each([
    ['localhost', 'localhost'],
    ['LOCALHOST', 'uppercase localhost'],
    ['metadata.google.internal', 'GCP metadata'],
  ])('blocks %s (%s)', (host) => {
    expect(isPrivateHost(host)).toBe(true);
  });

  // IPv4-mapped IPv6
  it('blocks IPv4-mapped IPv6 with private embedded IP', () => {
    expect(isPrivateHost('::ffff:192.168.1.1')).toBe(true);
    expect(isPrivateHost('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateHost('::ffff:169.254.169.254')).toBe(true);
  });

  // Public IPs — must pass
  it.each([
    ['8.8.8.8', 'Google DNS'],
    ['1.1.1.1', 'Cloudflare DNS'],
    ['93.184.216.34', 'example.com'],
    ['172.32.0.1', 'just above RFC-1918 172 range'],
    ['172.15.255.255', 'just below RFC-1918 172 range'],
  ])('allows public %s (%s)', (ip) => {
    expect(isPrivateHost(ip)).toBe(false);
  });

  // Public hostnames
  it.each([
    ['example.com', 'standard domain'],
    ['api.stripe.com', 'Stripe API'],
    ['hooks.slack.com', 'Slack webhooks'],
  ])('allows public hostname %s', (host) => {
    expect(isPrivateHost(host)).toBe(false);
  });

  // Edge cases — fail-closed
  it('blocks null', () => {
    expect(isPrivateHost(null)).toBe(true);
  });

  it('blocks undefined', () => {
    expect(isPrivateHost(undefined)).toBe(true);
  });

  it('blocks empty string', () => {
    expect(isPrivateHost('')).toBe(true);
  });
});

// ── validateWebhookUrl ──────────────────────────────────────────────────────

describe('validateWebhookUrl', () => {
  it('accepts valid HTTPS public URL', () => {
    const result = validateWebhookUrl('https://hooks.slack.com/services/abc');
    expect(result.valid).toBe(true);
  });

  it('rejects HTTP URLs', () => {
    const result = validateWebhookUrl('http://example.com/webhook');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/HTTPS/i);
  });

  it('rejects non-URL strings', () => {
    const result = validateWebhookUrl('not-a-url');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/valid URL/i);
  });

  it('rejects empty string', () => {
    const result = validateWebhookUrl('');
    expect(result.valid).toBe(false);
  });

  it('rejects null', () => {
    const result = validateWebhookUrl(null);
    expect(result.valid).toBe(false);
  });

  it('rejects HTTPS URL with private IP 127.0.0.1', () => {
    const result = validateWebhookUrl('https://127.0.0.1/webhook');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/private/i);
  });

  it('rejects HTTPS URL with AWS IMDS IP', () => {
    const result = validateWebhookUrl('https://169.254.169.254/latest/meta-data/');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/private/i);
  });

  it('rejects HTTPS URL targeting 10.x private range', () => {
    const result = validateWebhookUrl('https://10.0.0.1:8443/hook');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/private/i);
  });

  it('rejects HTTPS URL targeting localhost', () => {
    const result = validateWebhookUrl('https://localhost/hook');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/private/i);
  });

  it('rejects HTTPS URL with IPv6 loopback', () => {
    const result = validateWebhookUrl('https://[::1]/hook');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/private/i);
  });
});
