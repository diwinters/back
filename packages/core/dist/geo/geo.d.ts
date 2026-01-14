/**
 * Geo Service
 * Geographic utilities and PostGIS queries for proximity search
 *
 * *** CANONICAL IMPLEMENTATION ***
 * This is the SINGLE source of truth for all geographic calculations.
 * Do NOT duplicate Haversine or city detection logic elsewhere.
 */
export interface Coordinates {
    latitude: number;
    longitude: number;
}
export interface BoundingBox {
    north: number;
    south: number;
    east: number;
    west: number;
}
export interface CityInfo {
    id: string;
    code: string;
    name: string;
    country: string;
    currency: string;
    timezone: string | null;
    centerLatitude: number;
    centerLongitude: number;
    radiusKm: number;
    enabledServices: string[];
    allowCrossCityOrders: boolean;
    linkedCityIds: string[];
    distanceKm: number;
}
export interface CityDetectionResult {
    city: CityInfo | null;
    allCitiesInRange: CityInfo[];
    nearestCity: CityInfo | null;
}
export declare class GeoService {
    /**
     * Calculate distance between two points using Haversine formula
     */
    static calculateDistance(from: Coordinates, to: Coordinates): number;
    /**
     * Check if distance between two points exceeds threshold
     */
    static hasMovedBeyondThreshold(from: Coordinates, to: Coordinates, thresholdMeters: number): boolean;
    /**
     * Calculate bounding box around a point
     */
    static getBoundingBox(center: Coordinates, radiusKm: number): BoundingBox;
    /**
     * Find nearby available drivers using PostGIS
     */
    static findNearbyDrivers(latitude: number, longitude: number, radiusKm: number, options?: {
        availabilityType?: 'RIDE' | 'DELIVERY' | 'BOTH';
        vehicleType?: string;
        limit?: number;
    }): Promise<Array<{
        id: string;
        userId: string;
        distanceKm: number;
        latitude: number;
        longitude: number;
        vehicleType: string;
        rating: number;
    }>>;
    /**
     * Fallback method without PostGIS
     */
    private static findNearbyDriversFallback;
    /**
     * Estimate route distance and duration (simplified)
     * In production, use a routing API like OSRM, Mapbox, or Google
     */
    static estimateRoute(from: Coordinates, to: Coordinates): {
        distanceKm: number;
        durationMinutes: number;
    };
    /**
     * Calculate ETA to pickup
     */
    static calculateEta(driverLocation: Coordinates, pickupLocation: Coordinates, trafficMultiplier?: number): number;
    /**
     * Detect the nearest city within service radius
     * Returns the NEAREST city (not first match) to handle overlapping service areas
     *
     * @param latitude User's latitude
     * @param longitude User's longitude
     * @param serviceFilter Optional: filter cities by enabled service ('market', 'rides', 'delivery')
     */
    static detectCity(latitude: number, longitude: number, serviceFilter?: string): Promise<CityDetectionResult>;
    /**
     * Check if a point is inside a polygon (for advanced city boundaries)
     * Uses ray-casting algorithm
     *
     * @param point The point to check
     * @param polygon Array of [longitude, latitude] coordinates (GeoJSON style)
     */
    static isPointInPolygon(point: Coordinates, polygon: number[][]): boolean;
    /**
     * Detect city using polygon boundaries (for cities with usePolygonBoundary=true)
     * Falls back to radius-based detection
     */
    static detectCityAdvanced(latitude: number, longitude: number, serviceFilter?: string): Promise<CityDetectionResult>;
    /**
     * Check if two cities allow cross-city orders
     */
    static canCrossCityOrder(fromCityId: string, toCityId: string): Promise<boolean>;
    /**
     * Get cross-city pricing if available
     * NOTE: Requires CrossCityPricing model migration to be applied
     */
    static getCrossCityPricing(fromCityId: string, toCityId: string, vehicleTypeCode: string): Promise<{
        flatRate?: number;
        baseFare?: number;
        perKmRate?: number;
        minimumFare?: number;
        estimatedDistanceKm?: number;
        estimatedDurationMin?: number;
    } | null>;
    private static toRadians;
}
