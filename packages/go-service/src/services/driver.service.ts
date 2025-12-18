/**
 * Driver Service
 * Manages driver registration, availability, and location
 */

import { z } from 'zod'
import { prisma, logger, AppError, ErrorCode, NotFoundError, ConflictError, GeoService } from '@gominiapp/core'

// Validation schemas
export const registerDriverSchema = z.object({
  vehicleType: z.string().min(1), // Dynamic - accepts any configured vehicle type
  licensePlate: z.string().min(1),
  vehicleModel: z.string().optional(),
  vehicleColor: z.string().optional(),
  vehicleMake: z.string().optional(),
  availabilityType: z.enum(['RIDE', 'DELIVERY', 'BOTH']).default('BOTH'),
})

export const updateLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  heading: z.number().min(0).max(360).optional(),
})

export const updateAvailabilitySchema = z.object({
  isOnline: z.boolean().optional(),
  availabilityType: z.enum(['RIDE', 'DELIVERY', 'BOTH']).optional(),
})

// Location update threshold in meters
const LOCATION_UPDATE_THRESHOLD_METERS = 80

export class DriverService {
  /**
   * Register a user as a driver
   */
  async registerDriver(
    userId: string,
    data: z.infer<typeof registerDriverSchema>
  ): Promise<any> {
    const validated = registerDriverSchema.parse(data)

    // Check if driver already exists
    const existingDriver = await prisma.driver.findUnique({
      where: { userId },
    })

    if (existingDriver) {
      throw new ConflictError('User is already a driver', ErrorCode.DRIVER_ALREADY_EXISTS)
    }

    // Create driver
    const driver = await prisma.driver.create({
      data: {
        userId,
        vehicleType: validated.vehicleType as any,
        licensePlate: validated.licensePlate,
        vehicleModel: validated.vehicleModel,
        vehicleColor: validated.vehicleColor,
        vehicleMake: validated.vehicleMake,
        availabilityType: validated.availabilityType as any,
      },
      include: { user: true },
    })

    logger.info('Driver registered', { driverId: driver.id, userId })

    return driver
  }

