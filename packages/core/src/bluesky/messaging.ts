/**
 * Bluesky DM Messaging Service
 * Integration with Bluesky DMs for order communication
 */

import { logger } from '../utils/logger'

export interface ConversationMember {
  did: string
  handle?: string
}

export interface ChatMessage {
  text: string
  facets?: any[]
  embed?: any
}

export interface Conversation {
  id: string
  members: ConversationMember[]
  lastMessage?: {
    id: string
    text: string
    sender: string
    sentAt: Date
  }
}

export class BlueskyMessaging {
  private agent: any = null
  private serviceHandle: string

  constructor(
    private serviceIdentifier: string,
    private servicePassword: string
  ) {
    this.serviceHandle = serviceIdentifier
  }

  /**
   * Initialize the Bluesky agent
   */
  async initialize(): Promise<void> {
    try {
      // Dynamic import to avoid bundling ATP client if not needed
      const { BskyAgent } = await import('@atproto/api')
      
      this.agent = new BskyAgent({
        service: 'https://bsky.social',
      })

      await this.agent.login({
        identifier: this.serviceIdentifier,
        password: this.servicePassword,
      })

      logger.info('Bluesky messaging agent initialized', { handle: this.serviceHandle })
    } catch (error) {
      logger.error('Failed to initialize Bluesky agent', { error })
      throw error
    }
  }

  /**
   * Create a conversation between rider and driver
   */
  async createConversation(
    riderDid: string,
    driverDid: string
  ): Promise<string> {
    await this.ensureInitialized()

    try {
      // Get or create conversation
      const response = await this.agent.api.chat.bsky.convo.getConvoForMembers({
        members: [riderDid, driverDid],
      })

      const conversationId = response.data.convo.id
      
      logger.info('Created/retrieved conversation', {
        conversationId,
        rider: riderDid,
        driver: driverDid,
      })

      return conversationId
    } catch (error) {
      logger.error('Failed to create conversation', { error, riderDid, driverDid })
      throw error
    }
  }

  /**
   * Send a message to a conversation
   */
  async sendMessage(
    conversationId: string,
    message: ChatMessage
  ): Promise<string> {
    await this.ensureInitialized()

    try {
      const response = await this.agent.api.chat.bsky.convo.sendMessage({
        convoId: conversationId,
        message: {
          text: message.text,
          facets: message.facets,
          embed: message.embed,
        },
      })

      logger.debug('Message sent', { conversationId, messageId: response.data.id })

      return response.data.id
    } catch (error) {
      logger.error('Failed to send message', { error, conversationId })
      throw error
    }
  }

  /**
   * Send order-related message templates
   */
  async sendOrderMessage(
    conversationId: string,
    type: 'ORDER_CREATED' | 'DRIVER_ASSIGNED' | 'DRIVER_ARRIVED' | 'TRIP_STARTED' | 'TRIP_COMPLETED' | 'ORDER_CANCELLED',
    data: {
      orderId: string
      driverName?: string
      vehicleInfo?: string
      pickupAddress?: string
      dropoffAddress?: string
      eta?: number
      fare?: number
      otp?: string
    }
  ): Promise<string> {
    const messages: Record<string, string> = {
      ORDER_CREATED: `🚗 Your ride request has been created!\n\nPickup: ${data.pickupAddress}\nDropoff: ${data.dropoffAddress}\n\nLooking for a driver...`,
      DRIVER_ASSIGNED: `✅ Driver found!\n\n👤 ${data.driverName}\n🚗 ${data.vehicleInfo}\n⏱️ ETA: ${data.eta} minutes\n\nYour OTP: ${data.otp}`,
      DRIVER_ARRIVED: `📍 Your driver has arrived!\n\nOTP: ${data.otp}\n\nPlease share this code with your driver.`,
      TRIP_STARTED: `🚀 Trip started!\n\nYou're on your way to:\n${data.dropoffAddress}`,
      TRIP_COMPLETED: `🎉 Trip completed!\n\nFare: $${data.fare?.toFixed(2)}\n\nThank you for riding with us!`,
      ORDER_CANCELLED: `❌ Your ride has been cancelled.\n\nIf you didn't request this, please contact support.`,
    }

    const text = messages[type] || 'Order update'
    
    return this.sendMessage(conversationId, { text })
  }

