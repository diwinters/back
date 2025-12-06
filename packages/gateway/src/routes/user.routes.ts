/**
 * User Routes
 */

import { Router } from 'express'
import { authMiddleware } from '@gominiapp/core'
import { UserService } from '@gominiapp/go-service'

const router = Router()
const userService = new UserService()

// All routes require authentication
router.use(authMiddleware())

/**
 * GET /api/users/me
 * Get current user profile
 */
router.get('/me', async (req: any, res, next) => {
  try {
    const user = await userService.getUser(req.user.id)
    
    res.json({
      success: true,
      data: user,
    })
  } catch (error) {
    next(error)
  }
})

/**
 * PATCH /api/users/me
 * Update current user profile
 */
router.patch('/me', async (req: any, res, next) => {
  try {
    const { displayName, avatarUrl, phone, defaultPaymentMethod } = req.body
    
    const user = await userService.updateUser(req.user.id, {
      displayName,
      avatarUrl,
      phone,
      defaultPaymentMethod,
    })
    
    res.json({
      success: true,
      data: user,
    })
  } catch (error) {
    next(error)
  }
})

/**
 * PUT /api/users/me/push-token
 * Update push notification token
 */
router.put('/me/push-token', async (req: any, res, next) => {
  try {
    const { pushToken } = req.body
    
    if (!pushToken) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'pushToken is required' },
      })
    }
    
    await userService.updatePushToken(req.user.id, pushToken)
    
    res.json({ success: true })
  } catch (error) {
    next(error)
  }
})

export { router as userRouter }
