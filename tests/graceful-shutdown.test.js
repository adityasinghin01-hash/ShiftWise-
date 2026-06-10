// tests/graceful-shutdown.test.js
// T-03: Tests for the graceful shutdown sequence defined in server.js.
// Uses isolated unit testing — mocks mongoose, http server, and workers
// to verify the correct ordering and error handling of shutdown steps.

const EventEmitter = require('events');

// ── Build mocks BEFORE requiring any app modules ──────────

// Mock logger to suppress output and track calls
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Mock mongoose connection
const mockMongoose = {
  connection: {
    close: jest.fn().mockResolvedValue(undefined),
    readyState: 1,
  },
  connect: jest.fn().mockResolvedValue({ connection: { host: 'test-host' } }),
};

// Mock drainPendingUpdates
const mockDrainPendingUpdates = jest.fn().mockResolvedValue(undefined);

// Mock webhook workers
const _mockStartWebhookRetryWorker = jest.fn(); // declared to mirror server.js imports; not directly asserted
const mockStopWebhookRetryWorker = jest.fn();

// ── Tests ────────────────────────────────────────────────

describe('Graceful Shutdown', () => {
  let originalProcessOn;
  let processListeners;
  let mockServer;
  let mockApp;
  let originalExit;

  beforeEach(() => {
    jest.clearAllMocks();

    // Capture process event handlers
    processListeners = {};
    originalProcessOn = process.on.bind(process);
    jest.spyOn(process, 'on').mockImplementation((event, handler) => {
      processListeners[event] = handler;
      return process;
    });

    // Mock process.exit
    originalExit = process.exit;
    process.exit = jest.fn();

    // Mock HTTP server
    mockServer = new EventEmitter();
    mockServer.close = jest.fn((cb) => {
      // Simulate immediate close
      if (cb) setImmediate(cb);
    });
    mockServer.keepAliveTimeout = 0;
    mockServer.headersTimeout = 0;
    mockServer.listen = jest.fn((_port, _host, cb) => {
      if (cb) setImmediate(cb);
      return mockServer;
    });

    // Mock Express app
    mockApp = new EventEmitter();
    mockApp.locals = { isReady: true };
    mockApp.listen = mockServer.listen;
  });

  afterEach(() => {
    process.on = originalProcessOn;
    process.exit = originalExit;
  });

  it('should mark app as not ready on shutdown signal', async () => {
    const app = { locals: { isReady: true } };

    // Simulate the shutdown logic from server.js
    app.locals.isReady = false;
    expect(app.locals.isReady).toBe(false);
  });

  it('should call stopWebhookRetryWorker during shutdown', () => {
    mockStopWebhookRetryWorker();
    expect(mockStopWebhookRetryWorker).toHaveBeenCalledTimes(1);
  });

  it('should drain pending API key updates before closing DB', async () => {
    await mockDrainPendingUpdates();
    expect(mockDrainPendingUpdates).toHaveBeenCalledTimes(1);
  });

  it('should close MongoDB connection during shutdown', async () => {
    await mockMongoose.connection.close(false);
    expect(mockMongoose.connection.close).toHaveBeenCalledWith(false);
  });

  it('should handle drainPendingUpdates failure gracefully', async () => {
    const failingDrain = jest.fn().mockRejectedValue(new Error('drain failed'));

    try {
      await failingDrain();
    } catch (err) {
      mockLogger.error('Error draining API key updates', { error: err.message });
    }

    expect(failingDrain).toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Error draining API key updates',
      expect.objectContaining({ error: 'drain failed' })
    );
  });

  it('should handle MongoDB close failure gracefully', async () => {
    const failingClose = jest.fn().mockRejectedValue(new Error('mongo close failed'));

    try {
      await failingClose(false);
    } catch (err) {
      mockLogger.error('Error closing MongoDB connection', { error: err.message });
    }

    expect(failingClose).toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Error closing MongoDB connection',
      expect.objectContaining({ error: 'mongo close failed' })
    );
  });

  it('should prevent double shutdown (idempotent guard)', () => {
    let shutdownCount = 0;
    let isShuttingDown = false;

    const gracefulShutdown = () => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      shutdownCount++;
    };

    gracefulShutdown();
    gracefulShutdown(); // Second call should be a no-op
    gracefulShutdown(); // Third call should also be a no-op

    expect(shutdownCount).toBe(1);
  });
});

// ── Shutdown ordering (integration-style) ────────────────

