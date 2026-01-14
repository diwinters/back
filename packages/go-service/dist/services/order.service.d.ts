/**
 * Order Service
 * Manages ride and delivery orders
 */
import { z } from 'zod';
interface CityPricing {
    cityId: string;
    cityName: string;
    baseFare: number;
    perKmRate: number;
    perMinuteRate: number;
    minimumFare: number;
    surgeMultiplier: number;
}
export declare const createOrderSchema: z.ZodObject<{
    type: z.ZodEnum<["RIDE", "DELIVERY"]>;
    pickupLatitude: z.ZodNumber;
    pickupLongitude: z.ZodNumber;
    pickupAddress: z.ZodString;
    pickupName: z.ZodOptional<z.ZodString>;
    dropoffLatitude: z.ZodNumber;
    dropoffLongitude: z.ZodNumber;
    dropoffAddress: z.ZodString;
    dropoffName: z.ZodOptional<z.ZodString>;
    vehicleType: z.ZodDefault<z.ZodString>;
    packageSize: z.ZodOptional<z.ZodEnum<["SMALL", "MEDIUM", "LARGE", "EXTRA_LARGE"]>>;
    recipientName: z.ZodOptional<z.ZodString>;
    recipientPhone: z.ZodOptional<z.ZodString>;
    packageDescription: z.ZodOptional<z.ZodString>;
    assignedDriverId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    vehicleType?: string;
    type?: "RIDE" | "DELIVERY";
    pickupLatitude?: number;
    pickupLongitude?: number;
    pickupAddress?: string;
    pickupName?: string;
    dropoffLatitude?: number;
    dropoffLongitude?: number;
    dropoffAddress?: string;
    dropoffName?: string;
    packageSize?: "SMALL" | "MEDIUM" | "LARGE" | "EXTRA_LARGE";
    recipientName?: string;
    recipientPhone?: string;
    packageDescription?: string;
    assignedDriverId?: string;
}, {
    vehicleType?: string;
    type?: "RIDE" | "DELIVERY";
    pickupLatitude?: number;
    pickupLongitude?: number;
    pickupAddress?: string;
    pickupName?: string;
    dropoffLatitude?: number;
    dropoffLongitude?: number;
    dropoffAddress?: string;
    dropoffName?: string;
    packageSize?: "SMALL" | "MEDIUM" | "LARGE" | "EXTRA_LARGE";
    recipientName?: string;
    recipientPhone?: string;
    packageDescription?: string;
    assignedDriverId?: string;
}>;
export declare const acceptOrderSchema: z.ZodObject<{
    orderId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    orderId?: string;
}, {
    orderId?: string;
}>;
export declare const updateOrderStatusSchema: z.ZodObject<{
    status: z.ZodEnum<["DRIVER_ASSIGNED", "DRIVER_ARRIVING", "ARRIVED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]>;
}, "strip", z.ZodTypeAny, {
    status?: "DRIVER_ASSIGNED" | "DRIVER_ARRIVING" | "ARRIVED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
}, {
    status?: "DRIVER_ASSIGNED" | "DRIVER_ARRIVING" | "ARRIVED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
}>;
export declare class OrderService {
    private driverService;
    constructor();
    /**
     * Detect which city a location is in
     * *** USES CANONICAL GeoService.detectCity - finds NEAREST city within radius ***
     */
    detectCity(latitude: number, longitude: number): Promise<{
        cityId: string;
        cityName: string;
    } | null>;
    /**
     * Get city-specific pricing for a vehicle type
     * Returns null if no city pricing exists
     */
    getCityPricing(cityId: string, vehicleTypeCode: string): Promise<CityPricing | null>;
    /**
     * Calculate fare using city-specific pricing or fallback
     */
    calculateFare(distanceKm: number, durationMinutes: number, vehicleType: string, cityPricing: CityPricing | null): number;
    /**
     * Start a timeout for an order - if no driver accepts within 30s, re-broadcast
     */
    startOrderTimeout(orderId: string, order: any, excludedDriverIds?: string[]): void;
    /**
     * Clear timeout for an order (when accepted or cancelled)
     */
    clearOrderTimeout(orderId: string): void;
    /**
     * Get fare estimate
     */
    getEstimate(data: z.infer<typeof createOrderSchema>): Promise<{
        distanceKm: number;
        durationMinutes: number;
        fare: number;
        nearbyDrivers: number;
        cityId?: string;
        cityName?: string;
        surgeMultiplier?: number;
    }>;
    /**
     * Create a new order
     */
    createOrder(userId: string, data: z.infer<typeof createOrderSchema>): Promise<any>;
    /**
     * Accept an order (driver)
     */
    acceptOrder(driverId: string, orderId: string): Promise<any>;
    /**
     * Decline an order (driver)
     * Records decline event and re-broadcasts to other drivers
     */
    declineOrder(driverId: string, orderId: string): Promise<void>;
    /**
     * Re-broadcast an order to nearby drivers, excluding specific drivers
     */
    rebroadcastOrder(order: any, excludeDriverIds: string[]): Promise<void>;
    /**
     * Update order status
     */
    updateOrderStatus(orderId: string, status: string, location?: {
        latitude: number;
        longitude: number;
    }): Promise<any>;
    /**
     * Cancel order
     */
    cancelOrder(orderId: string, userId: string, reason?: string): Promise<void>;
    /**
     * Get active order for user
     */
    getActiveOrderForUser(userId: string): Promise<any>;
    /**
     * Get active order for driver
     */
    getActiveOrderForDriver(driverId: string): Promise<any>;
    /**
     * Get order history - for both riders (as user) and drivers (as driver)
     */
    getOrderHistory(userIdentifier: string, // can be internal userId (UUID) or DID
    options?: {
        page?: number;
        pageSize?: number;
    }): Promise<{
        orders: any[];
        total: number;
    }>;
    /**
     * Calculate distance between two points in meters
     */
    private calculateDistance;
}
export {};
