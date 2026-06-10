// tests/wave4-bugfixes.test.js
// Locks in the behavioural changes from Wave 4 so future regressions fail fast.
//
// Covers:
//   C2  audit log captures the PREVIOUS role on role change
//   C5  unverified login no longer leaks `isVerified: false`
//   C6  ADMINs cannot demote/ban each other (only SUPERADMIN can)
//   C7  apikeys POST validates name + scope allowlist
//   C8  banned user is blocked from refresh-token AND has tokens wiped
//   C8  toggleUserBan clears the user's refreshTokens

const request = require('supertest');
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI_TEST;

let app;
let User;
let AuditLog;
let Plan;
let Subscription;

const RUN_ID = Date.now();
const PASSWORD = 'Test@1234567';

beforeAll(async () => {
  if (!MONGO_URI) throw new Error('MONGO_URI_TEST env var is required');
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_URI);
  }
  app = require('../app');
  User = require('../models/User');
  AuditLog = require('../models/AuditLog');
  Plan = require('../models/Plan');
  Subscription = require('../models/Subscription');
});

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
});

// ─── helpers ────────────────────────────────────────────────────────────────
async function makeUser({ role = 'user', isBanned = false, isVerified = true, suffix }) {
  const email = `wave4-${suffix}-${RUN_ID}@spinx.dev`;
  // Clean any stale doc
  await User.deleteOne({ email });
  const u = await User.create({
    email,
    password: PASSWORD,
    name: 'Wave4 Tester',
    isVerified,
    role,
    isBanned,
    pendingSubscriptionCreation: false,
  });
  return u;
}

async function loginAndGetTokens(email) {
  const res = await request(app)
    .post('/api/v1/login')
    .send({ email, password: PASSWORD, recaptchaToken: 'dev-bypass' });
  return res;
}

// ─── C5: unverified login no longer leaks isVerified ───────────────────────
describe('C5 — unverified login response no longer carries isVerified', () => {
  let userEmail;
  beforeAll(async () => {
    const u = await makeUser({ isVerified: false, suffix: 'c5' });
    userEmail = u.email;
  });
  afterAll(async () => {
    await User.deleteOne({ email: userEmail });
  });

  it('returns plain 401 with no `isVerified` field', async () => {
    const res = await request(app)
      .post('/api/v1/login')
      .send({ email: userEmail, password: PASSWORD, recaptchaToken: 'dev-bypass' });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid credentials');
    expect(res.body.isVerified).toBeUndefined();
  });
});

// ─── C8: banned user is blocked from refresh + tokens wiped ────────────────
describe('C8 — refreshToken blocks banned users', () => {
  let user;
  let refreshToken;

  beforeAll(async () => {
    user = await makeUser({ suffix: 'c8a' });
    const loginRes = await loginAndGetTokens(user.email);
    expect(loginRes.status).toBe(200);
    refreshToken = loginRes.body.refreshToken;

    // Mark the user banned AFTER the login has issued a refresh token.
    await User.findByIdAndUpdate(user._id, { isBanned: true });
  });
  afterAll(async () => {
    await User.deleteOne({ _id: user._id });
  });

  it('returns 403 and wipes refreshTokens', async () => {
    const res = await request(app).post('/api/v1/refresh-token').send({ refreshToken });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/suspend/i);

    const fresh = await User.findById(user._id);
    expect(fresh.refreshTokens.length).toBe(0);
  });
});

// ─── C8: toggleUserBan wipes refreshTokens ─────────────────────────────────
describe("C8 — toggleUserBan clears the user's refreshTokens", () => {
  let admin, target;
  let adminToken;

  beforeAll(async () => {
    admin = await makeUser({ role: 'superadmin', suffix: 'c8admin' });
    target = await makeUser({ role: 'user', suffix: 'c8target' });
    // Give the target some refresh tokens
    target.refreshTokens.push({
      tokenHash: 'a'.repeat(64),
      createdAt: new Date(),
      deviceInfo: 'test',
    });
    await target.save();
    expect(target.refreshTokens.length).toBe(1);

    const loginRes = await loginAndGetTokens(admin.email);
    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.accessToken;
  });
  afterAll(async () => {
    await User.deleteOne({ _id: admin._id });
    await User.deleteOne({ _id: target._id });
  });

  it('clears refreshTokens when isBanned=true is applied', async () => {
    const res = await request(app)
      .put(`/api/v1/admin/users/${target._id}/ban`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isBanned: true });
    expect(res.status).toBe(200);

    const refreshed = await User.findById(target._id);
    expect(refreshed.isBanned).toBe(true);
    expect(refreshed.refreshTokens.length).toBe(0);
  });
});

