/**
 * Admin Routes
 * Protected endpoints for admin management
 */

import { Router } from 'express'
import { prisma, logger } from '@gominiapp/core'
import { CartService } from '@gominiapp/go-service'
// import { requireAuth, requireAdmin } from '../middleware/auth'

const router = Router()
const cartService = new CartService()

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
 * GET /api/admin/walkthroughs/by-city/:cityId
 * Get walkthrough by cityId (for admin panel - includes inactive)
 * NOTE: Must be defined BEFORE /walkthroughs/:id to avoid matching "by-city" as id
 */
router.get('/walkthroughs/by-city/:cityId', async (req, res, next) => {
  try {
    const { cityId } = req.params
    
    const walkthrough = await prisma.cityWalkthrough.findUnique({
      where: { cityId },
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
      return res.json({
        success: true,
        data: null,
        message: 'No walkthrough found for this city'
      })
    }

    res.json({
      success: true,
      data: walkthrough
    })
  } catch (error) {
    logger.error('Failed to get walkthrough by city', { error })
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
            // Rich content fields
            title: p.title,
            description: p.description,
            imageUrl: p.imageUrl,
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
                // Rich content fields
                title: p.title,
                description: p.description,
                imageUrl: p.imageUrl,
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

// =============================================================================
// MARKET CATEGORIES ADMIN ENDPOINTS
// =============================================================================

/**
 * GET /api/admin/market/categories
 * List all categories (including inactive) with subcategories
 */
router.get('/market/categories', async (req, res, next) => {
  try {
    const categories = await prisma.marketCategory.findMany({
      include: {
        subcategories: {
          orderBy: { sortOrder: 'asc' }
        },
        _count: {
          select: { posts: { where: { status: 'ACTIVE', isArchived: false } } }
        }
      },
      orderBy: { sortOrder: 'asc' }
    })
    
    res.json({
      success: true,
      data: categories.map(c => ({
        ...c,
        postCount: c._count.posts
      }))
    })
  } catch (error) {
    logger.error('Failed to list categories', { error })
    next(error)
  }
})

/**
 * GET /api/admin/market/categories/:id
 * Get single category with subcategories
 */
router.get('/market/categories/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    
    const category = await prisma.marketCategory.findUnique({
      where: { id },
      include: {
        subcategories: {
          orderBy: { sortOrder: 'asc' }
        },
        _count: {
          select: { posts: { where: { status: 'ACTIVE', isArchived: false } } }
        }
      }
    })
    
    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found'
      })
    }
    
    res.json({
      success: true,
      data: {
        ...category,
        postCount: category._count.posts
      }
    })
  } catch (error) {
    logger.error('Failed to get category', { error })
    next(error)
  }
})

/**
 * POST /api/admin/market/categories
 * Create a new category
 */
router.post('/market/categories', async (req, res, next) => {
  try {
    const { name, nameAr, description, emoji, iconUrl, gradientStart, gradientEnd, sortOrder, isActive, isGlobal } = req.body
    
    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'name is required'
      })
    }
    
    const category = await prisma.marketCategory.create({
      data: {
        name,
        nameAr,
        description,
        emoji,
        iconUrl,
        gradientStart,
        gradientEnd,
        sortOrder: sortOrder ?? 0,
        isActive: isActive ?? true,
        isGlobal: isGlobal ?? false
      },
      include: {
        subcategories: true,
        cities: { include: { city: { select: { id: true, name: true, code: true } } } }
      }
    })
    
    logger.info('Category created', { categoryId: category.id })
    
    res.status(201).json({
      success: true,
      data: category
    })
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(400).json({
        success: false,
        error: 'A category with this name already exists'
      })
    }
    logger.error('Failed to create category', { error })
    next(error)
  }
})

/**
 * PUT /api/admin/market/categories/:id
 * Update a category
 */
router.put('/market/categories/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    const { name, nameAr, description, emoji, iconUrl, gradientStart, gradientEnd, sortOrder, isActive, isGlobal } = req.body
    
    const existing = await prisma.marketCategory.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Category not found'
      })
    }
    
    const category = await prisma.marketCategory.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(nameAr !== undefined && { nameAr }),
        ...(description !== undefined && { description }),
        ...(emoji !== undefined && { emoji }),
        ...(iconUrl !== undefined && { iconUrl }),
        ...(gradientStart !== undefined && { gradientStart }),
        ...(gradientEnd !== undefined && { gradientEnd }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(isActive !== undefined && { isActive }),
        ...(isGlobal !== undefined && { isGlobal })
      },
      include: {
        subcategories: {
          orderBy: { sortOrder: 'asc' }
        },
        cities: { include: { city: { select: { id: true, name: true, code: true } } } }
      }
    })
    
    logger.info('Category updated', { categoryId: id })
    
    res.json({
      success: true,
      data: category
    })
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(400).json({
        success: false,
        error: 'A category with this name already exists'
      })
    }
    logger.error('Failed to update category', { error })
    next(error)
  }
})

