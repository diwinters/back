/**
 * Admin Routes
 * Protected endpoints for admin management
 */

import { Router } from 'express'
import { prisma, logger } from '@gominiapp/core'
// import { requireAuth, requireAdmin } from '../middleware/auth'

const router = Router()

// TODO: Re-enable authentication for production
// All admin routes require authentication and admin role
// router.use(requireAuth)
// router.use(requireAdmin)

// =============================================================================
// CITY WALKTHROUGH ADMIN ENDPOINTS
// =============================================================================

/**
 * GET /api/admin/walkthroughs
 * List all walkthroughs with their cities
 */
router.get('/walkthroughs', async (req, res, next) => {
  try {
    const walkthroughs = await prisma.cityWalkthrough.findMany({
      include: {
        city: {
          select: { id: true, name: true, code: true }
        },
        points: {
          orderBy: { order: 'asc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    res.json({
      success: true,
      data: walkthroughs.map(w => ({
        id: w.id,
        cityId: w.cityId,
        city: w.city,
        name: w.name,
        isActive: w.isActive,
        defaultDurationMs: w.defaultDurationMs,
        pointCount: w.points.length,
        points: w.points.map(p => ({
          id: p.id,
          order: p.order,
          latitude: p.latitude,
          longitude: p.longitude,
          zoom: p.zoom,
          pitch: p.pitch,
          bearing: p.bearing,
          durationMs: p.durationMs,
          label: p.label,
        })),
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
      }))
    })
  } catch (error) {
    logger.error('Failed to list walkthroughs', { error })
    next(error)
  }
})

/**
 * GET /api/admin/walkthroughs/:id
 * Get a specific walkthrough with all details
 */
router.get('/walkthroughs/:id', async (req, res, next) => {
  try {
    const walkthrough = await prisma.cityWalkthrough.findUnique({
      where: { id: req.params.id },
      include: {
        city: {
          select: { id: true, name: true, code: true, centerLatitude: true, centerLongitude: true }
        },
        points: {
          orderBy: { order: 'asc' }
        }
      }
    })

    if (!walkthrough) {
      return res.status(404).json({
        success: false,
        error: 'Walkthrough not found'
      })
    }

    res.json({
      success: true,
      data: walkthrough
    })
  } catch (error) {
    logger.error('Failed to get walkthrough', { error })
    next(error)
  }
})

/**
 * POST /api/admin/walkthroughs
 * Create a new walkthrough for a city
 */
router.post('/walkthroughs', async (req, res, next) => {
  try {
    const { cityId, name, isActive, defaultDurationMs, points } = req.body

    if (!cityId) {
      return res.status(400).json({
        success: false,
        error: 'cityId is required'
      })
    }

    // Check if city exists
    const city = await prisma.city.findUnique({ where: { id: cityId } })
    if (!city) {
      return res.status(404).json({
        success: false,
        error: 'City not found'
      })
    }

    // Check if walkthrough already exists for this city
    const existing = await prisma.cityWalkthrough.findUnique({ where: { cityId } })
    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'Walkthrough already exists for this city. Use PUT to update.'
      })
    }

    const walkthrough = await prisma.cityWalkthrough.create({
      data: {
        cityId,
        name: name || `${city.name} Tour`,
        isActive: isActive ?? true,
        defaultDurationMs: defaultDurationMs || 3000,
        points: points && points.length > 0 ? {
          create: points.map((p: any, index: number) => ({
            order: p.order ?? index + 1,
            latitude: p.latitude,
            longitude: p.longitude,
            zoom: p.zoom ?? 14,
            pitch: p.pitch ?? 60,
            bearing: p.bearing ?? 0,
            durationMs: p.durationMs,
            label: p.label,
          }))
        } : undefined
      },
      include: {
        city: { select: { id: true, name: true, code: true } },
        points: { orderBy: { order: 'asc' } }
      }
    })

    logger.info('Walkthrough created', { walkthroughId: walkthrough.id, cityId })

    res.status(201).json({
      success: true,
      data: walkthrough
    })
  } catch (error) {
    logger.error('Failed to create walkthrough', { error })
    next(error)
  }
})

/**
 * PUT /api/admin/walkthroughs/:id
 * Update a walkthrough (including replacing all points)
 */
router.put('/walkthroughs/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    const { name, isActive, defaultDurationMs, points } = req.body

    const existing = await prisma.cityWalkthrough.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Walkthrough not found'
      })
    }

    // Use transaction to update walkthrough and replace points
    const walkthrough = await prisma.$transaction(async (tx) => {
      // Delete existing points if new points provided
      if (points && Array.isArray(points)) {
        await tx.walkthroughPoint.deleteMany({
          where: { walkthroughId: id }
        })
      }

      // Update walkthrough and create new points
      return tx.cityWalkthrough.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(isActive !== undefined && { isActive }),
          ...(defaultDurationMs !== undefined && { defaultDurationMs }),
          ...(points && Array.isArray(points) && {
            points: {
              create: points.map((p: any, index: number) => ({
                order: p.order ?? index + 1,
                latitude: p.latitude,
                longitude: p.longitude,
                zoom: p.zoom ?? 14,
                pitch: p.pitch ?? 60,
                bearing: p.bearing ?? 0,
                durationMs: p.durationMs,
                label: p.label,
              }))
            }
          })
        },
        include: {
          city: { select: { id: true, name: true, code: true } },
          points: { orderBy: { order: 'asc' } }
        }
      })
    })

    logger.info('Walkthrough updated', { walkthroughId: id })

    res.json({
      success: true,
      data: walkthrough
    })
  } catch (error) {
    logger.error('Failed to update walkthrough', { error })
    next(error)
  }
})