  /**
   * Get driver by ID
   */
  async getDriver(driverId: string): Promise<any> {
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      include: { user: true },
    })

    if (!driver) {
      throw new NotFoundError('Driver not found', ErrorCode.DRIVER_NOT_FOUND)
    }

    return driver
  }

  /**
   * Get driver by user ID
   */
  async getDriverByUserId(userId: string): Promise<any> {
    const driver = await prisma.driver.findUnique({
      where: { userId },
      include: { user: true },
    })

    if (!driver) {
      throw new NotFoundError('Driver not found', ErrorCode.DRIVER_NOT_FOUND)
    }

    return driver
  }

  /**
   * Update driver availability (online/offline toggle)
   */
  async updateAvailability(
    driverId: string,
    data: z.infer<typeof updateAvailabilitySchema>
  ): Promise<any> {
    const validated = updateAvailabilitySchema.parse(data)

    const driver = await prisma.driver.update({
      where: { id: driverId },
      data: {
        ...(validated.isOnline !== undefined && { isOnline: validated.isOnline }),
        ...(validated.availabilityType && { availabilityType: validated.availabilityType as any }),
      },
      include: { user: true },
    })

    logger.info('Driver availability updated', {
      driverId,
      isOnline: driver.isOnline,
      availabilityType: driver.availabilityType,
    })

    return driver
  }

  /**
   * Update driver location
   */
  async updateLocation(
    driverId: string,
    data: z.infer<typeof updateLocationSchema>
  ): Promise<{ updated: boolean; distance?: number }> {
    const validated = updateLocationSchema.parse(data)

    // Get current location
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      select: {
        currentLatitude: true,
        currentLongitude: true,
      },
    })

    if (!driver) {
      throw new NotFoundError('Driver not found', ErrorCode.DRIVER_NOT_FOUND)
    }

    // Calculate distance from last location
    // *** USE SHARED GeoService - distance in meters ***
    let shouldUpdate = true
    let distance: number | undefined

    if (driver.currentLatitude && driver.currentLongitude) {
      // GeoService returns km, convert to meters
      const distanceKm = GeoService.calculateDistance(
        { latitude: driver.currentLatitude, longitude: driver.currentLongitude },
        { latitude: validated.latitude, longitude: validated.longitude }
      )
      distance = distanceKm * 1000 // Convert to meters

      // Only update if moved more than threshold
      shouldUpdate = distance >= LOCATION_UPDATE_THRESHOLD_METERS
    }

    if (shouldUpdate) {
      await prisma.driver.update({
        where: { id: driverId },
        data: {
          currentLatitude: validated.latitude,
          currentLongitude: validated.longitude,
          currentHeading: validated.heading,
          lastLocationUpdate: new Date(),
        },
      })

      logger.debug('Driver location updated', { driverId, ...validated })
    }

    return { updated: shouldUpdate, distance }
  }

  /**
   * Find nearby available drivers
   */
  async findNearbyDrivers(
    latitude: number,
    longitude: number,
    options: {
      radiusKm?: number
      availabilityType?: 'RIDE' | 'DELIVERY' | 'BOTH'
      vehicleType?: string
      limit?: number
    } = {}
  ): Promise<any[]> {
    const { radiusKm = 10, availabilityType, vehicleType, limit = 20 } = options

    // Simple bounding box query (for production, use PostGIS)
    const latDelta = radiusKm / 111
    const lonDelta = radiusKm / (111 * Math.cos(latitude * Math.PI / 180))

    const drivers = await prisma.driver.findMany({
      where: {
        isOnline: true,
        currentLatitude: {
          gte: latitude - latDelta,
          lte: latitude + latDelta,
        },
        currentLongitude: {
          gte: longitude - lonDelta,
          lte: longitude + lonDelta,
        },
        ...(availabilityType && availabilityType !== 'BOTH' ? {
          OR: [
            { availabilityType: availabilityType as any },
            { availabilityType: 'BOTH' },
          ],
        } : {}),
        ...(vehicleType ? { vehicleType: vehicleType as any } : {}),
      },
      include: { user: true },
      take: limit,
    })

    // Calculate actual distances and filter using shared GeoService
    return drivers
      .map(d => {
        const distKm = GeoService.calculateDistance(
          { latitude, longitude },
          { latitude: d.currentLatitude!, longitude: d.currentLongitude! }
        )
        return {
          ...d,
          distanceKm: distKm,
          etaMinutes: Math.ceil(distKm / 30 * 60), // Assume 30 km/h
        }
      })
      .filter(d => d.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
  }

  /**
   * Get driver stats
   */
  async getDriverStats(driverId: string): Promise<any> {
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
    })

    if (!driver) {
      throw new NotFoundError('Driver not found', ErrorCode.DRIVER_NOT_FOUND)
    }

    return {
      totalRides: driver.totalRides,
      totalDeliveries: driver.totalDeliveries,
      rating: driver.rating,
      totalEarnings: driver.totalEarnings,
    }
  }

  /**
   * Get all online drivers
   */
  async getOnlineDrivers(options: {
    availabilityType?: 'RIDE' | 'DELIVERY' | 'BOTH'
    vehicleType?: string
  } = {}): Promise<any[]> {
    const { availabilityType, vehicleType } = options

    const drivers = await prisma.driver.findMany({
      where: {
        isOnline: true,
        ...(availabilityType && availabilityType !== 'BOTH' ? {
          OR: [
            { availabilityType: availabilityType as any },
            { availabilityType: 'BOTH' },
          ],
        } : {}),
        ...(vehicleType ? { vehicleType: vehicleType as any } : {}),
      },
      include: { user: true },
      orderBy: { lastLocationUpdate: 'desc' },
    })

    return drivers
  }

  // *** REMOVED: Private calculateDistance method ***
  // Now using shared GeoService.calculateDistance from @gominiapp/core
  // This eliminates duplicate Haversine implementations
}
