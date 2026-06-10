// controllers/adminController.js
// Handles administrative actions protected by RBAC.

const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const logger = require('../config/logger');
const { roles } = require('../config/roles');

/**
 * @route   GET /api/v1/admin/users
 * @desc    Get paginated list of all users
 * @access  Private (Requires READ_USERS permission)
 */
exports.getAllUsers = async (req, res, next) => {
  try {
    const rawLimit = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 10;
    const cursor = req.query.cursor; // base64-encoded last-seen _id

    // M14 FIX: cursor/keyset pagination — O(1) regardless of page depth.
    // Client receives next_cursor; pass it as ?cursor= for the next page.
    const filter = cursor ? { _id: { $lt: Buffer.from(cursor, 'base64').toString() } } : {};

    const users = await User.find(filter)
      .select(
        'email name role isBanned isVerified createdAt updatedAt activeSubscription pendingSubscriptionCreation'
      )
      .lean()
      .sort({ _id: -1 })
      .limit(limit + 1); // fetch one extra to know if there's a next page

    const hasMore = users.length > limit;
    if (hasMore) users.pop();

    const nextCursor = hasMore
      ? Buffer.from(String(users[users.length - 1]._id)).toString('base64')
      : null;

    res.status(200).json({
      success: true,
      count: users.length,
      next_cursor: nextCursor,
      has_more: hasMore,
      data: users,
    });

    // M4: audit after response — non-blocking
    AuditLog.create({
      actorId: req.user._id,
      actorRole: req.user.role,
      action: 'view_users',
      ip: req.ip,
    }).catch((e) => logger.error('AuditLog create failed', { error: e.message }));
  } catch (err) {
    logger.error('Error in getAllUsers:', err);
    next(err);
  }
};

/**
 * @route   PUT /api/v1/admin/users/:id/role
 * @desc    Change user role
 * @access  Private (Requires UPDATE_ROLE permission)
 */
exports.updateUserRole = async (req, res, next) => {
  try {
    const { role } = req.body;
    const targetUserId = req.params.id;

    // 1. Validate the requested role exists
    if (!Object.values(roles).includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role specified' });
    }

    // 2. Prevent non-superadmins from granting or revoking superadmin status
    if (role === roles.SUPERADMIN && req.user.role !== roles.SUPERADMIN) {
      return res
        .status(403)
        .json({ success: false, message: 'Only superadmins can grant superadmin privileges' });
    }

    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Protect existing superadmins from being demoted by regular admins
    if (targetUser.role === roles.SUPERADMIN && req.user.role !== roles.SUPERADMIN) {
      return res
        .status(403)
        .json({ success: false, message: 'Cannot modify a superadmin account' });
    }

    // C6 FIX (Wave 4): Admin-on-admin peer attack protection.
    // Without this, two admins can demote each other. Only superadmins can
    // change another admin's role.
    if (targetUser.role === roles.ADMIN && req.user.role !== roles.SUPERADMIN) {
      return res
        .status(403)
        .json({ success: false, message: 'Only superadmins can modify another admin account' });
    }

    // Prevent modifying oneself to avoid lockouts
    if (targetUser._id.toString() === req.user.id) {
      return res.status(400).json({ success: false, message: 'Cannot modify your own role' });
    }

    // C2 FIX (Wave 4): capture the previous role BEFORE mutating the doc.
    // The old code wrote `from: targetUser.role` AFTER the assignment, so
    // every audit entry recorded `from === to`.
    const previousRole = targetUser.role;
    targetUser.role = role;
    await targetUser.save();

    logger.info(`Admin ${req.user.id} updated user ${targetUser._id} to role ${role}`);

    // M4: audit role change
    AuditLog.create({
      actorId: req.user._id,
      actorRole: req.user.role,
      action: 'role_change',
      targetId: targetUser._id,
      meta: { from: previousRole, to: role },
      ip: req.ip,
    }).catch((e) => logger.error('AuditLog create failed', { error: e.message }));

    res.status(200).json({
      success: true,
      message: `User role updated to ${role}`,
      data: { id: targetUser._id, name: targetUser.name, role: targetUser.role },
    });
  } catch (err) {
    logger.error('Error in updateUserRole:', err);
    next(err);
  }
};

/**
 * @route   PUT /api/v1/admin/users/:id/ban
 * @desc    Ban or unban a user
 * @access  Private (Requires MODERATE_USERS permission)
 */