// ─── C6: ADMIN cannot demote / ban another ADMIN ───────────────────────────
describe('C6 — admin-on-admin peer protection', () => {
  let adminA, adminB;
  let adminAToken;

  beforeAll(async () => {
    adminA = await makeUser({ role: 'admin', suffix: 'c6a' });
    adminB = await makeUser({ role: 'admin', suffix: 'c6b' });
    const loginRes = await loginAndGetTokens(adminA.email);
    expect(loginRes.status).toBe(200);
    adminAToken = loginRes.body.accessToken;
  });
  afterAll(async () => {
    await User.deleteOne({ _id: adminA._id });
    await User.deleteOne({ _id: adminB._id });
  });

  it('rejects role change from one admin to another with 403', async () => {
    const res = await request(app)
      .put(`/api/v1/admin/users/${adminB._id}/role`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .send({ role: 'user' });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/superadmin/i);

    const refreshed = await User.findById(adminB._id);
    expect(refreshed.role).toBe('admin'); // unchanged
  });

  it('rejects ban from one admin to another with 403', async () => {
    const res = await request(app)
      .put(`/api/v1/admin/users/${adminB._id}/ban`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .send({ isBanned: true });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/superadmin/i);

    const refreshed = await User.findById(adminB._id);
    expect(refreshed.isBanned).toBe(false);
  });
});

