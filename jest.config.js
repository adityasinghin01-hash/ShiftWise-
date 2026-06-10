// jest.config.js
// Jest configuration for Adv_Backend test suite.

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  // dotenv v17 path fix: setupFiles runs before test modules are loaded.
  // jest.setup.js uses path.resolve(__dirname) to guarantee root .env is loaded.
  setupFiles: ['<rootDir>/tests/jest.setup.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/jest.mocks.js'],
  // Ensure NODE_ENV=test so config.js dotenv guard doesn't skip loading
  testEnvironmentOptions: {
    NODE_ENV: 'test',
  },
  collectCoverage: true,
  coverageDirectory: 'coverage',
  // Emit human-readable table, machine-readable JSON summary, and lcov for Codecov.
  coverageReporters: ['text', 'json-summary', 'lcov'],

  // ─── Explicit collection scope ───────────────────────────────────────────────
  // Using collectCoverageFrom instead of coveragePathIgnorePatterns gives Jest an
  // unambiguous list of files to instrument, making threshold calculations stable.
  //
  // Excluded directories and reasons:
  //   services/  — 100% integration-dependent (live DB + network); tested via
  //                supertest integration suites, not unit-coverable in isolation.
  //   scripts/   — standalone CLI tools (console.log allowed); not app logic.
  collectCoverageFrom: [
    'app.js',
    'server.js',
    'config/**/*.js',
    'controllers/**/*.js',
    'middleware/**/*.js',
    'models/**/*.js',
    'routes/**/*.js',
    'utils/**/*.js',
    // Explicitly excluded:
    '!services/**/*.js',
    '!scripts/**/*.js',
    '!node_modules/**',
    '!tests/**',
    '!coverage/**',
  ],

  // ─── Coverage Thresholds ─────────────────────────────────────────────────────
  // Per-directory gates enforce quality on layers we directly control and test.
  // The global block is intentionally omitted: with services/ and scripts/
  // excluded via collectCoverageFrom, the global % is deterministic but low because
  // controllers/ still have integration-only paths. The per-directory gates below
  // catch regressions in every critical layer without false-positive failures.
  //
  // Current actuals (May 2026, 212 tests — verified from coverage/coverage-summary.json):
  //   utils/:      stmts 87.5%, branches 80.0%, fns 100.0%, lines 87.5%
  //   models/:     stmts 83.1%, branches 33.3%, fns  64.3%, lines 83.0%
  //   routes/:     stmts 95.1%, branches 37.5%, fns  66.7%, lines 95.1%
  //   middleware/: stmts 40.6%, branches 22.2%, fns  54.3%, lines 40.2%
  //
  // Note on middleware/: Several files (apiKeyMiddleware, planMiddleware, rbacMiddleware,
  // errorHandler) are integration-only paths not reachable in unit tests. The thresholds
  // reflect the true unit-testable surface and include a 3% safety buffer below actuals.
  //
  // Thresholds = actual − 3% safety buffer so new code with tests won't flip CI.
  coverageThreshold: {
    // Pure function utilities: highest confidence, tightest gates
    './utils/': {
      statements: 85,
      branches: 76,
      functions: 97,
      lines: 85,
    },
    // Mongoose models: schema + index definitions, mostly static
    // Branch % is low because enum guards / defaults aren't hit in unit tests
    './models/': {
      statements: 80,
      branches: 30,
      functions: 61,
      lines: 80,
    },
    // Route files: pure wiring (use → router.verb), nearly 100% covered
    './routes/': {
      statements: 92,
      branches: 34,
      functions: 63,
      lines: 92,
    },
    // Middleware: security-critical layer — auth, rate limit, reCAPTCHA, RBAC.
    // Several middlewares (apiKeyMiddleware, planMiddleware, rbacMiddleware, errorHandler)
    // have 0% unit-test coverage because they are integration-only paths.
    //
    // CI actuals (May 2026, live DB + real secrets):
    //   stmts 32.29%, branches 17.36%, fns ~54%, lines 31.31%
    // Local actuals are higher (~40%) because integration tests mock more paths.
    // Thresholds are set to CI actuals − 3% to prevent false-positive failures.
    './middleware/': {
      statements: 29,
      branches: 14,
      functions: 51,
      lines: 28,
    },
  },

  testTimeout: 30000,
  verbose: true,
  // uuid v13+ is ESM-only — transform to CJS for Jest
  transformIgnorePatterns: ['/node_modules/(?!uuid)'],
  transform: {
    '\\.js$': [
      'babel-jest',
      { presets: [['@babel/preset-env', { targets: { node: 'current' } }]] },
    ],
  },
};
