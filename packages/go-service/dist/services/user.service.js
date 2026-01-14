"use strict";
/**
 * User Service
 * Manages user profiles and settings
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserService = exports.updateUserSchema = void 0;
const zod_1 = require("zod");
const core_1 = require("@gominiapp/core");
exports.updateUserSchema = zod_1.z.object({
    displayName: zod_1.z.string().min(1).max(100).optional(),
    avatarUrl: zod_1.z.string().url().optional(),
    phone: zod_1.z.string().optional(),
    defaultPaymentMethod: zod_1.z.string().optional(),
});
class UserService {
    /**
     * Get or create user by DID
     */
    async getOrCreateUser(did, handle) {
        let user = await core_1.prisma.user.findUnique({
            where: { did },
        });
        if (!user) {
            user = await core_1.prisma.user.create({
                data: {
                    did,
                    handle: handle || `user_${did.slice(-8)}`,
                    displayName: handle || 'New User',
                },
            });
            core_1.logger.info('User created', { userId: user.id, did });
        }
        return user;
    }
    /**
     * Get user by ID
     */
    async getUser(userId) {
        const user = await core_1.prisma.user.findUnique({
            where: { id: userId },
            include: {
                driver: true,
            },
        });
        if (!user) {
            throw new core_1.NotFoundError('User not found', core_1.ErrorCode.USER_NOT_FOUND);
        }
        return user;
    }
    /**
     * Get user by DID
     */
    async getUserByDid(did) {
        const user = await core_1.prisma.user.findUnique({
            where: { did },
            include: {
                driver: true,
            },
        });
        if (!user) {
            throw new core_1.NotFoundError('User not found', core_1.ErrorCode.USER_NOT_FOUND);
        }
        return user;
    }
    /**
     * Update user profile
     */
    async updateUser(userId, data) {
        const validated = exports.updateUserSchema.parse(data);
        const user = await core_1.prisma.user.update({
            where: { id: userId },
            data: validated,
        });
        core_1.logger.info('User updated', { userId });
        return user;
    }
    /**
     * Get user's saved places
     */
    async getSavedPlaces(userId) {
        return core_1.prisma.savedPlace.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
        });
    }
    /**
     * Add saved place
     */
    async addSavedPlace(userId, data) {
        return core_1.prisma.savedPlace.create({
            data: {
                userId,
                label: data.label,
                address: data.address,
                latitude: data.latitude,
                longitude: data.longitude,
                name: data.name,
            },
        });
    }
    /**
     * Delete saved place
     */
    async deleteSavedPlace(userId, placeId) {
        await core_1.prisma.savedPlace.deleteMany({
            where: { id: placeId, userId },
        });
    }
    /**
     * Get user statistics
     */
    async getUserStats(userId) {
        const [orderStats, ratingAggregate, totalSpent] = await Promise.all([
            core_1.prisma.order.groupBy({
                by: ['status'],
                where: { userId },
                _count: true,
            }),
            core_1.prisma.rating.aggregate({
                where: { toUserId: userId },
                _avg: { rating: true },
            }),
            core_1.prisma.order.aggregate({
                where: { userId, status: 'COMPLETED' },
                _sum: { finalFare: true },
            }),
        ]);
        const statusCounts = new Map(orderStats.map(s => [s.status, s._count]));
        return {
            totalOrders: orderStats.reduce((sum, s) => sum + s._count, 0),
            completedOrders: statusCounts.get('COMPLETED') || 0,
            cancelledOrders: statusCounts.get('CANCELLED') || 0,
            averageRating: Math.round((ratingAggregate._avg.rating || 0) * 10) / 10,
            totalSpent: totalSpent._sum.finalFare || 0,
        };
    }
    /**
     * Check if user is a driver
     */
    async isDriver(userId) {
        const driver = await core_1.prisma.driver.findUnique({
            where: { userId },
        });
        return !!driver;
    }
    /**
     * Update push token
     */
    async updatePushToken(userId, pushToken) {
        await core_1.prisma.user.update({
            where: { id: userId },
            data: { pushToken },
        });
        core_1.logger.debug('Push token updated', { userId });
    }
    /**
     * Search users by handle or display name
     */
    async searchUsers(query, options = {}) {
        const { limit = 20 } = options;
        return core_1.prisma.user.findMany({
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
        });
    }
    /**
     * Get user's preferred city
     */
    async getPreferredCity(userId) {
        const user = await core_1.prisma.user.findUnique({
            where: { id: userId },
            include: {
                preferredCity: true,
            },
        });
        return user?.preferredCity || null;
    }
    /**
     * Set user's preferred city
     */
    async setPreferredCity(userId, cityId) {
        const user = await core_1.prisma.user.update({
            where: { id: userId },
            data: { preferredCityId: cityId },
            include: {
                preferredCity: true,
            },
        });
        core_1.logger.info('User preferred city updated', { userId, cityId });
        return user;
    }
}
exports.UserService = UserService;
