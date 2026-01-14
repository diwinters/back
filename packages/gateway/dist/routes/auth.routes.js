"use strict";
/**
 * Authentication Routes
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const express_1 = require("express");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const core_1 = require("@gominiapp/core");
const go_service_1 = require("@gominiapp/go-service");
const router = (0, express_1.Router)();
exports.authRouter = router;
const userService = new go_service_1.UserService();
const JWT_SECRET = process.env.JWT_SECRET || 'development-secret-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
/**
 * POST /api/auth/login
 * Authenticate with Bluesky DID
 */
router.post('/login', async (req, res, next) => {
    try {
        const { did, handle, displayName, avatarUrl, pushToken } = req.body;
        if (!did) {
            throw new core_1.AppError('DID is required', core_1.ErrorCode.INVALID_INPUT, 400);
        }
        // Validate DID format
        if (!(0, core_1.validateDid)(did)) {
            throw new core_1.AppError('Invalid DID format', core_1.ErrorCode.INVALID_DID, 400);
        }
        // Optionally verify DID exists on network
        try {
            await (0, core_1.resolveDid)(did);
        }
        catch {
            core_1.logger.warn('Could not resolve DID', { did });
            // Don't fail auth if resolution fails - might be network issue
        }
        // Get or create user
        let user = await userService.getOrCreateUser(did, handle);
        // Update profile if provided
        if (displayName || avatarUrl || pushToken) {
            await userService.updateUser(user.id, {
                displayName,
                avatarUrl,
            });
            if (pushToken) {
                await userService.updatePushToken(user.id, pushToken);
            }
        }
        // Get full user with driver info
        const fullUser = await userService.getUser(user.id);
        const isDriver = !!fullUser.driver;
        // Generate JWT
        const token = jsonwebtoken_1.default.sign({
            sub: user.id,
            did: user.did,
            handle: user.handle,
        }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
        core_1.logger.info('User authenticated', { userId: user.id, did, isDriver });
        res.json({
            success: true,
            data: {
                token,
                user: {
                    ...fullUser,
                    isDriver,
                },
                expiresIn: JWT_EXPIRES_IN,
            },
        });
    }
    catch (error) {
        next(error);
    }
});
/**
 * POST /api/auth/refresh
 * Refresh authentication token
 */
router.post('/refresh', async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            throw new core_1.AppError('No token provided', core_1.ErrorCode.UNAUTHORIZED, 401);
        }
        const oldToken = authHeader.slice(7);
        // Verify old token (allow expired)
        let payload;
        try {
            payload = jsonwebtoken_1.default.verify(oldToken, JWT_SECRET, { ignoreExpiration: true });
        }
        catch {
            throw new core_1.AppError('Invalid token', core_1.ErrorCode.INVALID_TOKEN, 401);
        }
        // Get fresh user data
        const user = await userService.getUser(payload.sub);
        // Generate new token
        const token = jsonwebtoken_1.default.sign({
            sub: user.id,
            did: user.did,
            handle: user.handle,
        }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
        res.json({
            success: true,
            data: {
                token,
                user,
                expiresIn: JWT_EXPIRES_IN,
            },
        });
    }
    catch (error) {
        next(error);
    }
});
/**
 * POST /api/auth/logout
 * Logout and clear push token
 */
router.post('/logout', async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith('Bearer ')) {
            const token = authHeader.slice(7);
            try {
                const payload = jsonwebtoken_1.default.verify(token, JWT_SECRET);
                // Clear push token
                await userService.updatePushToken(payload.sub, '');
                core_1.logger.info('User logged out', { userId: payload.sub });
            }
            catch {
                // Token invalid, but logout should still succeed
            }
        }
        res.json({ success: true });
    }
    catch (error) {
        next(error);
    }
});
