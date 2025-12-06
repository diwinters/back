/**
 * Rating Service
 * Manages ratings between users and drivers
 */

import { z } from 'zod'
import { prisma, logger, NotFoundError, ValidationError, ErrorCode } from '@gominiapp/core'

export const createRatingSchema = z.object({
  orderId: z.string(),
  toUserId: z.string(),
  rating: z.number().min(1).max(5),
  comment: z.string().optional(),
})

export class RatingService {
  /**
   * Create a rating for an order
   */
  async createRating(
    fromUserId: string,
    data: z.infer<typeof createRatingSchema>
  ): Promise<any> {
    const validated = createRatingSchema.parse(data)

    // Verify order exists and is completed
    const order = await prisma.order.findUnique({
      where: { id: validated.orderId },
    })

    if (!order) {
      throw new NotFoundError('Order not found', ErrorCode.ORDER_NOT_FOUND)
    }

    if (order.status !== 'COMPLETED') {
      throw new ValidationError('Can only rate completed orders')
    }

    // Check that the user is part of this order
    if (order.userId !== fromUserId && order.driverId !== fromUserId) {
      throw new ValidationError('You are not part of this order')
    }

    // Verify toUserId is part of this order
    if (order.userId !== validated.toUserId && order.driverId !== validated.toUserId) {
      throw new ValidationError('Invalid rating target')
    }

    // Check for existing rating
    const existingRating = await prisma.rating.findFirst({
      where: {
        orderId: validated.orderId,
        fromUserId,
      },
    })

    if (existingRating) {
      throw new ValidationError('You have already rated this order')
    }

    // Create the rating
    const rating = await prisma.rating.create({
      data: {
        orderId: validated.orderId,
        fromUserId,
        toUserId: validated.toUserId,
        rating: validated.rating,
        comment: validated.comment,
      },
    })

    // Update average rating for the target user
    await this.updateAverageRating(validated.toUserId)

    logger.info('Rating created', {
      orderId: validated.orderId,
      fromUserId,
      toUserId: validated.toUserId,
      rating: validated.rating,
    })

    return rating
  }

  /**
   * Get ratings for a user
   */
  async getUserRatings(
    userId: string,
    options: { page?: number; pageSize?: number } = {}
  ): Promise<{ ratings: any[]; total: number; average: number }> {
    const { page = 1, pageSize = 20 } = options

    const [ratings, total, aggregate] = await Promise.all([
      prisma.rating.findMany({
        where: { toUserId: userId },
        include: {
          fromUser: {
            select: { id: true, displayName: true, avatarUrl: true },
          },
          order: {
            select: { id: true, type: true, requestedAt: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.rating.count({ where: { toUserId: userId } }),
      prisma.rating.aggregate({
        where: { toUserId: userId },
        _avg: { rating: true },
      }),
    ])

    return {
      ratings,
      total,
      average: aggregate._avg.rating || 0,
    }
  }

  /**
   * Get rating summary for a user
   */
  async getRatingSummary(userId: string): Promise<{
    average: number
    total: number
    distribution: { stars: number; count: number }[]
  }> {
    const [aggregate, distribution] = await Promise.all([
      prisma.rating.aggregate({
        where: { toUserId: userId },
        _avg: { rating: true },
        _count: true,
      }),
      prisma.rating.groupBy({
        by: ['rating'],
        where: { toUserId: userId },
        _count: true,
      }),
    ])

    // Build distribution with all star levels (1-5)
    const distributionMap = new Map(
      distribution.map(d => [d.rating, d._count])
    )
    const fullDistribution = [5, 4, 3, 2, 1].map(stars => ({
      stars,
      count: distributionMap.get(stars) || 0,
    }))

    return {
      average: Math.round((aggregate._avg.rating || 0) * 10) / 10,
      total: aggregate._count,
      distribution: fullDistribution,
    }
  }

  /**
   * Update average rating for a user (stored on User model)
   */
  private async updateAverageRating(userId: string): Promise<void> {
    const aggregate = await prisma.rating.aggregate({
      where: { toUserId: userId },
      _avg: { rating: true },
    })

    // Update driver rating if user is a driver
    const driver = await prisma.driver.findUnique({
      where: { userId },
    })

    if (driver) {
      await prisma.driver.update({
        where: { userId },
        data: { rating: aggregate._avg.rating || 0 },
      })
    }
  }

  /**
   * Check if user can rate an order
   */
  async canRateOrder(userId: string, orderId: string): Promise<boolean> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
    })

    if (!order || order.status !== 'COMPLETED') {
      return false
    }

    // Check user is part of order
    if (order.userId !== userId && order.driverId !== userId) {
      return false
    }

    // Check for existing rating
    const existingRating = await prisma.rating.findFirst({
      where: {
        orderId,
        fromUserId: userId,
      },
    })

    return !existingRating
  }
}
