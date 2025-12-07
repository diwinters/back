/**
 * Order Service
 * Manages ride and delivery orders
 */

import { z } from 'zod'
import { prisma, logger, AppError, ErrorCode, NotFoundError, ValidationError, getWebSocketServer } from '@gominiapp/core'
import { DriverService } from './driver.service'

// Validation schemas
export const createOrderSchema = z.object({
  type: z.enum(['RIDE', 'DELIVERY']),
  pickupLatitude: z.number().min(-90).max(90),
  pickupLongitude: z.number().min(-180).max(180),
  pickupAddress: z.string().min(1),
  pickupName: z.string().optional(),
  dropoffLatitude: z.number().min(-90).max(90),
  dropoffLongitude: z.number().min(-180).max(180),
  dropoffAddress: z.string().min(1),
  dropoffName: z.string().optional(),
  vehicleType: z.string().default('ECONOMY'), // Dynamic - accepts any configured vehicle type
  // Delivery specific
  packageSize: z.enum(['SMALL', 'MEDIUM', 'LARGE', 'EXTRA_LARGE']).optional(),
  recipientName: z.string().optional(),
  recipientPhone: z.string().optional(),
  packageDescription: z.string().optional(),
})

export const acceptOrderSchema = z.object({
  orderId: z.string(),
})

export const updateOrderStatusSchema = z.object({
  status: z.enum([
    'DRIVER_ASSIGNED',
    'DRIVER_ARRIVING',
    'ARRIVED',
    'IN_PROGRESS',
    'COMPLETED',
    'CANCELLED',
  ]),
})

// Fare configuration
const FARE_CONFIG: Record<string, { baseFare: number; perKm: number; perMin: number; minimum: number }> = {
  ECONOMY: { baseFare: 2.50, perKm: 1.20, perMin: 0.20, minimum: 5.00 },
  COMFORT: { baseFare: 3.50, perKm: 1.50, perMin: 0.25, minimum: 7.00 },
  PREMIUM: { baseFare: 5.00, perKm: 2.00, perMin: 0.35, minimum: 10.00 },
  XL: { baseFare: 4.00, perKm: 1.80, perMin: 0.30, minimum: 8.00 },
  MOTO: { baseFare: 1.50, perKm: 0.80, perMin: 0.15, minimum: 3.00 },
  BIKE: { baseFare: 1.00, perKm: 0.50, perMin: 0.10, minimum: 2.00 },
}

// Order timeout configuration (in milliseconds)
const ORDER_TIMEOUT_MS = 30000 // 30 seconds

// Track pending orders with their broadcast timestamps
const pendingOrderTimeouts: Map<string, NodeJS.Timeout> = new Map()

export class OrderService {
  private driverService: DriverService

  constructor() {
    this.driverService = new DriverService()
  }

  /**
   * Start a timeout for an order - if no driver accepts within 30s, re-broadcast
   */
  startOrderTimeout(orderId: string, order: any, excludedDriverIds: string[] = []): void {
    // Clear any existing timeout
    this.clearOrderTimeout(orderId)

    const timeout = setTimeout(async () => {
      try {
        // Check if order is still pending
        const currentOrder = await prisma.order.findUnique({
          where: { id: orderId },
          include: { user: true },
        })

        if (currentOrder && currentOrder.status === 'PENDING') {
          logger.info('Order timed out, re-broadcasting', { orderId, excludedCount: excludedDriverIds.length })

          // Record timeout event
          await prisma.orderEvent.create({
            data: {
              orderId,
              eventType: 'TIMEOUT',
              metadata: { excludedDriverIds, attempt: excludedDriverIds.length + 1 },
            },
          })

          // Re-broadcast to other drivers
          await this.rebroadcastOrder(currentOrder, excludedDriverIds)

          // Start new timeout (with same excluded drivers - they already timed out)
          this.startOrderTimeout(orderId, currentOrder, excludedDriverIds)
        }
      } catch (error) {
        logger.error('Error handling order timeout', { orderId, error })
      }
    }, ORDER_TIMEOUT_MS)

    pendingOrderTimeouts.set(orderId, timeout)
  }

  /**
   * Clear timeout for an order (when accepted or cancelled)
   */
  clearOrderTimeout(orderId: string): void {
    const timeout = pendingOrderTimeouts.get(orderId)
    if (timeout) {
      clearTimeout(timeout)
      pendingOrderTimeouts.delete(orderId)
    }
  }

