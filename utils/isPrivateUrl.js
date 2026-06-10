// utils/isPrivateUrl.js
//
// SSRF guard — blocks any URL that targets a private, internal, or
// otherwise unsafe network range. Used at TWO points in the webhook
// pipeline:
//
//   1. Validation at register/update time (validateWebhookUrl)
//   2. Re-validation post-DNS-resolution at delivery time
//      (isPrivateHost), to defeat DNS rebinding attacks.
//
// Coverage (Wave 1 / C2 — May 2026):
//   IPv4 RFC-1918:           10/8, 172.16/12, 192.168/16
//   IPv4 loopback:           127/8
//   IPv4 link-local:         169.254/16  (AWS / Azure / GCP / DO IMDS)
//   IPv4 CGNAT (RFC 6598):   100.64/10   ← Alibaba metadata 100.100.100.200
//   IPv4 unspecified:        0.0.0.0/8
//   IPv4 multicast:          224.0.0.0/4
//   IPv4 reserved:           240.0.0.0/4
//   IPv4 broadcast:          255.255.255.255
//   IPv4 documentation:      192.0.2/24, 198.51.100/24, 203.0.113/24
//   IPv4 benchmark:          198.18/15
//   IPv6 loopback:           ::1
//   IPv6 unspecified:        ::
//   IPv6 link-local:         fe80::/10
//   IPv6 unique local:       fc00::/7  (fc00::/8 + fd00::/8)
//   IPv6 multicast:          ff00::/8
//   IPv6 documentation:      2001:db8::/32
//   IPv6 IPv4-mapped:        ::ffff:0:0/96 — checks embedded IPv4 (any form)
//   Hostnames:               localhost, metadata, metadata.google.internal,
//                            metadata.aws.internal, metadata.azure.com,
//                            metadata.packet.net, metadata.digitalocean.com,
//                            instance-data, instance-data.ec2.internal

'use strict';

const net = require('net');

// ── IPv4 first-octet ranges that are always private/unsafe ──
// We test the leading octet first as a fast path.
const PRIVATE_IPV4_PATTERNS = [
  /^10\./, // RFC-1918 Class A
  /^127\./, // Loopback
  /^169\.254\./, // Link-local / IMDS (AWS, Azure, GCP, DO)
  /^172\.(1[6-9]|2[0-9]|3[01])\./, // RFC-1918 Class B (172.16 – 172.31)
  /^192\.168\./, // RFC-1918 Class C
  /^192\.0\.2\./, // TEST-NET-1 (RFC 5737)
  /^198\.51\.100\./, // TEST-NET-2 (RFC 5737)
  /^203\.0\.113\./, // TEST-NET-3 (RFC 5737)
  /^198\.(1[89])\./, // 198.18.0.0/15 — RFC 2544 benchmark
  /^0\./, // Unspecified / "this network" (RFC 1122)
];

// ── Hostnames that map to internal infrastructure ──
const PRIVATE_HOSTNAMES = new Set([
  'localhost',
  'metadata', // bare GCP / Azure shorthand
  'metadata.google.internal',
  'metadata.aws.internal',
  'metadata.azure.com',
  'metadata.packet.net',
  'metadata.digitalocean.com',
  'instance-data',
  'instance-data.ec2.internal',
]);

// ── CGNAT (100.64.0.0/10) — RFC 6598 ──
// Range: 100.64.0.0 – 100.127.255.255  (second octet 64-127)
// Alibaba Cloud's IMDS (100.100.100.200) lives here.
const isCgnat = (ip) => {
  if (!ip.startsWith('100.')) return false;
  const second = parseInt(ip.split('.')[1], 10);
  return Number.isFinite(second) && second >= 64 && second <= 127;
};

// ── IPv4 multicast (224.0.0.0/4) ── 224.0.0.0 – 239.255.255.255
const isMulticastV4 = (ip) => {
  const first = parseInt(ip.split('.')[0], 10);
  return Number.isFinite(first) && first >= 224 && first <= 239;
};

// ── IPv4 reserved (240.0.0.0/4) ── 240.0.0.0 – 255.255.255.254
// Includes the 255.255.255.255 broadcast.
const isReservedV4 = (ip) => {
  const first = parseInt(ip.split('.')[0], 10);
  return Number.isFinite(first) && first >= 240 && first <= 255;
};

// ── IPv4 classifier (private OR otherwise unroutable / unsafe) ──
const isPrivateIPv4 = (ip) => {
  if (PRIVATE_IPV4_PATTERNS.some((re) => re.test(ip))) return true;
  if (isCgnat(ip)) return true;
  if (isMulticastV4(ip)) return true;
  if (isReservedV4(ip)) return true;
  return false;
};