  /**
   * Send delivery-specific messages
   */
  async sendDeliveryMessage(
    conversationId: string,
    type: 'PACKAGE_PICKUP' | 'IN_TRANSIT' | 'DELIVERED',
    data: {
      orderId: string
      driverName?: string
      recipientName?: string
      address?: string
      otp?: string
    }
  ): Promise<string> {
    const messages: Record<string, string> = {
      PACKAGE_PICKUP: `📦 Driver ${data.driverName} has picked up your package!\n\nDelivering to: ${data.recipientName}\n${data.address}`,
      IN_TRANSIT: `🚚 Your package is on the way!\n\nDriver: ${data.driverName}`,
      DELIVERED: `✅ Package delivered!\n\nRecipient: ${data.recipientName}\n\nThank you for using our delivery service!`,
    }

    const text = messages[type] || 'Delivery update'
    
    return this.sendMessage(conversationId, { text })
  }

  // ==========================================================================
  // MARKET ORDER MESSAGING
  // ==========================================================================

  /**
   * Create or get conversation between buyer and seller
   */
  async getOrCreateMarketConversation(
    buyerDid: string,
    sellerDid: string
  ): Promise<string> {
    await this.ensureInitialized()

    try {
      const response = await this.agent.api.chat.bsky.convo.getConvoForMembers({
        members: [buyerDid, sellerDid],
      })

      const conversationId = response.data.convo.id
      
      logger.info('Market conversation created/retrieved', {
        conversationId,
        buyer: buyerDid,
        seller: sellerDid,
      })

      return conversationId
    } catch (error) {
      logger.error('Failed to create market conversation', { error, buyerDid, sellerDid })
      throw error
    }
  }

  /**
   * Get post record for embedding
   */
  async getPostRecord(postUri: string): Promise<{ uri: string; cid: string } | null> {
    await this.ensureInitialized()

    try {
      // Parse the AT URI to get repo and rkey
      // Format: at://did:plc:xxx/app.bsky.feed.post/xxx
      const parts = postUri.replace('at://', '').split('/')
      const repo = parts[0]
      const rkey = parts[2]

      const response = await this.agent.api.app.bsky.feed.getPostThread({
        uri: postUri,
        depth: 0,
      })

      if (response.data.thread?.post) {
        return {
          uri: response.data.thread.post.uri,
          cid: response.data.thread.post.cid,
        }
      }

      return null
    } catch (error) {
      logger.error('Failed to get post record', { error, postUri })
      return null
    }
  }

  /**
   * Send market order notification to seller with embedded post
   * Returns both conversationId and messageId
   */
  async sendMarketOrderDM(
    buyerDid: string,
    sellerDid: string,
    orderData: {
      orderId: string
      total: number
      currency: string
      itemCount: number
      items: Array<{
        title: string
        quantity: number
        price: number
        postUri?: string
        postCid?: string
      }>
    }
  ): Promise<{ conversationId: string; messageId: string }> {
    await this.ensureInitialized()

    try {
      // Get or create conversation
      const conversationId = await this.getOrCreateMarketConversation(buyerDid, sellerDid)

      // Build the order summary text
      const itemsText = orderData.items.map(item => 
        `• ${item.title} x${item.quantity} - ${item.price} ${orderData.currency}`
      ).join('\n')

      const orderText = `🛒 New Order #${orderData.orderId.slice(-6).toUpperCase()}

💰 ${orderData.total} ${orderData.currency} • ${orderData.itemCount} item${orderData.itemCount > 1 ? 's' : ''}

${itemsText}`

      // Build embed with first product post if available
      let embed: any = undefined
      const firstItemWithPost = orderData.items.find(item => item.postUri && item.postCid)
      
      if (firstItemWithPost && firstItemWithPost.postUri && firstItemWithPost.postCid) {
        embed = {
          $type: 'app.bsky.embed.record',
          record: {
            uri: firstItemWithPost.postUri,
            cid: firstItemWithPost.postCid,
          },
        }
      }

      // Send the message
      const messageId = await this.sendMessage(conversationId, {
        text: orderText,
        embed,
      })

      logger.info('Market order DM sent', {
        conversationId,
        messageId,
        orderId: orderData.orderId,
        itemCount: orderData.itemCount,
      })

      return { conversationId, messageId }
    } catch (error) {
      logger.error('Failed to send market order DM', { error, buyerDid, sellerDid })
      throw error
    }
  }

