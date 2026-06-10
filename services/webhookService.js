// services/webhookService.js
// Core webhook engine — emit events, dispatch with retries, sign payloads.
// Uses only Node.js stdlib (crypto, https) — no external HTTP or queue packages.

const crypto = require('crypto');
const https = require('https');
const dns = require('dns').promises;
const { URL } = require('url');
const Webhook = require('../models/Webhook');
const WebhookDelivery = require('../models/WebhookDelivery');
const logger = require('../config/logger');
// HIGH-02 + HIGH-03 FIX: Runtime private-IP check used at dispatch time.
// Defeats DNS rebinding — URL is validated at creation, DNS resolved here at delivery.
const { isPrivateHost } = require('../utils/isPrivateUrl');

const DISPATCH_TIMEOUT = 10000; // 10 seconds
const MAX_ATTEMPTS = 4;
const RETRY_DELAYS = [30000, 60000, 300000]; // 30s, 60s, 5min
const MAX_RESPONSE_BYTES = 1000; // Matches WebhookDelivery.responseBody maxlength

// Module-level Map of pending retry timers: deliveryId → setTimeout handle
const retryTimers = new Map();

// ── Encryption Key ───────────────────────────────────────
// AES-256-GCM requires a 32-byte key (64 hex chars).
// Lazy resolution — validated on first use, not at import time,
// so the module can be safely required in tests.
let _encryptionKey = null;
const getEncryptionKey = () => {
  if (_encryptionKey) {
    return _encryptionKey;
  }
  const hex = process.env.WEBHOOK_SECRET_KEY;
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error(
      'WEBHOOK_SECRET_KEY must be set to a 64-character hex string (32 bytes). ' +
        "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  _encryptionKey = Buffer.from(hex, 'hex');
  return _encryptionKey;
};

// ── Helpers ──────────────────────────────────────────────

/**
 * Generate a random 32-byte hex string — the raw secret shown once to the user.
 */
const generateSecret = () => crypto.randomBytes(32).toString('hex');

/**
 * Encrypt a raw secret with AES-256-GCM for reversible storage.
 * Returns: iv:authTag:ciphertext (all hex, colon-separated).
 */
const encryptSecret = (rawSecret) => {
  const iv = crypto.randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  let encrypted = cipher.update(rawSecret, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
};

/**
 * Decrypt an AES-256-GCM encrypted secret back to its raw form.
 * Validates input format before attempting decryption.
 */
const decryptSecret = (encryptedSecret) => {
  if (!encryptedSecret || typeof encryptedSecret !== 'string') {
    throw new Error('decryptSecret: encryptedSecret must be a non-empty string');
  }
  const parts = encryptedSecret.split(':');
  if (parts.length !== 3) {
    throw new Error('decryptSecret: malformed encryptedSecret — expected iv:authTag:ciphertext');
  }
  const [ivHex, authTagHex, ciphertext] = parts;
  const hexPattern = /^[0-9a-f]+$/i;
  if (!ivHex || ivHex.length % 2 !== 0 || !hexPattern.test(ivHex)) {
    throw new Error('decryptSecret: invalid IV — must be even-length hex');
  }
  if (!authTagHex || authTagHex.length % 2 !== 0 || !hexPattern.test(authTagHex)) {
    throw new Error('decryptSecret: invalid authTag — must be even-length hex');
  }
  // AES-256-GCM auth tag must be exactly 16 bytes (128 bits = 32 hex chars)
  if (authTagHex.length !== 32) {
    throw new Error(
      'decryptSecret: invalid authTag — AES-256-GCM requires exactly 16 bytes (32 hex chars)'
    );
  }
  // M12 FIX: encryptSecret writes a 12-byte IV (96-bit, GCM-recommended).
  // Reject anything else so a malformed/forged record can't decrypt to garbage.
  if (ivHex.length !== 24) {
    throw new Error(
      'decryptSecret: invalid IV — AES-256-GCM with 96-bit IV requires 12 bytes (24 hex chars)'
    );
  }
  if (!ciphertext || ciphertext.length % 2 !== 0 || !hexPattern.test(ciphertext)) {
    throw new Error('decryptSecret: invalid ciphertext — must be even-length hex');
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};

// ── Core ─────────────────────────────────────────────────

/**
 * Emit a webhook event to all matching active endpoints for a user.
 * Fire-and-forget — does NOT block the caller.
 *
 * @param {string} event   - One of the WEBHOOK_EVENTS values
 * @param {object} payload - The event data to send
 * @param {string} userId  - Owner of the webhooks
 */
const emit = async (event, payload, userId) => {
  try {
    const webhooks = await Webhook.find({
      userId,
      isActive: true,
      events: event,
    });

    logger.info(`Webhook emit: ${event} → ${webhooks.length} endpoint(s) found`, {
      event,
      userId,
      endpointCount: webhooks.length,
    });

    for (const webhook of webhooks) {
      // Fire and forget — do NOT await
      dispatchWithRetry(webhook, event, payload).catch((err) => {
        logger.error('Webhook dispatchWithRetry unexpected error', {
          webhookId: webhook._id,
          event,
          error: err.message,
        });
      });
    }
  } catch (err) {
    logger.error('Webhook emit failed', { event, userId, error: err.message });
  }
};

/**
 * Dispatch a single webhook delivery with retry on failure.
 *
 * @param {object} webhook  - Webhook document from MongoDB
 * @param {string} event    - Event name
 * @param {object} payload  - Event data
 * @param {number} attempt  - Current attempt number (1-indexed)
 */
const dispatchWithRetry = async (webhook, event, payload, attempt = 1) => {
  const deliveryId = crypto.randomUUID();
  const body = JSON.stringify({
    // M17 FIX: include event_id so receivers can deduplicate retried deliveries.
    // deliveryId is the WebhookDelivery._id; it's stable across retry attempts for
    // the same original dispatch (generated once at first attempt).
    event_id: deliveryId,
    event,
    createdAt: new Date().toISOString(),
    data: payload,
  });

  // Decrypt the stored secret to compute HMAC-SHA256 signature.
  // C1 FIX (Wave 1): sign `${timestamp}.${body}` instead of just `${body}`.
  // Include X-Webhook-Timestamp header and encode signature as `t=<ts>,v1=<hex>`
  // (Stripe-style). Receivers can enforce a 5-min tolerance window to reject
  // replayed deliveries. See Skills/API_DESIGN.md §11 for the verification recipe.
  const rawSecret = decryptSecret(webhook.encryptedSecret);
  const timestamp = Math.floor(Date.now() / 1000); // Unix seconds
  const toSign = `${timestamp}.${body}`;
  const signature = crypto.createHmac('sha256', rawSecret).update(toSign).digest('hex');

  const url = new URL(webhook.url);

  // HIGH-03 FIX: DNS rebinding defence — re-resolve the hostname at dispatch time.
  // An attacker can pass URL validation at creation (public IP) then flip their DNS
  // to 127.0.0.1 / 169.254.169.254 (AWS IMDS). We block that here.
  try {
    const resolved = await dns.lookup(url.hostname, { all: true });
    for (const { address } of resolved) {
      if (isPrivateHost(address)) {
        logger.warn('Webhook blocked: hostname resolved to private IP (DNS rebinding attempt)', {
          webhookId: webhook._id,
          hostname: url.hostname,
          resolvedAddress: address,
        });
        // Record a blocked delivery so the user can see it in delivery history
        await WebhookDelivery.create({
          webhookId: webhook._id,
          userId: webhook.userId,
          event,
          payload,
          responseStatus: 0,
          responseBody: 'Blocked: hostname resolved to private/internal IP address.',
          attempt,
          success: false,
        }).catch(() => {}); // best-effort
        return; // abort — do NOT retry DNS-rebinding attempts
      }
    }
  } catch (dnsErr) {
    logger.warn('Webhook blocked: DNS lookup failed', {
      webhookId: webhook._id,
      hostname: url.hostname,
      error: dnsErr.message,
    });
    return; // fail-closed: if DNS lookup fails, do not dispatch
  }

  const options = {
    method: 'POST',
    hostname: url.hostname,
    port: url.port ? parseInt(url.port, 10) : 443, // L-05 FIX: url.port is a string; coerce to number
    path: url.pathname + url.search,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      // C1 FIX: Signature encodes both the timestamp and HMAC.
      // Format: `t=<unix_seconds>,v1=<hmac_sha256_of_timestamp.body>`
      // Receivers MUST check |now - t| < 300 to reject replays.
      'X-Webhook-Signature': `t=${timestamp},v1=${signature}`,
      'X-Webhook-Timestamp': String(timestamp),
      'X-Webhook-ID': String(webhook._id),
      'X-Delivery-ID': deliveryId,
    },
    timeout: DISPATCH_TIMEOUT,
  };

  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      let byteCount = 0;
      res.on('data', (d) => {
        if (byteCount >= MAX_RESPONSE_BYTES) {
          return;
        }
        const remaining = MAX_RESPONSE_BYTES - byteCount;
        const slice = d.length > remaining ? d.slice(0, remaining) : d;
        chunks.push(slice);
        byteCount += slice.length;
      });
      res.on('end', async () => {
        const bodyStr = Buffer.concat(chunks).toString('utf8').slice(0, MAX_RESPONSE_BYTES);
        const isSuccess = res.statusCode >= 200 && res.statusCode < 300;
        const truncatedBody = bodyStr;

        let savedDeliveryId;
        try {
          const delivery = await WebhookDelivery.create({
            webhookId: webhook._id,
            userId: webhook.userId,
            event,
            payload,
            responseStatus: res.statusCode,
            responseBody: truncatedBody,
            attempt,
            success: isSuccess,
            deliveredAt: new Date(),
            nextRetryAt:
              !isSuccess && attempt < MAX_ATTEMPTS
                ? new Date(
                    Date.now() +
                      (RETRY_DELAYS[attempt - 1] || RETRY_DELAYS[RETRY_DELAYS.length - 1])
                  )
                : undefined,
          });
          savedDeliveryId = delivery._id;
        } catch (dbErr) {
          logger.error('Failed to save WebhookDelivery', { error: dbErr.message });
        }

        if (isSuccess) {
          logger.info('Webhook delivered successfully', {
            webhookId: webhook._id,
            event,
            deliveryId,
            attempt,
            status: res.statusCode,
          });
        } else {
          logger.warn('Webhook delivery failed (non-2xx)', {
            webhookId: webhook._id,
            event,
            deliveryId,
            attempt,
            status: res.statusCode,
          });
          scheduleRetry(webhook, event, payload, attempt, savedDeliveryId);
        }
        resolve();
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('Webhook request timed out'));
    });

    req.on('error', async (err) => {
      let savedDeliveryId;
      try {
        const delivery = await WebhookDelivery.create({
          webhookId: webhook._id,
          userId: webhook.userId,
          event,
          payload,
          error: err.message,
          attempt,
          success: false,
          deliveredAt: new Date(),
          nextRetryAt:
            attempt < MAX_ATTEMPTS
              ? new Date(
                  Date.now() + (RETRY_DELAYS[attempt - 1] || RETRY_DELAYS[RETRY_DELAYS.length - 1])
                )
              : undefined,
        });
        savedDeliveryId = delivery._id;
      } catch (dbErr) {
        logger.error('Failed to save WebhookDelivery', { error: dbErr.message });
      }

      logger.warn('Webhook delivery failed (network error)', {
        webhookId: webhook._id,
        event,
        deliveryId,
        attempt,
        error: err.message,
      });
      scheduleRetry(webhook, event, payload, attempt, savedDeliveryId);
      resolve();
    });

    req.write(body);
    req.end();
  });
};

