/**
 * DID Authentication & Validation
 * Validates Bluesky DIDs and provides auth middleware
 */
import { Request, Response, NextFunction } from 'express';
export interface AuthenticatedRequest extends Request {
    user?: {
        id: string;
        did: string;
        handle?: string;
    };
}
/**
 * Validates a Bluesky DID format
 */
export declare function validateDid(did: string): boolean;
/**
 * Resolves a DID to get the associated handle and verify it exists
 */
export declare function resolveDid(did: string): Promise<{
    handle?: string;
    valid: boolean;
}>;
/**
 * Extracts DID from Authorization header
 * Supports: Bearer <jwt> or DID <did>
 */
export declare function extractDid(authHeader: string | undefined): string | null;
/**
 * Extracts full user info from Authorization header JWT
 * Returns user ID, DID, and handle from the token
 */
export declare function extractUserFromToken(authHeader: string | undefined): {
    id: string;
    did: string;
    handle?: string;
} | null;
/**
 * Generates a JWT for a validated DID
 */
export declare function generateToken(did: string, handle?: string): string;
/**
 * Express middleware for DID authentication
 */
export declare function authMiddleware(required?: boolean): (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<void>;
/**
 * Validates DID ownership by checking a signed challenge
 * Used for initial registration/verification
 */
export declare function verifyDidOwnership(did: string, challenge: string, signature: string): Promise<boolean>;
