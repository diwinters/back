/**
 * WebSocket Server for Real-time Updates
 * Handles live location tracking, order status, and driver availability
 */

import { Server as HttpServer } from 'http'
import { WebSocket, WebSocketServer as WSServer } from 'ws'
import { extractDid } from '../auth/did'
import { logger } from '../utils/logger'
import { RedisService } from './redis'

export interface WSClient {
  ws: WebSocket
  did: string
  role: 'user' | 'driver'
  subscriptions: Set<string>
  lastPing: number
}

export interface WSMessage {
  type: string
  payload: any
  timestamp?: number
}

export class WebSocketServer {
  private wss: WSServer
  private clients: Map<string, WSClient> = new Map()
  private redis: RedisService
  private pingInterval: NodeJS.Timeout | null = null
  private instanceId: string

  constructor(server: HttpServer, redis: RedisService) {
    this.redis = redis
    this.instanceId = `ws-${process.pid}-${Date.now()}`
    this.wss = new WSServer({ 
      server,
      path: '/ws',
      verifyClient: this.verifyClient.bind(this),
    })

    this.setupServer()
    this.startPingInterval()
    this.setupClusterMessaging()
  }

  /**
   * Set up Redis pub/sub for cross-cluster WebSocket messaging
   */
  private async setupClusterMessaging() {
    // Listen for targeted messages to specific DIDs
    await this.redis.subscribeToWsMessages(({ did, message }) => {
      // Check if we have this client locally
      const client = this.clients.get(did)
      if (client && client.ws.readyState === WebSocket.OPEN) {
        logger.info('Received cluster message, forwarding to local client', { 
          did, 
          type: message.type,
          instanceId: this.instanceId 
        })
        this.send(client.ws, message)
      }
    })

    // Listen for broadcast messages (e.g., new orders from admin)
    await this.redis.subscribeToBroadcast(async (broadcastMessage) => {
      logger.info('Received broadcast message', { type: broadcastMessage.type, instanceId: this.instanceId })
      
      if (broadcastMessage.type === 'broadcast_new_order') {
        // Broadcast to all connected drivers
        const orderPayload = broadcastMessage.payload
        const message = {
          type: 'new_order',
          payload: orderPayload,
        }
        
        const notifiedDrivers: string[] = []
        for (const client of this.clients.values()) {
          if (client.role === 'driver' && client.ws.readyState === WebSocket.OPEN) {
            this.send(client.ws, message)
            notifiedDrivers.push(client.did)
          }
        }
        
        logger.info('Broadcast new order to drivers', { 
          orderId: orderPayload.id, 
          driverCount: notifiedDrivers.length,
          drivers: notifiedDrivers,
          instanceId: this.instanceId 
        })
      }
    })

    logger.info('WebSocket cluster messaging initialized', { instanceId: this.instanceId })
  }

  private verifyClient(info: { origin: string; req: any }, callback: (result: boolean, code?: number, message?: string) => void) {
    // Try authorization header first
    const authHeader = info.req.headers.authorization
    let did = extractDid(authHeader)
    
    // If no header, try query string (for React Native/browser clients)
    if (!did) {
      const url = new URL(info.req.url, 'ws://localhost')
      did = url.searchParams.get('did') || undefined
    }
    
    if (!did) {
      callback(false, 401, 'Unauthorized')
      return
    }
    
    // Attach DID to request for later use
    info.req.did = did
    callback(true)
  }

  private setupServer() {
    this.wss.on('connection', (ws: WebSocket, req: any) => {
      const did = req.did as string
      const role = req.url?.includes('role=driver') ? 'driver' : 'user'
      
      const client: WSClient = {
        ws,
        did,
        role,
        subscriptions: new Set(),
        lastPing: Date.now(),
      }

      // Store client by DID
      this.clients.set(did, client)
      
      logger.info('WebSocket client connected', { did, role, totalClients: this.clients.size })
      
      // Log all connected clients for debugging
      const connectedDids = Array.from(this.clients.keys())
      logger.debug('Connected clients', { connectedDids })

      // Send welcome message
      this.send(ws, {
        type: 'connected',
        payload: { did, role },
      })

      ws.on('message', (data: Buffer) => {
        this.handleMessage(client, data)
      })

      ws.on('close', () => {
        this.handleDisconnect(client)
      })

      ws.on('error', (error) => {
        logger.error('WebSocket error', { did, error })
      })

      ws.on('pong', () => {
        client.lastPing = Date.now()
      })
    })
  }

  private async handleMessage(client: WSClient, data: Buffer) {
    try {
      const message: WSMessage = JSON.parse(data.toString())
      
      switch (message.type) {
        case 'subscribe':
          // Subscribe to order updates, driver location, etc.
          this.handleSubscribe(client, message.payload)
          break

        case 'unsubscribe':
          this.handleUnsubscribe(client, message.payload)
          break

        case 'driver_location':
          // Driver sending location update
          await this.handleDriverLocation(client, message.payload)
          break

        case 'ping':
          this.send(client.ws, { type: 'pong', payload: {} })
          break

        default:
          logger.warn('Unknown WebSocket message type', { type: message.type })
      }
    } catch (error) {
      logger.error('Failed to handle WebSocket message', { error })
    }
  }

  private handleSubscribe(client: WSClient, payload: { channel: string }) {
    const { channel } = payload
    client.subscriptions.add(channel)
    
    logger.debug('Client subscribed', { did: client.did, channel })
    
    this.send(client.ws, {
      type: 'subscribed',
      payload: { channel },
    })
  }

  private handleUnsubscribe(client: WSClient, payload: { channel: string }) {
    const { channel } = payload
    client.subscriptions.delete(channel)
    
    logger.debug('Client unsubscribed', { did: client.did, channel })
  }