exports.toggleUserBan = async (req, res, next) => {
  try {
    const { isBanned } = req.body; // Expecting boolean

    if (typeof isBanned !== 'boolean') {
      return res.status(400).json({ success: false, message: 'isBanned must be a boolean' });
    }

    const targetUser = await User.findById(req.params.id);
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Admins/Moderators cannot ban superadmins
    if (targetUser.role === roles.SUPERADMIN && req.user.role !== roles.SUPERADMIN) {
      return res.status(403).json({ success: false, message: 'Cannot ban a superadmin account' });
    }

    // C6 FIX (Wave 4): Only superadmins can ban another admin (peer attack).
    if (targetUser.role === roles.ADMIN && req.user.role !== roles.SUPERADMIN) {
      return res
        .status(403)
        .json({ success: false, message: 'Only superadmins can ban another admin account' });
    }

    if (targetUser._id.toString() === req.user.id) {
      return res.status(400).json({ success: false, message: 'Cannot ban yourself' });
    }

    targetUser.isBanned = isBanned;
    // C8 FIX (Wave 4): wipe all refresh tokens when banning so the user can't
    // simply refresh their access token to keep using the API. protect()
    // already blocks banned users at request time, but without clearing
    // refreshTokens the session metadata sticks around; doing it here keeps
    // the security model symmetric.
    if (isBanned) {
      targetUser.refreshTokens = [];
    }
    await targetUser.save();

    logger.info(
      `Moderator ${req.user.id} ${isBanned ? 'banned' : 'unbanned'} user ${targetUser._id}`
    );

    // M4: audit ban/unban
    AuditLog.create({
      actorId: req.user._id,
      actorRole: req.user.role,
      action: isBanned ? 'ban_user' : 'unban_user',
      targetId: targetUser._id,
      ip: req.ip,
    }).catch((e) => logger.error('AuditLog create failed', { error: e.message }));

    res.status(200).json({
      success: true,
      message: `User successfully ${isBanned ? 'banned' : 'unbanned'}`,
      data: { id: targetUser._id, isBanned: targetUser.isBanned },
    });
  } catch (err) {
    logger.error('Error in toggleUserBan:', err);
    next(err);
  }
};

/**
 * @route   GET /api/v1/admin/stats
 * @desc    Get basic system statistics
 * @access  Private (Requires VIEW_STATS permission)
 */
exports.getSystemStats = async (req, res, next) => {
  try {
    const [totalUsers, verifiedUsers, bannedUsers] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isVerified: true }),
      User.countDocuments({ isBanned: true }),
    ]);

    // Count by role
    const roleDistribution = await User.aggregate([
      { $group: { _id: '$role', count: { $sum: 1 } } },
    ]);

    const formattedDistribution = {};
    roleDistribution.forEach((stat) => {
      formattedDistribution[stat._id || 'user'] = stat.count;
    });

    res.status(200).json({
      success: true,
      data: {
        totalUsers,
        verifiedUsers,
        bannedUsers,
        roleDistribution: formattedDistribution,
      },
    });

    // M4: audit stats view
    AuditLog.create({
      actorId: req.user._id,
      actorRole: req.user.role,
      action: 'view_stats',
      ip: req.ip,
    }).catch((e) => logger.error('AuditLog create failed', { error: e.message }));
  } catch (err) {
    logger.error('Error in getSystemStats:', err);
    next(err);
  }
};

/**
 * @route   DELETE /api/v1/admin/users/:id
 * @desc    Delete a user (superadmin only)
 * @access  Private (Requires DELETE_USERS permission)
 */
exports.deleteUser = async (req, res, next) => {
  try {
    const targetUser = await User.findById(req.params.id);
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Cannot delete superadmins
    if (targetUser.role === roles.SUPERADMIN) {
      return res
        .status(403)
        .json({ success: false, message: 'Cannot delete a superadmin account' });
    }

    // Cannot delete yourself
    if (targetUser._id.toString() === req.user.id) {
      return res.status(400).json({ success: false, message: 'Cannot delete yourself' });
    }

    await User.findByIdAndDelete(req.params.id);

    logger.info(`Superadmin ${req.user.id} deleted user ${targetUser._id}`);

    // Audit log
    AuditLog.create({
      actorId: req.user._id,
      actorRole: req.user.role,
      action: 'delete_user',
      targetId: targetUser._id,
      meta: { email: targetUser.email, role: targetUser.role },
      ip: req.ip,
    }).catch((e) => logger.error('AuditLog create failed', { error: e.message }));

    res.status(200).json({
      success: true,
      message: 'User deleted successfully',
    });
  } catch (err) {
    logger.error('Error in deleteUser:', err);
    next(err);
  }
};
