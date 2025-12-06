/**
 * Driver Service
 * Manages driver registration, availability, and location updates
 */

import { z } from 'zod'
import {
  prisma,
  GeoService,
  RedisService,
  getRedis,
  PushNotificationService,
  logger,
  NotFoundError,
  ValidationError,
  ConflictError,
  ErrorCode,
} from '@gominiapp/core'
import type { Coordinates, DriverProfile, NearbyDriver } from '@gominiapp/core'

// Validation schemas
export const registerDriverSchema = z.object({
  vehicleType: z.enum(['CAR', 'MOTORCYCLE', 'BICYCLE', 'VAN']),
  vehiclePlate: z.string().min(1).max(20),
  vehicleModel: z.string().optional(),
  vehicleColor: z.string().optional(),
  availabilityType: z.enum(['RIDE', 'DELIVERY', 'BOTH']).default('BOTH'),
})

export const updateLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  heading: z.number().min(0).max(360).optional(),
  speed: z.number().min(0).optional(),
})

export const updateAvailabilitySchema = z.object({
  isOnline: z.boolean().optional(),
  availabilityType: z.enum(['RIDE', 'DELIVERY', 'BOTH']).optional(),
})

// Location update threshold in meters
const LOCATION_UPDATE_THRESHOLD = 80

export class DriverService {
  private redis: RedisService
  private pushService: PushNotificationService

  constructor() {
    this.redis = getRedis()
    this.pushService = new PushNotificationService()
  }

  /**
   * Register a new driver
   */
  async registerDriver(
    userId: string,
    data: z.infer<typeof registerDriverSchema>
  ): Promise<DriverProfile> {
    const validated = registerDriverSchema.parse(data)

    // Check if already a driver
    const existing = await prisma.driver.findUnique({
      where: { userId },
    })

    if (existing) {
      throw new ConflictError('User is already registered as a driver', ErrorCode.DRIVER_ALREADY_EXISTS)
    }

    const driver = await prisma.driver.create({
      data: {
        userId,
        vehicleType: validated.vehicleType as any,
        vehiclePlate: validated.vehiclePlate,
        vehicleModel: validated.vehicleModel,
        vehicleColor: validated.vehicleColor,
        availabilityType: validated.availabilityType as any,
        isOnline: false,
        rating: 5.0,
        totalRides: 0,
        totalDeliveries: 0,
      },
      include: {
        user: true,
      },
    })

    // Update user's isDriver flag
    await prisma.user.update({
      where: { id: userId },
      data: { isDriver: true },
    })

    logger.info('Driver registered', { userId, driverId: driver.id })

    return this.toDriverProfile(driver)
  }

