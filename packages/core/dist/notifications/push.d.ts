/**
 * Push Notification Service
 * Sends notifications via Expo's push notification service
 */
export interface PushPayload {
    title: string;
    body: string;
    data?: Record<string, any>;
    sound?: 'default' | null;
    badge?: number;
    channelId?: string;
    priority?: 'default' | 'normal' | 'high';
    categoryId?: string;
}
export interface OrderNotificationData {
    type: 'new_order' | 'order_accepted' | 'driver_arriving' | 'driver_arrived' | 'trip_started' | 'trip_completed' | 'order_cancelled';
    orderId: string;
    orderType: 'RIDE' | 'DELIVERY';
    [key: string]: any;
}
export declare class PushNotificationService {
    private expo;
    constructor();
    /**
     * Send push notification to a single user
     */
    sendToUser(userId: string, payload: PushPayload): Promise<boolean>;
    /**
     * Send push notification to a user by DID
     */
    sendToUserByDid(did: string, payload: PushPayload): Promise<boolean>;
    /**
     * Send push notification to multiple users
     */
    sendToUsers(userIds: string[], payload: PushPayload): Promise<Map<string, boolean>>;
    /**
     * Send notification to drivers in a geographic area
     */
    notifyNearbyDrivers(latitude: number, longitude: number, radiusKm: number, payload: PushPayload, availabilityType?: 'RIDE' | 'DELIVERY' | 'BOTH'): Promise<string[]>;
    /**
     * Send new order notification to a specific driver
     */
    sendOrderRequest(driverId: string, orderData: OrderNotificationData): Promise<boolean>;
    /**
     * Send order status update to user
     */
    sendOrderUpdate(userId: string, orderData: OrderNotificationData): Promise<boolean>;
    private sendToToken;
    private createMessage;
    private logNotification;
}
