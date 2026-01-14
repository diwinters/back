"use strict";
/**
 * Redis Service
 * Handles real-time driver locations, caching, and pub/sub
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisService = void 0;
exports.getRedisService = getRedisService;
const ioredis_1 = __importDefault(require("ioredis"));
const logger_1 = require("../utils/logger");
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
// Key prefixes
const KEYS = {
    DRIVER_LOCATION: 'driver:location:',
    DRIVER_GEO: 'drivers:geo',
    ORDER_CACHE: 'order:',
    SESSION: 'session:',
};
// Pub/Sub channels for cluster communication
const CHANNELS = {
    WS_MESSAGE: 'ws:message', // Cross-instance WebSocket messages
    WS_BROADCAST: 'ws:broadcast', // Broadcast to all drivers (from admin, etc.)
};
// TTLs in seconds
const TTL = {
    DRIVER_LOCATION: 300, // 5 minutes - stale if not updated
    ORDER_CACHE: 3600, // 1 hour
    SESSION: 86400 * 7, // 7 days
};
class RedisService {
    client;
    subscriber;
    messageHandlers = new Map();
    constructor() {
        this.client = new ioredis_1.default(REDIS_URL, {
            maxRetriesPerRequest: 3,
            retryStrategy: (times) => Math.min(times * 100, 3000),
        });
        this.subscriber = new ioredis_1.default(REDIS_URL);
        this.client.on('error', (error) => {
            logger_1.logger.error('Redis client error', { error });
        });
        this.client.on('connect', () => {
            logger_1.logger.info('Redis connected');
        });
        // Set up pub/sub message handling
        this.subscriber.on('message', (channel, message) => {
            const handler = this.messageHandlers.get(channel);
            if (handler) {
                try {
                    const data = JSON.parse(message);
                    handler(data);
                }
                catch (error) {
                    logger_1.logger.error('Failed to parse pub/sub message', { channel, error });
                }
            }
        });
    }
    // ==========================================================================
    // Driver Location Management
    // ==========================================================================
    /**
     * Update driver's current location
     */
    async setDriverLocation(did, latitude, longitude, heading) {
        try {
            const key = KEYS.DRIVER_LOCATION + did;
            const data = {
                latitude,
                longitude,
                heading: heading ?? 0,
                updatedAt: Date.now(),
            };
            // Store location data with timeout
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Redis setDriverLocation timeout')), 3000));
            const setPromise = (async () => {
                await this.client.setex(key, TTL.DRIVER_LOCATION, JSON.stringify(data));
                await this.client.geoadd(KEYS.DRIVER_GEO, longitude, latitude, did);
            })();
            await Promise.race([setPromise, timeoutPromise]);
        }
        catch (error) {
            logger_1.logger.error('Redis setDriverLocation failed', { did, error });
            // Don't throw - location update failure shouldn't crash the app
        }
    }
    /**
     * Get driver's current location
     */
    async getDriverLocation(did) {
        const key = KEYS.DRIVER_LOCATION + did;
        const data = await this.client.get(key);
        if (!data)
            return null;
        return JSON.parse(data);
    }
    /**
     * Remove driver from location tracking (went offline)
     */
    async removeDriverLocation(did) {
        await this.client.del(KEYS.DRIVER_LOCATION + did);
        await this.client.zrem(KEYS.DRIVER_GEO, did);
    }
    /**
     * Find drivers within radius (km) of a point
     */
    async getNearbyDrivers(latitude, longitude, radiusKm, limit = 20) {
        try {
            // Add timeout to prevent hanging if Redis is unresponsive
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Redis getNearbyDrivers timeout')), 5000));
            const queryPromise = this.client.georadius(KEYS.DRIVER_GEO, longitude, latitude, radiusKm, 'km', 'ASC', 'COUNT', limit);
            const results = await Promise.race([queryPromise, timeoutPromise]);
            return results;
        }
        catch (error) {
            logger_1.logger.error('Redis getNearbyDrivers failed', { error });
            return []; // Return empty array on failure instead of throwing
        }
    }
    /**
     * Get distance between driver and a point
     */
    async getDriverDistance(did, latitude, longitude) {
        // Add temporary point to calculate distance
        const tempKey = `temp:${Date.now()}`;
        await this.client.geoadd(KEYS.DRIVER_GEO, longitude, latitude, tempKey);
        const distance = await this.client.geodist(KEYS.DRIVER_GEO, did, tempKey, 'km');
        // Clean up temp point
        await this.client.zrem(KEYS.DRIVER_GEO, tempKey);
        return distance ? parseFloat(distance) : null;
    }
    // ==========================================================================
    // Order Caching
    // ==========================================================================
    /**
     * Cache order data for quick access
     */
    async cacheOrder(orderId, orderData) {
        const key = KEYS.ORDER_CACHE + orderId;
        await this.client.setex(key, TTL.ORDER_CACHE, JSON.stringify(orderData));
    }
    /**
     * Get cached order data
     */
    async getCachedOrder(orderId) {
        const key = KEYS.ORDER_CACHE + orderId;
        const data = await this.client.get(key);
        return data ? JSON.parse(data) : null;
    }
    /**
     * Invalidate order cache
     */
    async invalidateOrderCache(orderId) {
        await this.client.del(KEYS.ORDER_CACHE + orderId);
    }
    // ==========================================================================
    // Pub/Sub for Real-time Events
    // ==========================================================================
    /**
     * Publish event to a channel
     */
    async publish(channel, message) {
        await this.client.publish(channel, JSON.stringify(message));
    }
    /**
     * Subscribe to a channel
     */
    async subscribe(channel, callback) {
        await this.subscriber.subscribe(channel);
        this.subscriber.on('message', (ch, message) => {
            if (ch === channel) {
                callback(JSON.parse(message));
            }
        });
    }
    /**
     * Unsubscribe from a channel
     */
    async unsubscribe(channel) {
        await this.subscriber.unsubscribe(channel);
    }
    // ==========================================================================
    // Generic Cache Operations
    // ==========================================================================
    async get(key) {
        return this.client.get(key);
    }
    async set(key, value, ttlSeconds) {
        if (ttlSeconds) {
            await this.client.setex(key, ttlSeconds, value);
        }
        else {
            await this.client.set(key, value);
        }
    }
    async del(key) {
        await this.client.del(key);
    }
    async incr(key) {
        return this.client.incr(key);
    }
    async expire(key, seconds) {
        await this.client.expire(key, seconds);
    }
    // ==========================================================================
    // Health & Stats
    // ==========================================================================
    async ping() {
        try {
            const result = await this.client.ping();
            return result === 'PONG';
        }
        catch {
            return false;
        }
    }
    async getOnlineDriverCount() {
        return this.client.zcard(KEYS.DRIVER_GEO);
    }
    // ==========================================================================
    // Pub/Sub for Cluster Communication
    // ==========================================================================
    /**
     * Subscribe to WebSocket message channel for cross-cluster communication
     * @param handler Callback function to handle incoming messages
     */
    async subscribeToWsMessages(handler) {
        this.messageHandlers.set(CHANNELS.WS_MESSAGE, handler);
        await this.subscriber.subscribe(CHANNELS.WS_MESSAGE);
        logger_1.logger.info('Subscribed to WebSocket message channel for cluster communication');
    }
    /**
     * Subscribe to broadcast channel for admin-initiated events
     * @param handler Callback function to handle broadcast messages
     */
    async subscribeToBroadcast(handler) {
        this.messageHandlers.set(CHANNELS.WS_BROADCAST, handler);
        await this.subscriber.subscribe(CHANNELS.WS_BROADCAST);
        logger_1.logger.info('Subscribed to WebSocket broadcast channel');
    }
    /**
     * Publish a WebSocket message to all cluster instances
     * Used when target client is not on current instance
     */
    async publishWsMessage(did, message) {
        const payload = JSON.stringify({ did, message });
        await this.client.publish(CHANNELS.WS_MESSAGE, payload);
        logger_1.logger.debug('Published WebSocket message to cluster', { did, type: message.type });
    }
    /**
     * Clean shutdown
     */
    async close() {
        await this.subscriber.quit();
        await this.client.quit();
    }
}
exports.RedisService = RedisService;
// Singleton instance
let redisInstance = null;
function getRedisService() {
    if (!redisInstance) {
        redisInstance = new RedisService();
    }
    return redisInstance;
}