/**
 * DELETE /api/admin/market/categories/:id
 * Delete a category (blocked if has posts)
 */
router.delete('/market/categories/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    
    const category = await prisma.marketCategory.findUnique({
      where: { id },
      include: {
        _count: { select: { posts: true } }
      }
    })
    
    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found'
      })
    }
    
    if (category._count.posts > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete category with ${category._count.posts} posts. Move or delete posts first.`
      })
    }
    
    await prisma.marketCategory.delete({ where: { id } })
    
    logger.info('Category deleted', { categoryId: id })
    
    res.json({
      success: true,
      message: 'Category deleted'
    })
  } catch (error) {
    logger.error('Failed to delete category', { error })
    next(error)
  }
})

/**
 * POST /api/admin/market/categories/reorder
 * Reorder categories
 */
router.post('/market/categories/reorder', async (req, res, next) => {
  try {
    const { categoryIds } = req.body
    
    if (!categoryIds || !Array.isArray(categoryIds)) {
      return res.status(400).json({
        success: false,
        error: 'categoryIds array is required'
      })
    }
    
    await prisma.$transaction(
      categoryIds.map((categoryId: string, index: number) =>
        prisma.marketCategory.update({
          where: { id: categoryId },
          data: { sortOrder: index + 1 }
        })
      )
    )
    
    logger.info('Categories reordered')
    
    res.json({
      success: true,
      message: 'Categories reordered'
    })
  } catch (error) {
    logger.error('Failed to reorder categories', { error })
    next(error)
  }
})

// =============================================================================
// MARKET SUBCATEGORIES ADMIN ENDPOINTS
// =============================================================================

/**
 * POST /api/admin/market/categories/:id/subcategories
 * Create a subcategory
 */
router.post('/market/categories/:categoryId/subcategories', async (req, res, next) => {
  try {
    const { categoryId } = req.params
    const { name, nameAr, description, emoji, iconUrl, gradientStart, gradientEnd, sortOrder, isActive } = req.body
    
    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'name is required'
      })
    }
    
    const category = await prisma.marketCategory.findUnique({ where: { id: categoryId } })
    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found'
      })
    }
    
    const subcategory = await prisma.marketSubcategory.create({
      data: {
        categoryId,
        name,
        nameAr,
        description,
        emoji,
        iconUrl,
        gradientStart,
        gradientEnd,
        sortOrder: sortOrder ?? 0,
        isActive: isActive ?? true
      }
    })
    
    logger.info('Subcategory created', { subcategoryId: subcategory.id, categoryId })
    
    res.status(201).json({
      success: true,
      data: subcategory
    })
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(400).json({
        success: false,
        error: 'A subcategory with this name already exists in this category'
      })
    }
    logger.error('Failed to create subcategory', { error })
    next(error)
  }
})

/**
 * PUT /api/admin/market/subcategories/:id
 * Update a subcategory
 */
router.put('/market/subcategories/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    const { name, nameAr, description, emoji, iconUrl, gradientStart, gradientEnd, sortOrder, isActive } = req.body
    
    const existing = await prisma.marketSubcategory.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Subcategory not found'
      })
    }
    
    const subcategory = await prisma.marketSubcategory.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(nameAr !== undefined && { nameAr }),
        ...(description !== undefined && { description }),
        ...(emoji !== undefined && { emoji }),
        ...(iconUrl !== undefined && { iconUrl }),
        ...(gradientStart !== undefined && { gradientStart }),
        ...(gradientEnd !== undefined && { gradientEnd }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(isActive !== undefined && { isActive })
      }
    })
    
    logger.info('Subcategory updated', { subcategoryId: id })
    
    res.json({
      success: true,
      data: subcategory
    })
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(400).json({
        success: false,
        error: 'A subcategory with this name already exists in this category'
      })
    }
    logger.error('Failed to update subcategory', { error })
    next(error)
  }
})

/**
 * DELETE /api/admin/market/subcategories/:id
 * Delete a subcategory (blocked if has posts)
 */
router.delete('/market/subcategories/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    
    const subcategory = await prisma.marketSubcategory.findUnique({
      where: { id },
      include: {
        _count: { select: { posts: true } }
      }
    })
    
    if (!subcategory) {
      return res.status(404).json({
        success: false,
        error: 'Subcategory not found'
      })
    }
    
    if (subcategory._count.posts > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete subcategory with ${subcategory._count.posts} posts. Move or delete posts first.`
      })
    }
    
    await prisma.marketSubcategory.delete({ where: { id } })
    
    logger.info('Subcategory deleted', { subcategoryId: id })
    
    res.json({
      success: true,
      message: 'Subcategory deleted'
    })
  } catch (error) {
    logger.error('Failed to delete subcategory', { error })
    next(error)
  }
})

