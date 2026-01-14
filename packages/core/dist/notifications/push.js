"use strict";
/**
 * Push Notification Service
 * Sends notifications via Expo's push notification service
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PushNotificationService = void 0;
const expo_server_sdk_1 = __importDefault(require("expo-server-sdk"));
const prisma_1 = require("../db/prisma");
const logger_1 = require("../utils/logger");
class PushNotificationService {
    expo;
    constructor() {
        this.expo = new expo_server_sdk_1.default({
            accessToken: process.env.EXPO_ACCESS_TOKEN,
        });
    }
    /**
     * Send push notification to a single user
     */
    async sendToUser(userId, payload) {
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: userId },
            select: { pushToken: true },
        });
        if (!user?.pushToken) {
            logger_1.logger.warn('No push token for user', { userId });
            return false;
        }
        return this.sendToToken(user.pushToken, payload, userId);
    }
    /**
     * Send push notification to a user by DID
     */
    async sendToUserByDid(did, payload) {
        const user = await prisma_1.prisma.user.findUnique({
            where: { did },
            select: { id: true, pushToken: true },
        });
        if (!user?.pushToken) {
            logger_1.logger.warn('No push token for DID', { did });
            return false;
        }
        return this.sendToToken(user.pushToken, payload, user.id);
    }
    /**
     * Send push notification to multiple users
     */
    async sendToUsers(userIds, payload) {
        const users = await prisma_1.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, pushToken: true },
        });
        const results = new Map();
        const messages = [];
        const userIdByToken = new Map();
        for (const user of users) {
            if (user.pushToken && expo_server_sdk_1.default.isExpoPushToken(user.pushToken)) {
                messages.push(this.createMessage(user.pushToken, payload));
                userIdByToken.set(user.pushToken, user.id);
            }
            else {
                results.set(user.id, false);
            }
        }
        if (messages.length === 0) {
            return results;
        }
        const chunks = this.expo.chunkPushNotifications(messages);
        for (const chunk of chunks) {
            try {
                const tickets = await this.expo.sendPushNotificationsAsync(chunk);
                for (let i = 0; i < tickets.length; i++) {
                    const ticket = tickets[i];
                    const token = chunk[i].to;
                    const userId = userIdByToken.get(token);
                    if (userId) {
                        const success = ticket.status === 'ok';
                        results.set(userId, success);
                        // Log notification
                        await this.logNotification(userId, payload, success, ticket.status === 'error' ? ticket.message : undefined);
                    }
                }
            }
            catch (error) {
                logger_1.logger.error('Failed to send push notifications', { error });
            }
        }
        return results;
    }
    /**
     * Send notification to drivers in a geographic area
     */
    async notifyNearbyDrivers(latitude, longitude, radiusKm, payload, availabilityType) {
        // Find nearby online drivers
        const drivers = await prisma_1.prisma.$queryRaw `
      SELECT d."userId"
      FROM "Driver" d
      JOIN "User" u ON d."userId" = u.id
      WHERE d."isOnline" = true
        AND u."pushToken" IS NOT NULL
        AND d."currentLatitude" IS NOT NULL
        AND d."currentLongitude" IS NOT NULL
        ${availabilityType ? prisma_1.prisma.$queryRaw `AND (d."availabilityType" = ${availabilityType} OR d."availabilityType" = 'BOTH')` : prisma_1.prisma.$queryRaw ``}
        AND ST_DWithin(
          ST_MakePoint(d."currentLongitude", d."currentLatitude")::geography,
          ST_MakePoint(${longitude}, ${latitude})::geography,
          ${radiusKm * 1000}
        )
      ORDER BY ST_Distance(
        ST_MakePoint(d."currentLongitude", d."currentLatitude")::geography,
        ST_MakePoint(${longitude}, ${latitude})::geography
      )
      LIMIT 20
    `;
        const userIds = drivers.map(d => d.userId);
        if (userIds.length > 0) {
            await this.sendToUsers(userIds, payload);
        }
        return userIds;
    }
    /**
     * Send new order notification to a specific driver
     */
    async sendOrderRequest(driverId, orderData) {
        const payload = {
            title: orderData.orderType === 'RIDE' ? '🚗 New Ride Request' : '📦 New Delivery Request',
            body: `Pickup: ${orderData.pickupAddress}`,
            data: {
                ...orderData,
                action: 'open_order_request',
            },
            sound: 'default',
            priority: 'high',
            categoryId: 'order_request',
        };
        return this.sendToUser(driverId, payload);
    }
    /**
     * Send order status update to user
     */
    async sendOrderUpdate(userId, orderData) {
        const titles = {
            order_accepted: '✅ Driver Accepted',
            driver_arriving: '🚗 Driver On The Way',
            driver_arrived: '📍 Driver Has Arrived',
            trip_started: '🚀 Trip Started',
            trip_completed: '🎉 Trip Completed',
            order_cancelled: '❌ Order Cancelled',
        };
        const payload = {
            title: titles[orderData.type] || 'Order Update',
            body: orderData.message || 'Check your order status',
            data: {
                ...orderData,
                action: 'open_order',
            },
            sound: 'default',
        };
        return this.sendToUser(userId, payload);
    }
    async sendToToken(token, payload, userId) {
        if (!expo_server_sdk_1.default.isExpoPushToken(token)) {
            logger_1.logger.warn('Invalid Expo push token', { token, userId });
            return false;
        }
        const message = this.createMessage(token, payload);
        try {
            const [ticket] = await this.expo.sendPushNotificationsAsync([message]);
            const success = ticket.status === 'ok';
            await this.logNotification(userId, payload, success, ticket.status === 'error' ? ticket.message : undefined);
            return success;
        }
        catch (error) {
            logger_1.logger.error('Failed to send push notification', { error, userId });
            await this.logNotification(userId, payload, false, String(error));
            return false;
        }
    }
    createMessage(token, payload) {
        return {
            to: token,
            title: payload.title,
            body: payload.body,
            data: payload.data,
            sound: payload.sound ?? 'default',
            badge: payload.badge,
            channelId: payload.channelId,
            priority: payload.priority ?? 'high',
            categoryId: payload.categoryId,
        };
    }
    async logNotification(userId, payload, success, errorMessage) {
        try {
            await prisma_1.prisma.pushNotificationLog.create({
                data: {
                    userId,
                    title: payload.title,
                    body: payload.body,
                    data: payload.data,
                    status: success ? 'sent' : 'failed',
                    errorMessage,
                },
            });
        }
        catch (error) {
            logger_1.logger.error('Failed to log notification', { error });
        }
    }
}
exports.PushNotificationService = PushNotificationService;
