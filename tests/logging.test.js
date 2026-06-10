// tests/logging.test.js
// Verifies NO production code uses console.error/log/warn —
// all logging must go through Winston logger or next(err).

const fs = require('fs');
const path = require('path');

// All production files that must be free of console.* calls
const PRODUCTION_FILES = [
  { name: 'authController', path: path.join(__dirname, '..', 'controllers', 'authController.js') },
  {
    name: 'verificationController',
    path: path.join(__dirname, '..', 'controllers', 'verificationController.js'),
  },
  {
    name: 'passwordController',
    path: path.join(__dirname, '..', 'controllers', 'passwordController.js'),
  },
  {
    name: 'recaptchaMiddleware',
    path: path.join(__dirname, '..', 'middleware', 'recaptchaMiddleware.js'),
  },
];

// Files that perform inline logging (not just next(err) delegation)
const FILES_WITH_LOGGER = [
  { name: 'authController', path: path.join(__dirname, '..', 'controllers', 'authController.js') },
  {
    name: 'verificationController',
    path: path.join(__dirname, '..', 'controllers', 'verificationController.js'),
  },
  {
    name: 'passwordController',
    path: path.join(__dirname, '..', 'controllers', 'passwordController.js'),
  },
  {
    name: 'recaptchaMiddleware',
    path: path.join(__dirname, '..', 'middleware', 'recaptchaMiddleware.js'),
  },
];

describe('Structured Logging — No console.* in Production Code', () => {
  test.each(PRODUCTION_FILES)('$name must NOT use console.error', ({ path: filePath }) => {
    const source = fs.readFileSync(filePath, 'utf-8');
    const lines = source.split('\n');
    const violations = lines.filter(
      (line) => /console\.error\s*\(/.test(line) && !line.trim().startsWith('//')
    );
    expect(violations).toEqual([]);
  });

  test.each(PRODUCTION_FILES)('$name must NOT use console.log', ({ path: filePath }) => {
    const source = fs.readFileSync(filePath, 'utf-8');
    const lines = source.split('\n');
    const violations = lines.filter(
      (line) => /console\.log\s*\(/.test(line) && !line.trim().startsWith('//')
    );
    expect(violations).toEqual([]);
  });

  test.each(PRODUCTION_FILES)('$name must NOT use console.warn', ({ path: filePath }) => {
    const source = fs.readFileSync(filePath, 'utf-8');
    const lines = source.split('\n');
    const violations = lines.filter(
      (line) => /console\.warn\s*\(/.test(line) && !line.trim().startsWith('//')
    );
    expect(violations).toEqual([]);
  });

  test.each(FILES_WITH_LOGGER)('$name must import Winston logger', ({ path: filePath }) => {
    const source = fs.readFileSync(filePath, 'utf-8');
    expect(source).toMatch(/require\(.+logger.+\)/);
  });
});
