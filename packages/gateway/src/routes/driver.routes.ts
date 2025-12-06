/**
 * Driver Routes
 */

import { Router } from 'express'
import { authMiddleware, AppError, ErrorCode } from '@gominiapp/core'
import { DriverService } from '@gominiapp/go-service'

const router = Router()
const driverService = new DriverService()

// All routes require authentication
router.use(authMiddleware)

/**
 * POST /api/drivers/register
 * Register as a driver
 */
router.post('/register', async (req: any, res, next) => {
  try {
    const { vehicleType, vehiclePlate, vehicleModel, vehicleColor, availabilityType } = req.body
    
    const driver = await driverService.registerDriver(req.user.id, {
      vehicleType,
      vehiclePlate,
      vehicleModel,
      vehicleColor,
      availabilityType,
    })
    
    res.status(201).json({
      success: true,
      data: driver,
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/drivers/me
 * Get current driver profile
 */
router.get('/me', async (req: any, res, next) => {
  try {
    const driver = await driverService.getDriverByUserId(req.user.id)
    
    res.json({
      success: true,
      data: driver,
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/drivers/me/stats
 * Get driver statistics
 */
router.get('/me/stats', async (req: any, res, next) => {
  try {
    const driver = await driverService.getDriverByUserId(req.user.id)
    const stats = await driverService.getDriverStats(driver.id)
    
    res.json({
      success: true,
      data: stats,
    })
  } catch (error) {
    next(error)
  }
})

/**
 * PATCH /api/drivers/me/availability
 * Update driver availability (online/offline toggle)
 */
router.patch('/me/availability', async (req: any, res, next) => {
  try {
    const { isOnline, availabilityType } = req.body
    
    const driver = await driverService.getDriverByUserId(req.user.id)
    const updatedDriver = await driverService.updateAvailability(driver.id, {
      isOnline,
      availabilityType,
    })
    
    res.json({
      success: true,
      data: updatedDriver,
    })
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/drivers/me/location
 * Update driver location
 */
router.post('/me/location', async (req: any, res, next) => {
  try {
    const { latitude, longitude, heading, speed } = req.body
    
    if (latitude === undefined || longitude === undefined) {
      throw new AppError('latitude and longitude are required', ErrorCode.INVALID_INPUT, 400)
    }
    
    const driver = await driverService.getDriverByUserId(req.user.id)
    const result = await driverService.updateLocation(driver.id, {
      latitude,
      longitude,
      heading,
      speed,
    })
    
    res.json({
      success: true,
      data: result,
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/drivers/nearby
 * Find nearby available drivers
 */
router.get('/nearby', async (req: any, res, next) => {
  try {
    const { latitude, longitude, radius, type, vehicleType, limit } = req.query
    
    if (!latitude || !longitude) {
      throw new AppError('latitude and longitude are required', ErrorCode.INVALID_INPUT, 400)
    }
    
    const drivers = await driverService.findNearbyDrivers(
      { latitude: parseFloat(latitude), longitude: parseFloat(longitude) },
      {
        radiusKm: radius ? parseFloat(radius) : undefined,
        availabilityType: type as any,
        vehicleType: vehicleType as string,
        limit: limit ? parseInt(limit) : undefined,
      }
    )
    
    res.json({
      success: true,
      data: drivers,
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/drivers/:id
 * Get driver by ID (public info only)
 */
router.get('/:id', async (req: any, res, next) => {
  try {
    const driver = await driverService.getDriver(req.params.id)
    
    // Return only public info
    res.json({
      success: true,
      data: {
        id: driver.id,
        vehicleType: driver.vehicleType,
        vehicleModel: driver.vehicleModel,
        vehicleColor: driver.vehicleColor,
        rating: driver.rating,
        totalRides: driver.totalRides,
      },
    })
  } catch (error) {
    next(error)
  }
})

export { router as driverRouter }
