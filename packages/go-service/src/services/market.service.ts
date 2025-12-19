import { prisma, logger, AppError, ErrorCode, NotFoundError } from '@gominiapp/core'

export class MarketService {
  /**
   * Get all active categories with subcategories
   */
  async getCategories() {
    logger.info('[MarketService] Fetching categories')
    const categories = await prisma.marketCategory.findMany({
      where: { isActive: true },
      include: {
        subcategories: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' }
        },
        _count: {
          select: { posts: { where: { status: 'ACTIVE', isArchived: false } } }
        }
      },
      orderBy: { sortOrder: 'asc' }
    })
    logger.info(`[MarketService] Found ${categories.length} categories`)
    return categories
  }

  /**
   * Get active posts with pagination and filtering
   */
  async getActivePosts(params: {
    page?: number
    pageSize?: number
    categoryId?: string
    subcategoryId?: string
    cityId?: string
  }) {
    const page = params.page || 1
    const pageSize = params.pageSize || 20
    const skip = (page - 1) * pageSize

    logger.info(`[MarketService] Fetching active posts page=${page} pageSize=${pageSize} cityId=${params.cityId || 'all'}`)

    const where: any = {
      status: 'ACTIVE',
      isArchived: false,
      isInStock: true
    }

    if (params.categoryId) where.categoryId = params.categoryId
    if (params.subcategoryId) where.subcategoryId = params.subcategoryId
    
    // City filtering: STRICT - only posts for this specific city when specified
    // Posts with cityId=null will NOT show when a city is selected
    if (params.cityId) {
      where.cityId = params.cityId
      logger.info(`[MarketService] Filtering by cityId: ${params.cityId} (STRICT - no null cityId posts)`)
    } else {
      // When no city filter, show all posts (including those with null cityId)
      logger.info(`[MarketService] No city filter - showing all posts`)
    }

    logger.info(`[MarketService] Query where: ${JSON.stringify(where)}`)

    const [posts, total] = await Promise.all([
      prisma.marketPost.findMany({
        where,
        include: {
          seller: {
            include: {
              user: { select: { did: true, handle: true, displayName: true, avatarUrl: true } }
            }
          },
          category: true,
          subcategory: true
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize
      }),
      prisma.marketPost.count({ where })
    ])

    logger.info(`[MarketService] Found ${posts.length} posts (Total: ${total})`)

    return {
      data: posts,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize)
      }
    }
  }

  /**
   * Helper to find user by DID
   */
  private async findUserByDid(did: string) {
    return prisma.user.findUnique({ where: { did } })
  }

  /**
   * Helper to find seller by user's DID
   */
  private async findSellerByDid(did: string) {
    const user = await this.findUserByDid(did)
    if (!user) return null
    return prisma.marketSeller.findUnique({
      where: { userId: user.id },
      include: {
        user: { select: { did: true, handle: true, displayName: true, avatarUrl: true } },
        posts: {
          where: { isArchived: false },
          orderBy: { createdAt: 'desc' }
        }
      }
    })
  }

  /**
   * Get seller profile by DID
   */
  async getSellerProfile(did: string) {
    return this.findSellerByDid(did)
  }

  /**
   * Apply to become a seller
   */
  async applyAsSeller(data: {
    did: string
    storeName: string
    storeDescription?: string
    contactPhone?: string
    contactEmail?: string
  }) {
    // Find or create user
    let user = await this.findUserByDid(data.did)
    if (!user) {
      user = await prisma.user.create({
        data: { did: data.did }
      })
    }

    // Check if seller already exists
    const existing = await prisma.marketSeller.findUnique({
      where: { userId: user.id }
    })

    if (existing) {
      if (existing.status === 'REJECTED') {
        // Re-apply
        return prisma.marketSeller.update({
          where: { userId: user.id },
          data: {
            status: 'PENDING',
            storeName: data.storeName,
            storeDescription: data.storeDescription,
            contactPhone: data.contactPhone,
            contactEmail: data.contactEmail,
            rejectionReason: null
          }
        })
      }
      return existing
    }

    return prisma.marketSeller.create({
      data: {
        userId: user.id,
        storeName: data.storeName,
        storeDescription: data.storeDescription,
        contactPhone: data.contactPhone,
        contactEmail: data.contactEmail,
        status: 'PENDING'
      }
    })
  }

  /**
   * Create a new product post
   */
  async createPost(data: {
    did: string
    postUri: string
    postCid: string
    categoryId: string
    subcategoryId?: string
    cityId?: string
    title: string
    description?: string
    price?: number
    currency?: string
    quantity?: number
  }) {
    // Find seller by DID
    const seller = await this.findSellerByDid(data.did)

    if (!seller || seller.status !== 'APPROVED') {
      throw new AppError('Seller not approved', ErrorCode.FORBIDDEN, 403)
    }

    return prisma.marketPost.create({
      data: {
        sellerId: seller.id,
        postUri: data.postUri,
        postCid: data.postCid,
        categoryId: data.categoryId,
        subcategoryId: data.subcategoryId,
        cityId: data.cityId,  // Link product to city
        title: data.title,
        description: data.description,
        price: data.price,
        currency: data.currency || 'MAD',
        quantity: data.quantity ?? 1,
        status: 'ACTIVE', // Auto-approve for now
        isInStock: (data.quantity ?? 1) > 0
      }
    })
  }

  /**
   * Helper to verify post ownership
   */
  private async verifyPostOwnership(postId: string, did: string) {
    const post = await prisma.marketPost.findUnique({
      where: { id: postId },
      include: {
        seller: {
          include: { user: { select: { did: true } } }
        }
      }
    })

    if (!post) throw new NotFoundError('Post not found')
    if (post.seller.user.did !== did) {
      throw new AppError('Not authorized', ErrorCode.FORBIDDEN, 403)
    }

    return post
  }

  /**
   * Update inventory
   */
  async updateInventory(postId: string, did: string, quantity: number) {
    await this.verifyPostOwnership(postId, did)

    return prisma.marketPost.update({
      where: { id: postId },
      data: {
        quantity,
        isInStock: quantity > 0
      }
    })
  }

  /**
   * Record a sale
   */
  async recordSale(postId: string, did: string, quantitySold: number) {
    const post = await this.verifyPostOwnership(postId, did)

    const newQuantity = Math.max(0, post.quantity - quantitySold)

    return prisma.marketPost.update({
      where: { id: postId },
      data: {
        quantity: newQuantity,
        soldCount: { increment: quantitySold },
        isInStock: newQuantity > 0
      }
    })
  }

  /**
   * Archive a post
   */
  async archivePost(postId: string, did: string) {
    await this.verifyPostOwnership(postId, did)

    return prisma.marketPost.update({
      where: { id: postId },
      data: { isArchived: true }
    })
  }

  /**
   * Delete a post (soft delete via archive or mark as REMOVED)
   */
  async deletePost(postId: string, did: string) {
    await this.verifyPostOwnership(postId, did)

    return prisma.marketPost.update({
      where: { id: postId },
      data: { status: 'REMOVED', isArchived: true }
    })
  }

  // ===========================================================================
  // CHECKOUT CONFIG (City-specific or global)
  // ===========================================================================

  /**
   * Get checkout config for a city (falls back to global if no city-specific config)
   */
  async getCheckoutConfig(cityId?: string) {
    logger.info(`[MarketService] Getting checkout config for cityId=${cityId || 'global'}`)

    // Try city-specific config first
    if (cityId) {
      const cityConfig = await prisma.checkoutConfig.findUnique({
        where: { cityId }
      })
      if (cityConfig) {
        logger.info(`[MarketService] Found city-specific checkout config`)
        return cityConfig
      }
    }

    // Fall back to global config (cityId = null)
    let globalConfig = await prisma.checkoutConfig.findFirst({
      where: { cityId: null }
    })

    // Create default global config if none exists
    if (!globalConfig) {
      logger.info(`[MarketService] Creating default global checkout config`)
      globalConfig = await prisma.checkoutConfig.create({
        data: {
          cityId: null,
          defaultShippingFee: 15,
          codEnabled: true,
          codFeeEnabled: true,
          codFeeAmount: 5,
          walletEnabled: true,
          cardEnabled: true,
          requireFullName: true,
          requirePhone: true,
          requireStreet: true,
          requireCity: true,
          defaultCountry: 'Morocco'
        }
      })
    }

    return globalConfig
  }

  /**
   * Update or create checkout config (admin only)
   */
  async upsertCheckoutConfig(cityId: string | null, data: {
    defaultShippingFee?: number
    freeShippingThreshold?: number | null
    codEnabled?: boolean
    codFeeEnabled?: boolean
    codFeeAmount?: number
    codFeeType?: string
    walletEnabled?: boolean
    cardEnabled?: boolean
    requireFullName?: boolean
    requirePhone?: boolean
    requireStreet?: boolean
    requireCity?: boolean
    requireState?: boolean
    requirePostalCode?: boolean
    requireCountry?: boolean
    defaultCountry?: string
    minOrderAmount?: number | null
    maxOrderAmount?: number | null
  }) {
    logger.info(`[MarketService] Upserting checkout config for cityId=${cityId || 'global'}`)

    // For global config, we need to find or create by cityId=null
    if (cityId === null) {
      const existing = await prisma.checkoutConfig.findFirst({
        where: { cityId: null }
      })

      if (existing) {
        return prisma.checkoutConfig.update({
          where: { id: existing.id },
          data
        })
      }

      return prisma.checkoutConfig.create({
        data: { cityId: null, ...data }
      })
    }

    // For city-specific, use upsert
    return prisma.checkoutConfig.upsert({
      where: { cityId },
      update: data,
      create: { cityId, ...data }
    })
  }

  /**
   * Get all checkout configs (for admin listing)
   */
  async getAllCheckoutConfigs() {
    return prisma.checkoutConfig.findMany({
      include: { city: { select: { id: true, name: true, code: true } } },
      orderBy: [{ cityId: 'asc' }]
    })
  }

  /**
   * Delete city-specific checkout config (reverts to global)
   */
  async deleteCheckoutConfig(configId: string) {
    const config = await prisma.checkoutConfig.findUnique({
      where: { id: configId }
    })

    if (!config) throw new NotFoundError('Checkout config not found')
    if (!config.cityId) {
      throw new AppError('Cannot delete global checkout config', ErrorCode.BAD_REQUEST, 400)
    }

    return prisma.checkoutConfig.delete({ where: { id: configId } })
  }

  // ===========================================================================
  // PROMO CODES
  // ===========================================================================

  /**
   * Get all promo codes (admin)
   */
  async getPromoCodes(params?: { cityId?: string; isActive?: boolean }) {
    const where: any = {}
    if (params?.cityId !== undefined) where.cityId = params.cityId || null
    if (params?.isActive !== undefined) where.isActive = params.isActive

    return prisma.promoCode.findMany({
      where,
      include: {
        city: { select: { id: true, name: true, code: true } },
        _count: { select: { usages: true } }
      },
      orderBy: { createdAt: 'desc' }
    })
  }

  /**
   * Create promo code (admin)
   */
  async createPromoCode(data: {
    code: string
    cityId?: string | null
    type: 'PERCENTAGE' | 'FIXED' | 'FREE_SHIPPING'
    value?: number
    minOrderAmount?: number | null
    maxDiscount?: number | null
    maxTotalUses?: number | null
    maxUsesPerUser?: number
    validFrom?: Date | null
    validUntil?: Date | null
    isActive?: boolean
    description?: string | null
  }) {
    logger.info(`[MarketService] Creating promo code: ${data.code}`)

    // Check if code already exists
    const existing = await prisma.promoCode.findUnique({
      where: { code: data.code.toUpperCase() }
    })

    if (existing) {
      throw new AppError('Promo code already exists', ErrorCode.CONFLICT, 409)
    }

    return prisma.promoCode.create({
      data: {
        code: data.code.toUpperCase(),
        cityId: data.cityId || null,
        type: data.type,
        value: data.value || 0,
        minOrderAmount: data.minOrderAmount,
        maxDiscount: data.maxDiscount,
        maxTotalUses: data.maxTotalUses,
        maxUsesPerUser: data.maxUsesPerUser ?? 1,
        validFrom: data.validFrom,
        validUntil: data.validUntil,
        isActive: data.isActive ?? true,
        description: data.description
      }
    })
  }

  /**
   * Update promo code (admin)
   */
  async updatePromoCode(promoId: string, data: {
    code?: string
    cityId?: string | null
    type?: 'PERCENTAGE' | 'FIXED' | 'FREE_SHIPPING'
    value?: number
    minOrderAmount?: number | null
    maxDiscount?: number | null
    maxTotalUses?: number | null
    maxUsesPerUser?: number
    validFrom?: Date | null
    validUntil?: Date | null
    isActive?: boolean
    description?: string | null
  }) {
    logger.info(`[MarketService] Updating promo code: ${promoId}`)

    const existing = await prisma.promoCode.findUnique({ where: { id: promoId } })
    if (!existing) throw new NotFoundError('Promo code not found')

    // If code is being changed, check uniqueness
    if (data.code && data.code.toUpperCase() !== existing.code) {
      const duplicate = await prisma.promoCode.findUnique({
        where: { code: data.code.toUpperCase() }
      })
      if (duplicate) {
        throw new AppError('Promo code already exists', ErrorCode.CONFLICT, 409)
      }
    }

    return prisma.promoCode.update({
      where: { id: promoId },
      data: {
        ...data,
        code: data.code?.toUpperCase()
      }
    })
  }

  /**
   * Delete promo code (admin)
   */
  async deletePromoCode(promoId: string) {
    const existing = await prisma.promoCode.findUnique({ where: { id: promoId } })
    if (!existing) throw new NotFoundError('Promo code not found')

    return prisma.promoCode.delete({ where: { id: promoId } })
  }

  /**
   * Validate promo code for checkout (public)
   */
  async validatePromoCode(params: {
    code: string
    userDid: string
    cityId?: string
    orderSubtotal: number
  }): Promise<{
    valid: boolean
    error?: string
    promo?: {
      id: string
      code: string
      type: string
      value: number
      maxDiscount?: number | null
    }
    discount: number
  }> {
    const { code, userDid, cityId, orderSubtotal } = params
    logger.info(`[MarketService] Validating promo code: ${code} for user: ${userDid}`)

    const promo = await prisma.promoCode.findUnique({
      where: { code: code.toUpperCase() },
      include: {
        usages: { where: { userDid } }
      }
    })

    // Check if promo exists
    if (!promo) {
      return { valid: false, error: 'Invalid promo code', discount: 0 }
    }

    // Check if active
    if (!promo.isActive) {
      return { valid: false, error: 'This promo code is no longer active', discount: 0 }
    }

    // Check city restriction
    if (promo.cityId && cityId && promo.cityId !== cityId) {
      return { valid: false, error: 'This promo code is not valid in your city', discount: 0 }
    }

    // Check validity period
    const now = new Date()
    if (promo.validFrom && now < promo.validFrom) {
      return { valid: false, error: 'This promo code is not yet active', discount: 0 }
    }
    if (promo.validUntil && now > promo.validUntil) {
      return { valid: false, error: 'This promo code has expired', discount: 0 }
    }

    // Check total usage limit
    if (promo.maxTotalUses && promo.totalUsedCount >= promo.maxTotalUses) {
      return { valid: false, error: 'This promo code has reached its usage limit', discount: 0 }
    }

    // Check per-user usage limit
    if (promo.usages.length >= promo.maxUsesPerUser) {
      return { valid: false, error: 'You have already used this promo code', discount: 0 }
    }

    // Check minimum order amount
    if (promo.minOrderAmount && orderSubtotal < promo.minOrderAmount) {
      return {
        valid: false,
        error: `Minimum order of ${promo.minOrderAmount} MAD required for this promo`,
        discount: 0
      }
    }

    // Calculate discount
    let discount = 0
    switch (promo.type) {
      case 'PERCENTAGE':
        discount = Math.round(orderSubtotal * (promo.value / 100))
        if (promo.maxDiscount && discount > promo.maxDiscount) {
          discount = promo.maxDiscount
        }
        break
      case 'FIXED':
        discount = promo.value
        break
      case 'FREE_SHIPPING':
        // Caller should handle this by setting shipping to 0
        discount = 0 // Will be handled as free shipping
        break
    }

    return {
      valid: true,
      promo: {
        id: promo.id,
        code: promo.code,
        type: promo.type,
        value: promo.value,
        maxDiscount: promo.maxDiscount
      },
      discount
    }
  }

  /**
   * Record promo code usage (called after successful order)
   */
  async recordPromoUsage(params: {
    promoCodeId: string
    userDid: string
    orderId?: string
    discountAmount: number
  }) {
    logger.info(`[MarketService] Recording promo usage: ${params.promoCodeId} for user: ${params.userDid}`)

    // Create usage record
    await prisma.promoCodeUsage.create({
      data: {
        promoCodeId: params.promoCodeId,
        userDid: params.userDid,
        orderId: params.orderId,
        discountAmount: params.discountAmount
      }
    })

    // Increment total usage count
    await prisma.promoCode.update({
      where: { id: params.promoCodeId },
      data: { totalUsedCount: { increment: 1 } }
    })
  }
}
