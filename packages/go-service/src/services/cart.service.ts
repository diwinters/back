import { prisma, logger, AppError, ErrorCode, NotFoundError } from '@gominiapp/core'

export class CartService {
  /**
   * Get or create cart for a user
   */
  async getOrCreateCart(did: string) {
    // Find or create user first
    let user = await prisma.user.findUnique({ where: { did } })
    if (!user) {
      user = await prisma.user.create({ data: { did } })
    }

    // Find or create cart
    let cart = await prisma.cart.findUnique({
      where: { userId: user.id },
      include: {
        items: {
          include: {
            post: {
              include: {
                seller: {
                  include: {
                    user: { select: { did: true, handle: true, displayName: true, avatarUrl: true } }
                  }
                },
                category: true,
                shippingOptions: { where: { isActive: true } }
              }
            },
            shippingOption: true
          }
        }
      }
    })

    if (!cart) {
      cart = await prisma.cart.create({
        data: { userId: user.id },
        include: {
          items: {
            include: {
              post: {
                include: {
                  seller: {
                    include: {
                      user: { select: { did: true, handle: true, displayName: true, avatarUrl: true } }
                    }
                  },
                  category: true,
                  shippingOptions: { where: { isActive: true } }
                }
              },
              shippingOption: true
            }
          }
        }
      })
    }

    return cart
  }