// ── IPv6 normalization helper ──
// Expands a compressed IPv6 string to 8 colon-separated 4-hex-digit groups.
// Used so we can look at the trailing 32 bits (IPv4-mapped) regardless of
// whether the input is `::ffff:1.2.3.4` or `0:0:0:0:0:ffff:0102:0304`.
//
// Returns a lower-case 8-group string, or null if input isn't valid IPv6.
const expandIPv6 = (addr) => {
  if (!net.isIPv6(addr)) return null;
  let s = addr.toLowerCase();

  // Embedded IPv4 form: convert trailing dotted-quad to two hex groups.
  const dottedQuad = s.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (dottedQuad) {
    const [, a, b, c, d] = dottedQuad.map((x, i) => (i === 0 ? x : parseInt(x, 10)));
    const g1 = ((a << 8) | b).toString(16).padStart(4, '0');
    const g2 = ((c << 8) | d).toString(16).padStart(4, '0');
    s = s.replace(/\d+\.\d+\.\d+\.\d+$/, `${g1}:${g2}`);
  }

  // Expand `::` shorthand.
  if (s.includes('::')) {
    const [head, tail] = s.split('::');
    const headGroups = head ? head.split(':') : [];
    const tailGroups = tail ? tail.split(':') : [];
    const missing = 8 - headGroups.length - tailGroups.length;
    if (missing < 0) return null;
    const zeros = Array(missing).fill('0');
    s = [...headGroups, ...zeros, ...tailGroups].join(':');
  }

  const groups = s.split(':');
  if (groups.length !== 8) return null;
  return groups.map((g) => g.padStart(4, '0')).join(':');
};

// ── IPv6 classifier ──
const isPrivateIPv6 = (ip) => {
  if (ip === '::1' || ip === '::') return true;
  if (ip.startsWith('fe80')) return true; // link-local
  // ULA: fc00::/7 → first byte 0xfc or 0xfd
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true;
  // Multicast: ff00::/8
  if (ip.startsWith('ff')) return true;
  // Documentation: 2001:db8::/32
  if (ip.startsWith('2001:db8:') || ip.startsWith('2001:0db8:')) return true;

  // IPv4-mapped (::ffff:0:0/96) — check the embedded IPv4 in fully-expanded form.
  // Catches all of: `::ffff:1.2.3.4`, `0:0:0:0:0:ffff:0102:0304`,
  //                 `::FFFF:c0a8:0001` (uppercase), etc.
  const expanded = expandIPv6(ip);
  if (expanded && expanded.startsWith('0000:0000:0000:0000:0000:ffff:')) {
    const groups = expanded.split(':');
    const last32 = groups.slice(6).join('');
    const a = parseInt(last32.slice(0, 2), 16);
    const b = parseInt(last32.slice(2, 4), 16);
    const c = parseInt(last32.slice(4, 6), 16);
    const d = parseInt(last32.slice(6, 8), 16);
    const ipv4 = `${a}.${b}.${c}.${d}`;
    if (isPrivateIPv4(ipv4)) return true;
  }

  return false;
};

/**
 * Returns true if the hostname is a known private/internal address.
 * Works for both hostnames and IP addresses (v4 and v6).
 *
 * Fail-closed: any input we cannot classify is treated as private.
 *
 * @param {string} hostname - The hostname or IP string to check.
 * @returns {boolean}
 */
const isPrivateHost = (hostname) => {
  if (!hostname || typeof hostname !== 'string') return true; // fail-closed

  // Strip IPv6 brackets — URL.hostname returns '[::1]' for IPv6 literals,
  // but net.isIPv6('[::1]') returns false.
  const h = hostname.toLowerCase().trim().replace(/^\[/, '').replace(/\]$/, '');

  if (!h) return true; // empty after stripping → fail-closed

  // Hostname allowlist check (covers cloud metadata short names + localhost).
  if (PRIVATE_HOSTNAMES.has(h)) return true;

  if (net.isIPv4(h)) return isPrivateIPv4(h);
  if (net.isIPv6(h)) return isPrivateIPv6(h);

  // Not an IP, not a known internal hostname → assume public.
  // (Public DNS resolution + a SECOND check post-resolution in webhookService
  // is what defeats DNS rebinding.)
  return false;
};

/**
 * Validates a webhook URL at creation/update time.
 * Returns { valid: true } or { valid: false, reason: string }.
 *
 * Checks:
 *   1. URL parses
 *   2. Protocol is https
 *   3. Hostname is not a private/internal address (string-level check)
 *
 * Note: this is a static check only. DNS rebinding is prevented at delivery
 * time in webhookService.dispatchWithRetry by re-resolving the hostname
 * and re-running isPrivateHost on every returned IP.
 *
 * @param {string} rawUrl - The URL string submitted by the user.
 * @returns {{ valid: boolean, reason?: string }}
 */
const validateWebhookUrl = (rawUrl) => {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, reason: 'URL must be a non-empty string.' };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { valid: false, reason: 'URL is not a valid URL.' };
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, reason: 'Webhook URL must use HTTPS.' };
  }

  if (isPrivateHost(parsed.hostname)) {
    return {
      valid: false,
      reason: 'Webhook URL must not target private or internal network addresses.',
    };
  }

  return { valid: true };
};

module.exports = { isPrivateHost, validateWebhookUrl };
