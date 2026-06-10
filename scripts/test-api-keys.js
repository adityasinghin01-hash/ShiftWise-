#!/usr/bin/env node
// scripts/test-api-keys.js
// Smoke test for the API key lifecycle after review fixes

const http = require('http');

// M11 FIX (Wave 4): default port now matches config.PORT default (5001) so
// the smoke test runs against `npm start` / `npm run dev` out of the box.
// Override with TEST_BASE_URL=http://other:port if running on another host.
const BASE = process.env.TEST_BASE_URL || 'http://localhost:5001';
const REQUEST_TIMEOUT = 10000;

// Credentials from env — never hardcode secrets in test scripts
const email = process.env.TEST_EMAIL || 'testadmin@spinx.dev';
const password = process.env.TEST_PASSWORD || 'Test@12345';

function request(method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { ...headers },
    };
    let data = null;
    if (body) {
      data = JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = http.request(opts, (res) => {
      req.setTimeout(0);
      let chunks = '';
      res.on('data', (d) => (chunks += d));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(chunks) });
        } catch {
          resolve({ status: res.statusCode, data: chunks });
        }
      });
    });
    req.setTimeout(REQUEST_TIMEOUT, () => {
      req.destroy(new Error('Request timeout'));
    });
    req.on('error', reject);
    if (data) {
      req.write(data);
    }
    req.end();
  });
}

/**
 * Simple retry wrapper for the `request` helper.
 * Retries on HTTP 429 (Too Many Requests) with exponential back‑off.
 */
async function requestWithRetry(
  method,
  path,
  headers = {},
  body = null,
  retries = 3,
  backoff = 2000
) {
  let attempt = 0;
  while (true) {
    const resp = await request(method, path, headers, body);
    if (resp.status !== 429 || attempt >= retries) {
      return resp;
    }
    attempt++;
    const wait = backoff * Math.pow(2, attempt - 1);
    console.log(`⏳ Received 429 – retry ${attempt}/${retries} after ${wait} ms`);
    await new Promise((r) => setTimeout(r, wait));
  }
}

