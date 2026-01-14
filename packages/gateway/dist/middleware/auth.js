"use strict";
/**
 * Auth Middleware
 * Authentication and authorization middleware for admin routes
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = void 0;
exports.requireAdmin = requireAdmin;
const core_1 = require("@gominiapp/core");
/**
 * Require authentication (wraps core authMiddleware)
 */
exports.requireAuth = (0, core_1.authMiddleware)(true);
/**
 * Require admin role
 * Must be used after requireAuth
 */
async function requireAdmin(req, res, next) {
    try {
        if (!req.user?.id && !req.user?.did) {
            return next(new core_1.AppError('Authentication required', core_1.ErrorCode.UNAUTHORIZED, 401));
        }
        // Check if user is admin by DID or user ID
        let user;
        if (req.user.id) {
            user = await core_1.prisma.user.findUnique({
                where: { id: req.user.id },
                select: { id: true, did: true, role: true }
            });
        }
        else if (req.user.did) {
            user = await core_1.prisma.user.findUnique({
                where: { did: req.user.did },
                select: { id: true, did: true, role: true }
            });
        }
        if (!user) {
            return next(new core_1.AppError('User not found', core_1.ErrorCode.UNAUTHORIZED, 401));
        }
        // Check admin role
        if (user.role !== 'ADMIN') {
            return next(new core_1.AppError('Admin access required', core_1.ErrorCode.FORBIDDEN, 403));
        }
        // Ensure user ID is set
        req.user.id = user.id;
        next();
    }
    catch (error) {
        next(error);
    }
}
