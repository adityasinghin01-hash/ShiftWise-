// tests/health.test.js
// Integration tests for health check endpoints.

const request = require('supertest');
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI_TEST;

let app;

beforeAll(async () => {
  if (!MONGO_URI) {
    throw new Error('MONGO_URI_TEST env var is required for tests');
  }
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_URI);
  }
  app = require('../app');
});

afterAll(async () => {
  await mongoose.connection.close();
});

describe('GET /api/health', () => {
  it('should return 200', async () => {
    const res = await request(app).get('/api/health');
    expect(res.statusCode).toBe(200);
  });

  it('should return status ok with uptime and timestamp', async () => {
    const res = await request(app).get('/api/health');
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('uptime');
    expect(res.body).toHaveProperty('timestamp');
  });
});

describe('GET /api/health/deep', () => {
  it('should return 200 and healthy status when DB is connected', async () => {
    const original = app.locals.isReady;
    try {
      app.locals.isReady = true;

      const res = await request(app).get('/api/health/deep');
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.checks).toHaveProperty('database', 'connected');
      expect(res.body.checks).toHaveProperty('memory');
      expect(res.body.checks).toHaveProperty('server');
    } finally {
      app.locals.isReady = original;
    }
  });
});
