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
    
    // City filtering: only posts for this city when specified
    if (params.cityId) {
      where.cityId = params.cityId
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
}

