"use strict";
/**
 * Rating Service
 * Manages ratings between users and drivers
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RatingService = exports.createRatingSchema = void 0;
const zod_1 = require("zod");
const core_1 = require("@gominiapp/core");
exports.createRatingSchema = zod_1.z.object({
    orderId: zod_1.z.string(),
    toUserId: zod_1.z.string(),
    rating: zod_1.z.number().min(1).max(5),
    comment: zod_1.z.string().optional(),
});
class RatingService {
    /**
     * Create a rating for an order
     */
    async createRating(fromUserId, data) {
        const validated = exports.createRatingSchema.parse(data);
        // Verify order exists and is completed
        const order = await core_1.prisma.order.findUnique({
            where: { id: validated.orderId },
        });
        if (!order) {
            throw new core_1.NotFoundError('Order not found', core_1.ErrorCode.ORDER_NOT_FOUND);
        }
        if (order.status !== 'COMPLETED') {
            throw new core_1.ValidationError('Can only rate completed orders');
        }
        // Check that the user is part of this order
        if (order.userId !== fromUserId && order.driverId !== fromUserId) {
            throw new core_1.ValidationError('You are not part of this order');
        }
        // Verify toUserId is part of this order
        if (order.userId !== validated.toUserId && order.driverId !== validated.toUserId) {
            throw new core_1.ValidationError('Invalid rating target');
        }
        // Check for existing rating
        const existingRating = await core_1.prisma.rating.findFirst({
            where: {
                orderId: validated.orderId,
                fromUserId,
            },
        });
        if (existingRating) {
            throw new core_1.ValidationError('You have already rated this order');
        }
        // Create the rating
        const rating = await core_1.prisma.rating.create({
            data: {
                orderId: validated.orderId,
                fromUserId,
                toUserId: validated.toUserId,
                rating: validated.rating,
                comment: validated.comment,
            },
        });
        // Update average rating for the target user
        await this.updateAverageRating(validated.toUserId);
        core_1.logger.info('Rating created', {
            orderId: validated.orderId,
            fromUserId,
            toUserId: validated.toUserId,
            rating: validated.rating,
        });
        return rating;
    }
    /**
     * Get ratings for a user
     */
    async getUserRatings(userId, options = {}) {
        const { page = 1, pageSize = 20 } = options;
        const [ratings, total, aggregate] = await Promise.all([
            core_1.prisma.rating.findMany({
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
            core_1.prisma.rating.count({ where: { toUserId: userId } }),
            core_1.prisma.rating.aggregate({
                where: { toUserId: userId },
                _avg: { rating: true },
            }),
        ]);
        return {
            ratings,
            total,
            average: aggregate._avg.rating || 0,
        };
    }
    /**
     * Get rating summary for a user
     */
    async getRatingSummary(userId) {
        const [aggregate, distribution] = await Promise.all([
            core_1.prisma.rating.aggregate({
                where: { toUserId: userId },
                _avg: { rating: true },
                _count: true,
            }),
            core_1.prisma.rating.groupBy({
                by: ['rating'],
                where: { toUserId: userId },
                _count: true,
            }),
        ]);
        // Build distribution with all star levels (1-5)
        const distributionMap = new Map(distribution.map(d => [d.rating, d._count]));
        const fullDistribution = [5, 4, 3, 2, 1].map(stars => ({
            stars,
            count: distributionMap.get(stars) || 0,
        }));
        return {
            average: Math.round((aggregate._avg.rating || 0) * 10) / 10,
            total: aggregate._count,
            distribution: fullDistribution,
        };
    }
    /**
     * Update average rating for a user (stored on User model)
     */
    async updateAverageRating(userId) {
        const aggregate = await core_1.prisma.rating.aggregate({
            where: { toUserId: userId },
            _avg: { rating: true },
        });
        // Update driver rating if user is a driver
        const driver = await core_1.prisma.driver.findUnique({
            where: { userId },
        });
        if (driver) {
            await core_1.prisma.driver.update({
                where: { userId },
                data: { rating: aggregate._avg.rating || 0 },
            });
        }
    }
    /**
     * Check if user can rate an order
     */
    async canRateOrder(userId, orderId) {
        const order = await core_1.prisma.order.findUnique({
            where: { id: orderId },
        });
        if (!order || order.status !== 'COMPLETED') {
            return false;
        }
        // Check user is part of order
        if (order.userId !== userId && order.driverId !== userId) {
            return false;
        }
        // Check for existing rating
        const existingRating = await core_1.prisma.rating.findFirst({
            where: {
                orderId,
                fromUserId: userId,
            },
        });
        return !existingRating;
    }
}
exports.RatingService = RatingService;
