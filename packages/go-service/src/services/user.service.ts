/**
 * User Service
 * Manages user profiles and settings
 */

import { z } from 'zod'
import { prisma, logger, NotFoundError, ErrorCode } from '@gominiapp/core'

export const updateUserSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().url().optional(),
  phone: z.string().optional(),
  defaultPaymentMethod: z.string().optional(),
})

export class UserService {
  /**
   * Get or create user by DID
   */
  async getOrCreateUser(did: string, handle?: string): Promise<any> {
    let user = await prisma.user.findUnique({
      where: { did },
    })

    if (!user) {
      user = await prisma.user.create({
        data: {
          did,
          handle: handle || `user_${did.slice(-8)}`,
          displayName: handle || 'New User',
        },
      })
      logger.info('User created', { userId: user.id, did })
    }

    return user
  }

  /**
   * Get user by ID
   */
  async getUser(userId: string): Promise<any> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        driver: true,
      },
    })

    if (!user) {
      throw new NotFoundError('User not found', ErrorCode.USER_NOT_FOUND)
    }

    return user
  }

  /**
   * Get user by DID
   */
  async getUserByDid(did: string): Promise<any> {
    const user = await prisma.user.findUnique({
      where: { did },
      include: {
        driver: true,
      },
    })

    if (!user) {
      throw new NotFoundError('User not found', ErrorCode.USER_NOT_FOUND)
    }

    return user
  }

  /**
   * Update user profile
   */
  async updateUser(userId: string, data: z.infer<typeof updateUserSchema>): Promise<any> {
    const validated = updateUserSchema.parse(data)

    const user = await prisma.user.update({
      where: { id: userId },
      data: validated,
    })

    logger.info('User updated', { userId })

    return user
  }

  /**
   * Get user's saved places
   */
  async getSavedPlaces(userId: string): Promise<any[]> {
    return prisma.savedPlace.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })
  }

  /**
   * Add saved place
   */
  async addSavedPlace(
    userId: string,
    data: {
      label: string
      address: string
      latitude: number
      longitude: number
      name: string
    }
  ): Promise<any> {
    return prisma.savedPlace.create({
      data: {
        userId,
        label: data.label,
        address: data.address,
        latitude: data.latitude,
        longitude: data.longitude,
        name: data.name,
      },
    })
  }

  /**
   * Delete saved place
   */
  async deleteSavedPlace(userId: string, placeId: string): Promise<void> {
    await prisma.savedPlace.deleteMany({
      where: { id: placeId, userId },
    })
  }

  /**
   * Get user statistics
   */
  async getUserStats(userId: string): Promise<{
    totalOrders: number
    completedOrders: number
    cancelledOrders: number
    averageRating: number
    totalSpent: number
  }> {
    const [orderStats, ratingAggregate, totalSpent] = await Promise.all([
      prisma.order.groupBy({
        by: ['status'],
        where: { userId },
        _count: true,
      }),
      prisma.rating.aggregate({
        where: { toUserId: userId },
        _avg: { rating: true },
      }),
      prisma.order.aggregate({
        where: { userId, status: 'COMPLETED' },
        _sum: { finalFare: true },
      }),
    ])

    const statusCounts = new Map(
      orderStats.map(s => [s.status, s._count])
    )

    return {
      totalOrders: orderStats.reduce((sum, s) => sum + s._count, 0),
      completedOrders: statusCounts.get('COMPLETED') || 0,
      cancelledOrders: statusCounts.get('CANCELLED') || 0,
      averageRating: Math.round((ratingAggregate._avg.rating || 0) * 10) / 10,
      totalSpent: totalSpent._sum.finalFare || 0,
    }
  }

  /**
   * Check if user is a driver
   */
  async isDriver(userId: string): Promise<boolean> {
    const driver = await prisma.driver.findUnique({
      where: { userId },
    })
    return !!driver
  }

  /**
   * Update push token
   */
  async updatePushToken(userId: string, pushToken: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { pushToken },
    })
    logger.debug('Push token updated', { userId })
  }

  /**
   * Search users by handle or display name
   */
  async searchUsers(
    query: string,
    options: { limit?: number } = {}
  ): Promise<any[]> {
    const { limit = 20 } = options

    return prisma.user.findMany({
      where: {
        OR: [
          { handle: { contains: query, mode: 'insensitive' } },
          { displayName: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        did: true,
        handle: true,
        displayName: true,
        avatarUrl: true,
      },
      take: limit,
    })
  }

  /**
   * Get user's preferred city
   */
  async getPreferredCity(userId: string): Promise<any | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        preferredCity: true,
      },
    })

    return user?.preferredCity || null
  }

  /**
   * Set user's preferred city
   */
  async setPreferredCity(userId: string, cityId: string | null): Promise<any> {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { preferredCityId: cityId },
      include: {
        preferredCity: true,
      },
    })

    logger.info('User preferred city updated', { userId, cityId })

    return user
  }
}