  /**
   * Get driver profile
   */
  async getDriver(driverId: string): Promise<DriverProfile> {
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
    })

    if (!driver) {
      throw new NotFoundError('Driver not found', ErrorCode.DRIVER_NOT_FOUND)
    }

    return this.toDriverProfile(driver)
  }

  /**
   * Get driver by user ID
   */
  async getDriverByUserId(userId: string): Promise<DriverProfile> {
    const driver = await prisma.driver.findUnique({
      where: { userId },
    })

    if (!driver) {
      throw new NotFoundError('Driver not found', ErrorCode.DRIVER_NOT_FOUND)
    }

    return this.toDriverProfile(driver)
  }

  /**
   * Update driver availability (online/offline toggle)
   */
  async updateAvailability(
    driverId: string,
    data: z.infer<typeof updateAvailabilitySchema>
  ): Promise<DriverProfile> {
    const validated = updateAvailabilitySchema.parse(data)

    const driver = await prisma.driver.update({
      where: { id: driverId },
      data: {
        ...(validated.isOnline !== undefined && { isOnline: validated.isOnline }),
        ...(validated.availabilityType && { availabilityType: validated.availabilityType as any }),
      },
    })

    // Update Redis if going online/offline
    if (validated.isOnline === false) {
      await this.redis.removeDriverLocation(driverId)
      logger.info('Driver went offline', { driverId })
    } else if (validated.isOnline === true && driver.currentLatitude && driver.currentLongitude) {
      await this.redis.updateDriverLocation(
        driverId,
        driver.currentLatitude,
        driver.currentLongitude
      )
      logger.info('Driver went online', { driverId })
    }

    return this.toDriverProfile(driver)
  }

  /**
   * Update driver location with 80m threshold optimization
   */
  async updateLocation(
    driverId: string,
    data: z.infer<typeof updateLocationSchema>
  ): Promise<{ updated: boolean; distance?: number }> {
    const validated = updateLocationSchema.parse(data)

    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
    })

    if (!driver) {
      throw new NotFoundError('Driver not found', ErrorCode.DRIVER_NOT_FOUND)
    }

    if (!driver.isOnline) {
      throw new ValidationError('Driver must be online to update location')
    }

    // Check if location has changed significantly (80m threshold)
    let shouldUpdate = true
    let distance: number | undefined

    if (driver.currentLatitude && driver.currentLongitude) {
      const hasMoved = GeoService.hasMovedBeyondThreshold(
        { latitude: driver.currentLatitude, longitude: driver.currentLongitude },
        { latitude: validated.latitude, longitude: validated.longitude },
        LOCATION_UPDATE_THRESHOLD
      )

      if (!hasMoved) {
        shouldUpdate = false
        distance = GeoService.calculateDistance(
          { latitude: driver.currentLatitude, longitude: driver.currentLongitude },
          { latitude: validated.latitude, longitude: validated.longitude }
        ) * 1000 // Convert to meters
      }
    }

    if (shouldUpdate) {
      // Update database
      await prisma.driver.update({
        where: { id: driverId },
        data: {
          currentLatitude: validated.latitude,
          currentLongitude: validated.longitude,
          lastLocationUpdate: new Date(),
        },
      })

      // Update Redis for fast geo queries
      await this.redis.updateDriverLocation(
        driverId,
        validated.latitude,
        validated.longitude
      )

      // Publish location update for real-time subscribers
      await this.redis.publish('driver:location', {
        driverId,
        latitude: validated.latitude,
        longitude: validated.longitude,
        heading: validated.heading,
        timestamp: Date.now(),
      })

      logger.debug('Driver location updated', {
        driverId,
        lat: validated.latitude,
        lng: validated.longitude,
      })
    }

    return { updated: shouldUpdate, distance }
  }

  /**
   * Find nearby available drivers
   */
  async findNearbyDrivers(
    location: Coordinates,
    options: {
      radiusKm?: number
      availabilityType?: 'RIDE' | 'DELIVERY' | 'BOTH'
      vehicleType?: string
      limit?: number
    } = {}
  ): Promise<NearbyDriver[]> {
    const { radiusKm = 5, availabilityType, vehicleType, limit = 10 } = options

    // First try Redis for fast geo query
    const nearbyIds = await this.redis.getNearbyDrivers(
      location.latitude,
      location.longitude,
      radiusKm
    )

    if (nearbyIds.length > 0) {
      // Get driver details from database
      const drivers = await prisma.driver.findMany({
        where: {
          id: { in: nearbyIds },
          isOnline: true,
          ...(availabilityType && availabilityType !== 'BOTH' ? {
            OR: [
              { availabilityType },
              { availabilityType: 'BOTH' },
            ],
          } : {}),
          ...(vehicleType ? { vehicleType: vehicleType as any } : {}),
        },
        include: { user: true },
        take: limit,
      })

      return drivers.map(d => {
        const distanceKm = GeoService.calculateDistance(
          location,
          { latitude: d.currentLatitude!, longitude: d.currentLongitude! }
        )

        return {
          id: d.id,
          userId: d.userId,
          distanceKm,
          etaMinutes: GeoService.calculateEta(
            { latitude: d.currentLatitude!, longitude: d.currentLongitude! },
            location
          ),
          vehicleType: d.vehicleType,
          vehicleInfo: `${d.vehicleColor || ''} ${d.vehicleModel || d.vehicleType} - ${d.vehiclePlate}`.trim(),
          rating: d.rating,
          location: {
            latitude: d.currentLatitude!,
            longitude: d.currentLongitude!,
          },
        }
      }).sort((a, b) => a.distanceKm - b.distanceKm)
    }

    // Fallback to PostGIS query
    const drivers = await GeoService.findNearbyDrivers(
      location.latitude,
      location.longitude,
      radiusKm,
      { availabilityType, vehicleType, limit }
    )

    // Enrich with driver details
    const driverIds = drivers.map(d => d.id)
    const driverDetails = await prisma.driver.findMany({
      where: { id: { in: driverIds } },
    })

    const detailsMap = new Map(driverDetails.map(d => [d.id, d]))

    return drivers.map(d => {
      const details = detailsMap.get(d.id)!
      return {
        id: d.id,
        userId: d.userId,
        distanceKm: d.distanceKm,
        etaMinutes: GeoService.calculateEta(
          { latitude: d.latitude, longitude: d.longitude },
          location
        ),
        vehicleType: d.vehicleType,
        vehicleInfo: `${details.vehicleColor || ''} ${details.vehicleModel || d.vehicleType} - ${details.vehiclePlate}`.trim(),
        rating: d.rating,
        location: {
          latitude: d.latitude,
          longitude: d.longitude,
        },
      }
    })
  }

  /**
   * Get driver stats
   */
  async getDriverStats(driverId: string): Promise<{
    totalRides: number
    totalDeliveries: number
    rating: number
    totalEarnings: number
    completionRate: number
  }> {
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
    })

    if (!driver) {
      throw new NotFoundError('Driver not found', ErrorCode.DRIVER_NOT_FOUND)
    }

    // Get order stats
    const [completedOrders, totalOrders, earnings] = await Promise.all([
      prisma.order.count({
        where: { driverId, status: 'COMPLETED' },
      }),
      prisma.order.count({
        where: { driverId },
      }),
      prisma.order.aggregate({
        where: { driverId, status: 'COMPLETED' },
        _sum: { fare: true },
      }),
    ])

    return {
      totalRides: driver.totalRides,
      totalDeliveries: driver.totalDeliveries,
      rating: driver.rating,
      totalEarnings: earnings._sum.fare || 0,
      completionRate: totalOrders > 0 ? completedOrders / totalOrders : 1,
    }
  }

  private toDriverProfile(driver: any): DriverProfile {
    return {
      id: driver.id,
      userId: driver.userId,
      isOnline: driver.isOnline,
      availabilityType: driver.availabilityType,
      vehicleType: driver.vehicleType,
      vehiclePlate: driver.vehiclePlate,
      vehicleModel: driver.vehicleModel,
      vehicleColor: driver.vehicleColor,
      rating: driver.rating,
      totalRides: driver.totalRides,
      totalDeliveries: driver.totalDeliveries,
      ...(driver.currentLatitude && driver.currentLongitude && {
        currentLocation: {
          latitude: driver.currentLatitude,
          longitude: driver.currentLongitude,
        },
      }),
    }
  }
}
