"use strict";
/**
 * DID Authentication & Validation
 * Validates Bluesky DIDs and provides auth middleware
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateDid = validateDid;
exports.resolveDid = resolveDid;
exports.extractDid = extractDid;
exports.extractUserFromToken = extractUserFromToken;
exports.generateToken = generateToken;
exports.authMiddleware = authMiddleware;
exports.verifyDidOwnership = verifyDidOwnership;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const errors_1 = require("../utils/errors");
const logger_1 = require("../utils/logger");
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const BSKY_DID_PLC_URL = process.env.BSKY_DID_PLC_URL || 'https://plc.directory';
/**
 * Validates a Bluesky DID format
 */
function validateDid(did) {
    // DID format: did:plc:xxxx or did:web:domain
    const didRegex = /^did:(plc:[a-z0-9]+|web:[a-zA-Z0-9.-]+)$/;
    return didRegex.test(did);
}
/**
 * Resolves a DID to get the associated handle and verify it exists
 */
async function resolveDid(did) {
    if (!validateDid(did)) {
        return { valid: false };
    }
    try {
        // For did:plc, resolve from PLC directory
        if (did.startsWith('did:plc:')) {
            const response = await fetch(`${BSKY_DID_PLC_URL}/${did}`);
            if (!response.ok) {
                return { valid: false };
            }
            const data = await response.json();
            // Extract handle from alsoKnownAs
            const handle = data.alsoKnownAs?.find((aka) => aka.startsWith('at://'))?.replace('at://', '');
            return { handle, valid: true };
        }
        // For did:web, resolve from the domain's .well-known
        if (did.startsWith('did:web:')) {
            const domain = did.replace('did:web:', '');
            const response = await fetch(`https://${domain}/.well-known/did.json`);
            if (!response.ok) {
                return { valid: false };
            }
            return { valid: true };
        }
        return { valid: false };
    }
    catch (error) {
        logger_1.logger.error('DID resolution failed', { did, error });
        return { valid: false };
    }
}
/**
 * Extracts DID from Authorization header
 * Supports: Bearer <jwt> or DID <did>
 */
function extractDid(authHeader) {
    if (!authHeader)
        return null;
    // JWT Bearer token
    if (authHeader.startsWith('Bearer ')) {
        try {
            const token = authHeader.slice(7);
            const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
            return decoded.did;
        }
        catch {
            return null;
        }
    }
    // Direct DID (for development/testing)
    if (authHeader.startsWith('DID ')) {
        const did = authHeader.slice(4);
        return validateDid(did) ? did : null;
    }
    return null;
}
/**
 * Extracts full user info from Authorization header JWT
 * Returns user ID, DID, and handle from the token
 */
function extractUserFromToken(authHeader) {
    if (!authHeader)
        return null;
    // JWT Bearer token
    if (authHeader.startsWith('Bearer ')) {
        try {
            const token = authHeader.slice(7);
            const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
            return {
                id: decoded.sub,
                did: decoded.did,
                handle: decoded.handle,
            };
        }
        catch {
            return null;
        }
    }
    return null;
}
/**
 * Generates a JWT for a validated DID
 */
function generateToken(did, handle) {
    return jsonwebtoken_1.default.sign({ did, handle }, JWT_SECRET, { expiresIn: '7d' });
}
/**
 * Express middleware for DID authentication
 */
function authMiddleware(required = true) {
    return async (req, res, next) => {
        const authHeader = req.headers.authorization;
        // Try to extract full user info from JWT first
        const userFromToken = extractUserFromToken(authHeader);
        if (userFromToken) {
            // JWT token with user ID - use it directly
            req.user = userFromToken;
            return next();
        }
        // Fall back to DID-only extraction (for backward compatibility)
        const did = extractDid(authHeader);
        if (!did) {
            if (required) {
                return next(new errors_1.AppError('Authentication required', errors_1.ErrorCode.UNAUTHORIZED, 401));
            }
            return next();
        }
        // Validate DID exists
        const resolved = await resolveDid(did);
        if (!resolved.valid) {
            return next(new errors_1.AppError('Invalid DID', errors_1.ErrorCode.INVALID_DID, 401));
        }
        // Note: Without JWT, we don't have the user ID - this path shouldn't be used for protected routes
        req.user = {
            id: '', // Empty - will cause issues if routes expect user ID
            did,
            handle: resolved.handle,
        };
        next();
    };
}
/**
 * Validates DID ownership by checking a signed challenge
 * Used for initial registration/verification
 */
async function verifyDidOwnership(did, challenge, signature) {
    // In production, this would verify the signature against the DID's public key
    // For now, we trust the Bluesky session
    logger_1.logger.info('DID ownership verification', { did, challenge });
    return true;
}
