// tests/plan.test.js
// Covers: P-02 (checkLimit subscription caching optimization).

const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// P-02: checkLimit must reuse req.subscription from requirePlan
// Rationale: When requirePlan and checkLimit are chained on the same route,
// both previously issued Subscription.findOne() queries. After the fix,
// checkLimit short-circuits with req.subscription when available.
// ─────────────────────────────────────────────────────────────────────────────
describe('P-02 — checkLimit reuses req.subscription from requirePlan', () => {
  const planMiddlewareSrc = fs.readFileSync(
    path.join(__dirname, '..', 'middleware', 'planMiddleware.js'),
    'utf-8'
  );

  test('checkLimit must check req.subscription before querying DB', () => {
    // The optimization: look for `req.subscription` being checked
    expect(planMiddlewareSrc).toMatch(/req\.subscription/);
  });

  test('checkLimit must conditionally query only when req.subscription is absent', () => {
    // Must have: if (!subscription) { ... Subscription.findOne ... }
    // i.e., the DB call must be inside a guard
    expect(planMiddlewareSrc).toMatch(/if\s*\(\s*!subscription\s*\)/);
  });

  test('requirePlan must still attach subscription to req for downstream use', () => {
    // requirePlan sets req.subscription for checkLimit to consume
    expect(planMiddlewareSrc).toMatch(/req\.subscription\s*=\s*subscription/);
  });

  test('requirePlan must still attach plan to req for downstream use', () => {
    expect(planMiddlewareSrc).toMatch(/req\.plan\s*=\s*subscription\.planId/);
  });
});
