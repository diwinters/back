/**
 * Jetstream Consumer
 * WebSocket client for consuming Bluesky Jetstream events
 * 
 * Connects to public Jetstream servers and filters events by DIDs
 * Supports reconnection with cursor-based resume
 */

import WebSocket from 'ws'
import { logger } from '../utils/logger'
import { RedisService } from '../realtime/redis'
import type { JetstreamEvent } from './types'

// Public Jetstream servers
const JETSTREAM_ENDPOINTS = [
  'wss://jetstream2.us-east.bsky.network/subscribe',
  'wss://jetstream1.us-east.bsky.network/subscribe',
  'wss://jetstream2.us-west.bsky.network/subscribe',
]

// Redis keys for state persistence
const REDIS_KEYS = {
  CURSOR: 'jetstream:cursor',
  STATUS: 'jetstream:status',
  LAST_EVENT: 'jetstream:last_event',
}

export interface JetstreamConsumerOptions {
  onEvent: (event: JetstreamEvent) => Promise<void>
  onConnect?: () => void
  onDisconnect?: (code: number, reason: string) => void
  onError?: (error: Error) => void
  redis?: RedisService
  maxReconnectAttempts?: number
}

export class JetstreamConsumer {
  private ws: WebSocket | null = null
  private watchedDids: Set<string> = new Set()
  private cursor: bigint | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts: number
  private reconnecting = false
  private heartbeatInterval: NodeJS.Timeout | null = null
  private options: JetstreamConsumerOptions
  private redis?: RedisService
  private endpointIndex = 0
  private isShuttingDown = false

  constructor(options: JetstreamConsumerOptions) {
    this.options = options
    this.redis = options.redis
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10
  }

  /**
   * Initialize the consumer with DIDs to watch
   */
  async initialize(dids: string[], cursor?: bigint): Promise<void> {
    this.watchedDids = new Set(dids)
    
    // Try to restore cursor from Redis if not provided
    if (cursor) {
      this.cursor = cursor
    } else if (this.redis) {
      const savedCursor = await this.redis.get(REDIS_KEYS.CURSOR)
      if (savedCursor) {
        this.cursor = BigInt(savedCursor)
        logger.info('[Jetstream] Restored cursor from Redis', { cursor: this.cursor.toString() })
      }
    }

    logger.info('[Jetstream] Consumer initialized', {
      didCount: this.watchedDids.size,
      cursor: this.cursor?.toString() ?? 'none',
    })
  }

  /**
   * Connect to Jetstream
   */
  connect(): void {
    if (this.isShuttingDown) {
      logger.info('[Jetstream] Skipping connect - shutting down')
      return
    }

    const endpoint = JETSTREAM_ENDPOINTS[this.endpointIndex]
    const params = new URLSearchParams()
    
    // Add collection filter
    params.append('wantedCollections', 'app.bsky.feed.post')
    
    // Add DID filters (up to 10,000)
    const dids = Array.from(this.watchedDids).slice(0, 10000)
    for (const did of dids) {
      params.append('wantedDids', did)
    }
    
    // Add cursor for resume
    if (this.cursor) {
      params.append('cursor', this.cursor.toString())
    }

    const url = `${endpoint}?${params.toString()}`
    
    logger.info('[Jetstream] Connecting...', {
      endpoint,
      dids: dids.length,
      cursor: this.cursor?.toString() ?? 'none',
    })

    try {
      this.ws = new WebSocket(url)
      this.setupEventHandlers()
    } catch (error) {
      logger.error('[Jetstream] Failed to create WebSocket', { error })
      this.scheduleReconnect()
    }
  }