(async () => {
  let pass = 0,
    fail = 0;
  const assert = (test, name) => {
    if (test) {
      pass++;
      console.log(`  ✅ ${name}`);
    } else {
      fail++;
      console.log(`  ❌ ${name}`);
    }
  };

  // Step 1: Login
  console.log('\n=== Step 1: Login ===');
  const login = await requestWithRetry(
    'POST',
    '/api/v1/login',
    {},
    {
      email,
      password,
    }
  );
  assert(login.status === 200, `Login → ${login.status} (expected 200)`);
  const TOKEN = login.data.accessToken;

  // Step 2: No auth → 401
  console.log('\n=== Step 2: No auth → 401 ===');
  const noAuth = await requestWithRetry('GET', '/api/v1/profile');
  assert(noAuth.status === 401, `No auth → ${noAuth.status} (expected 401)`);
  const noAuthMsg = String(noAuth?.data?.message || '');
  assert(!noAuthMsg.includes('API key'), `Message: "${noAuthMsg}"`);

  // Step 3: Query string API key is ignored (logged as warning, returns 401 like no-auth)
  console.log('\n=== Step 3: Query string API key → 401 ===');
  const qsKey = await requestWithRetry('GET', '/api/v1/profile?apiKey=sk_live_fake');
  assert(qsKey.status === 401, `Query key → ${qsKey.status} (expected 401)`);

  // Step 4a: Cleanup existing keys
  console.log('\n=== Step 4a: Cleanup existing keys ===');
  try {
    const existing = await requestWithRetry('GET', '/api/v1/apikeys', {
      Authorization: `Bearer ${TOKEN}`,
    });
    if (existing.status === 200 && Array.isArray(existing?.data?.data)) {
      for (const k of existing.data.data) {
        const id = k._id || k.id;
        const del = await requestWithRetry('DELETE', `/api/v1/apikeys/${id}`, {
          Authorization: `Bearer ${TOKEN}`,
        });
        if (del.status === 200) {
          console.log(`  🧹 Deleted existing key: ${id}`);
        } else {
          console.log(`  ⚠️  Failed to delete key ${id} → ${del.status}`);
        }
      }
    } else if (existing.status === 200) {
      console.log('  ℹ️  No existing keys to clean up');
    } else {
      console.log(`  ⚠️  Could not list keys for cleanup → ${existing.status}`);
    }
  } catch (err) {
    console.log(`  ⚠️  Cleanup error (continuing): ${err.message}`);
  }

  // Step 4: Create API key
  console.log('\n=== Step 4: Create API key ===');
  const create = await requestWithRetry(
    'POST',
    '/api/v1/apikeys',
    {
      Authorization: `Bearer ${TOKEN}`,
    },
    { name: 'Review Smoke Test', scopes: ['api:read'] }
  );
  assert(create.status === 201, `Create → ${create.status} (expected 201)`);

  if (create.status !== 201 || !create?.data?.data) {
    console.error('❌ FATAL: API Key creation failed or missing data. Payload:', create?.data);
    process.exit(1);
  }

  if (!create.data.data.key) {
    console.error('❌ FATAL: create.data.data.key missing. Payload:', create.data);
    process.exit(1);
  }

  assert(create.data.data.key.expiresAt !== undefined, 'Response includes expiresAt');
  const RAW_KEY = create.data.data.rawKey;
  const KEY_ID = create.data.data.key.id;
  assert(typeof RAW_KEY === 'string' && RAW_KEY.length > 0, `RAW_KEY invalid`);
  assert(typeof KEY_ID === 'string' && KEY_ID.length > 0, `KEY_ID invalid`);
  console.log(`  Key: (redacted)`);

  // Step 5: List keys
  console.log('\n=== Step 5: List keys via JWT ===');
  const list = await requestWithRetry('GET', '/api/v1/apikeys', {
    Authorization: `Bearer ${TOKEN}`,
  });
  assert(list.status === 200, `List → ${list.status} (expected 200)`);
  if (!list?.data || list.data.count === undefined) {
    console.error('❌ FATAL: list.data missing. Payload:', list?.data);
    process.exit(1);
  }
  assert(list.data.count >= 1, `Count: ${list.data.count}`);

  // Step 6: X-API-Key on JWT-only route → 401 (no implicit fallback)
  console.log('\n=== Step 6: X-API-Key on JWT-only route → 401 ===');
  const noFallback = await requestWithRetry('GET', '/api/v1/profile', {
    'X-API-Key': RAW_KEY,
  });
  assert(noFallback.status === 401, `No fallback → ${noFallback.status} (expected 401)`);

  // Step 7: Revoke key
  console.log('\n=== Step 7: Revoke key ===');
  const revoke = await requestWithRetry('DELETE', `/api/v1/apikeys/${KEY_ID}`, {
    Authorization: `Bearer ${TOKEN}`,
  });
  assert(revoke.status === 200, `Revoke → ${revoke.status} (expected 200)`);

  // Step 8: Verify revoked key no longer appears in active list
  console.log('\n=== Step 8: Revoked key absent from list ===');
  const postRevoke = await requestWithRetry('GET', '/api/v1/apikeys', {
    Authorization: `Bearer ${TOKEN}`,
  });
  assert(postRevoke.status === 200, `List after revoke → ${postRevoke.status} (expected 200)`);

  if (!postRevoke?.data?.data) {
    console.error('❌ FATAL: postRevoke.data.data missing. Payload:', postRevoke?.data);
    process.exit(1);
  }

  const revokedStillListed = postRevoke.data.data.some((k) => String(k._id) === String(KEY_ID));
  assert(!revokedStillListed, `Revoked key absent from active list`);

  // Summary
  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${pass} passed, ${fail} failed`);
  console.log(`${'='.repeat(40)}\n`);
  process.exit(fail > 0 ? 1 : 0);
})();