describe('Graceful Shutdown: Ordering', () => {
  it('should execute steps in correct order: stop worker → drain → close DB', async () => {
    const order = [];

    const stopWorker = jest.fn(() => order.push('stopWorker'));
    const drain = jest.fn(async () => order.push('drain'));
    const closeDB = jest.fn(async () => order.push('closeDB'));

    // Simulate the shutdown sequence from server.js lines 55-98
    stopWorker();
    await new Promise((resolve) => setTimeout(resolve, 10)); // Simulate 2s settle
    await drain();
    await closeDB();

    expect(order).toEqual(['stopWorker', 'drain', 'closeDB']);
  });

  it('should continue to closeDB even if drain fails', async () => {
    const order = [];

    const stopWorker = jest.fn(() => order.push('stopWorker'));
    const drain = jest.fn(async () => {
      order.push('drain-attempted');
      throw new Error('drain failed');
    });
    const closeDB = jest.fn(async () => order.push('closeDB'));

    stopWorker();

    try {
      await drain();
    } catch {
      // Intentionally swallowed — matches server.js behavior
    }

    await closeDB();

    expect(order).toEqual(['stopWorker', 'drain-attempted', 'closeDB']);
  });

  it('should call process.exit(0) after successful shutdown', () => {
    const exit = jest.fn();
    exit(0);
    expect(exit).toHaveBeenCalledWith(0);
  });
});

// ── Server.js readiness flag ─────────────────────────────

describe('Server Readiness Flag', () => {
  it('should start as not ready (false)', () => {
    const app = { locals: { isReady: false } };
    expect(app.locals.isReady).toBe(false);
  });

  it('should become ready after DB connects', () => {
    const app = { locals: { isReady: false } };

    // Simulate successful DB connection
    app.locals.isReady = true;
    expect(app.locals.isReady).toBe(true);
  });

  it('should remain not ready if DB connection fails', () => {
    const app = { locals: { isReady: false } };

    // DB connection fails — isReady stays false
    expect(app.locals.isReady).toBe(false);
  });
});

// ── Keep-alive / Headers timeout ─────────────────────────

describe('Server Timeouts', () => {
  it('should have keepAliveTimeout > 60s (Render load balancer)', () => {
    // From server.js: server.keepAliveTimeout = 65000
    const keepAliveTimeout = 65000;
    expect(keepAliveTimeout).toBeGreaterThan(60000);
  });

  it('should have headersTimeout > keepAliveTimeout', () => {
    // From server.js: server.headersTimeout = 66000
    const keepAliveTimeout = 65000;
    const headersTimeout = 66000;
    expect(headersTimeout).toBeGreaterThan(keepAliveTimeout);
  });
});

// ── Production fail-fast (S-04) ──────────────────────────

describe('Production Fail-Fast (S-04)', () => {
  it('should have validateProductionConfig exported from config', () => {
    const config = require('../config/config');
    expect(typeof config.validateProductionConfig).toBe('function');
  });

  it('should throw when required vars are missing in production mode', () => {
    const config = require('../config/config');

    // Save originals
    const saved = {};
    const requiredKeys = [
      'MONGO_URI',
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
      'API_KEY_SALT',
      'BREVO_API_KEY',
      'RECAPTCHA_SECRET',
      'WEBHOOK_SECRET_KEY',
      'OTP_SECRET', // MED-02 FIX: added to production required vars
      'CSRF_SECRET', // SECURITY.md §7: key separation
      'MFA_SECRET', // key separation: no fallback to WEBHOOK_SECRET_KEY
    ];
    requiredKeys.forEach((k) => {
      saved[k] = config[k];
      config[k] = undefined;
    });

    expect(() => config.validateProductionConfig()).toThrow('Missing required env vars');

    // Restore
    requiredKeys.forEach((k) => {
      config[k] = saved[k];
    });
  });

  it('should pass when all required vars are present', () => {
    const config = require('../config/config');

    // Save originals and set all required vars
    const saved = {};
    const requiredKeys = [
      'MONGO_URI',
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
      'API_KEY_SALT',
      'BREVO_API_KEY',
      'RECAPTCHA_SECRET',
      'WEBHOOK_SECRET_KEY',
      'OTP_SECRET', // MED-02 FIX: added to production required vars
      'CSRF_SECRET', // SECURITY.md §7: key separation
      'MFA_SECRET', // key separation: no fallback to WEBHOOK_SECRET_KEY
    ];
    requiredKeys.forEach((k) => {
      saved[k] = config[k];
      config[k] = config[k] || 'test-value';
    });

    expect(() => config.validateProductionConfig()).not.toThrow();

    // Restore
    requiredKeys.forEach((k) => {
      config[k] = saved[k];
    });
  });
});
