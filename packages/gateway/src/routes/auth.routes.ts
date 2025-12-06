/**
 * Authentication Routes
 */

import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { validateDid, resolveDid, logger, AppError, ErrorCode } from '@gominiapp/core'
import { UserService } from '@gominiapp/go-service'

const router = Router()
const userService = new UserService()

const JWT_SECRET = process.env.JWT_SECRET || 'development-secret-change-in-production'
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d'

/**
 * POST /api/auth/login
 * Authenticate with Bluesky DID
 */
router.post('/login', async (req, res, next) => {
  try {
    const { did, handle, displayName, avatarUrl, pushToken } = req.body

    if (!did) {
      throw new AppError('DID is required', ErrorCode.INVALID_INPUT, 400)
    }

    // Validate DID format
    if (!validateDid(did)) {
      throw new AppError('Invalid DID format', ErrorCode.INVALID_DID, 400)
    }

    // Optionally verify DID exists on network
    try {
      await resolveDid(did)
    } catch {
      logger.warn('Could not resolve DID', { did })
      // Don't fail auth if resolution fails - might be network issue
    }

    // Get or create user
    const user = await userService.registerOrUpdateUser({
      did,
      handle,
      displayName,
      avatarUrl,
      pushToken,
    })

    // Generate JWT
    const token = jwt.sign(
      {
        sub: user.id,
        did: user.did,
        handle: user.handle,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    )

    logger.info('User authenticated', { userId: user.id, did })

    res.json({
      success: true,
      data: {
        token,
        user,
        expiresIn: JWT_EXPIRES_IN,
      },
    })
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/auth/refresh
 * Refresh authentication token
 */
router.post('/refresh', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization
    
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError('No token provided', ErrorCode.UNAUTHORIZED, 401)
    }

    const oldToken = authHeader.slice(7)

    // Verify old token (allow expired)
    let payload: any
    try {
      payload = jwt.verify(oldToken, JWT_SECRET, { ignoreExpiration: true })
    } catch {
      throw new AppError('Invalid token', ErrorCode.INVALID_TOKEN, 401)
    }

    // Get fresh user data
    const user = await userService.getUserById(payload.sub)

    // Generate new token
    const token = jwt.sign(
      {
        sub: user.id,
        did: user.did,
        handle: user.handle,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    )

    res.json({
      success: true,
      data: {
        token,
        user,
        expiresIn: JWT_EXPIRES_IN,
      },
    })
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/auth/logout
 * Logout and clear push token
 */
router.post('/logout', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization
    
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      
      try {
        const payload = jwt.verify(token, JWT_SECRET) as any
        
        // Clear push token
        await userService.updatePushToken(payload.sub, '')
        
        logger.info('User logged out', { userId: payload.sub })
      } catch {
        // Token invalid, but logout should still succeed
      }
    }

    res.json({ success: true })
  } catch (error) {
    next(error)
  }
})

export { router as authRouter }