/**
 * Schedule a retry via setTimeout if attempts remain.
 * Persists nextRetryAt to DB for durability. setTimeout is the in-process owner;
 * when it fires it atomically claims the delivery first to prevent duplicates.
 *
 * @param {object} webhook        - Webhook document
 * @param {string} event          - Event name
 * @param {object} payload        - Event data
 * @param {number} currentAttempt - Just-completed attempt number
 * @param {string} [deliveryId]   - The _id of the WebhookDelivery record to retry
 */
const scheduleRetry = async (webhook, event, payload, currentAttempt, deliveryId) => {
  if (currentAttempt >= MAX_ATTEMPTS) {
    logger.error('Webhook delivery exhausted all retries', {
      webhookId: webhook._id,
      event,
      totalAttempts: currentAttempt,
    });
    return;
  }

  const delay = RETRY_DELAYS[currentAttempt - 1] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
  const nextAttempt = currentAttempt + 1;
  const nextRetryAt = new Date(Date.now() + delay);

  // Persist nextRetryAt on the specific delivery record so the retry worker can find it
  if (deliveryId) {
    try {
      await WebhookDelivery.findByIdAndUpdate(deliveryId, { $set: { nextRetryAt } });
    } catch (dbErr) {
      logger.error('Failed to persist nextRetryAt', { deliveryId, error: dbErr.message });
    }
  }

  logger.info('Webhook retry scheduled', {
    webhookId: webhook._id,
    event,
    deliveryId,
    nextAttempt,
    delayMs: delay,
    nextRetryAt: nextRetryAt.toISOString(),
  });

  // H-03 FIX: Use deliveryId as key when available; otherwise generate a stable UUID.
  // Previously used String(timerId) which produces "[object Object]" for all undefined-deliveryId
  // retries, causing Map key collisions and overwriting unrelated timers.
  const timerKey = deliveryId ? String(deliveryId) : crypto.randomUUID();

  // H-04 FIX: Wrap the entire async setTimeout body in try/catch so that an error
  // in Webhook.findById (DB unavailable) does not produce an unhandled rejection.
  const timerId = setTimeout(async () => {
    try {
      retryTimers.delete(timerKey);

      // Atomically claim — if the worker already grabbed it, claimed will be null
      if (deliveryId) {
        try {
          const claimed = await WebhookDelivery.findOneAndUpdate(
            { _id: deliveryId, nextRetryAt: { $exists: true }, success: false },
            { $unset: { nextRetryAt: 1 } },
            { returnDocument: 'after' }
          );
          if (!claimed) {
            logger.info('Retry already claimed by worker, skipping setTimeout dispatch', {
              deliveryId,
              webhookId: webhook._id,
            });
            return;
          }
        } catch (claimErr) {
          logger.error('Failed to claim delivery for retry', { error: claimErr.message });
        }
      }

      // Re-fetch webhook to detect deactivation/deletion/URL changes since scheduling
      const latest = await Webhook.findById(webhook._id);
      if (!latest || !latest.isActive) {
        logger.warn('Webhook retry skipped — webhook inactive or deleted since scheduling', {
          webhookId: webhook._id,
          event,
        });
        return;
      }

      dispatchWithRetry(latest, event, payload, nextAttempt).catch((err) => {
        logger.error('Webhook retry unexpected error', {
          webhookId: latest._id,
          event,
          attempt: nextAttempt,
          error: err.message,
        });
      });
    } catch (fatalErr) {
      // H-04 FIX: Catch any unexpected error (e.g. DB unavailable during findById)
      // to prevent an unhandled promise rejection from silently killing the retry.
      logger.error('Webhook retry timer fatal error', {
        webhookId: webhook._id,
        event,
        deliveryId,
        error: fatalErr.message,
      });
    }
  }, delay);

  retryTimers.set(timerKey, timerId);
};

