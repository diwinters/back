/**
 * Redis Service
 * Handles real-time driver locations, caching, and pub/sub
 */

import Redis from 'ioredis'
import { logger } from '../utils/logger'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

// Key prefixes
const KEYS = {
  DRIVER_LOCATION: 'driver:location:',
  DRIVER_GEO: 'drivers:geo',
  ORDER_CACHE: 'order:',
  SESSION: 'session:',
}

// Pub/Sub channels for cluster communication
const CHANNELS = {
  WS_MESSAGE: 'ws:message',  // Cross-instance WebSocket messages
  WS_BROADCAST: 'ws:broadcast',  // Broadcast to all drivers (from admin, etc.)
}

// TTLs in seconds
const TTL = {
  DRIVER_LOCATION: 300, // 5 minutes - stale if not updated
  ORDER_CACHE: 3600,    // 1 hour
  SESSION: 86400 * 7,   // 7 days
}

export class RedisService {
  private client: Redis
  private subscriber: Redis
  private messageHandlers: Map<string, (message: any) => void> = new Map()

  constructor() {
    this.client = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 100, 3000),
    })

    this.subscriber = new Redis(REDIS_URL)

    this.client.on('error', (error: any) => {
      logger.error('Redis client error', { error })
    })

    this.client.on('connect', () => {
      logger.info('Redis connected')
    })

    // Set up pub/sub message handling
    this.subscriber.on('message', (channel, message) => {
      const handler = this.messageHandlers.get(channel)
      if (handler) {
        try {
          const data = JSON.parse(message)
          handler(data)
        } catch (error) {
          logger.error('Failed to parse pub/sub message', { channel, error })
        }
      }
    })
  }

  // ==========================================================================
  // Driver Location Management
  // ==========================================================================

  /**
   * Update driver's current location
   */
  async setDriverLocation(
    did: string,
    latitude: number,
    longitude: number,
    heading?: number
  ): Promise<void> {
    try {
      const key = KEYS.DRIVER_LOCATION + did
      const data = {
        latitude,
        longitude,
        heading: heading ?? 0,
        updatedAt: Date.now(),
      }

      // Store location data with timeout
      const timeoutPromise = new Promise<void>((_, reject) => 
        setTimeout(() => reject(new Error('Redis setDriverLocation timeout')), 3000)
      )
      
      const setPromise = (async () => {
        await this.client.setex(key, TTL.DRIVER_LOCATION, JSON.stringify(data))
        await this.client.geoadd(KEYS.DRIVER_GEO, longitude, latitude, did)
      })()
      
      await Promise.race([setPromise, timeoutPromise])
    } catch (error) {
      logger.error('Redis setDriverLocation failed', { did, error })
      // Don't throw - location update failure shouldn't crash the app
    }
  }

  /**
   * Get driver's current location
   */
  async getDriverLocation(did: string): Promise<{
    latitude: number
    longitude: number
    heading: number
    updatedAt: number
  } | null> {
    const key = KEYS.DRIVER_LOCATION + did
    const data = await this.client.get(key)
    
    if (!data) return null
    return JSON.parse(data)
  }

  /**
   * Remove driver from location tracking (went offline)
   */
  async removeDriverLocation(did: string): Promise<void> {
    await this.client.del(KEYS.DRIVER_LOCATION + did)
    await this.client.zrem(KEYS.DRIVER_GEO, did)
  }

  /**
   * Find drivers within radius (km) of a point
   */
  async getNearbyDrivers(
    latitude: number,
    longitude: number,
    radiusKm: number,
    limit: number = 20
  ): Promise<string[]> {
    try {
      // Add timeout to prevent hanging if Redis is unresponsive
      const timeoutPromise = new Promise<string[]>((_, reject) => 
        setTimeout(() => reject(new Error('Redis getNearbyDrivers timeout')), 5000)
      )
      
      const queryPromise = this.client.georadius(
        KEYS.DRIVER_GEO,
        longitude,
        latitude,
        radiusKm,
        'km',
        'ASC',
        'COUNT',
        limit
      )
      
      const results = await Promise.race([queryPromise, timeoutPromise])
      return results as string[]
    } catch (error) {
      logger.error('Redis getNearbyDrivers failed', { error })
      return [] // Return empty array on failure instead of throwing
    }
  }

  /**
   * Get distance between driver and a point
   */
  async getDriverDistance(
    did: string,
    latitude: number,
    longitude: number
  ): Promise<number | null> {
    // Add temporary point to calculate distance
    const tempKey = `temp:${Date.now()}`
    await this.client.geoadd(KEYS.DRIVER_GEO, longitude, latitude, tempKey)
    
    const distance = await this.client.geodist(KEYS.DRIVER_GEO, did, tempKey, 'km' as any)
    
    // Clean up temp point
    await this.client.zrem(KEYS.DRIVER_GEO, tempKey)
    
    return distance ? parseFloat(distance) : null
  }

  // ==========================================================================
  // Order Caching
  // ==========================================================================

  /**
   * Cache order data for quick access
   */
  async cacheOrder(orderId: string, orderData: any): Promise<void> {
    const key = KEYS.ORDER_CACHE + orderId
    await this.client.setex(key, TTL.ORDER_CACHE, JSON.stringify(orderData))
  }

  /**
   * Get cached order data
   */
  async getCachedOrder(orderId: string): Promise<any | null> {
    const key = KEYS.ORDER_CACHE + orderId
    const data = await this.client.get(key)
    return data ? JSON.parse(data) : null
  }

  /**
   * Invalidate order cache
   */
  async invalidateOrderCache(orderId: string): Promise<void> {
    await this.client.del(KEYS.ORDER_CACHE + orderId)
  }

  // ==========================================================================
  // Pub/Sub for Real-time Events
  // ==========================================================================

  /**
   * Publish event to a channel
   */
  async publish(channel: string, message: any): Promise<void> {
    await this.client.publish(channel, JSON.stringify(message))
  }

  /**
   * Subscribe to a channel
   */
  async subscribe(channel: string, callback: (message: any) => void): Promise<void> {
    await this.subscriber.subscribe(channel)
    
    this.subscriber.on('message', (ch, message) => {
      if (ch === channel) {
        callback(JSON.parse(message))
      }
    })
  }

  /**
   * Unsubscribe from a channel
   */
  async unsubscribe(channel: string): Promise<void> {
    await this.subscriber.unsubscribe(channel)
  }

  // ==========================================================================
  // Generic Cache Operations
  // ==========================================================================

  async get(key: string): Promise<string | null> {
    return this.client.get(key)
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.setex(key, ttlSeconds, value)
    } else {
      await this.client.set(key, value)
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key)
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key)
  }

  async expire(key: string, seconds: number): Promise<void> {
    await this.client.expire(key, seconds)
  }

  // ==========================================================================
  // Health & Stats
  // ==========================================================================

  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping()
      return result === 'PONG'
    } catch {
      return false
    }
  }

  async getOnlineDriverCount(): Promise<number> {
    return this.client.zcard(KEYS.DRIVER_GEO)
  }

  // ==========================================================================
  // Pub/Sub for Cluster Communication
  // ==========================================================================

  /**
   * Subscribe to WebSocket message channel for cross-cluster communication
   * @param handler Callback function to handle incoming messages
   */
  async subscribeToWsMessages(handler: (message: { did: string; message: any }) => void): Promise<void> {
    this.messageHandlers.set(CHANNELS.WS_MESSAGE, handler)
    await this.subscriber.subscribe(CHANNELS.WS_MESSAGE)
    logger.info('Subscribed to WebSocket message channel for cluster communication')
  }

  /**
   * Subscribe to broadcast channel for admin-initiated events
   * @param handler Callback function to handle broadcast messages
   */
  async subscribeToBroadcast(handler: (message: any) => void): Promise<void> {
    this.messageHandlers.set(CHANNELS.WS_BROADCAST, handler)
    await this.subscriber.subscribe(CHANNELS.WS_BROADCAST)
    logger.info('Subscribed to WebSocket broadcast channel')
  }

  /**
   * Publish a WebSocket message to all cluster instances
   * Used when target client is not on current instance
   */
  async publishWsMessage(did: string, message: any): Promise<void> {
    const payload = JSON.stringify({ did, message })
    await this.client.publish(CHANNELS.WS_MESSAGE, payload)
    logger.debug('Published WebSocket message to cluster', { did, type: message.type })
  }

  /**
   * Clean shutdown
   */
  async close(): Promise<void> {
    await this.subscriber.quit()
    await this.client.quit()
  }
}

// Singleton instance
let redisInstance: RedisService | null = null

export function getRedisService(): RedisService {
  if (!redisInstance) {
    redisInstance = new RedisService()
  }
  return redisInstance
}