/**
 * POST /api/admin/market/categories/:categoryId/subcategories/reorder
 * Reorder subcategories within a category
 */
router.post('/market/categories/:categoryId/subcategories/reorder', async (req, res, next) => {
  try {
    const { subcategoryIds } = req.body
    
    if (!subcategoryIds || !Array.isArray(subcategoryIds)) {
      return res.status(400).json({
        success: false,
        error: 'subcategoryIds array is required'
      })
    }
    
    await prisma.$transaction(
      subcategoryIds.map((subcategoryId: string, index: number) =>
        prisma.marketSubcategory.update({
          where: { id: subcategoryId },
          data: { sortOrder: index + 1 }
        })
      )
    )
    
    logger.info('Subcategories reordered')
    
    res.json({
      success: true,
      message: 'Subcategories reordered'
    })
  } catch (error) {
    logger.error('Failed to reorder subcategories', { error })
    next(error)
  }
})

// =============================================================================
// MARKET SETTINGS ADMIN ENDPOINTS
// =============================================================================

/**
 * GET /api/admin/market/settings
 * Get current market settings (TVA, service fee, etc.)
 */
router.get('/market/settings', async (req, res, next) => {
  try {
    const settings = await cartService.getMarketSettings()
    
    res.json({
      success: true,
      data: {
        tvaRate: settings.tvaRate,
        tvaEnabled: settings.tvaEnabled,
        serviceFeeRate: settings.serviceFeeRate,
        serviceFeeMin: settings.serviceFeeMin,
        serviceFeeMax: settings.serviceFeeMax,
        serviceFeeEnabled: settings.serviceFeeEnabled,
        defaultCurrency: settings.defaultCurrency,
        updatedAt: settings.updatedAt
      }
    })
  } catch (error) {
    logger.error('Failed to get market settings', { error })
    next(error)
  }
})

/**
 * PUT /api/admin/market/settings
 * Update market settings (TVA, service fee, etc.)
 */
router.put('/market/settings', async (req, res, next) => {
  try {
    const {
      tvaRate,
      tvaEnabled,
      serviceFeeRate,
      serviceFeeMin,
      serviceFeeMax,
      serviceFeeEnabled,
      defaultCurrency
    } = req.body

    // Validate rates are percentages (0-1)
    if (tvaRate !== undefined && (tvaRate < 0 || tvaRate > 1)) {
      return res.status(400).json({
        success: false,
        error: 'TVA rate must be between 0 and 1 (e.g., 0.20 for 20%)'
      })
    }
    if (serviceFeeRate !== undefined && (serviceFeeRate < 0 || serviceFeeRate > 1)) {
      return res.status(400).json({
        success: false,
        error: 'Service fee rate must be between 0 and 1 (e.g., 0.05 for 5%)'
      })
    }

    const settings = await cartService.updateMarketSettings({
      tvaRate,
      tvaEnabled,
      serviceFeeRate,
      serviceFeeMin,
      serviceFeeMax,
      serviceFeeEnabled,
      defaultCurrency
    })
    
    logger.info('Market settings updated', { settings })
    
    res.json({
      success: true,
      data: {
        tvaRate: settings.tvaRate,
        tvaEnabled: settings.tvaEnabled,
        serviceFeeRate: settings.serviceFeeRate,
        serviceFeeMin: settings.serviceFeeMin,
        serviceFeeMax: settings.serviceFeeMax,
        serviceFeeEnabled: settings.serviceFeeEnabled,
        defaultCurrency: settings.defaultCurrency,
        updatedAt: settings.updatedAt
      },
      message: 'Market settings updated successfully'
    })
  } catch (error) {
    logger.error('Failed to update market settings', { error })
    next(error)
  }
})

export { router as adminRouter }
