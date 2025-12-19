import { Router } from 'express'
import { authMiddleware, logger } from '@gominiapp/core'
import { MarketService } from '@gominiapp/go-service'

const router = Router()
const marketService = new MarketService()

// Public routes
router.get('/categories', async (req, res, next) => {
  try {
    logger.info('[Market] GET /categories')
    const categories = await marketService.getCategories()
    logger.info(`[Market] Returning ${categories.length} categories`)
    res.json({ success: true, data: categories })
  } catch (error) {
    logger.error('[Market] Error fetching categories:', error)
    next(error)
  }
})

router.get('/posts/active', async (req, res, next) => {
  try {
    logger.info('[Market] GET /posts/active', req.query)
    const { page, pageSize, categoryId, subcategoryId, cityId } = req.query

    const result = await marketService.getActivePosts({
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
      categoryId: categoryId as string,
      subcategoryId: subcategoryId as string,
      cityId: cityId as string
    })

    logger.info(`[Market] Found ${result.data.length} active posts`)
    res.json({ success: true, ...result })
  } catch (error) {
    logger.error('[Market] Error fetching active posts:', error)
    next(error)
  }
})

// GET /sellers/me - Get seller profile by DID (query param)
router.get('/sellers/me', async (req, res, next) => {
  try {
    const did = req.query.did as string
    logger.info(`[Market] GET /sellers/me did=${did}`)
    if (!did) {
      return res.status(400).json({ success: false, error: 'did query parameter required' })
    }
    const seller = await marketService.getSellerProfile(did)
    logger.info(`[Market] Seller profile found: ${seller ? 'yes' : 'no'}`)
    res.json({ success: true, data: seller })
  } catch (error) {
    logger.error('[Market] Error fetching seller:', error)
    next(error)
  }
})

// Note: These routes use DID from request body/query for authorization
// In production, you'd want to verify the DID signature

// POST /sellers/apply - Apply to become a seller
router.post('/sellers/apply', async (req: any, res, next) => {
  try {
    logger.info(`[Market] POST /sellers/apply`, req.body)
    const result = await marketService.applyAsSeller(req.body)
    res.json({ success: true, data: result })
  } catch (error) {
    logger.error('[Market] Error applying as seller:', error)
    next(error)
  }
})

// POST /posts/submit - Submit a new product post
router.post('/posts/submit', async (req: any, res, next) => {
  try {
    logger.info(`[Market] POST /posts/submit`, req.body)
    const result = await marketService.createPost(req.body)
    res.json({ success: true, data: result })
  } catch (error) {
    logger.error('[Market] Error submitting post:', error)
    next(error)
  }
})

// PUT /posts/:id/inventory - Update inventory quantity
router.put('/posts/:id/inventory', async (req: any, res, next) => {
  try {
    logger.info(`[Market] PUT /posts/${req.params.id}/inventory`, req.body)
    const { did, quantity } = req.body
    const result = await marketService.updateInventory(req.params.id, did, quantity)
    res.json({ success: true, data: result })
  } catch (error) {
    logger.error('[Market] Error updating inventory:', error)
    next(error)
  }
})

// POST /posts/:id/sold - Record a sale
router.post('/posts/:id/sold', async (req: any, res, next) => {
  try {
    logger.info(`[Market] POST /posts/${req.params.id}/sold`, req.body)
    const { did, quantitySold } = req.body
    const result = await marketService.recordSale(req.params.id, did, quantitySold || 1)
    res.json({ success: true, data: result })
  } catch (error) {
    logger.error('[Market] Error recording sale:', error)
    next(error)
  }
})

// POST /posts/:id/archive - Archive a post
router.post('/posts/:id/archive', async (req: any, res, next) => {
  try {
    logger.info(`[Market] POST /posts/${req.params.id}/archive`, req.body)
    const { did } = req.body
    const result = await marketService.archivePost(req.params.id, did)
    res.json({ success: true, data: result })
  } catch (error) {
    logger.error('[Market] Error archiving post:', error)
    next(error)
  }
})

// DELETE /posts/:id - Delete a post
router.delete('/posts/:id', async (req: any, res, next) => {
  try {
    const did = req.query.did as string
    logger.info(`[Market] DELETE /posts/${req.params.id} did=${did}`)
    if (!did) {
      return res.status(400).json({ success: false, error: 'did query parameter required' })
    }
    const result = await marketService.deletePost(req.params.id, did)
    res.json({ success: true, data: { deleted: true } })
  } catch (error) {
    logger.error('[Market] Error deleting post:', error)
    next(error)
  }
})

// =============================================================================
// CHECKOUT CONFIG ROUTES
// =============================================================================

// GET /checkout-config - Get checkout config for a city (or global)
router.get('/checkout-config', async (req, res, next) => {
  try {
    const cityId = req.query.cityId as string | undefined
    logger.info(`[Market] GET /checkout-config cityId=${cityId || 'global'}`)
    const config = await marketService.getCheckoutConfig(cityId)
    res.json({ success: true, data: config })
  } catch (error) {
    logger.error('[Market] Error fetching checkout config:', error)
    next(error)
  }
})

