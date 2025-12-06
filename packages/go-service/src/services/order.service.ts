/**
 * Order Service
 * Manages ride and delivery orders
 */

import { z } from 'zod'
import {
  prisma,
  GeoService,
  RedisService,
  getRedis,
  PushNotificationService,
  BlueskyMessaging,
  getBlueskyMessaging,
  logger,
  NotFoundError,
  ValidationError,
  ErrorCode,
} from '@gominiapp/core'
import type {
  Coordinates,
  Location,
  OrderRequest,
  OrderEstimate,
  ActiveOrder,
} from '@gominiapp/core'
import { DriverService } from './driver.service'

// Validation schemas
export const createOrderSchema = z.object({
  type: z.enum(['RIDE', 'DELIVERY']),
  pickupLocation: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    address: z.string().optional(),
    placeId: z.string().optional(),
    name: z.string().optional(),
  }),
  dropoffLocation: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    address: z.string().optional(),
    placeId: z.string().optional(),
    name: z.string().optional(),
  }),
  vehicleType: z.string().optional(),
  packageSize: z.enum(['SMALL', 'MEDIUM', 'LARGE']).optional(),
  recipientName: z.string().optional(),
  recipientPhone: z.string().optional(),
  packageDescription: z.string().optional(),
})

export const acceptOrderSchema = z.object({
  orderId: z.string().uuid(),
})

export const updateOrderStatusSchema = z.object({
  status: z.enum([
    'DRIVER_ASSIGNED',
    'DRIVER_ARRIVED',
    'IN_PROGRESS',
    'COMPLETED',
    'CANCELLED',
  ]),
  otp: z.string().length(4).optional(),
})

// Fare configuration
const FARE_CONFIG = {
  RIDE: {
    CAR: { baseFare: 2.50, perKm: 1.20, perMinute: 0.20, minimumFare: 5.00 },
    MOTORCYCLE: { baseFare: 1.50, perKm: 0.80, perMinute: 0.15, minimumFare: 3.00 },
    BICYCLE: { baseFare: 1.00, perKm: 0.50, perMinute: 0.10, minimumFare: 2.00 },
  },
  DELIVERY: {
    SMALL: { baseFare: 3.00, perKm: 1.00, perMinute: 0.10, minimumFare: 5.00 },
    MEDIUM: { baseFare: 5.00, perKm: 1.50, perMinute: 0.15, minimumFare: 8.00 },
    LARGE: { baseFare: 8.00, perKm: 2.00, perMinute: 0.20, minimumFare: 12.00 },
  },
}

// Search radius for drivers in km
const DRIVER_SEARCH_RADIUS_KM = 10

export class OrderService {
  private redis: RedisService
  private pushService: PushNotificationService
  private driverService: DriverService
  private messaging: BlueskyMessaging

  constructor() {
    this.redis = getRedis()
    this.pushService = new PushNotificationService()
    this.driverService = new DriverService()
    this.messaging = getBlueskyMessaging()
  }

