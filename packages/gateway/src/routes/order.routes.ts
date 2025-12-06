/**
 * Order Routes
 */

import { Router } from 'express'
import { authMiddleware, AppError, ErrorCode } from '@gominiapp/core'
import { OrderService, RatingService, DriverService } from '@gominiapp/go-service'

const router = Router()
const orderService = new OrderService()
const ratingService = new RatingService()
const driverService = new DriverService()

// All routes require authentication
router.use(authMiddleware)

/**
 * POST /api/orders/estimate
 * Get fare estimate for a ride/delivery
 */
router.post('/estimate', async (req: any, res, next) => {
  try {
    const { 
      type, 
      pickupLatitude, 
      pickupLongitude, 
      pickupAddress,
      dropoffLatitude, 
      dropoffLongitude, 
      dropoffAddress,
      vehicleType, 
      packageSize 
    } = req.body
    
    if (!type || pickupLatitude === undefined || pickupLongitude === undefined || 
        dropoffLatitude === undefined || dropoffLongitude === undefined) {
      throw new AppError('type, pickup/dropoff coordinates are required', ErrorCode.INVALID_INPUT, 400)
    }
    
    const estimate = await orderService.getEstimate({
      type,
      pickupLatitude,
      pickupLongitude,
      pickupAddress: pickupAddress || '',
      dropoffLatitude,
      dropoffLongitude,
      dropoffAddress: dropoffAddress || '',
      vehicleType,
      packageSize,
    })
    
    res.json({
      success: true,
      data: estimate,
    })
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/orders
 * Create a new order (ride or delivery)
 */
router.post('/', async (req: any, res, next) => {
  try {
    const order = await orderService.createOrder(req.user.id, req.body)
    
    res.status(201).json({
      success: true,
      data: order,
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/orders/active
 * Get user's active order
 */
router.get('/active', async (req: any, res, next) => {
  try {
    const order = await orderService.getActiveOrderForUser(req.user.id)
    
    res.json({
      success: true,
      data: order,
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/orders/driver/active
 * Get driver's active order
 */
router.get('/driver/active', async (req: any, res, next) => {
  try {
    const driver = await driverService.getDriverByUserId(req.user.id)
    const order = await orderService.getActiveOrderForDriver(driver.id)
    
    res.json({
      success: true,
      data: order,
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/orders/history
 * Get user's order history
 */
router.get('/history', async (req: any, res, next) => {
  try {
    const { page, pageSize } = req.query
    
    const result = await orderService.getOrderHistory(req.user.id, {
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    })
    
    res.json({
      success: true,
      data: result.orders,
      meta: {
        total: result.total,
        page: page ? parseInt(page) : 1,
        pageSize: pageSize ? parseInt(pageSize) : 20,
      },
    })
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/orders/:id/accept
 * Driver accepts an order
 */
router.post('/:id/accept', async (req: any, res, next) => {
  try {
    const driver = await driverService.getDriverByUserId(req.user.id)
    const order = await orderService.acceptOrder(driver.id, req.params.id)
    
    res.json({
      success: true,
      data: order,
    })
  } catch (error) {
    next(error)
  }
})

/**
 * PATCH /api/orders/:id/status
 * Update order status
 */
router.patch('/:id/status', async (req: any, res, next) => {
  try {
    const { status, otp, latitude, longitude } = req.body
    
    if (!status) {
      throw new AppError('status is required', ErrorCode.INVALID_INPUT, 400)
    }
    
    const location = latitude && longitude ? { latitude, longitude } : undefined
    
    const order = await orderService.updateOrderStatus(
      req.params.id,
      status,
      location
    )
    
    res.json({
      success: true,
      data: order,
    })
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/orders/:id/cancel
 * Cancel an order
 */
router.post('/:id/cancel', async (req: any, res, next) => {
  try {
    const { reason } = req.body
    
    await orderService.cancelOrder(req.params.id, req.user.id, reason)
    
    res.json({ success: true })
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/orders/:id/rate
 * Rate a completed order
 */
router.post('/:id/rate', async (req: any, res, next) => {
  try {
    const { rating, comment } = req.body
    
    if (!rating || rating < 1 || rating > 5) {
      throw new AppError('rating must be between 1 and 5', ErrorCode.INVALID_INPUT, 400)
    }
    
    // Get order to find the other user
    const order = await orderService.getActiveOrderForUser(req.user.id)
    if (!order || order.id !== req.params.id) {
      throw new AppError('Order not found', ErrorCode.ORDER_NOT_FOUND, 404)
    }
    
    const toUserId = order.userId === req.user.id ? order.driverId : order.userId
    
    await ratingService.createRating(req.user.id, {
      orderId: req.params.id,
      toUserId: toUserId!,
      rating,
      comment,
    })
    
    res.json({ success: true })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/orders/:id
 * Get order details
 */
router.get('/:id', async (req: any, res, next) => {
  try {
    // This would need to be implemented in OrderService
    // For now, return not implemented
    throw new AppError('Not implemented', ErrorCode.INTERNAL_ERROR, 501)
  } catch (error) {
    next(error)
  }
})

export { router as orderRouter }