/**
 * DELETE /api/admin/walkthroughs/:id
 * Delete a walkthrough
 */
router.delete('/walkthroughs/:id', async (req, res, next) => {
  try {
    const { id } = req.params

    const existing = await prisma.cityWalkthrough.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Walkthrough not found'
      })
    }

    await prisma.cityWalkthrough.delete({ where: { id } })

    logger.info('Walkthrough deleted', { walkthroughId: id })

    res.json({
      success: true,
      message: 'Walkthrough deleted'
    })
  } catch (error) {
    logger.error('Failed to delete walkthrough', { error })
    next(error)
  }
})

// =============================================================================
// WALKTHROUGH POINTS MANAGEMENT
// =============================================================================

/**
 * POST /api/admin/walkthroughs/:id/points
 * Add a single point to a walkthrough
 */
router.post('/walkthroughs/:id/points', async (req, res, next) => {
  try {
    const { id } = req.params
    const { latitude, longitude, zoom, pitch, bearing, durationMs, label, order } = req.body

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        error: 'latitude and longitude are required'
      })
    }

    const walkthrough = await prisma.cityWalkthrough.findUnique({
      where: { id },
      include: { points: { orderBy: { order: 'desc' }, take: 1 } }
    })

    if (!walkthrough) {
      return res.status(404).json({
        success: false,
        error: 'Walkthrough not found'
      })
    }

    const nextOrder = order ?? (walkthrough.points[0]?.order ?? 0) + 1

    const point = await prisma.walkthroughPoint.create({
      data: {
        walkthroughId: id,
        order: nextOrder,
        latitude,
        longitude,
        zoom: zoom ?? 14,
        pitch: pitch ?? 60,
        bearing: bearing ?? 0,
        durationMs,
        label,
      }
    })

    logger.info('Walkthrough point added', { walkthroughId: id, pointId: point.id })

    res.status(201).json({
      success: true,
      data: point
    })
  } catch (error) {
    logger.error('Failed to add walkthrough point', { error })
    next(error)
  }
})

/**
 * PUT /api/admin/walkthroughs/:id/points/:pointId
 * Update a specific point
 */
router.put('/walkthroughs/:id/points/:pointId', async (req, res, next) => {
  try {
    const { pointId } = req.params
    const { latitude, longitude, zoom, pitch, bearing, durationMs, label, order } = req.body

    const existing = await prisma.walkthroughPoint.findUnique({ where: { id: pointId } })
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Point not found'
      })
    }

    const point = await prisma.walkthroughPoint.update({
      where: { id: pointId },
      data: {
        ...(latitude !== undefined && { latitude }),
        ...(longitude !== undefined && { longitude }),
        ...(zoom !== undefined && { zoom }),
        ...(pitch !== undefined && { pitch }),
        ...(bearing !== undefined && { bearing }),
        ...(durationMs !== undefined && { durationMs }),
        ...(label !== undefined && { label }),
        ...(order !== undefined && { order }),
      }
    })

    logger.info('Walkthrough point updated', { pointId })

    res.json({
      success: true,
      data: point
    })
  } catch (error) {
    logger.error('Failed to update walkthrough point', { error })
    next(error)
  }
})

/**
 * DELETE /api/admin/walkthroughs/:id/points/:pointId
 * Delete a specific point
 */
router.delete('/walkthroughs/:id/points/:pointId', async (req, res, next) => {
  try {
    const { pointId } = req.params

    const existing = await prisma.walkthroughPoint.findUnique({ where: { id: pointId } })
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Point not found'
      })
    }

    await prisma.walkthroughPoint.delete({ where: { id: pointId } })

    logger.info('Walkthrough point deleted', { pointId })

    res.json({
      success: true,
      message: 'Point deleted'
    })
  } catch (error) {
    logger.error('Failed to delete walkthrough point', { error })
    next(error)
  }
})

/**
 * POST /api/admin/walkthroughs/:id/points/reorder
 * Reorder points in a walkthrough
 */
router.post('/walkthroughs/:id/points/reorder', async (req, res, next) => {
  try {
    const { id } = req.params
    const { pointIds } = req.body // Array of point IDs in new order

    if (!pointIds || !Array.isArray(pointIds)) {
      return res.status(400).json({
        success: false,
        error: 'pointIds array is required'
      })
    }

    // Update all points with new order
    await prisma.$transaction(
      pointIds.map((pointId: string, index: number) =>
        prisma.walkthroughPoint.update({
          where: { id: pointId },
          data: { order: index + 1 }
        })
      )
    )

    logger.info('Walkthrough points reordered', { walkthroughId: id })

    res.json({
      success: true,
      message: 'Points reordered'
    })
  } catch (error) {
    logger.error('Failed to reorder walkthrough points', { error })
    next(error)
  }
})

// =============================================================================
// CITIES LIST FOR ADMIN (to select when creating walkthrough)
// =============================================================================

/**
 * GET /api/admin/cities
 * List all cities for admin selection
 */
router.get('/cities', async (req, res, next) => {
  try {
    const cities = await prisma.city.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        country: true,
        isActive: true,
        centerLatitude: true,
        centerLongitude: true,
        radiusKm: true,
        walkthrough: {
          select: { id: true, isActive: true }
        }
      },
      orderBy: { name: 'asc' }
    })

    res.json({
      success: true,
      data: cities.map(c => ({
        ...c,
        hasWalkthrough: !!c.walkthrough,
        walkthroughId: c.walkthrough?.id,
        walkthroughActive: c.walkthrough?.isActive ?? false,
      }))
    })
  } catch (error) {
    logger.error('Failed to list cities', { error })
    next(error)
  }
})

export { router as adminRouter }
