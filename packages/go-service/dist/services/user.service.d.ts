/**
 * User Service
 * Manages user profiles and settings
 */
import { z } from 'zod';
export declare const updateUserSchema: z.ZodObject<{
    displayName: z.ZodOptional<z.ZodString>;
    avatarUrl: z.ZodOptional<z.ZodString>;
    phone: z.ZodOptional<z.ZodString>;
    defaultPaymentMethod: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    displayName?: string;
    avatarUrl?: string;
    defaultPaymentMethod?: string;
    phone?: string;
}, {
    displayName?: string;
    avatarUrl?: string;
    defaultPaymentMethod?: string;
    phone?: string;
}>;
export declare class UserService {
    /**
     * Get or create user by DID
     */
    getOrCreateUser(did: string, handle?: string): Promise<any>;
    /**
     * Get user by ID
     */
    getUser(userId: string): Promise<any>;
    /**
     * Get user by DID
     */
    getUserByDid(did: string): Promise<any>;
    /**
     * Update user profile
     */
    updateUser(userId: string, data: z.infer<typeof updateUserSchema>): Promise<any>;
    /**
     * Get user's saved places
     */
    getSavedPlaces(userId: string): Promise<any[]>;
    /**
     * Add saved place
     */
    addSavedPlace(userId: string, data: {
        label: string;
        address: string;
        latitude: number;
        longitude: number;
        name: string;
    }): Promise<any>;
    /**
     * Delete saved place
     */
    deleteSavedPlace(userId: string, placeId: string): Promise<void>;
    /**
     * Get user statistics
     */
    getUserStats(userId: string): Promise<{
        totalOrders: number;
        completedOrders: number;
        cancelledOrders: number;
        averageRating: number;
        totalSpent: number;
    }>;
    /**
     * Check if user is a driver
     */
    isDriver(userId: string): Promise<boolean>;
    /**
     * Update push token
     */
    updatePushToken(userId: string, pushToken: string): Promise<void>;
    /**
     * Search users by handle or display name
     */
    searchUsers(query: string, options?: {
        limit?: number;
    }): Promise<any[]>;
    /**
     * Get user's preferred city
     */
    getPreferredCity(userId: string): Promise<any | null>;
    /**
     * Set user's preferred city
     */
    setPreferredCity(userId: string, cityId: string | null): Promise<any>;
}
