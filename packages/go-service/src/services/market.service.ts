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
  }) {
    const page = params.page || 1
    const pageSize = params.pageSize || 20
    const skip = (page - 1) * pageSize

    logger.info('[MarketService] Fetching active posts', params)

    const where: any = {
      status: 'ACTIVE',
      isArchived: false,
      isInStock: true
    }

    if (params.categoryId) where.categoryId = params.categoryId
    if (params.subcategoryId) where.subcategoryId = params.subcategoryId

    logger.info('[MarketService] Query where:', JSON.stringify(where))

    const [posts, total] = await Promise.all([
      prisma.marketPost.findMany({
        where,
        include: {
          seller: true,
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
   * Get seller profile by DID
   */
  async getSellerProfile(did: string) {
    const seller = await prisma.marketSeller.findUnique({
      where: { did },
      include: {
        posts: {
          where: { isArchived: false },
          orderBy: { createdAt: 'desc' }
        }
      }
    })

    return seller
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
    // Check if already exists
    const existing = await prisma.marketSeller.findUnique({
      where: { did: data.did }
    })

    if (existing) {
      if (existing.status === 'REJECTED') {
        // Re-apply
        return prisma.marketSeller.update({
          where: { did: data.did },
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
        did: data.did,
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
    title: string
    description?: string
    price?: number
    currency?: string
    quantity?: number
  }) {
    // Verify seller
    const seller = await prisma.marketSeller.findUnique({
      where: { did: data.did }
    })

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
   * Update inventory
   */
  async updateInventory(postId: string, did: string, quantity: number) {
    const post = await prisma.marketPost.findUnique({
      where: { id: postId },
      include: { seller: true }
    })

    if (!post) throw new NotFoundError('Post not found')
    if (post.seller.did !== did) throw new AppError('Not authorized', ErrorCode.FORBIDDEN, 403)

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
    const post = await prisma.marketPost.findUnique({
      where: { id: postId },
      include: { seller: true }
    })

    if (!post) throw new NotFoundError('Post not found')
    if (post.seller.did !== did) throw new AppError('Not authorized', ErrorCode.FORBIDDEN, 403)

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
    const post = await prisma.marketPost.findUnique({
      where: { id: postId },
      include: { seller: true }
    })

    if (!post) throw new NotFoundError('Post not found')
    if (post.seller.did !== did) throw new AppError('Not authorized', ErrorCode.FORBIDDEN, 403)

    return prisma.marketPost.update({
      where: { id: postId },
      data: { isArchived: true }
    })
  }

  /**
   * Delete a post (soft delete via archive or hard delete if needed)
   * For now, we'll just archive it or mark as REMOVED
   */
  async deletePost(postId: string, did: string) {
    const post = await prisma.marketPost.findUnique({
      where: { id: postId },
      include: { seller: true }
    })

    if (!post) throw new NotFoundError('Post not found')
    if (post.seller.did !== did) throw new AppError('Not authorized', ErrorCode.FORBIDDEN, 403)

    return prisma.marketPost.update({
      where: { id: postId },
      data: { status: 'REMOVED', isArchived: true }
    })
  }
}