// ── Persistent Retry Worker ──────────────────────────────
// Polls every 60s for failed deliveries with a past nextRetryAt.
// Covers retries missed due to process restarts (setTimeout is in-memory only).

const RETRY_POLL_INTERVAL = 60000; // 60 seconds
let retryWorkerTimer = null;

const processRetryQueue = async () => {
  try {
    // Atomic claim loop — avoids TOCTOU race by matching AND clearing nextRetryAt in one operation
    const deliveries = [];

    while (true) {
      const delivery = await WebhookDelivery.findOneAndUpdate(
        { success: false, nextRetryAt: { $lte: new Date() } },
        { $unset: { nextRetryAt: 1 } },
        { returnDocument: 'after' }
      );
      if (!delivery) {
        break;
      }
      deliveries.push(delivery);
      if (deliveries.length >= 50) {
        break;
      } // batch size cap
    }

    if (deliveries.length === 0) {
      return;
    }

    logger.info(`Webhook retry worker found ${deliveries.length} pending retries`);

    // H11 FIX: Batch-load all webhooks in one query instead of one per delivery.
    const webhookIds = [...new Set(deliveries.map((d) => String(d.webhookId)))];
    const webhooks = await Webhook.find({ _id: { $in: webhookIds } });
    const webhookById = new Map(webhooks.map((w) => [String(w._id), w]));

    for (const delivery of deliveries) {
      const webhook = webhookById.get(String(delivery.webhookId));
      if (!webhook || !webhook.isActive) {
        logger.info('Skipping retry — webhook inactive or deleted', {
          webhookId: delivery.webhookId,
        });
        continue;
      }

      const nextAttempt = delivery.attempt + 1;
      if (nextAttempt > MAX_ATTEMPTS) {
        logger.warn('Skipping retry — delivery exhausted all attempts', {
          deliveryId: delivery._id,
          currentAttempt: delivery.attempt,
          maxAttempts: MAX_ATTEMPTS,
        });
        continue;
      }

      dispatchWithRetry(webhook, delivery.event, delivery.payload, nextAttempt).catch((err) => {
        logger.error('Retry worker dispatch error', {
          webhookId: webhook._id,
          event: delivery.event,
          attempt: nextAttempt,
          error: err.message,
        });
      });
    }
  } catch (err) {
    logger.error('Webhook retry worker error', { error: err.message });
  }
};

