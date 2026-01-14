/**
 * Rating Service
 * Manages ratings between users and drivers
 */
import { z } from 'zod';
export declare const createRatingSchema: z.ZodObject<{
    orderId: z.ZodString;
    toUserId: z.ZodString;
    rating: z.ZodNumber;
    comment: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    rating?: number;
    orderId?: string;
    toUserId?: string;
    comment?: string;
}, {
    rating?: number;
    orderId?: string;
    toUserId?: string;
    comment?: string;
}>;
export declare class RatingService {
    /**
     * Create a rating for an order
     */
    createRating(fromUserId: string, data: z.infer<typeof createRatingSchema>): Promise<any>;
    /**
     * Get ratings for a user
     */
    getUserRatings(userId: string, options?: {
        page?: number;
        pageSize?: number;
    }): Promise<{
        ratings: any[];
        total: number;
        average: number;
    }>;
    /**
     * Get rating summary for a user
     */
    getRatingSummary(userId: string): Promise<{
        average: number;
        total: number;
        distribution: {
            stars: number;
            count: number;
        }[];
    }>;
    /**
     * Update average rating for a user (stored on User model)
     */
    private updateAverageRating;
    /**
     * Check if user can rate an order
     */
    canRateOrder(userId: string, orderId: string): Promise<boolean>;
}