  /**
   * Get fare estimate
   */
  async getEstimate(data: z.infer<typeof createOrderSchema>): Promise<{
    distanceKm: number
    durationMinutes: number
    fare: number
    nearbyDrivers: number
  }> {
    const validated = createOrderSchema.parse(data)

    // Calculate distance
    const distanceKm = this.calculateDistance(
      validated.pickupLatitude,
      validated.pickupLongitude,
      validated.dropoffLatitude,
      validated.dropoffLongitude
    ) / 1000

    // Estimate duration (assume 30 km/h average)
    const durationMinutes = Math.ceil(distanceKm / 30 * 60)

    // Calculate fare
    const config = FARE_CONFIG[validated.vehicleType] || FARE_CONFIG.ECONOMY
    const fare = Math.max(
      config.baseFare + (distanceKm * config.perKm) + (durationMinutes * config.perMin),
      config.minimum
    )

    // Count nearby drivers
    const nearbyDrivers = await this.driverService.findNearbyDrivers(
      validated.pickupLatitude,
      validated.pickupLongitude,
      { radiusKm: 10, limit: 50 }
    )

    return {
      distanceKm: Math.round(distanceKm * 10) / 10,
      durationMinutes,
      fare: Math.round(fare * 100) / 100,
      nearbyDrivers: nearbyDrivers.length,
    }
  }

  /**
   * Create a new order
   */
  async createOrder(userId: string, data: z.infer<typeof createOrderSchema>): Promise<any> {
    const validated = createOrderSchema.parse(data)
    const estimate = await this.getEstimate(validated)

    const order = await prisma.order.create({
      data: {
        type: validated.type as any,
        status: 'PENDING',
        userId,
        pickupLatitude: validated.pickupLatitude,
        pickupLongitude: validated.pickupLongitude,
        pickupAddress: validated.pickupAddress,
        pickupName: validated.pickupName,
        dropoffLatitude: validated.dropoffLatitude,
        dropoffLongitude: validated.dropoffLongitude,
        dropoffAddress: validated.dropoffAddress,
        dropoffName: validated.dropoffName,
        vehicleType: validated.vehicleType as any,
        distanceKm: estimate.distanceKm,
        durationMinutes: estimate.durationMinutes,
        estimatedFare: estimate.fare,
        ...(validated.type === 'DELIVERY' && {
          packageSize: validated.packageSize as any,
          recipientName: validated.recipientName,
          recipientPhone: validated.recipientPhone,
          packageDescription: validated.packageDescription,
        }),
      },
      include: {
        user: true,
      },
    })

    // Create order event
    await prisma.orderEvent.create({
      data: {
        orderId: order.id,
        eventType: 'CREATED',
        latitude: validated.pickupLatitude,
        longitude: validated.pickupLongitude,
      },
    })

    logger.info('Order created', { orderId: order.id, userId, type: validated.type })

    // Notify nearby drivers via WebSocket (non-blocking)
    // Don't await this - we don't want Redis issues to block order creation
    const wsServer = getWebSocketServer()
    if (wsServer) {
      const orderData = {
        id: order.id,
        type: order.type,
        pickupLatitude: validated.pickupLatitude,
        pickupLongitude: validated.pickupLongitude,
        pickupAddress: validated.pickupAddress,
        dropoffLatitude: validated.dropoffLatitude,
        dropoffLongitude: validated.dropoffLongitude,
        dropoffAddress: validated.dropoffAddress,
        estimatedFare: order.estimatedFare,
        estimatedDistance: (order as any).estimatedDistance,
        estimatedDuration: (order as any).estimatedDuration,
        vehicleType: order.vehicleType,
        user: {
          displayName: order.user?.displayName,
        },
      }
      
      // Broadcast to drivers within 5km radius (fire and forget)
      wsServer.broadcastToNearbyDrivers(
        validated.pickupLatitude,
        validated.pickupLongitude,
        5000, // 5km radius
        {
          type: 'new_order',
          payload: orderData,
        }
      ).then(() => {
        logger.info('Order broadcast to nearby drivers', { orderId: order.id })
        // Start timeout for auto-rebroadcast if no driver accepts
        this.startOrderTimeout(order.id, order)
      }).catch((err) => {
        logger.error('Failed to broadcast order to drivers', { orderId: order.id, error: err.message })
      })
    }

    return order
  }