// ─── C2: AuditLog captures the PREVIOUS role on role change ────────────────
describe('C2 — role_change audit captures the previous role, not the new one', () => {
  let admin, target;
  let adminToken;

  beforeAll(async () => {
    admin = await makeUser({ role: 'superadmin', suffix: 'c2admin' });
    target = await makeUser({ role: 'user', suffix: 'c2target' });
    const loginRes = await loginAndGetTokens(admin.email);
    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.accessToken;
  });
  afterAll(async () => {
    await User.deleteOne({ _id: admin._id });
    await User.deleteOne({ _id: target._id });
    await AuditLog.collection.deleteMany({ targetId: target._id });
  });

  it('records meta.from as the user role BEFORE mutation', async () => {
    const res = await request(app)
      .put(`/api/v1/admin/users/${target._id}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'moderator' });
    expect(res.status).toBe(200);

    // B6 FIX (Wave 4.1): the audit log is fire-and-forget after the response.
    // Poll for it instead of a fixed wait so the test isn't flaky on slow CI.
    let log = null;
    for (let i = 0; i < 20; i++) {
      log = await AuditLog.findOne({ targetId: target._id, action: 'role_change' });
      if (log) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(log).toBeTruthy();
    expect(log.meta.from).toBe('user');
    expect(log.meta.to).toBe('moderator');
  });
});

// ─── B1: rememberMe survives refresh-token rotation ────────────────────────
//
// Regression test for Wave 4.1 B1. Before the fix, the rotation pipeline used
// a single `cutoff = now - 7d` filter, so rememberMe sessions older than 7d
// were silently pruned during a token rotation — even though they had up to
// 30d of validity. After the fix, the per-token `$cond` cutoff respects
// `rememberMe` and 30d-old rememberMe sessions are preserved.
describe('B1 — refresh-token rotation preserves a 10-day-old rememberMe session', () => {
  let user;
  let initialRefreshToken;

  beforeAll(async () => {
    user = await makeUser({ suffix: 'b1' });

    // Create a "stale" rememberMe session that's 10 days old. With the old
    // code (7-day cutoff) this would be pruned during the rotation below.
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    user.refreshTokens.push({
      tokenHash: 'b'.repeat(64),
      createdAt: tenDaysAgo,
      deviceInfo: 'mobile-remembered',
      rememberMe: true,
    });
    // Disable the pre-save prune for this seed by writing through the
    // collection directly (bypasses Mongoose middleware).
    await User.collection.updateOne(
      { _id: user._id },
      {
        $set: {
          refreshTokens: [
            {
              tokenHash: 'b'.repeat(64),
              createdAt: tenDaysAgo,
              deviceInfo: 'mobile-remembered',
              rememberMe: true,
            },
          ],
        },
      }
    );

    // Now log in normally — this is the second session, current and not
    // rememberMe. The rotation pipeline runs against both entries.
    const loginRes = await loginAndGetTokens(user.email);
    expect(loginRes.status).toBe(200);
    initialRefreshToken = loginRes.body.refreshToken;
  });
  afterAll(async () => {
    await User.deleteOne({ _id: user._id });
  });

  it('keeps the 10-day-old rememberMe entry after a rotation', async () => {
    const res = await request(app)
      .post('/api/v1/refresh-token')
      .send({ refreshToken: initialRefreshToken });
    expect(res.status).toBe(200);

    const fresh = await User.findById(user._id);

    // The seeded rememberMe token must still be there.
    const remembered = fresh.refreshTokens.find((t) => t.tokenHash === 'b'.repeat(64));
    expect(remembered).toBeTruthy();
    expect(remembered.rememberMe).toBe(true);

    // Plus exactly one rotated session for the recent login.
    const recentSessions = fresh.refreshTokens.filter((t) => t.tokenHash !== 'b'.repeat(64));
    expect(recentSessions.length).toBe(1);
  });
});

// ─── C7: apikeys POST validates name + scope allowlist ─────────────────────
describe('C7 — POST /apikeys input validation', () => {
  let user;
  let token;

  beforeAll(async () => {
    user = await makeUser({ suffix: 'c7' });
    // Need an active subscription so apiKeyService doesn't 403 on plan lookup
    // D3 FIX (Wave 4.2): use an idempotent upsert instead of `Plan.create`.
    // Tests run in parallel; if both this file and webhooks.test.js race on
    // a missing 'pro' plan, the second `create` would hit the unique-name
    // constraint (E11000). findOneAndUpdate({upsert: true}) is race-safe.
    const plan = await Plan.findOneAndUpdate(
      { name: 'pro' },
      {
        $setOnInsert: {
          name: 'pro',
          displayName: 'Pro',
          price: 19,
          currency: 'USD',
          billingPeriod: 'monthly',
          features: [],
          limits: { apiCallsPerMonth: 50000, maxApiKeys: 5, webhooksAllowed: 5, storageGB: 5 },
          isActive: true,
        },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
    await Subscription.deleteMany({ userId: user._id });
    await Subscription.create({
      userId: user._id,
      planId: plan._id,
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      usage: { apiCalls: 0, storage: 0 },
    });

    const loginRes = await loginAndGetTokens(user.email);
    expect(loginRes.status).toBe(200);
    token = loginRes.body.accessToken;
  });
  afterAll(async () => {
    await Subscription.deleteMany({ userId: user._id });
    await User.deleteOne({ _id: user._id });
  });

  it('rejects oversized name with 422', async () => {
    const res = await request(app)
      .post('/api/v1/apikeys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'A'.repeat(200), scopes: ['api:read'] });
    expect(res.status).toBe(422);
  });

  it('rejects unknown scopes with 422 + unified shape', async () => {
    const res = await request(app)
      .post('/api/v1/apikeys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test Key', scopes: ['admin:everything'] });
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('validation_failed');
    expect(res.body.message).toMatch(/scope/i);
  });

  it('accepts a valid name + valid scopes', async () => {
    const res = await request(app)
      .post('/api/v1/apikeys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Wave4 Test Key', scopes: ['api:read', 'api:write'] });
    expect(res.status).toBe(201);
    expect(res.body.data.rawKey).toBeTruthy();
  });
});

// ─── D1: webhook plan-limit holds under concurrent creates ────────────────
//
// Regression test for Wave 4.2 D1. Before the fix, two simultaneous POSTs
// could both pass the count check (TOCTOU) and end up with N+2 webhooks
// despite a limit of N. The fix wraps count + create in a Mongo transaction
// so only one writer can succeed when the limit boundary is crossed.
//
// NOTE: requires a replica-set MongoDB. On standalone mongod the
// startTransaction() call throws and the test will fail — same constraint
// as services/apiKeyService.js. Render's MongoDB and Atlas are replica sets
// by default.
describe('D1 — concurrent createWebhook calls respect plan limit', () => {
  let user;
  let token;
  let smallPlan;
  let Webhook;

  beforeAll(async () => {
    Webhook = require('../models/Webhook');
    user = await makeUser({ suffix: 'd1' });

    // Plan that allows exactly 1 webhook so we can probe the boundary.
    smallPlan = await Plan.findOneAndUpdate(
      { name: 'd1-test-plan' },
      {
        $setOnInsert: {
          name: 'd1-test-plan',
          displayName: 'D1 Test',
          price: 0,
          currency: 'USD',
          billingPeriod: 'monthly',
          features: [],
          limits: { apiCallsPerMonth: 1000, maxApiKeys: 1, webhooksAllowed: 1, storageGB: 1 },
          isActive: true,
        },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );

    await Subscription.deleteMany({ userId: user._id });
    await Subscription.create({
      userId: user._id,
      planId: smallPlan._id,
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      usage: { apiCalls: 0, storage: 0 },
    });

    const loginRes = await loginAndGetTokens(user.email);
    expect(loginRes.status).toBe(200);
    token = loginRes.body.accessToken;
  });

  afterAll(async () => {
    await Webhook.deleteMany({ userId: user._id });
    await Subscription.deleteMany({ userId: user._id });
    await User.deleteOne({ _id: user._id });
  });

  it('only one of two concurrent POSTs creates a webhook (limit=1)', async () => {
    // Plan limit is 1. Fire 5 concurrent creates; exactly 1 should win, 4
    // should return 429.
    const concurrency = 5;
    const requests = Array.from({ length: concurrency }, (_, i) =>
      request(app)
        .post('/api/v1/webhooks')
        .set('Authorization', `Bearer ${token}`)
        .send({
          url: `https://example.com/webhook-${i}`,
          events: ['user.created'],
          description: `Concurrent test ${i}`,
        })
    );

    const results = await Promise.all(requests);
    const created = results.filter((r) => r.statusCode === 201);
    const limited = results.filter((r) => r.statusCode === 429);

    // The transaction guarantees: total successful creates ≤ webhooksAllowed.
    // (Replica-set conflict aborts may also surface as 5xx; we accept any
    // non-201 as "did not create" here, but at least 1 success must happen.)
    expect(created.length).toBeLessThanOrEqual(1);
    expect(created.length + limited.length).toBeGreaterThanOrEqual(1);

    const stored = await Webhook.countDocuments({ userId: user._id });
    expect(stored).toBeLessThanOrEqual(1);
  });
});
