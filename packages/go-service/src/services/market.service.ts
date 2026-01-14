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
    // Service-specific fields (when listingType = SERVICE)
    duration?: number
    durationUnit?: string
    pricingType?: string
    minGuests?: number
    maxGuests?: number
    bookingLeadTime?: number
    serviceLocation?: string
    serviceLatitude?: number
    serviceLongitude?: number
    includedItems?: string[]
  }) {
    // Find seller by DID
    const seller = await this.findSellerByDid(data.did)

    if (!seller || seller.status !== 'APPROVED') {
      throw new AppError('Seller not approved', ErrorCode.FORBIDDEN, 403)
    }

    // Get category to determine listing type
    const category = await prisma.marketCategory.findUnique({
      where: { id: data.categoryId },
      select: { listingType: true }
    })

    if (!category) {
      throw new NotFoundError('Category not found')
    }

    const listingType = category.listingType
    const isServiceListing = listingType === 'SERVICE'

    // Build the base data object
    const createData: any = {
      sellerId: seller.id,
      postUri: data.postUri,
      postCid: data.postCid,
      categoryId: data.categoryId,
      subcategoryId: data.subcategoryId || null,
      cityId: data.cityId || null,
      listingType,
      title: data.title,
      description: data.description || null,
      price: data.price || null,
      currency: data.currency || 'MAD',
      quantity: isServiceListing ? 1 : (data.quantity ?? 1),
      status: 'ACTIVE',
      isInStock: isServiceListing ? true : (data.quantity ?? 1) > 0,
    }

    // Add service-specific fields if it's a service listing
    if (isServiceListing) {
      createData.duration = data.duration || null
      createData.durationUnit = data.durationUnit || null
      createData.pricingType = data.pricingType || 'FLAT'
      createData.minGuests = data.minGuests || null
      createData.maxGuests = data.maxGuests || null
      createData.bookingLeadTime = data.bookingLeadTime || null
      createData.serviceLocation = data.serviceLocation || null
      createData.serviceLatitude = data.serviceLatitude || null
      createData.serviceLongitude = data.serviceLongitude || null
      createData.includedItems = data.includedItems ? JSON.stringify(data.includedItems) : null
    }

    return prisma.marketPost.create({
      data: createData
    })
  }

  /**
   * Helper to verify post ownership
   */
  private async verifyPostOwnership(postId: string, did: string) {
    logger.info(`[MarketService] verifyPostOwnership postId=${postId}, did=${did}`)
    
    const post = await prisma.marketPost.findUnique({
      where: { id: postId },
      include: {
        seller: {
          include: { user: { select: { did: true } } }
        }
      }
    })

    logger.info(`[MarketService] Post ownership check:`, {
      found: !!post,
      postSellerId: post?.sellerId,
      sellerUserId: post?.seller?.userId,
      sellerUserDid: post?.seller?.user?.did,
      matchesDid: post?.seller?.user?.did === did
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

  // ============================================================================
  // SERVICE AVAILABILITY (Calendar/Booking Management)
  // ============================================================================

  /**
   * Get availability slots for a service
   */
  async getServiceAvailability(postId: string, params: {
    startDate?: string  // ISO date string
    endDate?: string    // ISO date string
  } = {}) {
    logger.info(`[MarketService] Getting availability for post ${postId}`)

    const where: any = { postId }
    
    if (params.startDate || params.endDate) {
      where.date = {}
      if (params.startDate) {
        where.date.gte = new Date(params.startDate)
      }
      if (params.endDate) {
        where.date.lte = new Date(params.endDate)
      }
    } else {
      // Default: next 30 days
      const now = new Date()
      where.date = {
        gte: now,
        lte: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
      }
    }

    return prisma.serviceAvailability.findMany({
      where,
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }]
    })
  }

  /**
   * Create/update availability slots for a service
   */
  async setServiceAvailability(postId: string, did: string, slots: Array<{
    date: string         // ISO date string (YYYY-MM-DD)
    startTime?: string   // HH:mm format
    endTime?: string     // HH:mm format
    totalSlots?: number
    priceOverride?: number
    isAvailable?: boolean
  }>) {
    // Verify ownership
    await this.verifyPostOwnership(postId, did)

    logger.info(`[MarketService] Setting ${slots.length} availability slots for post ${postId}`)

    const results = []
    
    for (const slot of slots) {
      const date = new Date(slot.date)
      
      const result = await prisma.serviceAvailability.upsert({
        where: {
          postId_date_startTime: {
            postId,
            date,
            startTime: slot.startTime || null
          }
        },
        create: {
          postId,
          date,
          startTime: slot.startTime || null,
          endTime: slot.endTime || null,
          totalSlots: slot.totalSlots ?? 1,
          priceOverride: slot.priceOverride || null,
          isAvailable: slot.isAvailable ?? true
        },
        update: {
          endTime: slot.endTime || null,
          totalSlots: slot.totalSlots ?? 1,
          priceOverride: slot.priceOverride || null,
          isAvailable: slot.isAvailable ?? true
        }
      })
      
      results.push(result)
    }

    return results
  }

  /**
   * Delete availability slots
   */
  async deleteServiceAvailability(postId: string, did: string, slotIds: string[]) {
    // Verify ownership
    await this.verifyPostOwnership(postId, did)

    logger.info(`[MarketService] Deleting ${slotIds.length} availability slots for post ${postId}`)

    return prisma.serviceAvailability.deleteMany({
      where: {
        id: { in: slotIds },
        postId
      }
    })
  }

  /**
   * Bulk generate availability slots for a date range
   */
  async generateAvailabilitySlots(postId: string, did: string, params: {
    startDate: string    // ISO date string (YYYY-MM-DD)
    endDate: string      // ISO date string (YYYY-MM-DD)
    startTime?: string   // HH:mm - daily start time
    endTime?: string     // HH:mm - daily end time
    slotDuration?: number // Minutes per slot
    totalSlotsPerSlot?: number
    excludeDays?: number[] // 0=Sunday, 6=Saturday
  }) {
    // Verify ownership
    await this.verifyPostOwnership(postId, did)

    logger.info(`[MarketService] Generating availability slots for post ${postId}`)

    const slots: Array<{
      date: string
      startTime?: string
      endTime?: string
      totalSlots: number
    }> = []

    const start = new Date(params.startDate)
    const end = new Date(params.endDate)
    const excludeDays = params.excludeDays || []

    // Iterate through each day
    for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
      // Skip excluded days
      if (excludeDays.includes(date.getDay())) {
        continue
      }

      const dateStr = date.toISOString().split('T')[0]

      if (params.startTime && params.endTime && params.slotDuration) {
        // Generate time slots
        const [startHour, startMin] = params.startTime.split(':').map(Number)
        const [endHour, endMin] = params.endTime.split(':').map(Number)
        const startMinutes = startHour * 60 + startMin
        const endMinutes = endHour * 60 + endMin

        for (let mins = startMinutes; mins < endMinutes; mins += params.slotDuration) {
          const slotStart = `${Math.floor(mins / 60).toString().padStart(2, '0')}:${(mins % 60).toString().padStart(2, '0')}`
          const slotEndMins = mins + params.slotDuration
          const slotEnd = `${Math.floor(slotEndMins / 60).toString().padStart(2, '0')}:${(slotEndMins % 60).toString().padStart(2, '0')}`

          slots.push({
            date: dateStr,
            startTime: slotStart,
            endTime: slotEnd,
            totalSlots: params.totalSlotsPerSlot ?? 1
          })
        }
      } else {
        // Single slot per day
        slots.push({
          date: dateStr,
          startTime: params.startTime,
          endTime: params.endTime,
          totalSlots: params.totalSlotsPerSlot ?? 1
        })
      }
    }

    // Create all slots
    return this.setServiceAvailability(postId, did, slots)
  }

  /**
   * Book a slot (increment bookedSlots)
   */
  async bookSlot(slotId: string, quantity: number = 1) {
    const slot = await prisma.serviceAvailability.findUnique({
      where: { id: slotId }
    })

    if (!slot) {
      throw new NotFoundError('Availability slot not found')
    }

    if (!slot.isAvailable) {
      throw new AppError('Slot is not available', ErrorCode.BAD_REQUEST, 400)
    }

    const availableSlots = slot.totalSlots - slot.bookedSlots
    if (quantity > availableSlots) {
      throw new AppError(`Only ${availableSlots} slots available`, ErrorCode.BAD_REQUEST, 400)
    }

    return prisma.serviceAvailability.update({
      where: { id: slotId },
      data: {
        bookedSlots: { increment: quantity }
      }
    })
  }

  /**
   * Cancel a booking (decrement bookedSlots) - DEPRECATED: Use cancelServiceBooking instead
   */
  async cancelBooking(slotId: string, quantity: number = 1) {
    return prisma.serviceAvailability.update({
      where: { id: slotId },
      data: {
        bookedSlots: { decrement: quantity }
      }
    })
  }

  // =============================================================================
  // SERVICE BOOKING MANAGEMENT (New comprehensive booking system)
  // =============================================================================

  /**
   * Create a service booking with full tracking
   */
  async createServiceBooking(data: {
    serviceAvailabilityId: string
    userDid: string
    guestCount?: number
    customerName?: string
    customerPhone?: string
    customerEmail?: string
    specialRequests?: string
    orderItemId?: string
    paymentMethod?: 'PAY_ON_ARRIVAL' | 'PREPAID'
  }) {
    // Get the slot with post info for pricing
    const slot = await prisma.serviceAvailability.findUnique({
      where: { id: data.serviceAvailabilityId },
      include: {
        post: {
          select: {
            id: true,
            sellerId: true,
            price: true,
            currency: true,
            pricingType: true,
            title: true
          }
        }
      }
    })

    if (!slot) {
      throw new NotFoundError('Availability slot not found')
    }

    if (!slot.isAvailable) {
      throw new AppError('Slot is not available for booking', ErrorCode.BAD_REQUEST, 400)
    }

    const guestCount = data.guestCount || 1
    const availableSlots = slot.totalSlots - slot.bookedSlots
    
    if (guestCount > availableSlots) {
      throw new AppError(`Only ${availableSlots} spots available`, ErrorCode.BAD_REQUEST, 400)
    }

    // Calculate total price based on pricing type
    let totalPrice: number
    const basePrice = slot.priceOverride ?? slot.post.price ?? 0
    
    switch (slot.post.pricingType) {
      case 'PER_PERSON':
        totalPrice = basePrice * guestCount
        break
      case 'HOURLY':
        // For hourly, we'd need duration info; for now, use base price
        totalPrice = basePrice
        break
      case 'FLAT':
      default:
        totalPrice = basePrice
    }

    // Create booking within a transaction
    return prisma.$transaction(async (tx) => {
      // Increment booked slots
      await tx.serviceAvailability.update({
        where: { id: data.serviceAvailabilityId },
        data: { bookedSlots: { increment: guestCount } }
      })

      // Create the booking record
      const booking = await tx.serviceBooking.create({
        data: {
          serviceAvailabilityId: data.serviceAvailabilityId,
          userDid: data.userDid,
          guestCount,
          totalPrice,
          currency: slot.post.currency || 'MAD',
          paymentMethod: data.paymentMethod || 'PAY_ON_ARRIVAL',
          status: 'PENDING',
          customerName: data.customerName,
          customerPhone: data.customerPhone,
          customerEmail: data.customerEmail,
          specialRequests: data.specialRequests,
          orderItemId: data.orderItemId,
        },
        include: {
          serviceAvailability: {
            include: {
              post: {
                select: { id: true, title: true, sellerId: true }
              }
            }
          }
        }
      })

      return booking
    })
  }

  /**
   * Get a single booking by ID
   */
  async getServiceBooking(bookingId: string) {
    return prisma.serviceBooking.findUnique({
      where: { id: bookingId },
      include: {
        serviceAvailability: {
          include: {
            post: {
              select: {
                id: true,
                title: true,
                price: true,
                currency: true,
                sellerId: true,
                serviceLocation: true,
                duration: true,
                durationUnit: true,
                seller: {
                  select: { storeName: true, userId: true, user: { select: { did: true } } }
                }
              }
            }
          }
        }
      }
    })
  }

  /**
   * Get all bookings for a user (buyer view)
   */
  async getUserBookings(userDid: string, options?: {
    status?: string
    upcoming?: boolean
    page?: number
    pageSize?: number
  }) {
    const page = options?.page || 1
    const pageSize = options?.pageSize || 20

    const where: any = { userDid }
    
    if (options?.status) {
      where.status = options.status
    }

    if (options?.upcoming) {
      where.serviceAvailability = {
        date: { gte: new Date() }
      }
      where.status = { in: ['PENDING', 'CONFIRMED'] }
    }

    const [bookings, total] = await Promise.all([
      prisma.serviceBooking.findMany({
        where,
        include: {
          serviceAvailability: {
            include: {
              post: {
                select: {
                  id: true,
                  title: true,
                  price: true,
                  currency: true,
                  postUri: true,
                  serviceLocation: true,
                  duration: true,
                  durationUnit: true,
                  seller: {
                    select: { storeName: true, userId: true, user: { select: { did: true } } }
                  }
                }
              }
            }
          }
        },
        orderBy: [
          { serviceAvailability: { date: 'asc' } },
          { createdAt: 'desc' }
        ],
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      prisma.serviceBooking.count({ where })
    ])

    return { data: bookings, total, page, pageSize }
  }

  /**
   * Get ALL bookings across all seller's services (for seller dashboard)
   */
  async getAllSellerBookings(sellerDid: string, options?: {
    status?: string
    page?: number
    pageSize?: number
  }) {
    logger.info(`[MarketService] getAllSellerBookings for seller ${sellerDid}`)
    
    // Find seller
    const seller = await prisma.marketSeller.findFirst({
      where: { user: { did: sellerDid } },
      select: { id: true }
    })
    
    if (!seller) {
      return { data: [], total: 0, page: 1, pageSize: 20 }
    }

    const page = options?.page || 1
    const pageSize = options?.pageSize || 50

    // Find all bookings for services owned by this seller
    const where: any = {
      serviceAvailability: {
        post: {
          sellerId: seller.id
        }
      }
    }

    if (options?.status) {
      where.status = options.status
    }

    const [bookings, total] = await Promise.all([
      prisma.serviceBooking.findMany({
        where,
        include: {
          serviceAvailability: {
            include: {
              post: {
                select: {
                  id: true,
                  title: true,
                  price: true,
                  currency: true,
                  postUri: true,
                  serviceLocation: true,
                }
              }
            }
          }
        },
        orderBy: [
          { createdAt: 'desc' },
          { serviceAvailability: { date: 'asc' } }
        ],
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      prisma.serviceBooking.count({ where })
    ])

    logger.info(`[MarketService] Found ${total} bookings for seller ${sellerDid}`)
    return { data: bookings, total, page, pageSize }
  }

  /**
   * Get all bookings for a seller's service post
   */
  async getSellerBookings(postId: string, sellerDid: string, options?: {
    date?: string
    status?: string
    page?: number
    pageSize?: number
  }) {
    // Verify ownership
    const post = await prisma.marketPost.findFirst({
      where: { id: postId, seller: { user: { did: sellerDid } } }
    })
    
    if (!post) {
      throw new NotFoundError('Service post not found or not owned by seller')
    }

    const page = options?.page || 1
    const pageSize = options?.pageSize || 50

    const where: any = {
      serviceAvailability: { postId }
    }

    if (options?.date) {
      where.serviceAvailability.date = new Date(options.date)
    }

    if (options?.status) {
      where.status = options.status
    }

    const [bookings, total] = await Promise.all([
      prisma.serviceBooking.findMany({
        where,
        include: {
          serviceAvailability: true
        },
        orderBy: [
          { serviceAvailability: { date: 'asc' } },
          { serviceAvailability: { startTime: 'asc' } }
        ],
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      prisma.serviceBooking.count({ where })
    ])

    return { data: bookings, total, page, pageSize }
  }

  /**
   * Confirm a booking (seller action)
   */
  async confirmServiceBooking(bookingId: string, sellerDid: string) {
    const booking = await prisma.serviceBooking.findUnique({
      where: { id: bookingId },
      include: {
        serviceAvailability: {
          include: { post: { include: { seller: { include: { user: true } } } } }
        }
      }
    })

    if (!booking) {
      throw new NotFoundError('Booking not found')
    }

    if (booking.serviceAvailability.post.seller.user.did !== sellerDid) {
      throw new AppError('Not authorized to confirm this booking', ErrorCode.FORBIDDEN, 403)
    }

    if (booking.status !== 'PENDING') {
      throw new AppError('Booking is not in pending status', ErrorCode.BAD_REQUEST, 400)
    }

    return prisma.serviceBooking.update({
      where: { id: bookingId },
      data: {
        status: 'CONFIRMED',
        confirmedAt: new Date()
      }
    })
  }

  /**
   * Cancel a service booking (no refund policy)
   */
  async cancelServiceBooking(bookingId: string, cancelledByDid: string, reason?: string) {
    const booking = await prisma.serviceBooking.findUnique({
      where: { id: bookingId },
      include: {
        serviceAvailability: {
          include: { post: { include: { seller: { include: { user: true } } } } }
        }
      }
    })

    if (!booking) {
      throw new NotFoundError('Booking not found')
    }

    // Check if user is authorized (buyer or seller)
    const isBuyer = booking.userDid === cancelledByDid
    const isSeller = booking.serviceAvailability.post.seller.user.did === cancelledByDid

    if (!isBuyer && !isSeller) {
      throw new AppError('Not authorized to cancel this booking', ErrorCode.FORBIDDEN, 403)
    }

    if (['CANCELLED', 'COMPLETED', 'NO_SHOW'].includes(booking.status)) {
      throw new AppError('Booking cannot be cancelled', ErrorCode.BAD_REQUEST, 400)
    }

    // Cancel booking and free up slots
    return prisma.$transaction(async (tx) => {
      await tx.serviceAvailability.update({
        where: { id: booking.serviceAvailabilityId },
        data: { bookedSlots: { decrement: booking.guestCount } }
      })

      return tx.serviceBooking.update({
        where: { id: bookingId },
        data: {
          status: 'CANCELLED',
          cancelledBy: cancelledByDid,
          cancellationReason: reason || (isBuyer ? 'Cancelled by customer' : 'Cancelled by seller'),
          cancelledAt: new Date()
        }
      })
    })
  }

  /**
   * Mark booking as completed (seller action after service delivery)
   */
  async completeServiceBooking(bookingId: string, sellerDid: string) {
    const booking = await prisma.serviceBooking.findUnique({
      where: { id: bookingId },
      include: {
        serviceAvailability: {
          include: { post: { include: { seller: { include: { user: true } } } } }
        }
      }
    })

    if (!booking) {
      throw new NotFoundError('Booking not found')
    }

    if (booking.serviceAvailability.post.seller.user.did !== sellerDid) {
      throw new AppError('Not authorized', ErrorCode.FORBIDDEN, 403)
    }

    if (booking.status !== 'CONFIRMED') {
      throw new AppError('Booking must be confirmed first', ErrorCode.BAD_REQUEST, 400)
    }

    return prisma.serviceBooking.update({
      where: { id: bookingId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date()
      }
    })
  }

  /**
   * Mark as no-show (seller action)
   */
  async markBookingNoShow(bookingId: string, sellerDid: string) {
    const booking = await prisma.serviceBooking.findUnique({
      where: { id: bookingId },
      include: {
        serviceAvailability: {
          include: { post: { include: { seller: { include: { user: true } } } } }
        }
      }
    })

    if (!booking) {
      throw new NotFoundError('Booking not found')
    }

    if (booking.serviceAvailability.post.seller.user.did !== sellerDid) {
      throw new AppError('Not authorized', ErrorCode.FORBIDDEN, 403)
    }

    return prisma.serviceBooking.update({
      where: { id: bookingId },
      data: { status: 'NO_SHOW' }
    })
  }

  // =============================================================================
  // RECURRING AVAILABILITY PATTERNS
  // =============================================================================

  /**
   * Create a recurring availability pattern
   */
  async createRecurringPattern(postId: string, sellerDid: string, data: {
    daysOfWeek: number[]  // 0-6 (Sun-Sat)
    startTime: string     // "09:00"
    endTime: string       // "17:00"
    slotDurationMinutes: number
    slotsPerWindow?: number
    breakBetweenMinutes?: number
    priceOverride?: number
    validFrom?: Date
    validUntil?: Date
  }) {
    logger.info(`[MarketService] createRecurringPattern postId=${postId}, sellerDid=${sellerDid}`)
    
    // Verify ownership - first find the post with all relations for debugging
    const post = await prisma.marketPost.findFirst({
      where: { id: postId },
      include: { seller: { include: { user: { select: { did: true } } } } }
    })
    
    logger.info(`[MarketService] Post lookup result:`, {
      found: !!post,
      postSellerId: post?.sellerId,
      sellerUserId: post?.seller?.userId,
      sellerUserDid: post?.seller?.user?.did,
      matchesDid: post?.seller?.user?.did === sellerDid
    })

    if (!post || post.seller?.user?.did !== sellerDid) {
      throw new NotFoundError('Service post not found or not owned by seller')
    }

    return prisma.serviceRecurringPattern.create({
      data: {
        postId,
        daysOfWeek: data.daysOfWeek,
        startTime: data.startTime,
        endTime: data.endTime,
        slotDurationMinutes: data.slotDurationMinutes,
        slotsPerWindow: data.slotsPerWindow || 1,
        breakBetweenMinutes: data.breakBetweenMinutes || 0,
        priceOverride: data.priceOverride,
        validFrom: data.validFrom || new Date(),
        validUntil: data.validUntil,
        isActive: true
      }
    })
  }

  /**
   * Get recurring patterns for a service
   */
  async getRecurringPatterns(postId: string) {
    return prisma.serviceRecurringPattern.findMany({
      where: { postId, isActive: true },
      orderBy: { createdAt: 'desc' }
    })
  }

  /**
   * Update a recurring pattern
   */
  async updateRecurringPattern(patternId: string, sellerDid: string, data: Partial<{
    daysOfWeek: number[]
    startTime: string
    endTime: string
    slotDurationMinutes: number
    slotsPerWindow: number
    breakBetweenMinutes: number
    priceOverride: number | null
    validUntil: Date | null
    isActive: boolean
  }>) {
    const pattern = await prisma.serviceRecurringPattern.findUnique({
      where: { id: patternId },
      include: { post: { include: { seller: { include: { user: true } } } } }
    })

    if (!pattern) {
      throw new NotFoundError('Pattern not found')
    }

    if (pattern.post.seller.user.did !== sellerDid) {
      throw new AppError('Not authorized', ErrorCode.FORBIDDEN, 403)
    }

    return prisma.serviceRecurringPattern.update({
      where: { id: patternId },
      data
    })
  }

  /**
   * Delete a recurring pattern
   */
  async deleteRecurringPattern(patternId: string, sellerDid: string) {
    const pattern = await prisma.serviceRecurringPattern.findUnique({
      where: { id: patternId },
      include: { post: { include: { seller: { include: { user: true } } } } }
    })

    if (!pattern) {
      throw new NotFoundError('Pattern not found')
    }

    if (pattern.post.seller.user.did !== sellerDid) {
      throw new AppError('Not authorized', ErrorCode.FORBIDDEN, 403)
    }

    return prisma.serviceRecurringPattern.delete({
      where: { id: patternId }
    })
  }

  /**
   * Generate slots from recurring patterns for a date range
   * This should be called periodically (cron job) or on-demand
   */
  async generateSlotsFromPatterns(postId: string, startDate: Date, endDate: Date) {
    const patterns = await prisma.serviceRecurringPattern.findMany({
      where: {
        postId,
        isActive: true,
        validFrom: { lte: endDate },
        OR: [
          { validUntil: null },
          { validUntil: { gte: startDate } }
        ]
      }
    })

    if (patterns.length === 0) {
      return []
    }

    const slotsToCreate: any[] = []
    const currentDate = new Date(startDate)

    while (currentDate <= endDate) {
      const dayOfWeek = currentDate.getDay()
      const dateStr = currentDate.toISOString().split('T')[0]

      for (const pattern of patterns) {
        // Check if this day is in the pattern
        if (!pattern.daysOfWeek.includes(dayOfWeek)) continue

        // Check validity period
        if (pattern.validFrom && currentDate < pattern.validFrom) continue
        if (pattern.validUntil && currentDate > pattern.validUntil) continue

        // Generate time slots for this day
        const startMins = this.timeToMinutes(pattern.startTime)
        const endMins = this.timeToMinutes(pattern.endTime)
        const duration = pattern.slotDurationMinutes
        const breakTime = pattern.breakBetweenMinutes

        let slotStart = startMins
        while (slotStart + duration <= endMins) {
          const slotEnd = slotStart + duration
          const slotStartTime = this.minutesToTime(slotStart)
          const slotEndTime = this.minutesToTime(slotEnd)

          slotsToCreate.push({
            postId,
            date: new Date(dateStr),
            startTime: slotStartTime,
            endTime: slotEndTime,
            totalSlots: pattern.slotsPerWindow,
            priceOverride: pattern.priceOverride,
            isAvailable: true
          })

          slotStart = slotEnd + breakTime
        }
      }

      currentDate.setDate(currentDate.getDate() + 1)
    }

    // Upsert slots (don't duplicate existing ones)
    const results = []
    for (const slot of slotsToCreate) {
      try {
        const result = await prisma.serviceAvailability.upsert({
          where: {
            postId_date_startTime: {
              postId: slot.postId,
              date: slot.date,
              startTime: slot.startTime
            }
          },
          update: {}, // Don't update existing slots
          create: slot
        })
        results.push(result)
      } catch (e) {
        // Skip duplicates
      }
    }

    return results
  }

  // Helper methods
  private timeToMinutes(time: string): number {
    const [hours, mins] = time.split(':').map(Number)
    return hours * 60 + mins
  }

  private minutesToTime(mins: number): string {
    const hours = Math.floor(mins / 60)
    const minutes = mins % 60
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
  }
}