  /**
   * Accept an order (driver)
   */
  async acceptOrder(driverId: string, orderId: string): Promise<any> {
    const driver = await this.driverService.getDriver(driverId)

    const order = await prisma.order.findUnique({
      where: { id: orderId },
    })

    if (!order) {
      throw new NotFoundError('Order not found', ErrorCode.ORDER_NOT_FOUND)
    }

    if (order.status !== 'PENDING') {
      throw new ValidationError('Order is no longer available')
    }

    // Clear the timeout since order is being accepted
    this.clearOrderTimeout(orderId)

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        driverId: driver.userId,
        status: 'DRIVER_ASSIGNED',
        acceptedAt: new Date(),
      },
      include: {
        user: true,
        driver: true,
      },
    })

    // Create order event
    await prisma.orderEvent.create({
      data: {
        orderId,
        eventType: 'DRIVER_ASSIGNED',
        latitude: driver.currentLatitude,
        longitude: driver.currentLongitude,
      },
    })

    logger.info('Order accepted', { orderId, driverId })

    // Notify user that driver accepted their order
    const wsServer = getWebSocketServer()
    if (wsServer && updatedOrder.user) {
      await wsServer.sendOrderUpdate(
        updatedOrder.user.did,
        orderId,
        'DRIVER_ASSIGNED',
        {
          driver: {
            id: updatedOrder.driver?.id,
            displayName: updatedOrder.driver?.displayName,
            avatarUrl: updatedOrder.driver?.avatarUrl,
            currentLatitude: driver.currentLatitude,
            currentLongitude: driver.currentLongitude,
            vehicleMake: driver.vehicleMake,
            vehicleModel: driver.vehicleModel,
            vehicleColor: driver.vehicleColor,
            licensePlate: driver.licensePlate,
          },
        }
      )
      logger.info('User notified of driver assignment', { orderId, userDid: updatedOrder.user.did })
    }

    return updatedOrder
  }

  /**
   * Decline an order (driver)
   * Records decline event and re-broadcasts to other drivers
   */
  async declineOrder(driverId: string, orderId: string): Promise<void> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { user: true },
    })

    if (!order || order.status !== 'PENDING') {
      // Order already assigned or doesn't exist, ignore silently
      return
    }

    // Record the decline event
    await prisma.orderEvent.create({
      data: {
        orderId,
        eventType: 'DECLINED',
        metadata: { driverId },
      },
    })

    logger.info('Order declined by driver', { orderId, driverId })

    // Re-broadcast to other nearby drivers (excluding this one)
    await this.rebroadcastOrder(order, [driverId])
  }

  /**
   * Re-broadcast an order to nearby drivers, excluding specific drivers
   */
  async rebroadcastOrder(order: any, excludeDriverIds: string[]): Promise<void> {
    const wsServer = getWebSocketServer()
    if (!wsServer) return

    const orderData = {
      id: order.id,
      type: order.type,
      pickupLatitude: order.pickupLatitude,
      pickupLongitude: order.pickupLongitude,
      pickupAddress: order.pickupAddress,
      dropoffLatitude: order.dropoffLatitude,
      dropoffLongitude: order.dropoffLongitude,
      dropoffAddress: order.dropoffAddress,
      estimatedFare: order.estimatedFare,
      vehicleType: order.vehicleType,
      user: order.user ? {
        displayName: order.user.displayName,
      } : undefined,
    }

    // Get all declined driver DIDs for this order
    const declinedEvents = await prisma.orderEvent.findMany({
      where: {
        orderId: order.id,
        eventType: 'DECLINED',
      },
    })
    
    const allExcludedDriverIds = [...excludeDriverIds]
    for (const event of declinedEvents) {
      const metadata = event.metadata as any
      if (metadata?.driverId && !allExcludedDriverIds.includes(metadata.driverId)) {
        allExcludedDriverIds.push(metadata.driverId)
      }
    }

    // Broadcast to nearby drivers, excluding those who already declined
    await wsServer.broadcastToNearbyDrivers(
      order.pickupLatitude,
      order.pickupLongitude,
      5000, // 5km radius
      {
        type: 'new_order',
        payload: orderData,
      },
      allExcludedDriverIds
    )

    logger.info('Order re-broadcast to drivers', { orderId: order.id, excludedCount: allExcludedDriverIds.length })
  }

  /**
   * Update order status
   */
  async updateOrderStatus(
    orderId: string,
    status: string,
    location?: { latitude: number; longitude: number }
  ): Promise<any> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
    })

    if (!order) {
      throw new NotFoundError('Order not found', ErrorCode.ORDER_NOT_FOUND)
    }

    const updateData: any = { status }

    // Set timestamps based on status
    switch (status) {
      case 'DRIVER_ARRIVING':
        break
      case 'ARRIVED':
        updateData.arrivedAt = new Date()
        break
      case 'IN_PROGRESS':
        updateData.startedAt = new Date()
        break
      case 'COMPLETED':
        updateData.completedAt = new Date()
        updateData.finalFare = order.estimatedFare
        break
      case 'CANCELLED':
        updateData.cancelledAt = new Date()
        break
    }

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: updateData,
      include: {
        user: true,
        driver: true,
      },
    })

    // Create order event
    const eventTypeMap: Record<string, string> = {
      DRIVER_ARRIVING: 'DRIVER_ARRIVING',
      ARRIVED: 'DRIVER_ARRIVED',
      IN_PROGRESS: 'TRIP_STARTED',
      COMPLETED: 'TRIP_COMPLETED',
      CANCELLED: 'CANCELLED',
    }

    await prisma.orderEvent.create({
      data: {
        orderId,
        eventType: eventTypeMap[status] as any,
        latitude: location?.latitude,
        longitude: location?.longitude,
      },
    })

    logger.info('Order status updated', { orderId, status })

    // Notify user of status update via WebSocket
    const wsServer = getWebSocketServer()
    if (wsServer && updatedOrder.user) {
      const statusMessages: Record<string, string> = {
        DRIVER_ARRIVING: 'Driver is on the way to pickup',
        ARRIVED: 'Driver has arrived at pickup location',
        IN_PROGRESS: 'Trip has started',
        COMPLETED: 'Trip completed',
        CANCELLED: 'Order has been cancelled',
      }
      
      await wsServer.sendOrderUpdate(
        updatedOrder.user.did,
        orderId,
        status,
        {
          message: statusMessages[status],
          driverLocation: location,
          completedAt: status === 'COMPLETED' ? updatedOrder.completedAt : undefined,
          finalFare: status === 'COMPLETED' ? updatedOrder.finalFare : undefined,
        }
      )
      
      logger.info('User notified of status update', { orderId, status, userDid: updatedOrder.user.did })
    }

    return updatedOrder
  }

  /**
   * Cancel order
   */
  async cancelOrder(orderId: string, userId: string, reason?: string): Promise<void> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: true,
        driver: {
          include: {
            driver: true, // Get driver's user record for DID
          },
        },
      },
    })

    if (!order) {
      throw new NotFoundError('Order not found', ErrorCode.ORDER_NOT_FOUND)
    }

    if (order.status === 'COMPLETED') {
      throw new ValidationError('Cannot cancel completed order')
    }

    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: reason,
        cancelledBy: userId,
      },
    })

    await prisma.orderEvent.create({
      data: {
        orderId,
        eventType: 'CANCELLED',
        metadata: { reason, cancelledBy: userId },
      },
    })

    logger.info('Order cancelled', { orderId, cancelledBy: userId, reason })

    // Notify both user and driver of cancellation via WebSocket
    const wsServer = getWebSocketServer()
    if (wsServer) {
      const cancelData = {
        message: 'Order has been cancelled',
        reason,
        cancelledBy: userId,
      }
      
      // Notify user
      if (order.user) {
        await wsServer.sendOrderUpdate(order.user.did, orderId, 'CANCELLED', cancelData)
      }
      
      // Notify driver if assigned
      if (order.driver?.driver) {
        // Get the driver's user record to find their DID
        const driverUser = await prisma.user.findUnique({
          where: { id: order.driverId! },
        })
        if (driverUser) {
          await wsServer.sendOrderUpdate(driverUser.did, orderId, 'CANCELLED', cancelData)
        }
      }
    }
  }

  /**
   * Get active order for user
   */
  async getActiveOrderForUser(userId: string): Promise<any> {
    return prisma.order.findFirst({
      where: {
        userId,
        status: {
          in: ['PENDING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'ARRIVED', 'IN_PROGRESS'],
        },
      },
      include: {
        driver: true,
      },
      orderBy: { requestedAt: 'desc' },
    })
  }

  /**
   * Get active order for driver
   */
  async getActiveOrderForDriver(driverId: string): Promise<any> {
    const driver = await this.driverService.getDriver(driverId)
    
    return prisma.order.findFirst({
      where: {
        driverId: driver.userId,
        status: {
          in: ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'ARRIVED', 'IN_PROGRESS'],
        },
      },
      include: {
        user: true,
      },
      orderBy: { requestedAt: 'desc' },
    })
  }

  /**
   * Get order history
   */
  async getOrderHistory(
    userId: string,
    options: { page?: number; pageSize?: number } = {}
  ): Promise<{ orders: any[]; total: number }> {
    const { page = 1, pageSize = 20 } = options

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: { userId },
        include: { driver: true },
        orderBy: { requestedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.order.count({ where: { userId } }),
    ])

    return { orders, total }
  }

  /**
   * Calculate distance between two points in meters
   */
  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371000
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLon = (lon2 - lon1) * Math.PI / 180
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }
}