  /**
   * Get fare estimate for a ride/delivery
   */
  async getEstimate(request: OrderRequest): Promise<OrderEstimate> {
    const route = GeoService.estimateRoute(
      request.pickupLocation,
      request.dropoffLocation
    )

    // Get fare config based on type
    let fareConfig
    if (request.type === 'RIDE') {
      const vehicleType = (request.vehicleType as keyof typeof FARE_CONFIG.RIDE) || 'CAR'
      fareConfig = FARE_CONFIG.RIDE[vehicleType] || FARE_CONFIG.RIDE.CAR
    } else {
      const packageSize = (request.packageSize as keyof typeof FARE_CONFIG.DELIVERY) || 'SMALL'
      fareConfig = FARE_CONFIG.DELIVERY[packageSize] || FARE_CONFIG.DELIVERY.SMALL
    }

    // Calculate fare
    const distanceFare = route.distanceKm * fareConfig.perKm
    const timeFare = route.durationMinutes * fareConfig.perMinute
    const totalFare = Math.max(
      fareConfig.baseFare + distanceFare + timeFare,
      fareConfig.minimumFare
    )

    // Check for surge pricing (simplified: based on demand/supply)
    const nearbyDrivers = await this.driverService.findNearbyDrivers(
      request.pickupLocation,
      {
        radiusKm: DRIVER_SEARCH_RADIUS_KM,
        availabilityType: request.type,
        limit: 20,
      }
    )

    let surgeMultiplier = 1.0
    if (nearbyDrivers.length < 3) {
      surgeMultiplier = 1.5
    } else if (nearbyDrivers.length < 5) {
      surgeMultiplier = 1.2
    }

    const finalFare = totalFare * surgeMultiplier
    const surgeFare = finalFare - totalFare

    // Estimated pickup time (ETA of nearest driver)
    const estimatedPickupTime = nearbyDrivers.length > 0
      ? nearbyDrivers[0].etaMinutes
      : 15 // Default if no drivers nearby

    return {
      distanceKm: route.distanceKm,
      durationMinutes: route.durationMinutes,
      fare: Math.round(finalFare * 100) / 100,
      fareBreakdown: {
        baseFare: fareConfig.baseFare,
        distanceFare: Math.round(distanceFare * 100) / 100,
        timeFare: Math.round(timeFare * 100) / 100,
        surgeFare: Math.round(surgeFare * 100) / 100,
      },
      surgeMultiplier: surgeMultiplier > 1 ? surgeMultiplier : undefined,
      nearbyDrivers: nearbyDrivers.length,
      estimatedPickupTime,
    }
  }

  /**
   * Create a new order
   */
  async createOrder(
    userId: string,
    data: z.infer<typeof createOrderSchema>
  ): Promise<ActiveOrder> {
    const validated = createOrderSchema.parse(data)

    // Get estimate for fare calculation
    const estimate = await this.getEstimate(validated as OrderRequest)

    // Generate OTP for verification
    const otp = this.generateOtp()

    // Create order in database
    const order = await prisma.order.create({
      data: {
        userId,
        type: validated.type as any,
        status: 'SEARCHING',
        pickupLatitude: validated.pickupLocation.latitude,
        pickupLongitude: validated.pickupLocation.longitude,
        pickupAddress: validated.pickupLocation.address,
        dropoffLatitude: validated.dropoffLocation.latitude,
        dropoffLongitude: validated.dropoffLocation.longitude,
        dropoffAddress: validated.dropoffLocation.address,
        fare: estimate.fare,
        estimatedDistance: estimate.distanceKm,
        estimatedDuration: estimate.durationMinutes,
        otp,
        ...(validated.type === 'DELIVERY' && {
          packageSize: validated.packageSize as any,
          recipientName: validated.recipientName,
          recipientPhone: validated.recipientPhone,
          packageDescription: validated.packageDescription,
        }),
      },
    })

    // Create initial order event
    await this.createOrderEvent(order.id, 'CREATED', validated.pickupLocation)

    // Cache order in Redis
    await this.redis.cacheOrder(order.id, {
      id: order.id,
      userId,
      type: validated.type,
      status: 'SEARCHING',
      pickup: validated.pickupLocation,
      dropoff: validated.dropoffLocation,
      fare: estimate.fare,
    })

    // Find and notify nearby drivers
    await this.notifyNearbyDrivers(order.id, validated as OrderRequest, estimate)

    logger.info('Order created', { orderId: order.id, userId, type: validated.type })

    return this.toActiveOrder(order)
  }

