/**
 * Push Notification Service
 * Sends notifications via Expo's push notification service
 */

import Expo, { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk'
import { prisma } from '../db/prisma'
import { logger } from '../utils/logger'

export interface PushPayload {
  title: string
  body: string
  data?: Record<string, any>
  sound?: 'default' | null
  badge?: number
  channelId?: string
  priority?: 'default' | 'normal' | 'high'
  categoryId?: string
}

export interface OrderNotificationData {
  type: 'new_order' | 'order_accepted' | 'driver_arriving' | 'driver_arrived' | 'trip_started' | 'trip_completed' | 'order_cancelled'
  orderId: string
  orderType: 'RIDE' | 'DELIVERY'
  [key: string]: any
}

export class PushNotificationService {
  private expo: Expo

  constructor() {
    this.expo = new Expo({
      accessToken: process.env.EXPO_ACCESS_TOKEN,
    })
  }

  /**
   * Send push notification to a single user
   */
  async sendToUser(userId: string, payload: PushPayload): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { pushToken: true },
    })

    if (!user?.pushToken) {
      logger.warn('No push token for user', { userId })
      return false
    }

    return this.sendToToken(user.pushToken, payload, userId)
  }

  /**
   * Send push notification to a user by DID
   */
  async sendToUserByDid(did: string, payload: PushPayload): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { did },
      select: { id: true, pushToken: true },
    })

    if (!user?.pushToken) {
      logger.warn('No push token for DID', { did })
      return false
    }

    return this.sendToToken(user.pushToken, payload, user.id)
  }

  /**
   * Send push notification to multiple users
   */
  async sendToUsers(userIds: string[], payload: PushPayload): Promise<Map<string, boolean>> {
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, pushToken: true },
    })

    const results = new Map<string, boolean>()
    
    const messages: ExpoPushMessage[] = []
    const userIdByToken = new Map<string, string>()

    for (const user of users) {
      if (user.pushToken && Expo.isExpoPushToken(user.pushToken)) {
        messages.push(this.createMessage(user.pushToken, payload))
        userIdByToken.set(user.pushToken, user.id)
      } else {
        results.set(user.id, false)
      }
    }

    if (messages.length === 0) {
      return results
    }

    const chunks = this.expo.chunkPushNotifications(messages)
    
    for (const chunk of chunks) {
      try {
        const tickets = await this.expo.sendPushNotificationsAsync(chunk)
        
        for (let i = 0; i < tickets.length; i++) {
          const ticket = tickets[i]
          const token = (chunk[i] as ExpoPushMessage).to as string
          const userId = userIdByToken.get(token)
          
          if (userId) {
            const success = ticket.status === 'ok'
            results.set(userId, success)
            
            // Log notification
            await this.logNotification(userId, payload, success, 
              ticket.status === 'error' ? ticket.message : undefined)
          }
        }
      } catch (error) {
        logger.error('Failed to send push notifications', { error })
      }
    }

    return results
  }

  /**
   * Send notification to drivers in a geographic area
   */
  async notifyNearbyDrivers(
    latitude: number,
    longitude: number,
    radiusKm: number,
    payload: PushPayload,
    availabilityType?: 'RIDE' | 'DELIVERY' | 'BOTH'
  ): Promise<string[]> {
    // Find nearby online drivers
    const drivers = await prisma.$queryRaw<Array<{ userId: string }>>`
      SELECT d."userId"
      FROM "Driver" d
      JOIN "User" u ON d."userId" = u.id
      WHERE d."isOnline" = true
        AND u."pushToken" IS NOT NULL
        AND d."currentLatitude" IS NOT NULL
        AND d."currentLongitude" IS NOT NULL
        ${availabilityType ? prisma.$queryRaw`AND (d."availabilityType" = ${availabilityType} OR d."availabilityType" = 'BOTH')` : prisma.$queryRaw``}
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
    `

    const userIds = drivers.map(d => d.userId)
    
    if (userIds.length > 0) {
      await this.sendToUsers(userIds, payload)
    }

    return userIds
  }

  /**
   * Send new order notification to a specific driver
   */
  async sendOrderRequest(driverId: string, orderData: OrderNotificationData): Promise<boolean> {
    const payload: PushPayload = {
      title: orderData.orderType === 'RIDE' ? '🚗 New Ride Request' : '📦 New Delivery Request',
      body: `Pickup: ${orderData.pickupAddress}`,
      data: {
        ...orderData,
        action: 'open_order_request',
      },
      sound: 'default',
      priority: 'high',
      categoryId: 'order_request',
    }

    return this.sendToUser(driverId, payload)
  }

  /**
   * Send order status update to user
   */
  async sendOrderUpdate(userId: string, orderData: OrderNotificationData): Promise<boolean> {
    const titles: Record<string, string> = {
      order_accepted: '✅ Driver Accepted',
      driver_arriving: '🚗 Driver On The Way',
      driver_arrived: '📍 Driver Has Arrived',
      trip_started: '🚀 Trip Started',
      trip_completed: '🎉 Trip Completed',
      order_cancelled: '❌ Order Cancelled',
    }

    const payload: PushPayload = {
      title: titles[orderData.type] || 'Order Update',
      body: orderData.message || 'Check your order status',
      data: {
        ...orderData,
        action: 'open_order',
      },
      sound: 'default',
    }

    return this.sendToUser(userId, payload)
  }

  private async sendToToken(token: string, payload: PushPayload, userId: string): Promise<boolean> {
    if (!Expo.isExpoPushToken(token)) {
      logger.warn('Invalid Expo push token', { token, userId })
      return false
    }

    const message = this.createMessage(token, payload)

    try {
      const [ticket] = await this.expo.sendPushNotificationsAsync([message])
      const success = ticket.status === 'ok'
      
      await this.logNotification(userId, payload, success,
        ticket.status === 'error' ? ticket.message : undefined)
      
      return success
    } catch (error) {
      logger.error('Failed to send push notification', { error, userId })
      await this.logNotification(userId, payload, false, String(error))
      return false
    }
  }

  private createMessage(token: string, payload: PushPayload): ExpoPushMessage {
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
    }
  }

  private async logNotification(
    userId: string,
    payload: PushPayload,
    success: boolean,
    errorMessage?: string
  ): Promise<void> {
    try {
      await prisma.pushNotificationLog.create({
        data: {
          userId,
          title: payload.title,
          body: payload.body,
          data: payload.data as any,
          status: success ? 'sent' : 'failed',
          errorMessage,
        },
      })
    } catch (error) {
      logger.error('Failed to log notification', { error })
    }
  }
}
