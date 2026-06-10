// utils/handleValidation.js
// M1+M11 FIX: Centralized express-validator error handler.
// Returns 422 Unprocessable Entity (semantic error) with consistent shape:
//   { success: false, code: 'validation_failed', message, request_id }
//
// USAGE in controllers:
//   const { validationResult } = require('express-validator');
//   const { handleValidationErrors } = require('../utils/handleValidation');
//
//   const errors = validationResult(req);
//   if (handleValidationErrors(errors, res, req)) return;

/**
 * @param {import('express-validator').Result} errors
 * @param {import('express').Response} res
 * @param {import('express').Request} [req] - optional, used for request_id
 * @returns {boolean} true if error response sent, false if validation passed
 */
function handleValidationErrors(errors, res, req) {
  if (!errors.isEmpty()) {
    res.status(422).json({
      success: false,
      code: 'validation_failed',
      message: errors.array()[0].msg,
      request_id: req?.id,
    });
    return true;
  }
  return false;
}

module.exports = { handleValidationErrors };
