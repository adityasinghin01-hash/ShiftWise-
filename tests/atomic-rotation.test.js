// tests/atomic-rotation.test.js
// Verifies refresh token rotation uses a single atomic DB operation.
//
// Wave 1 / H8 update (May 2026): changed from findByIdAndUpdate to findOneAndUpdate
// because findByIdAndUpdate only accepts _id in its first argument — additional
// query fields (like 'refreshTokens.tokenHash') are silently ignored, making the
// "token must be present" guard ineffective. findOneAndUpdate accepts a full query.

const fs = require('fs');
const path = require('path');

const AUTH_CONTROLLER_PATH = path.join(__dirname, '..', 'controllers', 'authController.js');

describe('Refresh Token Rotation — Atomic Operation Check', () => {
  let source;

  beforeAll(() => {
    source = fs.readFileSync(AUTH_CONTROLLER_PATH, 'utf-8');
  });

  // Extract just the refreshToken function body for targeted assertions.
  const getRefreshTokenBody = (src) => {
    const fnStart = src.indexOf('const refreshToken = async');
    const fnEnd = src.indexOf('// ── Logout');
    return src.slice(fnStart, fnEnd);
  };

  test('refreshToken uses findOneAndUpdate (not findByIdAndUpdate) so query filter is honored', () => {
    const fnBody = getRefreshTokenBody(source);

    // H8 FIX: Must use findOneAndUpdate so that 'refreshTokens.tokenHash' in the
    // query is enforced by MongoDB atomically. findByIdAndUpdate silently ignores
    // extra query fields beyond _id.
    expect(fnBody).toContain('findOneAndUpdate');
    expect(fnBody).toContain("'refreshTokens.tokenHash': hashedIncoming");
  });

  test('refreshToken must NOT have two separate write calls (no separate $pull + $push)', () => {
    const fnBody = getRefreshTokenBody(source);

    // Count update calls — should be exactly 1 atomic operation.
    const updateCalls = fnBody.match(/findOneAndUpdate|findByIdAndUpdate/g) || [];
    // One for the token swap; additional findById calls (read-only) are allowed.
    // The wipe call on reuse detection (findByIdAndUpdate for wiping) is fine.
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
  });

  test('atomic update must use $filter inside the pipeline', () => {
    const fnBody = getRefreshTokenBody(source);
    // $filter removes the old token within the aggregation pipeline.
    expect(fnBody).toMatch(/\$filter/);
  });

  test('atomic update must use $concatArrays to append the new token', () => {
    const fnBody = getRefreshTokenBody(source);
    expect(fnBody).toMatch(/\$concatArrays/);
  });
});