  /**
   * Get cart with calculated totals
   */
  async getCartWithTotals(did: string) {
    const cart = await this.getOrCreateCart(did)
    const settings = await this.getMarketSettings()

    // Calculate totals
    let subtotal = 0
    let totalShipping = 0
    const itemsWithTotals = cart.items.map(item => {
      const itemTotal = (item.post.price || 0) * item.quantity
      subtotal += itemTotal
      
      const shippingCost = item.shippingOption?.price || 0
      totalShipping += shippingCost

      return {
        ...item,
        itemTotal,
        shippingCost
      }
    })

    // Calculate fees
    const serviceFee = settings.serviceFeeEnabled 
      ? Math.min(
          Math.max(subtotal * settings.serviceFeeRate, settings.serviceFeeMin),
          settings.serviceFeeMax || Infinity
        )
      : 0

    const tvaAmount = settings.tvaEnabled 
      ? (subtotal + serviceFee) * settings.tvaRate 
      : 0

    const total = subtotal + totalShipping + serviceFee + tvaAmount

    return {
      cart: {
        ...cart,
        items: itemsWithTotals
      },
      totals: {
        subtotal,
        shipping: totalShipping,
        serviceFee,
        serviceFeeRate: settings.serviceFeeRate,
        tvaAmount,
        tvaRate: settings.tvaRate,
        total,
        currency: settings.defaultCurrency,
        itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0)
      }
    }
  }

  /**
   * Add item to cart
   */
  async addToCart(data: {
    did: string
    postId: string
    quantity: number
    shippingOptionId?: string
  }) {
    const cart = await this.getOrCreateCart(data.did)

    // Verify post exists and is active
    const post = await prisma.marketPost.findUnique({
      where: { id: data.postId },
      include: { shippingOptions: { where: { isActive: true } } }
    })

    if (!post) throw new NotFoundError('Product not found')
    if (post.status !== 'ACTIVE' || post.isArchived) {
      throw new AppError('Product is not available', ErrorCode.BAD_REQUEST, 400)
    }
    if (!post.isInStock || post.quantity < data.quantity) {
      throw new AppError('Insufficient stock', ErrorCode.BAD_REQUEST, 400)
    }

    // Validate shipping option if provided
    if (data.shippingOptionId) {
      const validOption = post.shippingOptions.find(o => o.id === data.shippingOptionId)
      if (!validOption) {
        throw new AppError('Invalid shipping option', ErrorCode.BAD_REQUEST, 400)
      }
    }

    // Check if item already in cart
    const existingItem = cart.items.find(item => item.postId === data.postId)

    if (existingItem) {
      // Update quantity
      const newQuantity = existingItem.quantity + data.quantity
      if (newQuantity > post.quantity) {
        throw new AppError('Insufficient stock', ErrorCode.BAD_REQUEST, 400)
      }

      return prisma.cartItem.update({
        where: { id: existingItem.id },
        data: {
          quantity: newQuantity,
          shippingOptionId: data.shippingOptionId || existingItem.shippingOptionId
        },
        include: {
          post: {
            include: {
              seller: {
                include: {
                  user: { select: { did: true, handle: true, displayName: true, avatarUrl: true } }
                }
              }
            }
          },
          shippingOption: true
        }
      })
    }

    // Add new item
    return prisma.cartItem.create({
      data: {
        cartId: cart.id,
        postId: data.postId,
        quantity: data.quantity,
        shippingOptionId: data.shippingOptionId,
        priceAtAdd: post.price || 0
      },
      include: {
        post: {
          include: {
            seller: {
              include: {
                user: { select: { did: true, handle: true, displayName: true, avatarUrl: true } }
              }
            }
          }
        },
        shippingOption: true
      }
    })
  }

  /**
   * Update cart item quantity
   */
  async updateCartItem(data: {
    did: string
    itemId: string
    quantity: number
    shippingOptionId?: string
  }) {
    const cart = await this.getOrCreateCart(data.did)
    
    const item = cart.items.find(i => i.id === data.itemId)
    if (!item) throw new NotFoundError('Cart item not found')

    if (data.quantity <= 0) {
      // Remove item
      await prisma.cartItem.delete({ where: { id: data.itemId } })
      return null
    }

    // Check stock
    const post = await prisma.marketPost.findUnique({ where: { id: item.postId } })
    if (!post || data.quantity > post.quantity) {
      throw new AppError('Insufficient stock', ErrorCode.BAD_REQUEST, 400)
    }

    return prisma.cartItem.update({
      where: { id: data.itemId },
      data: {
        quantity: data.quantity,
        shippingOptionId: data.shippingOptionId !== undefined ? data.shippingOptionId : item.shippingOptionId
      },
      include: {
        post: {
          include: {
            seller: {
              include: {
                user: { select: { did: true, handle: true, displayName: true, avatarUrl: true } }
              }
            }
          }
        },
        shippingOption: true
      }
    })
  }

  /**
   * Remove item from cart
   */
  async removeFromCart(did: string, itemId: string) {
    const cart = await this.getOrCreateCart(did)
    
    const item = cart.items.find(i => i.id === itemId)
    if (!item) throw new NotFoundError('Cart item not found')

    await prisma.cartItem.delete({ where: { id: itemId } })
    return { success: true }
  }

  /**
   * Clear entire cart
   */
  async clearCart(did: string) {
    const cart = await this.getOrCreateCart(did)
    
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } })
    return { success: true }
  }

  /**
   * Get market settings (singleton)
   */
  async getMarketSettings() {
    let settings = await prisma.marketSettings.findUnique({ where: { id: 1 } })
    
    if (!settings) {
      // Create default settings
      settings = await prisma.marketSettings.create({
        data: {
          id: 1,
          tvaRate: 0.20,
          tvaEnabled: true,
          serviceFeeRate: 0.05,
          serviceFeeMin: 5,
          serviceFeeEnabled: true,
          defaultCurrency: 'MAD'
        }
      })
    }

    return settings
  }

  /**
   * Update market settings (admin only)
   */
  async updateMarketSettings(data: {
    tvaRate?: number
    tvaEnabled?: boolean
    serviceFeeRate?: number
    serviceFeeMin?: number
    serviceFeeMax?: number | null
    serviceFeeEnabled?: boolean
    defaultCurrency?: string
  }) {
    // Ensure settings exist
    await this.getMarketSettings()

    return prisma.marketSettings.update({
      where: { id: 1 },
      data
    })
  }
}
