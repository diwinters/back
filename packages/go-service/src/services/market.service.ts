import { prisma, logger, AppError, ErrorCode, NotFoundError } from '@gominiapp/core'

export class MarketService {
  /**
   * Get all active categories with subcategories
   * If cityId is provided, returns categories that are:
   * 1. Global (isGlobal = true) - shown in all cities
   * 2. Enabled for this specific city via CategoryCity junction table
   * 
   * If no cityId is provided, returns all active categories (backward compatible)
   */
  async getCategories(cityId?: string) {
    logger.info(`[MarketService] Fetching categories${cityId ? ` for city ${cityId}` : ' (all)'}`)
    
    if (cityId) {
      // City-specific query: get global categories + categories enabled for this city
      const categories = await prisma.marketCategory.findMany({
        where: {
          isActive: true,
          OR: [
            // Global categories - shown everywhere
            { isGlobal: true },
            // City-specific categories - enabled for this city
            {
              cities: {
                some: {
                  cityId: cityId,
                  isActive: true
                }
              }
            }
          ]
        },
        include: {
          subcategories: {
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' }
          },
          cities: {
            where: { cityId: cityId },
            select: {
              isFeatured: true,
              sortOrder: true,
              isActive: true
            }
          },
          _count: {
            select: { posts: { where: { status: 'ACTIVE', isArchived: false, cityId: cityId } } }
          }
        },
        orderBy: { sortOrder: 'asc' }
      })
      
      // Transform to include per-city isFeatured and adjust post count
      const transformedCategories = categories.map(cat => {
        const cityConfig = cat.cities[0] // Will have at most 1 entry due to where clause
        return {
          ...cat,
          // Use city-specific isFeatured if available, otherwise false for global categories
          isFeatured: cityConfig?.isFeatured ?? false,
          // Use city-specific sortOrder if available, otherwise use global sortOrder
          sortOrder: cityConfig?.sortOrder ?? cat.sortOrder,
          // Remove the cities array from response (internal use only)
          cities: undefined
        }
      }).sort((a, b) => a.sortOrder - b.sortOrder) // Re-sort by potentially overridden sortOrder
      
      logger.info(`[MarketService] Found ${transformedCategories.length} categories for city ${cityId}`)
      return transformedCategories
    }
    
    // No city filter - return all active categories (backward compatible)
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
    
    // For backward compatibility, set isFeatured to false when no city context
    // (Featured is now per-city)
    const transformedCategories = categories.map(cat => ({
      ...cat,
      isFeatured: false // No city context = no featured categories
    }))
    
    logger.info(`[MarketService] Found ${transformedCategories.length} categories (all)`)
    return transformedCategories
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
    search?: string
    sortBy?: 'newest' | 'price_asc' | 'price_desc' | 'best_selling'
  }) {
    const page = params.page || 1
    const pageSize = params.pageSize || 20
    const skip = (page - 1) * pageSize

    logger.info(`[MarketService] Fetching active posts page=${page} pageSize=${pageSize} cityId=${params.cityId || 'all'} search=${params.search || 'none'}`)

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

    // Search filtering: case-insensitive search on title and description
    if (params.search && params.search.trim()) {
      const searchTerm = params.search.trim()
      where.OR = [
        { title: { contains: searchTerm, mode: 'insensitive' } },
        { description: { contains: searchTerm, mode: 'insensitive' } }
      ]
      logger.info(`[MarketService] Search filter: "${searchTerm}"`)
    }

    // Determine sort order
    let orderBy: any = { createdAt: 'desc' } // default: newest
    switch (params.sortBy) {
      case 'price_asc':
        orderBy = { price: 'asc' }
        break
      case 'price_desc':
        orderBy = { price: 'desc' }
        break
      case 'best_selling':
        orderBy = { soldCount: 'desc' }
        break
      case 'newest':
      default:
        orderBy = { createdAt: 'desc' }
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
        orderBy,
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
   * Get admin-curated best sellers for a city
   * Returns posts from MarketBestSeller table, ordered by sortOrder
   */
  async getCuratedBestSellers(cityId: string, limit: number = 10) {
    logger.info(`[MarketService] Fetching curated best sellers for city ${cityId} limit=${limit}`)

    const curatedEntries = await prisma.marketBestSeller.findMany({
      where: {
        cityId,
        isActive: true,
      },
      orderBy: { sortOrder: 'asc' },
      take: limit,
      include: {
        marketPost: {
          include: {
            seller: {
              include: {
                user: { select: { did: true, handle: true, displayName: true, avatarUrl: true } }
              }
            },
            category: true,
            subcategory: true
          }
        }
      }
    })

    logger.info(`[MarketService] Found ${curatedEntries.length} curated best sellers`)

    // Transform to return both the post data (if linked) and the postUri for Bluesky fetching
    const results = curatedEntries.map(entry => ({
      // If we have a linked MarketPost, include its data
      ...(entry.marketPost || {}),
      // Always include the Bluesky post URI so the app can fetch it
      postUri: entry.postUri,
      // Override title/price if curated entry has custom values
      ...(entry.title && { customTitle: entry.title }),
      ...(entry.price && { customPrice: entry.price }),
      // Include best seller entry id for reference
      bestSellerId: entry.id,
    }))

    return results
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
      throw new AppError('Promo code already exists', ErrorCode.BAD_REQUEST, 409)
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
        throw new AppError('Promo code already exists', ErrorCode.BAD_REQUEST, 409)
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

  // =============================================================================
  // SEARCH HISTORY & VISITED PRODUCTS
  // =============================================================================

  /**
   * Save a search query to user's history
   */
  async saveSearchHistory(params: {
    userDid: string
    query: string
    resultsCount?: number
  }) {
    logger.info(`[MarketService] Saving search history for user ${params.userDid}: "${params.query}"`)

    // Don't save empty queries or very short ones
    if (!params.query || params.query.trim().length < 2) {
      return null
    }

    return prisma.marketSearchHistory.create({
      data: {
        userDid: params.userDid,
        query: params.query.trim(),
        resultsCount: params.resultsCount ?? 0
      }
    })
  }

  /**
   * Get user's recent search history
   */
  async getSearchHistory(userDid: string, limit: number = 10) {
    logger.info(`[MarketService] Getting search history for user ${userDid}`)

    // Get unique recent searches (deduplicated)
    const searches = await prisma.marketSearchHistory.findMany({
      where: { userDid },
      orderBy: { createdAt: 'desc' },
      take: limit * 2, // Get more to filter duplicates
      select: {
        id: true,
        query: true,
        resultsCount: true,
        createdAt: true
      }
    })

    // Deduplicate by query (keep most recent)
    const uniqueSearches = searches.reduce((acc, search) => {
      if (!acc.some(s => s.query.toLowerCase() === search.query.toLowerCase())) {
        acc.push(search)
      }
      return acc
    }, [] as typeof searches)

    return uniqueSearches.slice(0, limit)
  }

  /**
   * Clear user's search history
   */
  async clearSearchHistory(userDid: string) {
    logger.info(`[MarketService] Clearing search history for user ${userDid}`)

    return prisma.marketSearchHistory.deleteMany({
      where: { userDid }
    })
  }

  /**
   * Delete a single search history entry
   */
  async deleteSearchHistoryItem(userDid: string, searchId: string) {
    logger.info(`[MarketService] Deleting search history item ${searchId} for user ${userDid}`)

    return prisma.marketSearchHistory.deleteMany({
      where: { 
        id: searchId,
        userDid // Ensure user owns this entry
      }
    })
  }

  /**
   * Track a product visit
   */
  async trackProductVisit(params: {
    userDid: string
    postId: string
  }) {
    logger.info(`[MarketService] Tracking product visit for user ${params.userDid}: ${params.postId}`)

    // Upsert: create or update visit count
    return prisma.marketVisitedProduct.upsert({
      where: {
        userDid_postId: {
          userDid: params.userDid,
          postId: params.postId
        }
      },
      create: {
        userDid: params.userDid,
        postId: params.postId,
        visitCount: 1
      },
      update: {
        visitCount: { increment: 1 },
        lastVisitedAt: new Date()
      }
    })
  }

  /**
   * Get user's recently visited products
   */
  async getVisitedProducts(userDid: string, limit: number = 10) {
    logger.info(`[MarketService] Getting visited products for user ${userDid}`)

    const visited = await prisma.marketVisitedProduct.findMany({
      where: { userDid },
      orderBy: { lastVisitedAt: 'desc' },
      take: limit,
      include: {
        post: {
          include: {
            seller: {
              include: {
                user: { select: { did: true, handle: true, displayName: true, avatarUrl: true } }
              }
            },
            category: true,
            subcategory: true
          }
        }
      }
    })

    // Filter out archived/inactive posts and return just the posts
    return visited
      .filter(v => v.post.status === 'ACTIVE' && !v.post.isArchived)
      .map(v => ({
        ...v.post,
        visitCount: v.visitCount,
        lastVisitedAt: v.lastVisitedAt
      }))
  }

  /**
   * Clear user's visited products history
   */
  async clearVisitedProducts(userDid: string) {
    logger.info(`[MarketService] Clearing visited products for user ${userDid}`)

    return prisma.marketVisitedProduct.deleteMany({
      where: { userDid }
    })
  }
}
