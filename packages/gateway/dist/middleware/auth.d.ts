/**
 * Auth Middleware
 * Authentication and authorization middleware for admin routes
 */
import { Request, Response, NextFunction } from 'express';
interface AuthenticatedRequest extends Request {
    user?: {
        id: string;
        did: string;
        handle?: string;
    };
}
/**
 * Require authentication (wraps core authMiddleware)
 */
export declare const requireAuth: (req: import("@gominiapp/core").AuthenticatedRequest, res: Response, next: NextFunction) => Promise<void>;
/**
 * Require admin role
 * Must be used after requireAuth
 */
export declare function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void>;
export {};
