/**
 * Config Routes
 * Public configuration endpoints (no auth required)
 */

import { Router } from 'express'
import { prisma, logger } from '@gominiapp/core'

const router = Router()

/**
 * GET /api/config/vehicle-types
 * Get active vehicle types for client display
 * Public endpoint - no auth required
 */
router.get('/vehicle-types', async (req, res, next) => {
  try {
    const vehicleTypes = await prisma.vehicleTypeConfig.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        icon: true,
        capacity: true,
        baseFare: true,
        perKmRate: true,
        perMinuteRate: true,
        minimumFare: true,
        features: true,
        sortOrder: true,
        isPromo: true,
        promoText: true,
      }
    })

    // Transform to client-friendly format
    const clientVehicleTypes = vehicleTypes.map(vt => ({
      id: vt.code.toLowerCase(),
      type: vt.code.toLowerCase(),
      code: vt.code,
      name: vt.name,
      description: vt.description,
      icon: vt.icon,
      capacity: vt.capacity,
      eta: Math.floor(Math.random() * 8) + 2, // Random 2-10 min ETA (would be real in production)
      price: {
        base: vt.baseFare,
        perKm: vt.perKmRate,
        perMile: vt.perKmRate * 1.60934, // Convert to miles for display
        perMinute: vt.perMinuteRate,
        minimum: vt.minimumFare,
      },
      estimatedFare: vt.baseFare + (vt.perKmRate * 5), // Base + ~5km estimate
      features: vt.features,
      available: true,
      isPromo: vt.isPromo,
      promoText: vt.promoText,
    }))

    res.json({
      success: true,
      data: clientVehicleTypes,
    })
  } catch (error) {
    logger.error('Failed to fetch vehicle types', { error })
    next(error)
  }
})

/**
 * GET /api/config/vehicle-types/:code
 * Get pricing for a specific vehicle type
 */
router.get('/vehicle-types/:code', async (req, res, next) => {
  try {
    const vehicleType = await prisma.vehicleTypeConfig.findUnique({
      where: { code: req.params.code.toUpperCase() }
    })

    if (!vehicleType) {
      return res.status(404).json({
        success: false,
        error: 'Vehicle type not found'
      })
    }

    res.json({
      success: true,
      data: {
        code: vehicleType.code,
        name: vehicleType.name,
        baseFare: vehicleType.baseFare,
        perKmRate: vehicleType.perKmRate,
        perMinuteRate: vehicleType.perMinuteRate,
        minimumFare: vehicleType.minimumFare,
      }
    })
  } catch (error) {
    next(error)
  }
})

export { router as configRouter }
