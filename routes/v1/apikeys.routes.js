// routes/v1/apikeys.routes.js
// Routes for managing developer API keys.

const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const apiKeyController = require('../../controllers/apiKeyController');
const { protect } = require('../../middleware/authMiddleware');

// SECURITY: All API key management routes require active JWT authentication
// from a frontend session. API keys CANNOT be used to manage API keys.
router.use(protect());

// C7 FIX (Wave 4): explicit validation chains. Previously the route had no
// express-validator chain, so the controller saw whatever the user sent —
// arbitrarily long names, non-array scopes, etc.
const createValidation = [
  body('name')
    .exists({ checkFalsy: true })
    .withMessage('API Key name is required.')
    .isString()
    .withMessage('Name must be a string.')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Name must be between 1 and 50 characters.'),
  body('scopes')
    .optional()
    .isArray({ min: 1, max: 10 })
    .withMessage('Scopes must be an array of 1-10 strings.'),
  body('scopes.*').optional().isString().withMessage('Each scope must be a string.'),
];

const idValidation = [param('id').isMongoId().withMessage('Invalid API key ID.')];

router.post('/', createValidation, apiKeyController.createKey);
router.get('/', apiKeyController.listKeys);
router.delete('/:id', idValidation, apiKeyController.revokeKey);
router.post('/:id/rotate', idValidation, apiKeyController.rotateKey);

module.exports = router;