  private setupEventHandlers(): void {
    if (!this.ws) return

    this.ws.on('open', () => {
      logger.info('[Jetstream] Connected')
      this.reconnectAttempts = 0
      this.reconnecting = false
      this.startHeartbeat()
      this.updateStatus('running')
      this.options.onConnect?.()
    })

    this.ws.on('message', async (data: Buffer) => {
      try {
        const event: JetstreamEvent = JSON.parse(data.toString())
        
        // Update cursor for resume
        this.cursor = BigInt(event.time_us)
        
        // Persist cursor periodically (every 100 events)
        if (this.redis && Math.random() < 0.01) {
          await this.redis.set(REDIS_KEYS.CURSOR, this.cursor.toString())
        }
        
        // Process event
        await this.options.onEvent(event)
        
      } catch (error) {
        logger.error('[Jetstream] Failed to process event', { error })
      }
    })

    this.ws.on('close', (code, reason) => {
      const reasonStr = reason.toString()
      logger.warn('[Jetstream] Connection closed', { code, reason: reasonStr })
      this.stopHeartbeat()
      this.updateStatus('stopped')
      this.options.onDisconnect?.(code, reasonStr)
      
      if (!this.isShuttingDown) {
        this.scheduleReconnect()
      }
    })

    this.ws.on('error', (error) => {
      logger.error('[Jetstream] WebSocket error', { error })
      this.options.onError?.(error)
    })

    this.ws.on('pong', () => {
      // Connection is alive
    })
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping()
      }
    }, 30000) // 30 seconds
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnecting || this.isShuttingDown) return
    
    this.reconnecting = true
    this.reconnectAttempts++
    
    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      logger.error('[Jetstream] Max reconnect attempts reached')
      this.updateStatus('error', 'Max reconnect attempts reached')
      return
    }

    // Exponential backoff with jitter: 1s, 2s, 4s, 8s, ... max 30s
    const baseDelay = Math.min(30000, 1000 * Math.pow(2, this.reconnectAttempts - 1))
    const jitter = Math.random() * 1000
    const delay = baseDelay + jitter

    // Try next endpoint on reconnect
    this.endpointIndex = (this.endpointIndex + 1) % JETSTREAM_ENDPOINTS.length

    logger.info('[Jetstream] Reconnecting...', {
      attempt: this.reconnectAttempts,
      delay: Math.round(delay),
      nextEndpoint: JETSTREAM_ENDPOINTS[this.endpointIndex],
    })

    setTimeout(() => {
      this.reconnecting = false
      this.connect()
    }, delay)
  }

  private async updateStatus(status: string, errorMessage?: string): Promise<void> {
    if (this.redis) {
      await this.redis.set(REDIS_KEYS.STATUS, JSON.stringify({
        status,
        cursor: this.cursor?.toString(),
        watchedDidsCount: this.watchedDids.size,
        errorMessage,
        updatedAt: new Date().toISOString(),
      }))
    }
  }

  /**
   * Update the list of DIDs to watch (can be called while connected)
   */
  async updateWatchedDids(dids: string[]): Promise<void> {
    const newDids = new Set(dids)
    
    // Check if DIDs actually changed
    const hasChanges = dids.length !== this.watchedDids.size ||
      !dids.every(d => this.watchedDids.has(d))
    
    if (!hasChanges) {
      logger.debug('[Jetstream] No DID changes, skipping update')
      return
    }
    
    this.watchedDids = newDids
    
    logger.info('[Jetstream] Updating watched DIDs', { count: dids.length })
    
    // Reconnect with new DIDs
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.close(1000, 'Updating DID filter')
      // Will reconnect automatically with new DIDs
    }
  }

  /**
   * Get current cursor for persistence
   */
  getCursor(): bigint | null {
    return this.cursor
  }

  /**
   * Get count of watched DIDs
   */
  getWatchedDidsCount(): number {
    return this.watchedDids.size
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  /**
   * Disconnect and cleanup
   */
  async disconnect(): Promise<void> {
    this.isShuttingDown = true
    this.stopHeartbeat()
    
    // Persist final cursor
    if (this.redis && this.cursor) {
      await this.redis.set(REDIS_KEYS.CURSOR, this.cursor.toString())
      logger.info('[Jetstream] Saved cursor on disconnect', { cursor: this.cursor.toString() })
    }
    
    if (this.ws) {
      this.ws.close(1000, 'Shutting down')
      this.ws = null
    }
    
    await this.updateStatus('stopped')
    logger.info('[Jetstream] Disconnected')
  }
}
