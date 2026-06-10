// routes/v1/admin.routes.js
// Protected routes for RBAC administrative actions.

const express = require('express');
const router = express.Router();
const { param } = require('express-validator');
const { protect: authMiddleware } = require('../../middleware/authMiddleware');
const { authorize } = require('../../middleware/rbacMiddleware');
const { requireRecentAuth } = require('../../middleware/stepUpAuth');
const { permissions } = require('../../config/roles');
const adminController = require('../../controllers/adminController');

const idValidation = [param('id').isMongoId().withMessage('Invalid user ID format.')];

// All admin routes require authentication
router.use(authMiddleware());

// Block banned users from all admin routes
router.use((req, res, next) => {
  if (req.user && req.user.isBanned) {
    return res.status(403).json({
      success: false,
      message: 'Forbidden: Account banned',
    });
  }
  next();
});

// ── GET /api/v1/admin/users
router.get('/users', authorize(permissions.READ_USERS), adminController.getAllUsers);

// ── PUT /api/v1/admin/users/:id/role (requires step-up)
router.put(
  '/users/:id/role',
  idValidation,
  authorize(permissions.UPDATE_ROLE),
  requireRecentAuth(10),
  adminController.updateUserRole
);

// ── PUT /api/v1/admin/users/:id/ban (requires step-up)
router.put(
  '/users/:id/ban',
  idValidation,
  authorize(permissions.MODERATE_USERS),
  requireRecentAuth(10),
  adminController.toggleUserBan
);

// ── DELETE /api/v1/admin/users/:id (requires step-up)
router.delete(
  '/users/:id',
  idValidation,
  authorize(permissions.DELETE_USERS),
  requireRecentAuth(10),
  adminController.deleteUser
);

// ── GET /api/v1/admin/stats
router.get('/stats', authorize(permissions.VIEW_STATS), adminController.getSystemStats);

module.exports = router;
