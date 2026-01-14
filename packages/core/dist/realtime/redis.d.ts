/**
 * Redis Service
 * Handles real-time driver locations, caching, and pub/sub
 */
export declare class RedisService {
    private client;
    private subscriber;
    private messageHandlers;
    constructor();
    /**
     * Update driver's current location
     */
    setDriverLocation(did: string, latitude: number, longitude: number, heading?: number): Promise<void>;
    /**
     * Get driver's current location
     */
    getDriverLocation(did: string): Promise<{
        latitude: number;
        longitude: number;
        heading: number;
        updatedAt: number;
    } | null>;
    /**
     * Remove driver from location tracking (went offline)
     */
    removeDriverLocation(did: string): Promise<void>;
    /**
     * Find drivers within radius (km) of a point
     */
    getNearbyDrivers(latitude: number, longitude: number, radiusKm: number, limit?: number): Promise<string[]>;
    /**
     * Get distance between driver and a point
     */
    getDriverDistance(did: string, latitude: number, longitude: number): Promise<number | null>;
    /**
     * Cache order data for quick access
     */
    cacheOrder(orderId: string, orderData: any): Promise<void>;
    /**
     * Get cached order data
     */
    getCachedOrder(orderId: string): Promise<any | null>;
    /**
     * Invalidate order cache
     */
    invalidateOrderCache(orderId: string): Promise<void>;
    /**
     * Publish event to a channel
     */
    publish(channel: string, message: any): Promise<void>;
    /**
     * Subscribe to a channel
     */
    subscribe(channel: string, callback: (message: any) => void): Promise<void>;
    /**
     * Unsubscribe from a channel
     */
    unsubscribe(channel: string): Promise<void>;
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttlSeconds?: number): Promise<void>;
    del(key: string): Promise<void>;
    incr(key: string): Promise<number>;
    expire(key: string, seconds: number): Promise<void>;
    ping(): Promise<boolean>;
    getOnlineDriverCount(): Promise<number>;
    /**
     * Subscribe to WebSocket message channel for cross-cluster communication
     * @param handler Callback function to handle incoming messages
     */
    subscribeToWsMessages(handler: (message: {
        did: string;
        message: any;
    }) => void): Promise<void>;
    /**
     * Subscribe to broadcast channel for admin-initiated events
     * @param handler Callback function to handle broadcast messages
     */
    subscribeToBroadcast(handler: (message: any) => void): Promise<void>;
    /**
     * Publish a WebSocket message to all cluster instances
     * Used when target client is not on current instance
     */
    publishWsMessage(did: string, message: any): Promise<void>;
    /**
     * Clean shutdown
     */
    close(): Promise<void>;
}
export declare function getRedisService(): RedisService;
