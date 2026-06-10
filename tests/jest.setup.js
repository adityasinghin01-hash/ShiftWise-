// tests/jest.setup.js
// Loads .env before any test module is evaluated.
// dotenv v17 resolves paths relative to the caller, NOT process.cwd().
// We must pass an explicit path to the root .env to guarantee correct loading.
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), override: true });
