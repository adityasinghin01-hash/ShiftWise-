// middleware/rbacMiddleware.js
// Authorizes a user based on their role and requested permissions.
// MUST be executed after authMiddleware.js.

const { rolePermissions, roles } = require('../config/roles');
const logger = require('../config/logger');

/**
 * Middleware factory that enforces permission checks.
 * @param {...string} requiredPermissions - The permissions required to access the route.
 */
const authorize = (...requiredPermissions) => {
  return (req, res, next) => {
    // 0. Fail-closed: deny if no permissions were specified
    if (requiredPermissions.length === 0) {
      logger.warn('RBAC Auth failed: No required permissions specified — denying access');
      return res.status(403).json({
        success: false,
        message: 'Forbidden: No permissions specified',
      });
    }

    // 1. Ensure user exists (authMiddleware must run first)
    if (!req.user || !req.user.role) {
      logger.warn('RBAC Auth failed: User or user role is missing from request');
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Missing user context',
      });
    }

    // 2. Check if user is banned — block before any RBAC logic
    if (req.user.isBanned) {
      logger.warn(`RBAC Auth blocked: Banned user ${req.user.id} attempted access`);
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Account banned',
      });
    }

    const userRole = req.user.role;
    const userPermissions = rolePermissions[userRole];

    // 2b. Validate the role exists in our configuration
    if (!userPermissions) {
      logger.error(`RBAC Auth failed: Unknown role '${userRole}' found for user ${req.user.id}`);
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Invalid role assignment',
      });
    }

    // 3. Superadmin override: grant all access immediately
    if (userRole === roles.SUPERADMIN) {
      return next();
    }

    // 4. Verify user has ALL required permissions
    const hasAllPermissions = requiredPermissions.every((permission) =>
      userPermissions.includes(permission)
    );

    if (!hasAllPermissions) {
      logger.warn(
        `RBAC Auth failed: User ${req.user.id} (${userRole}) attempted to access resource requiring permissions: [${requiredPermissions.join(', ')}]`
      );
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Insufficient permissions',
      });
    }

    next();
  };
};

module.exports = {
  authorize,
};
