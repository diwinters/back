/**
 * Driver Service
 * Manages driver registration, availability, and location
 */
import { z } from 'zod';
export declare const registerDriverSchema: z.ZodObject<{
    vehicleType: z.ZodString;
    licensePlate: z.ZodString;
    vehicleModel: z.ZodOptional<z.ZodString>;
    vehicleColor: z.ZodOptional<z.ZodString>;
    vehicleMake: z.ZodOptional<z.ZodString>;
    availabilityType: z.ZodDefault<z.ZodEnum<["RIDE", "DELIVERY", "BOTH"]>>;
}, "strip", z.ZodTypeAny, {
    vehicleType?: string;
    licensePlate?: string;
    vehicleModel?: string;
    vehicleColor?: string;
    vehicleMake?: string;
    availabilityType?: "RIDE" | "DELIVERY" | "BOTH";
}, {
    vehicleType?: string;
    licensePlate?: string;
    vehicleModel?: string;
    vehicleColor?: string;
    vehicleMake?: string;
    availabilityType?: "RIDE" | "DELIVERY" | "BOTH";
}>;
export declare const updateLocationSchema: z.ZodObject<{
    latitude: z.ZodNumber;
    longitude: z.ZodNumber;
    heading: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    latitude?: number;
    longitude?: number;
    heading?: number;
}, {
    latitude?: number;
    longitude?: number;
    heading?: number;
}>;
export declare const updateAvailabilitySchema: z.ZodObject<{
    isOnline: z.ZodOptional<z.ZodBoolean>;
    availabilityType: z.ZodOptional<z.ZodEnum<["RIDE", "DELIVERY", "BOTH"]>>;
}, "strip", z.ZodTypeAny, {
    availabilityType?: "RIDE" | "DELIVERY" | "BOTH";
    isOnline?: boolean;
}, {
    availabilityType?: "RIDE" | "DELIVERY" | "BOTH";
    isOnline?: boolean;
}>;
export declare class DriverService {
    /**
     * Register a user as a driver
     */
    registerDriver(userId: string, data: z.infer<typeof registerDriverSchema>): Promise<any>;
    /**
     * Get driver by ID
     */
    getDriver(driverId: string): Promise<any>;
    /**
     * Get driver by user ID
     */
    getDriverByUserId(userId: string): Promise<any>;
    /**
     * Update driver availability (online/offline toggle)
     */
    updateAvailability(driverId: string, data: z.infer<typeof updateAvailabilitySchema>): Promise<any>;
    /**
     * Update driver location
     */
    updateLocation(driverId: string, data: z.infer<typeof updateLocationSchema>): Promise<{
        updated: boolean;
        distance?: number;
    }>;
    /**
     * Find nearby available drivers
     */
    findNearbyDrivers(latitude: number, longitude: number, options?: {
        radiusKm?: number;
        availabilityType?: 'RIDE' | 'DELIVERY' | 'BOTH';
        vehicleType?: string;
        limit?: number;
    }): Promise<any[]>;
    /**
     * Get driver stats
     */
    getDriverStats(driverId: string): Promise<any>;
    /**
     * Get all online drivers
     */
    getOnlineDrivers(options?: {
        availabilityType?: 'RIDE' | 'DELIVERY' | 'BOTH';
        vehicleType?: string;
    }): Promise<any[]>;
}