  private async handleDriverLocation(client: WSClient, payload: { 
    latitude: number
    longitude: number
    heading?: number
    orderId?: string
  }) {
    if (client.role !== 'driver') {
      return
    }

    const { latitude, longitude, heading, orderId } = payload

    // Store in Redis for real-time access
    await this.redis.setDriverLocation(client.did, latitude, longitude, heading)

    // If driver is on an active order, broadcast to the user
    if (orderId) {
      this.broadcastToChannel(`order:${orderId}`, {
        type: 'driver_location',
        payload: { latitude, longitude, heading, orderId },
      })
    }
  }

  private handleDisconnect(client: WSClient) {
    this.clients.delete(client.did)
    logger.info('WebSocket client disconnected', { did: client.did })
  }

  /**
   * Send message to a specific DID
   * If client not on this instance, publishes to Redis for other instances to handle
   */
  async sendToDid(did: string, message: WSMessage): Promise<boolean> {
    const client = this.clients.get(did)
    logger.debug('sendToDid called', { did, hasClient: !!client, clientState: client?.ws?.readyState, instanceId: this.instanceId })
    
    if (client && client.ws.readyState === WebSocket.OPEN) {
      this.send(client.ws, message)
      logger.info('Message sent to DID (local)', { did, type: message.type })
      return true
    }
    
    // Client not on this instance - publish to Redis for other cluster instances
    logger.info('Client not on this instance, publishing to cluster', { did, type: message.type, instanceId: this.instanceId })
    await this.redis.publishWsMessage(did, message)
    return true // Return true since message was published to cluster
  }

  /**
   * Broadcast message to all subscribers of a channel
   */
  broadcastToChannel(channel: string, message: WSMessage) {
    for (const client of this.clients.values()) {
      if (client.subscriptions.has(channel) && client.ws.readyState === WebSocket.OPEN) {
        this.send(client.ws, message)
      }
    }
  }

  /**
   * Broadcast to all drivers in a geographic area
   * @param excludeDriverIds - Array of driver user IDs to exclude (e.g., drivers who declined)
   */
  async broadcastToNearbyDrivers(
    latitude: number,
    longitude: number,
    radiusKm: number,
    message: WSMessage,
    excludeDriverIds: string[] = []
  ): Promise<string[]> {
    // Try to get nearby drivers from Redis geo index
    const nearbyDriverDids = await this.redis.getNearbyDrivers(latitude, longitude, radiusKm)
    
    // Filter out excluded drivers
    const filteredDids = nearbyDriverDids.filter(did => !excludeDriverIds.includes(did))
    
    // If we found drivers in Redis, send to them
    if (filteredDids.length > 0) {
      for (const did of filteredDids) {
        await this.sendToDid(did, message)
      }
      logger.info('Broadcast to nearby drivers from Redis', { 
        count: filteredDids.length, 
        excluded: excludeDriverIds.length 
      })
      return filteredDids
    }
    
    // Fallback: If no drivers in Redis (geo index empty), broadcast to ALL connected drivers
    // This ensures drivers get orders even if location tracking hasn't populated Redis yet
    const allDriverDids: string[] = []
    for (const client of this.clients.values()) {
      if (client.role === 'driver' && client.ws.readyState === WebSocket.OPEN) {
        // Skip excluded drivers
        if (excludeDriverIds.includes(client.did)) continue
        
        this.send(client.ws, message)
        allDriverDids.push(client.did)
      }
    }
    
    if (allDriverDids.length > 0) {
      logger.info('Broadcast to all connected drivers (fallback)', { 
        count: allDriverDids.length,
        excluded: excludeDriverIds.length 
      })
    }
    
    return allDriverDids
  }

  /**
   * Send order update to user
   */
  async sendOrderUpdate(userDid: string, orderId: string, status: string, data: any = {}) {
    await this.sendToDid(userDid, {
      type: 'order_update',
      payload: { orderId, status, ...data },
    })
  }

  /**
   * Send new order request to driver
   */
  async sendOrderRequest(driverDid: string, orderData: any) {
    await this.sendToDid(driverDid, {
      type: 'new_order_request',
      payload: orderData,
    })
  }

  private send(ws: WebSocket, message: WSMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        ...message,
        timestamp: Date.now(),
      }))
    }
  }

  private startPingInterval() {
    // Ping clients every 30 seconds
    this.pingInterval = setInterval(() => {
      const now = Date.now()
      
      for (const [did, client] of this.clients) {
        if (client.ws.readyState === WebSocket.OPEN) {
          // Disconnect if no pong received in 60 seconds
          if (now - client.lastPing > 60000) {
            logger.warn('Client timed out', { did })
            client.ws.terminate()
            this.clients.delete(did)
          } else {
            client.ws.ping()
          }
        }
      }
    }, 30000)
  }

  /**
   * Get count of connected clients
   */
  getStats() {
    let drivers = 0
    let users = 0
    
    for (const client of this.clients.values()) {
      if (client.role === 'driver') drivers++
      else users++
    }
    
    return { total: this.clients.size, drivers, users }
  }

  /**
   * Clean shutdown
   */
  close() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
    }
    
    for (const client of this.clients.values()) {
      client.ws.close(1001, 'Server shutting down')
    }
    
    this.wss.close()
  }
}

// Global WebSocket server instance for cross-service access
let wsServerInstance: WebSocketServer | null = null

/**
 * Set the global WebSocket server instance
 * Called from gateway server initialization
 */
export function setWebSocketServer(server: WebSocketServer): void {
  wsServerInstance = server
}

/**
 * Get the global WebSocket server instance
 * Returns null if not initialized
 */
export function getWebSocketServer(): WebSocketServer | null {
  return wsServerInstance
}
