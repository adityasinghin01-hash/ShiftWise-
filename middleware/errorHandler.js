// middleware/errorHandler.js
// Global error handler — MUST be the last middleware in app.js.
//
// M1 FIX (Wave 3): unified error response shape:
//   { success: false, code: string, message: string, request_id: string }
// All errors now include request_id for log correlation.
// Mongoose ValidationError → 422 (semantic) not 400.

const logger = require('../config/logger');

// Map Mongoose/JWT error names to { statusCode, code }
const ERROR_MAP = {
  ValidationError: { status: 422, code: 'validation_failed' },
  CastError: { status: 400, code: 'bad_request' },
  JsonWebTokenError: { status: 401, code: 'unauthenticated' },
  TokenExpiredError: { status: 401, code: 'unauthenticated' },
};

const errorHandler = (err, req, res, _next) => {
  if (res.headersSent) return _next(err);

  // Determine status + code.
  // M2 FIX: a controller that explicitly sets err.statusCode should win over
  // the name-based ERROR_MAP. Only fall back to the map when statusCode wasn't
  // set on the error itself.
  let statusCode = err.statusCode;
  let code = err.code && typeof err.code === 'string' ? err.code : 'internal_error';

  const mapped = ERROR_MAP[err.name];
  if (mapped) {
    if (!statusCode) statusCode = mapped.status;
    code = mapped.code;
  }
  if (!statusCode) statusCode = 500;
  if (err.code === 11000) {
    statusCode = 409;
    code = 'conflict';
  }

  // Determine user-facing message
  let message = err.message || 'Internal Server Error';
  if (statusCode === 500 && process.env.NODE_ENV === 'production') {
    message = 'Internal Server Error';
  }
  if (err.code === 11000) {
    message = 'A record with that value already exists';
  }

  const requestId = req.id;

  logger.error({
    message: err.message,
    statusCode,
    code,
    requestId,
    method: req.method,
    url: req.originalUrl,
    userId: req.user?._id || req.user?.id,
    ip: req.ip,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });

  const response = {
    success: false,
    code,
    message,
    request_id: requestId,
  };

  // Mongoose field-level validation details in non-production
  if (process.env.NODE_ENV !== 'production' && err.errors) {
    response.details = err.errors;
  }

  res.status(statusCode).json(response);
};

module.exports = errorHandler;
