/**
 * Shared Types
 * Common type definitions used across packages
 */
export type { User, Driver, Order, OrderEvent as PrismaOrderEvent, Rating, SavedPlace, MiniApp, } from '@prisma/client';
export { AvailabilityType, OrderType, OrderStatus, PackageSize, OrderEventType, } from '@prisma/client';
export type VehicleType = string;
export interface Coordinates {
    latitude: number;
    longitude: number;
}
export interface Location extends Coordinates {
    address?: string;
    placeId?: string;
    name?: string;
}
export interface UserProfile {
    id: string;
    did: string;
    handle?: string;
    displayName?: string;
    avatarUrl?: string;
    isDriver: boolean;
}
export interface AuthenticatedUser {
    id: string;
    did: string;
    handle?: string;
}
export interface DriverProfile {
    id: string;
    userId: string;
    isOnline: boolean;
    availabilityType: 'RIDE' | 'DELIVERY' | 'BOTH';
    vehicleType: string;
    vehiclePlate: string;
    vehicleModel?: string;
    vehicleColor?: string;
    rating: number;
    totalRides: number;
    totalDeliveries: number;
    currentLocation?: Coordinates;
}
export interface DriverLocationUpdate {
    driverId: string;
    latitude: number;
    longitude: number;
    heading?: number;
    speed?: number;
    timestamp: Date;
}
export interface NearbyDriver {
    id: string;
    userId: string;
    distanceKm: number;
    etaMinutes: number;
    vehicleType: string;
    vehicleInfo: string;
    rating: number;
    location: Coordinates;
}
export interface OrderRequest {
    type: 'RIDE' | 'DELIVERY';
    pickupLocation: Location;
    dropoffLocation: Location;
    vehicleType?: string;
    packageSize?: 'SMALL' | 'MEDIUM' | 'LARGE';
    recipientName?: string;
    recipientPhone?: string;
    packageDescription?: string;
}
export interface OrderEstimate {
    distanceKm: number;
    durationMinutes: number;
    fare: number;
    fareBreakdown: {
        baseFare: number;
        distanceFare: number;
        timeFare: number;
        surgeFare?: number;
    };
    surgeMultiplier?: number;
    nearbyDrivers: number;
    estimatedPickupTime: number;
}
export interface ActiveOrder {
    id: string;
    type: 'RIDE' | 'DELIVERY';
    status: string;
    pickup: Location;
    dropoff: Location;
    fare: number;
    otp?: string;
    driver?: {
        id: string;
        name: string;
        phone?: string;
        avatar?: string;
        vehicleType: string;
        vehiclePlate: string;
        vehicleModel?: string;
        vehicleColor?: string;
        rating: number;
        currentLocation?: Coordinates;
    };
    eta?: number;
    conversationId?: string;
    createdAt: Date;
    startedAt?: Date;
    completedAt?: Date;
}
export interface OrderEvent {
    id: string;
    orderId: string;
    type: string;
    location?: Coordinates;
    metadata?: Record<string, any>;
    timestamp: Date;
}
export interface WSMessage {
    type: string;
    payload: any;
}
export interface WSDriverLocationMessage {
    type: 'driver:location';
    payload: {
        driverId: string;
        latitude: number;
        longitude: number;
        heading?: number;
    };
}
export interface WSOrderUpdateMessage {
    type: 'order:update';
    payload: {
        orderId: string;
        status: string;
        driverLocation?: Coordinates;
        eta?: number;
    };
}
export interface WSOrderRequestMessage {
    type: 'order:request';
    payload: {
        orderId: string;
        type: 'RIDE' | 'DELIVERY';
        pickup: Location;
        dropoff: Location;
        fare: number;
        estimatedDistance: number;
        estimatedDuration: number;
    };
}
export interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: {
        code: string;
        message: string;
        details?: Record<string, any>;
    };
}
export interface PaginatedResponse<T> {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
}
export interface RatingInput {
    orderId: string;
    rating: number;
    comment?: string;
}
export interface FareConfig {
    baseFare: number;
    perKm: number;
    perMinute: number;
    minimumFare: number;
    surgeMultiplier?: number;
}
export interface FareBreakdown {
    baseFare: number;
    distanceFare: number;
    timeFare: number;
    surgeFare: number;
    total: number;
}
export interface PushNotificationPayload {
    title: string;
    body: string;
    data?: Record<string, string>;
    badge?: number;
    sound?: string;
}
export interface DriverSearchFilters {
    availabilityType?: 'RIDE' | 'DELIVERY' | 'BOTH';
    vehicleType?: string;
    minRating?: number;
}
export interface OrderSearchFilters {
    status?: string[];
    type?: 'RIDE' | 'DELIVERY';
    dateFrom?: Date;
    dateTo?: Date;
}