  /**
   * Send order status update message
   */
  async sendOrderStatusUpdate(
    conversationId: string,
    type: 'CONFIRMED' | 'PACKAGED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'DISPUTED',
    data: {
      orderId: string
      itemTitle?: string
      trackingNumber?: string
      estimatedDelivery?: string
      reason?: string
    }
  ): Promise<string> {
    const messages: Record<string, string> = {
      CONFIRMED: `✅ Order confirmed!\n\nOrder #${data.orderId.slice(-6).toUpperCase()}\n${data.itemTitle || ''}\n\nSeller is preparing your order.`,
      PACKAGED: `📦 Order packaged!\n\nOrder #${data.orderId.slice(-6).toUpperCase()}\n${data.itemTitle || ''}\n\nYour order is ready to ship.`,
      SHIPPED: `🚚 Order shipped!\n\nOrder #${data.orderId.slice(-6).toUpperCase()}\n${data.itemTitle || ''}\n${data.trackingNumber ? `Tracking: ${data.trackingNumber}` : ''}\n${data.estimatedDelivery ? `ETA: ${data.estimatedDelivery}` : ''}`,
      DELIVERED: `✅ Order delivered!\n\nOrder #${data.orderId.slice(-6).toUpperCase()}\n${data.itemTitle || ''}\n\nPlease confirm receipt to release payment.`,
      CANCELLED: `❌ Order cancelled\n\nOrder #${data.orderId.slice(-6).toUpperCase()}\n${data.itemTitle || ''}\n${data.reason ? `Reason: ${data.reason}` : ''}`,
      DISPUTED: `⚠️ Dispute opened\n\nOrder #${data.orderId.slice(-6).toUpperCase()}\n${data.itemTitle || ''}\n${data.reason ? `Reason: ${data.reason}` : ''}\n\nOur team will review and respond within 24-48 hours.`,
    }

    const text = messages[type] || 'Order update'
    
    return this.sendMessage(conversationId, { text })
  }

  /**
   * Get conversation messages
   */
  async getMessages(
    conversationId: string,
    options: { limit?: number; cursor?: string } = {}
  ): Promise<{
    messages: Array<{
      id: string
      text: string
      sender: string
      sentAt: Date
    }>
    cursor?: string
  }> {
    await this.ensureInitialized()

    try {
      const response = await this.agent.api.chat.bsky.convo.getMessages({
        convoId: conversationId,
        limit: options.limit || 50,
        cursor: options.cursor,
      })

      return {
        messages: response.data.messages.map((m: any) => ({
          id: m.id,
          text: m.text,
          sender: m.sender.did,
          sentAt: new Date(m.sentAt),
        })),
        cursor: response.data.cursor,
      }
    } catch (error) {
      logger.error('Failed to get messages', { error, conversationId })
      throw error
    }
  }

  /**
   * Leave/archive a conversation
   */
  async leaveConversation(conversationId: string): Promise<void> {
    await this.ensureInitialized()

    try {
      await this.agent.api.chat.bsky.convo.leaveConvo({
        convoId: conversationId,
      })

      logger.info('Left conversation', { conversationId })
    } catch (error) {
      logger.error('Failed to leave conversation', { error, conversationId })
      // Don't throw - this is a cleanup operation
    }
  }

  /**
   * Ensure the agent is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.agent) {
      await this.initialize()
    }
  }
}

// Singleton instance
let messagingInstance: BlueskyMessaging | null = null

export function getBlueskyMessaging(): BlueskyMessaging {
  if (!messagingInstance) {
    const identifier = process.env.BSKY_SERVICE_IDENTIFIER
    const password = process.env.BSKY_SERVICE_PASSWORD

    if (!identifier || !password) {
      throw new Error('BSKY_SERVICE_IDENTIFIER and BSKY_SERVICE_PASSWORD must be set')
    }

    messagingInstance = new BlueskyMessaging(identifier, password)
  }

  return messagingInstance
}
