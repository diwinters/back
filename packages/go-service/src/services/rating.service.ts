/**
 * Rating Service
 * Manages ratings for drivers after orders
 */

import { z } from 'zod'
import {
  prisma,
  logger,
  NotFoundError,
  ValidationError,
  ErrorCode,
} from '@gominiapp/core'

export const createRatingSchema = z.object({
  orderId: z.string().uuid(),
  rating: z.number().min(1).max(5),
  comment: z.string().max(500).optional(),
})

export class RatingService {
  /**
   * Rate a completed order
   */
  async rateOrder(
    userId: string,
    data: z.infer<typeof createRatingSchema>
  ): Promise<void> {
    const validated = createRatingSchema.parse(data)

    // Get order
    const order = await prisma.order.findUnique({
      where: { id: validated.orderId },
      include: { driver: true },
    })

    if (!order) {
      throw new NotFoundError('Order not found', ErrorCode.ORDER_NOT_FOUND)
    }

    if (order.userId !== userId) {
      throw new ValidationError('You cannot rate this order')
    }

    if (order.status !== 'COMPLETED') {
      throw new ValidationError('Can only rate completed orders')
    }

    if (!order.driverId) {
      throw new ValidationError('Order has no driver to rate')
    }

    // Check if already rated
    const existingRating = await prisma.rating.findFirst({
      where: { orderId: validated.orderId },
    })

    if (existingRating) {
      throw new ValidationError('Order has already been rated')
    }

    // Create rating
    await prisma.rating.create({
      data: {
        orderId: validated.orderId,
        driverId: order.driverId,
        userId,
        rating: validated.rating,
        comment: validated.comment,
      },
    })

    // Update driver's average rating
    const ratings = await prisma.rating.findMany({
      where: { driverId: order.driverId },
      select: { rating: true },
    })

    const avgRating = ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length

    await prisma.driver.update({
      where: { id: order.driverId },
      data: { rating: Math.round(avgRating * 10) / 10 },
    })

    logger.info('Order rated', {
      orderId: validated.orderId,
      driverId: order.driverId,
      rating: validated.rating,
    })
  }

  /**
   * Get ratings for a driver
   */
  async getDriverRatings(
    driverId: string,
    options: { page?: number; pageSize?: number } = {}
  ): Promise<{
    ratings: Array<{
      id: string
      rating: number
      comment?: string
      createdAt: Date
    }>
    average: number
    total: number
  }> {
    const { page = 1, pageSize = 20 } = options

    const [ratings, stats] = await Promise.all([
      prisma.rating.findMany({
        where: { driverId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          rating: true,
          comment: true,
          createdAt: true,
        },
      }),
      prisma.rating.aggregate({
        where: { driverId },
        _avg: { rating: true },
        _count: true,
      }),
    ])

    return {
      ratings,
      average: stats._avg.rating || 0,
      total: stats._count,
    }
  }
}