/**
 * Start the background retry worker. Call once from server.js after DB connects.
 */
const startWebhookRetryWorker = () => {
  if (retryWorkerTimer) {
    return;
  } // idempotent
  logger.info('🔁 Webhook retry worker started (polling every 60s)');
  retryWorkerTimer = setInterval(processRetryQueue, RETRY_POLL_INTERVAL);
  // Run once immediately to pick up anything pending from before restart
  processRetryQueue().catch((err) => {
    logger.error('Webhook retry worker initial run failed', { error: err.message });
  });
};

/**
 * Stop the background retry worker. Call during graceful shutdown.
 * Also clears all pending in-process retry timers.
 */
const stopWebhookRetryWorker = () => {
  if (retryWorkerTimer) {
    clearInterval(retryWorkerTimer);
    retryWorkerTimer = null;
    logger.info('🛑 Webhook retry worker stopped');
  }
  // Clear all pending retry timers
  for (const [_key, timerId] of retryTimers) {
    clearTimeout(timerId);
  }
  if (retryTimers.size > 0) {
    logger.info(`🛑 Cleared ${retryTimers.size} pending retry timer(s)`);
  }
  retryTimers.clear();
};

module.exports = {
  emit,
  dispatchWithRetry,
  generateSecret,
  encryptSecret,
  decryptSecret,
  startWebhookRetryWorker,
  stopWebhookRetryWorker,
  // B8 FIX (Wave 4.1): test-only helper. Exported unconditionally so
  // require() always returns it (avoids module-load-order pitfalls), but
  // throws when called outside a Jest worker so a stray production caller
  // can't quietly clear the encryption-key cache. JEST_WORKER_ID is the
  // most reliable signal — Jest always sets it inside a worker, and dotenv
  // can't accidentally override it the way it does NODE_ENV.
  _resetEncryptionKey: () => {
    if (!process.env.JEST_WORKER_ID) {
      throw new Error('_resetEncryptionKey is test-only');
    }
    _encryptionKey = null;
  },
};
