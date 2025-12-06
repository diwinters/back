/**
 * Geo Service
 * Geographic utilities and PostGIS queries for proximity search
 */

import { prisma } from '../db/prisma'
import { logger } from '../utils/logger'

export interface Coordinates {
  latitude: number
  longitude: number
}

export interface BoundingBox {
  north: number
  south: number
  east: number
  west: number
}

// Earth's radius in kilometers
const EARTH_RADIUS_KM = 6371

export class GeoService {
  /**
   * Calculate distance between two points using Haversine formula
   */
  static calculateDistance(from: Coordinates, to: Coordinates): number {
    const dLat = this.toRadians(to.latitude - from.latitude)
    const dLon = this.toRadians(to.longitude - from.longitude)
    
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(from.latitude)) * Math.cos(this.toRadians(to.latitude)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2)
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    
    return EARTH_RADIUS_KM * c
  }

  /**
   * Check if distance between two points exceeds threshold
   */
  static hasMovedBeyondThreshold(
    from: Coordinates,
    to: Coordinates,
    thresholdMeters: number
  ): boolean {
    const distanceKm = this.calculateDistance(from, to)
    return distanceKm * 1000 >= thresholdMeters
  }

  /**
   * Calculate bounding box around a point
   */
  static getBoundingBox(center: Coordinates, radiusKm: number): BoundingBox {
    const latDelta = radiusKm / 111 // ~111km per degree of latitude
    const lonDelta = radiusKm / (111 * Math.cos(this.toRadians(center.latitude)))
    
    return {
      north: center.latitude + latDelta,
      south: center.latitude - latDelta,
      east: center.longitude + lonDelta,
      west: center.longitude - lonDelta,
    }
  }

  /**
   * Find nearby available drivers using PostGIS
   */
  static async findNearbyDrivers(
    latitude: number,
    longitude: number,
    radiusKm: number,
    options: {
      availabilityType?: 'RIDE' | 'DELIVERY' | 'BOTH'
      vehicleType?: string
      limit?: number
    } = {}
  ): Promise<Array<{
    id: string
    userId: string
    distanceKm: number
    latitude: number
    longitude: number
    vehicleType: string
    rating: number
  }>> {
    const { availabilityType, vehicleType, limit = 20 } = options

    try {
      // Use PostGIS for efficient geo queries
      const drivers = await prisma.$queryRaw<Array<{
        id: string
        userId: string
        distance_km: number
        currentLatitude: number
        currentLongitude: number
        vehicleType: string
        rating: number
      }>>`
        SELECT 
          d.id,
          d."userId",
          ST_Distance(
            ST_MakePoint(d."currentLongitude", d."currentLatitude")::geography,
            ST_MakePoint(${longitude}, ${latitude})::geography
          ) / 1000 as distance_km,
          d."currentLatitude",
          d."currentLongitude",
          d."vehicleType",
          d.rating
        FROM "Driver" d
        WHERE d."isOnline" = true
          AND d."currentLatitude" IS NOT NULL
          AND d."currentLongitude" IS NOT NULL
          ${availabilityType ? prisma.$queryRaw`AND (d."availabilityType" = ${availabilityType}::"AvailabilityType" OR d."availabilityType" = 'BOTH')` : prisma.$queryRaw``}
          ${vehicleType ? prisma.$queryRaw`AND d."vehicleType" = ${vehicleType}::"VehicleType"` : prisma.$queryRaw``}
          AND ST_DWithin(
            ST_MakePoint(d."currentLongitude", d."currentLatitude")::geography,
            ST_MakePoint(${longitude}, ${latitude})::geography,
            ${radiusKm * 1000}
          )
        ORDER BY distance_km ASC
        LIMIT ${limit}
      `

      return drivers.map(d => ({
        id: d.id,
        userId: d.userId,
        distanceKm: d.distance_km,
        latitude: d.currentLatitude,
        longitude: d.currentLongitude,
        vehicleType: d.vehicleType,
        rating: d.rating,
      }))
    } catch (error) {
      logger.error('Failed to find nearby drivers', { error, latitude, longitude })
      
      // Fallback to bounding box query if PostGIS fails
      return this.findNearbyDriversFallback(latitude, longitude, radiusKm, options)
    }
  }

  /**
   * Fallback method without PostGIS
   */
  private static async findNearbyDriversFallback(
    latitude: number,
    longitude: number,
    radiusKm: number,
    options: {
      availabilityType?: 'RIDE' | 'DELIVERY' | 'BOTH'
      vehicleType?: string
      limit?: number
    }
  ): Promise<Array<{
    id: string
    userId: string
    distanceKm: number
    latitude: number
    longitude: number
    vehicleType: string
    rating: number
  }>> {
    const { availabilityType, vehicleType, limit = 20 } = options
    const bbox = this.getBoundingBox({ latitude, longitude }, radiusKm)

    const drivers = await prisma.driver.findMany({
      where: {
        isOnline: true,
        currentLatitude: { not: null, gte: bbox.south, lte: bbox.north },
        currentLongitude: { not: null, gte: bbox.west, lte: bbox.east },
        ...(availabilityType && availabilityType !== 'BOTH' ? {
          OR: [
            { availabilityType },
            { availabilityType: 'BOTH' },
          ],
        } : {}),
        ...(vehicleType ? { vehicleType: vehicleType as any } : {}),
      },
      take: limit * 2, // Get extra to filter by actual distance
    })

    // Calculate actual distances and filter
    const driversWithDistance = drivers
      .map(d => ({
        id: d.id,
        userId: d.userId,
        latitude: d.currentLatitude!,
        longitude: d.currentLongitude!,
        vehicleType: d.vehicleType,
        rating: d.rating,
        distanceKm: this.calculateDistance(
          { latitude, longitude },
          { latitude: d.currentLatitude!, longitude: d.currentLongitude! }
        ),
      }))
      .filter(d => d.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, limit)

    return driversWithDistance
  }

  /**
   * Estimate route distance and duration (simplified)
   * In production, use a routing API like OSRM, Mapbox, or Google
   */
  static estimateRoute(from: Coordinates, to: Coordinates): {
    distanceKm: number
    durationMinutes: number
  } {
    // Straight-line distance
    const directDistance = this.calculateDistance(from, to)
    
    // Approximate road distance (usually 1.3-1.5x straight line)
    const roadDistance = directDistance * 1.4
    
    // Assume average speed of 30 km/h in urban areas
    const averageSpeedKmh = 30
    const durationHours = roadDistance / averageSpeedKmh
    const durationMinutes = Math.ceil(durationHours * 60)

    return {
      distanceKm: Math.round(roadDistance * 10) / 10,
      durationMinutes,
    }
  }

  /**
   * Calculate ETA to pickup
   */
  static calculateEta(
    driverLocation: Coordinates,
    pickupLocation: Coordinates,
    trafficMultiplier: number = 1.0
  ): number {
    const route = this.estimateRoute(driverLocation, pickupLocation)
    return Math.ceil(route.durationMinutes * trafficMultiplier)
  }

  private static toRadians(degrees: number): number {
    return degrees * (Math.PI / 180)
  }
}