// GET /checkout-config/all - Get all checkout configs (admin)
router.get('/checkout-config/all', async (req, res, next) => {
  try {
    logger.info('[Market] GET /checkout-config/all')
    const configs = await marketService.getAllCheckoutConfigs()
    res.json({ success: true, data: configs })
  } catch (error) {
    logger.error('[Market] Error fetching all checkout configs:', error)
    next(error)
  }
})

// PUT /checkout-config - Update or create checkout config (admin)
router.put('/checkout-config', async (req, res, next) => {
  try {
    logger.info('[Market] PUT /checkout-config', req.body)
    const { cityId, ...data } = req.body
    const config = await marketService.upsertCheckoutConfig(cityId ?? null, data)
    res.json({ success: true, data: config })
  } catch (error) {
    logger.error('[Market] Error updating checkout config:', error)
    next(error)
  }
})

// DELETE /checkout-config/:id - Delete city-specific checkout config (admin)
router.delete('/checkout-config/:id', async (req, res, next) => {
  try {
    logger.info(`[Market] DELETE /checkout-config/${req.params.id}`)
    await marketService.deleteCheckoutConfig(req.params.id)
    res.json({ success: true, data: { deleted: true } })
  } catch (error) {
    logger.error('[Market] Error deleting checkout config:', error)
    next(error)
  }
})

// =============================================================================
// PROMO CODE ROUTES
// =============================================================================

// GET /promo-codes - Get all promo codes (admin)
router.get('/promo-codes', async (req, res, next) => {
  try {
    const { cityId, isActive } = req.query
    logger.info('[Market] GET /promo-codes', { cityId, isActive })
    const promos = await marketService.getPromoCodes({
      cityId: cityId as string | undefined,
      isActive: isActive !== undefined ? isActive === 'true' : undefined
    })
    res.json({ success: true, data: promos })
  } catch (error) {
    logger.error('[Market] Error fetching promo codes:', error)
    next(error)
  }
})

// POST /promo-codes - Create promo code (admin)
router.post('/promo-codes', async (req, res, next) => {
  try {
    logger.info('[Market] POST /promo-codes', req.body)
    const promo = await marketService.createPromoCode(req.body)
    res.json({ success: true, data: promo })
  } catch (error) {
    logger.error('[Market] Error creating promo code:', error)
    next(error)
  }
})

// PUT /promo-codes/:id - Update promo code (admin)
router.put('/promo-codes/:id', async (req, res, next) => {
  try {
    logger.info(`[Market] PUT /promo-codes/${req.params.id}`, req.body)
    const promo = await marketService.updatePromoCode(req.params.id, req.body)
    res.json({ success: true, data: promo })
  } catch (error) {
    logger.error('[Market] Error updating promo code:', error)
    next(error)
  }
})

// DELETE /promo-codes/:id - Delete promo code (admin)
router.delete('/promo-codes/:id', async (req, res, next) => {
  try {
    logger.info(`[Market] DELETE /promo-codes/${req.params.id}`)
    await marketService.deletePromoCode(req.params.id)
    res.json({ success: true, data: { deleted: true } })
  } catch (error) {
    logger.error('[Market] Error deleting promo code:', error)
    next(error)
  }
})

// POST /promo-codes/validate - Validate promo code for checkout (public)
router.post('/promo-codes/validate', async (req, res, next) => {
  try {
    logger.info('[Market] POST /promo-codes/validate', req.body)
    const { code, userDid, cityId, orderSubtotal } = req.body

    if (!code || !userDid || orderSubtotal === undefined) {
      return res.status(400).json({
        success: false,
        error: 'code, userDid, and orderSubtotal are required'
      })
    }

    const result = await marketService.validatePromoCode({
      code,
      userDid,
      cityId,
      orderSubtotal
    })

    res.json({ success: true, data: result })
  } catch (error) {
    logger.error('[Market] Error validating promo code:', error)
    next(error)
  }
})

// POST /promo-codes/:id/record-usage - Record promo code usage after order
router.post('/promo-codes/:id/record-usage', async (req, res, next) => {
  try {
    logger.info(`[Market] POST /promo-codes/${req.params.id}/record-usage`, req.body)
    const { userDid, orderId, discountAmount } = req.body

    if (!userDid || discountAmount === undefined) {
      return res.status(400).json({
        success: false,
        error: 'userDid and discountAmount are required'
      })
    }

    await marketService.recordPromoUsage({
      promoCodeId: req.params.id,
      userDid,
      orderId,
      discountAmount
    })

    res.json({ success: true, data: { recorded: true } })
  } catch (error) {
    logger.error('[Market] Error recording promo usage:', error)
    next(error)
  }
})

export const marketRouter = router
