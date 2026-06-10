// tests/admin-validation.test.js
// TDD RED: Verifies admin routes validate :id params as MongoIds.

const fs = require('fs');
const path = require('path');

const ADMIN_ROUTES_PATH = path.join(__dirname, '..', 'routes', 'v1', 'admin.routes.js');

describe('Admin Route Param Validation', () => {
  let source;

  beforeAll(() => {
    source = fs.readFileSync(ADMIN_ROUTES_PATH, 'utf-8');
  });

  test('admin.routes.js must import param from express-validator', () => {
    expect(source).toMatch(/param.*=.*require\(.+express-validator.+\)/);
  });

  test('admin.routes.js must define isMongoId validation', () => {
    expect(source).toMatch(/isMongoId/);
  });

  test('PUT /users/:id/role route must use id validation middleware', () => {
    // The route definition for role should include validation middleware
    const roleRouteSection = source.match(/role.*=|users\/:id\/role/g);
    expect(roleRouteSection).toBeTruthy();
    // idValidation should appear before the controller handler
    expect(source).toMatch(/idValidation.*updateUserRole|updateUserRole.*idValidation/s);
  });

  test('PUT /users/:id/ban route must use id validation middleware', () => {
    expect(source).toMatch(/idValidation.*toggleUserBan|toggleUserBan.*idValidation/s);
  });
});
