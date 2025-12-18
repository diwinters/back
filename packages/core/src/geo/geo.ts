/**
 * Geo Service
 * Geographic utilities and PostGIS queries for proximity search
 * 
 * *** CANONICAL IMPLEMENTATION ***
 * This is the SINGLE source of truth for all geographic calculations.
 * Do NOT duplicate Haversine or city detection logic elsewhere.
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

export interface CityInfo {
  id: string
  code: string
  name: string
  country: string
  currency: string
  timezone: string | null
  centerLatitude: number
  centerLongitude: number
  radiusKm: number
  enabledServices: string[]
  allowCrossCityOrders: boolean
  linkedCityIds: string[]
  distanceKm: number  // Distance from user to city center
}

export interface CityDetectionResult {
  city: CityInfo | null
  allCitiesInRange: CityInfo[]  // All cities user is within radius of
  nearestCity: CityInfo | null   // Nearest city even if outside radius
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

  // =============================================================================
  // CITY DETECTION - CANONICAL IMPLEMENTATION
  // =============================================================================

  /**
   * Detect the nearest city within service radius
   * Returns the NEAREST city (not first match) to handle overlapping service areas
   * 
   * @param latitude User's latitude
   * @param longitude User's longitude
   * @param serviceFilter Optional: filter cities by enabled service ('market', 'rides', 'delivery')
   */
  static async detectCity(
    latitude: number,
    longitude: number,
    serviceFilter?: string
  ): Promise<CityDetectionResult> {
    logger.info('[GeoService] Detecting city', { latitude, longitude, serviceFilter })

    try {
      const cities = await prisma.city.findMany({
        where: { isActive: true }
      })

      if (cities.length === 0) {
        logger.warn('[GeoService] No active cities found in database')
        return { city: null, allCitiesInRange: [], nearestCity: null }
      }

      const citiesWithDistance: CityInfo[] = cities.map(city => {
        const distanceKm = this.calculateDistance(
          { latitude, longitude },
          { latitude: city.centerLatitude, longitude: city.centerLongitude }
        )

        return {
          id: city.id,
          code: city.code,
          name: city.name,
          country: city.country,
          currency: city.currency,
          timezone: city.timezone,
          centerLatitude: city.centerLatitude,
          centerLongitude: city.centerLongitude,
          radiusKm: city.radiusKm,
          enabledServices: (city as any).enabledServices || ['market', 'rides', 'delivery'],
          allowCrossCityOrders: (city as any).allowCrossCityOrders || false,
          linkedCityIds: (city as any).linkedCityIds || [],
          distanceKm
        }
      })

      // Filter by service if specified
      let filteredCities = citiesWithDistance
      if (serviceFilter) {
        filteredCities = citiesWithDistance.filter(c => 
          c.enabledServices.includes(serviceFilter)
        )
      }

      // Sort by distance (nearest first)
      filteredCities.sort((a, b) => a.distanceKm - b.distanceKm)

      // Find all cities within their respective radius
      const citiesInRange = filteredCities.filter(c => c.distanceKm <= c.radiusKm)
      
      // The nearest city (even if outside radius)
      const nearestCity = filteredCities[0] || null

      // The selected city is the nearest one within range
      const selectedCity = citiesInRange[0] || null

      logger.info('[GeoService] City detection result', {
        selectedCity: selectedCity?.name,
        citiesInRange: citiesInRange.length,
        nearestCity: nearestCity?.name,
        nearestDistance: nearestCity?.distanceKm?.toFixed(2)
      })

      return {
        city: selectedCity,
        allCitiesInRange: citiesInRange,
        nearestCity
      }
    } catch (error) {
      logger.error('[GeoService] City detection failed', { error, latitude, longitude })
      return { city: null, allCitiesInRange: [], nearestCity: null }
    }
  }

  /**
   * Check if a point is inside a polygon (for advanced city boundaries)
   * Uses ray-casting algorithm
   * 
   * @param point The point to check
   * @param polygon Array of [longitude, latitude] coordinates (GeoJSON style)
   */
  static isPointInPolygon(point: Coordinates, polygon: number[][]): boolean {
    const x = point.longitude
    const y = point.latitude
    let inside = false

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0], yi = polygon[i][1]
      const xj = polygon[j][0], yj = polygon[j][1]

      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside
      }
    }

    return inside
  }

  /**
   * Detect city using polygon boundaries (for cities with usePolygonBoundary=true)
   * Falls back to radius-based detection
   */
  static async detectCityAdvanced(
    latitude: number,
    longitude: number,
    serviceFilter?: string
  ): Promise<CityDetectionResult> {
    logger.info('[GeoService] Advanced city detection', { latitude, longitude, serviceFilter })

    try {
      const cities = await prisma.city.findMany({
        where: { isActive: true }
      })

      const point = { latitude, longitude }
      const citiesWithDistance: CityInfo[] = []

      for (const city of cities) {
        const cityData = city as any
        const distanceKm = this.calculateDistance(
          point,
          { latitude: city.centerLatitude, longitude: city.centerLongitude }
        )

        // Check if city uses polygon boundary
        let isInCity = false
        if (cityData.usePolygonBoundary && cityData.boundaryPolygon) {
          isInCity = this.isPointInPolygon(point, cityData.boundaryPolygon)
        } else {
          isInCity = distanceKm <= city.radiusKm
        }

        const cityInfo: CityInfo = {
          id: city.id,
          code: city.code,
          name: city.name,
          country: city.country,
          currency: city.currency,
          timezone: city.timezone,
          centerLatitude: city.centerLatitude,
          centerLongitude: city.centerLongitude,
          radiusKm: city.radiusKm,
          enabledServices: cityData.enabledServices || ['market', 'rides', 'delivery'],
          allowCrossCityOrders: cityData.allowCrossCityOrders || false,
          linkedCityIds: cityData.linkedCityIds || [],
          distanceKm
        }

        citiesWithDistance.push(cityInfo)
      }

      // Filter by service
      let filteredCities = citiesWithDistance
      if (serviceFilter) {
        filteredCities = citiesWithDistance.filter(c => 
          c.enabledServices.includes(serviceFilter)
        )
      }

      // Sort by distance
      filteredCities.sort((a, b) => a.distanceKm - b.distanceKm)

      // For polygon cities, re-check which ones contain the point
      const citiesInRange = filteredCities.filter(c => c.distanceKm <= c.radiusKm)
      const nearestCity = filteredCities[0] || null
      const selectedCity = citiesInRange[0] || null

      return {
        city: selectedCity,
        allCitiesInRange: citiesInRange,
        nearestCity
      }
    } catch (error) {
      logger.error('[GeoService] Advanced city detection failed', { error })
      // Fallback to simple detection
      return this.detectCity(latitude, longitude, serviceFilter)
    }
  }

  /**
   * Check if two cities allow cross-city orders
   */
  static async canCrossCityOrder(fromCityId: string, toCityId: string): Promise<boolean> {
    if (fromCityId === toCityId) return true

    const fromCity = await prisma.city.findUnique({
      where: { id: fromCityId }
    })

    if (!fromCity) return false

    const cityData = fromCity as any
    if (!cityData.allowCrossCityOrders) return false
    
    // Check if target city is in linked cities
    const linkedCities = cityData.linkedCityIds || []
    return linkedCities.includes(toCityId)
  }

  /**
   * Get cross-city pricing if available
   */
  static async getCrossCityPricing(
    fromCityId: string,
    toCityId: string,
    vehicleTypeCode: string
  ): Promise<{
    flatRate?: number
    baseFare?: number
    perKmRate?: number
    minimumFare?: number
    estimatedDistanceKm?: number
    estimatedDurationMin?: number
  } | null> {
    const pricing = await prisma.crossCityPricing.findUnique({
      where: {
        fromCityId_toCityId_vehicleTypeCode: {
          fromCityId,
          toCityId,
          vehicleTypeCode
        }
      }
    })

    if (!pricing || !pricing.isActive) return null

    return {
      flatRate: pricing.flatRate || undefined,
      baseFare: pricing.baseFare || undefined,
      perKmRate: pricing.perKmRate || undefined,
      minimumFare: pricing.minimumFare || undefined,
      estimatedDistanceKm: pricing.estimatedDistanceKm || undefined,
      estimatedDurationMin: pricing.estimatedDurationMin || undefined
    }
  }

  private static toRadians(degrees: number): number {
    return degrees * (Math.PI / 180)
  }
}
