/**
 * Auth Middleware
 * Authentication and authorization middleware for admin routes
 */

import { Request, Response, NextFunction } from 'express'
import { authMiddleware, AppError, ErrorCode, prisma } from '@gominiapp/core'

// Extend Express Request to include user from authMiddleware
interface AuthenticatedRequest extends Request {
  user?: {
    id: string
    did: string
    handle?: string
  }
}

/**
 * Require authentication (wraps core authMiddleware)
 */
export const requireAuth = authMiddleware(true)

/**
 * Require admin role
 * Must be used after requireAuth
 */
export async function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user?.id && !req.user?.did) {
      return next(new AppError('Authentication required', ErrorCode.UNAUTHORIZED, 401))
    }

    // Check if user is admin by DID or user ID
    let user
    if (req.user.id) {
      user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { id: true, did: true, role: true }
      })
    } else if (req.user.did) {
      user = await prisma.user.findUnique({
        where: { did: req.user.did },
        select: { id: true, did: true, role: true }
      })
    }

    if (!user) {
      return next(new AppError('User not found', ErrorCode.UNAUTHORIZED, 401))
    }

    // Check admin role
    if (user.role !== 'ADMIN') {
      return next(new AppError('Admin access required', ErrorCode.FORBIDDEN, 403))
    }

    // Ensure user ID is set
    req.user.id = user.id

    next()
  } catch (error) {
    next(error)
  }
}