  /**
   * Driver accepts an order
   */
  async acceptOrder(
    driverId: string,
    orderId: string
  ): Promise<ActiveOrder> {
    // Get driver details
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      include: { user: true },
    })

    if (!driver) {
      throw new NotFoundError('Driver not found', ErrorCode.DRIVER_NOT_FOUND)
    }

    // Get order
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { user: true },
    })

    if (!order) {
      throw new NotFoundError('Order not found', ErrorCode.ORDER_NOT_FOUND)
    }

    if (order.status !== 'SEARCHING') {
      throw new ValidationError('Order is no longer available', {
        currentStatus: order.status,
      })
    }

    // Create Bluesky conversation for rider-driver communication
    let conversationId: string | undefined
    try {
      conversationId = await this.messaging.createConversation(
        order.user.did,
        driver.user.did
      )
    } catch (error) {
      logger.warn('Failed to create Bluesky conversation', { error, orderId })
    }

    // Update order with driver assignment
    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        driverId,
        status: 'DRIVER_ASSIGNED',
        conversationId,
      },
      include: {
        user: true,
        driver: {
          include: { user: true },
        },
      },
    })

    // Create order event
    await this.createOrderEvent(orderId, 'DRIVER_ASSIGNED', {
      latitude: driver.currentLatitude!,
      longitude: driver.currentLongitude!,
    })

    // Calculate ETA
    const eta = driver.currentLatitude && driver.currentLongitude
      ? GeoService.calculateEta(
          { latitude: driver.currentLatitude, longitude: driver.currentLongitude },
          { latitude: order.pickupLatitude, longitude: order.pickupLongitude }
        )
      : undefined

    // Send push notification to rider
    if (order.user.pushToken) {
      await this.pushService.sendToUser(order.user.pushToken, {
        title: 'Driver Found!',
        body: `${driver.user.handle || 'Your driver'} is on the way. ETA: ${eta} min`,
        data: {
          type: 'ORDER_UPDATE',
          orderId,
          status: 'DRIVER_ASSIGNED',
        },
      })
    }

    // Send Bluesky DM
    if (conversationId) {
      await this.messaging.sendOrderMessage(conversationId, 'DRIVER_ASSIGNED', {
        orderId,
        driverName: driver.user.handle || 'Driver',
        vehicleInfo: `${driver.vehicleColor || ''} ${driver.vehicleModel || driver.vehicleType} - ${driver.vehiclePlate}`,
        eta,
        otp: order.otp!,
      })
    }

    // Update cache
    await this.redis.cacheOrder(orderId, {
      ...await this.redis.getOrder(orderId),
      status: 'DRIVER_ASSIGNED',
      driverId,
    })

    logger.info('Order accepted', { orderId, driverId })

    return this.toActiveOrder(updatedOrder)
  }

  /**
   * Update order status
   */
  async updateOrderStatus(
    orderId: string,
    status: string,
    actorId: string,
    location?: Coordinates,
    otp?: string
  ): Promise<ActiveOrder> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: true,
        driver: {
          include: { user: true },
        },
      },
    })

    if (!order) {
      throw new NotFoundError('Order not found', ErrorCode.ORDER_NOT_FOUND)
    }

    // Validate status transition
    this.validateStatusTransition(order.status, status)

    // Validate OTP for starting trip
    if (status === 'IN_PROGRESS' && otp !== order.otp) {
      throw new ValidationError('Invalid OTP', { code: ErrorCode.INVALID_OTP })
    }

    // Update order
    const updateData: any = { status }
    
    if (status === 'IN_PROGRESS') {
      updateData.startedAt = new Date()
    } else if (status === 'COMPLETED') {
      updateData.completedAt = new Date()
      
      // Update driver stats
      if (order.driverId) {
        await prisma.driver.update({
          where: { id: order.driverId },
          data: {
            ...(order.type === 'RIDE' ? { totalRides: { increment: 1 } } : {}),
            ...(order.type === 'DELIVERY' ? { totalDeliveries: { increment: 1 } } : {}),
          },
        })
      }
    }

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: updateData,
      include: {
        user: true,
        driver: {
          include: { user: true },
        },
      },
    })

    // Create order event
    await this.createOrderEvent(orderId, status as any, location)

    // Send notifications
    await this.sendStatusNotifications(updatedOrder, status)

    // Update cache
    await this.redis.cacheOrder(orderId, {
      ...await this.redis.getOrder(orderId),
      status,
    })

    logger.info('Order status updated', { orderId, status })

    return this.toActiveOrder(updatedOrder)
  }

  /**
   * Cancel an order
   */
  async cancelOrder(
    orderId: string,
    userId: string,
    reason?: string
  ): Promise<void> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: true,
        driver: {
          include: { user: true },
        },
      },
    })

    if (!order) {
      throw new NotFoundError('Order not found', ErrorCode.ORDER_NOT_FOUND)
    }

    // Check if user can cancel
    if (order.userId !== userId && order.driverId !== userId) {
      throw new ValidationError('You cannot cancel this order')
    }

    // Can't cancel completed orders
    if (order.status === 'COMPLETED') {
      throw new ValidationError('Cannot cancel completed order')
    }

    // Update order
    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledBy: userId,
        cancellationReason: reason,
      },
    })

    // Create order event
    await this.createOrderEvent(orderId, 'CANCELLED')

    // Notify relevant parties
    if (order.driver && order.driverId !== userId) {
      // Rider cancelled - notify driver
      if (order.driver.user.pushToken) {
        await this.pushService.sendToUser(order.driver.user.pushToken, {
          title: 'Order Cancelled',
          body: 'The rider has cancelled the order',
          data: { type: 'ORDER_CANCELLED', orderId },
        })
      }
    } else if (order.driverId && order.userId !== userId) {
      // Driver cancelled - notify rider
      if (order.user.pushToken) {
        await this.pushService.sendToUser(order.user.pushToken, {
          title: 'Order Cancelled',
          body: 'Your driver has cancelled. We\'re finding you a new driver.',
          data: { type: 'ORDER_CANCELLED', orderId },
        })
      }
    }

    // Send Bluesky DM
    if (order.conversationId) {
      await this.messaging.sendOrderMessage(order.conversationId, 'ORDER_CANCELLED', {
        orderId,
      })
    }

    // Remove from cache
    await this.redis.deleteOrder(orderId)

    logger.info('Order cancelled', { orderId, cancelledBy: userId, reason })
  }

  /**
   * Get active order for user
   */
  async getActiveOrderForUser(userId: string): Promise<ActiveOrder | null> {
    const order = await prisma.order.findFirst({
      where: {
        userId,
        status: {
          in: ['SEARCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVED', 'IN_PROGRESS'],
        },
      },
      include: {
        driver: {
          include: { user: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return order ? this.toActiveOrder(order) : null
  }

  /**
   * Get active order for driver
   */
  async getActiveOrderForDriver(driverId: string): Promise<ActiveOrder | null> {
    const order = await prisma.order.findFirst({
      where: {
        driverId,
        status: {
          in: ['DRIVER_ASSIGNED', 'DRIVER_ARRIVED', 'IN_PROGRESS'],
        },
      },
      include: {
        user: true,
        driver: {
          include: { user: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return order ? this.toActiveOrder(order) : null
  }

  /**
   * Get order history
   */
  async getOrderHistory(
    userId: string,
    options: { page?: number; pageSize?: number } = {}
  ): Promise<{ orders: ActiveOrder[]; total: number }> {
    const { page = 1, pageSize = 20 } = options

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: { userId },
        include: {
          driver: {
            include: { user: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.order.count({ where: { userId } }),
    ])

    return {
      orders: orders.map(o => this.toActiveOrder(o)),
      total,
    }
  }

  // Private helper methods

  private async notifyNearbyDrivers(
    orderId: string,
    request: OrderRequest,
    estimate: OrderEstimate
  ): Promise<void> {
    const nearbyDrivers = await this.driverService.findNearbyDrivers(
      request.pickupLocation,
      {
        radiusKm: DRIVER_SEARCH_RADIUS_KM,
        availabilityType: request.type,
        limit: 10,
      }
    )

    if (nearbyDrivers.length === 0) {
      logger.warn('No drivers available for order', { orderId })
      return
    }

    // Get driver user IDs for push tokens
    const driverUserIds = nearbyDrivers.map(d => d.userId)
    const users = await prisma.user.findMany({
      where: { id: { in: driverUserIds } },
      select: { id: true, pushToken: true },
    })

    const pushTokens = users
      .filter(u => u.pushToken)
      .map(u => u.pushToken!)

    if (pushTokens.length > 0) {
      await this.pushService.notifyNearbyDrivers(pushTokens, {
        orderId,
        type: request.type,
        pickup: request.pickupLocation,
        dropoff: request.dropoffLocation,
        fare: estimate.fare,
        estimatedDistance: estimate.distanceKm,
        estimatedDuration: estimate.durationMinutes,
      })
    }

    // Also publish to Redis for WebSocket notifications
    await this.redis.publish('order:new', {
      orderId,
      type: request.type,
      pickup: request.pickupLocation,
      dropoff: request.dropoffLocation,
      fare: estimate.fare,
      driverIds: nearbyDrivers.map(d => d.id),
    })

    logger.info('Notified nearby drivers', {
      orderId,
      driverCount: nearbyDrivers.length,
    })
  }

  private async createOrderEvent(
    orderId: string,
    type: string,
    location?: Coordinates,
    metadata?: Record<string, any>
  ): Promise<void> {
    await prisma.orderEvent.create({
      data: {
        orderId,
        type: type as any,
        latitude: location?.latitude,
        longitude: location?.longitude,
        metadata: metadata ? JSON.stringify(metadata) : undefined,
      },
    })
  }

  private async sendStatusNotifications(
    order: any,
    status: string
  ): Promise<void> {
    const messageTypes: Record<string, any> = {
      DRIVER_ARRIVED: 'DRIVER_ARRIVED',
      IN_PROGRESS: 'TRIP_STARTED',
      COMPLETED: 'TRIP_COMPLETED',
    }

    const messageType = messageTypes[status]
    if (!messageType) return

    // Send push notification
    if (order.user.pushToken) {
      const titles: Record<string, string> = {
        DRIVER_ARRIVED: 'Driver Arrived!',
        IN_PROGRESS: 'Trip Started',
        COMPLETED: 'Trip Completed',
      }

      const bodies: Record<string, string> = {
        DRIVER_ARRIVED: 'Your driver has arrived at the pickup location',
        IN_PROGRESS: 'You\'re on your way!',
        COMPLETED: `Trip completed! Fare: $${order.fare.toFixed(2)}`,
      }

      await this.pushService.sendToUser(order.user.pushToken, {
        title: titles[status],
        body: bodies[status],
        data: {
          type: 'ORDER_UPDATE',
          orderId: order.id,
          status,
        },
      })
    }

    // Send Bluesky DM
    if (order.conversationId) {
      await this.messaging.sendOrderMessage(order.conversationId, messageType, {
        orderId: order.id,
        dropoffAddress: order.dropoffAddress,
        otp: order.otp,
        fare: order.fare,
      })
    }
  }

  private validateStatusTransition(current: string, next: string): void {
    const validTransitions: Record<string, string[]> = {
      SEARCHING: ['DRIVER_ASSIGNED', 'CANCELLED'],
      DRIVER_ASSIGNED: ['DRIVER_ARRIVED', 'CANCELLED'],
      DRIVER_ARRIVED: ['IN_PROGRESS', 'CANCELLED'],
      IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
    }

    const allowed = validTransitions[current] || []
    if (!allowed.includes(next)) {
      throw new ValidationError(
        `Invalid status transition from ${current} to ${next}`,
        { currentStatus: current, requestedStatus: next }
      )
    }
  }

  private generateOtp(): string {
    return Math.floor(1000 + Math.random() * 9000).toString()
  }

  private toActiveOrder(order: any): ActiveOrder {
    return {
      id: order.id,
      type: order.type,
      status: order.status,
      pickup: {
        latitude: order.pickupLatitude,
        longitude: order.pickupLongitude,
        address: order.pickupAddress,
      },
      dropoff: {
        latitude: order.dropoffLatitude,
        longitude: order.dropoffLongitude,
        address: order.dropoffAddress,
      },
      fare: order.fare,
      otp: order.otp,
      conversationId: order.conversationId,
      createdAt: order.createdAt,
      startedAt: order.startedAt,
      completedAt: order.completedAt,
      ...(order.driver && {
        driver: {
          id: order.driver.id,
          name: order.driver.user?.handle || 'Driver',
          avatar: order.driver.user?.avatarUrl,
          vehicleType: order.driver.vehicleType,
          vehiclePlate: order.driver.vehiclePlate,
          vehicleModel: order.driver.vehicleModel,
          vehicleColor: order.driver.vehicleColor,
          rating: order.driver.rating,
          ...(order.driver.currentLatitude && order.driver.currentLongitude && {
            currentLocation: {
              latitude: order.driver.currentLatitude,
              longitude: order.driver.currentLongitude,
            },
          }),
        },
      }),
    }
  }
}
