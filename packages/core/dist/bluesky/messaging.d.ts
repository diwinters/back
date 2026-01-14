/**
 * Bluesky DM Messaging Service
 * Integration with Bluesky DMs for order communication
 */
export interface ConversationMember {
    did: string;
    handle?: string;
}
export interface ChatMessage {
    text: string;
    facets?: any[];
    embed?: any;
}
export interface Conversation {
    id: string;
    members: ConversationMember[];
    lastMessage?: {
        id: string;
        text: string;
        sender: string;
        sentAt: Date;
    };
}
export declare class BlueskyMessaging {
    private serviceIdentifier;
    private servicePassword;
    private agent;
    private serviceHandle;
    constructor(serviceIdentifier: string, servicePassword: string);
    /**
     * Initialize the Bluesky agent
     */
    initialize(): Promise<void>;
    /**
     * Create a conversation between rider and driver
     */
    createConversation(riderDid: string, driverDid: string): Promise<string>;
    /**
     * Send a message to a conversation
     */
    sendMessage(conversationId: string, message: ChatMessage): Promise<string>;
    /**
     * Send order-related message templates
     */
    sendOrderMessage(conversationId: string, type: 'ORDER_CREATED' | 'DRIVER_ASSIGNED' | 'DRIVER_ARRIVED' | 'TRIP_STARTED' | 'TRIP_COMPLETED' | 'ORDER_CANCELLED', data: {
        orderId: string;
        driverName?: string;
        vehicleInfo?: string;
        pickupAddress?: string;
        dropoffAddress?: string;
        eta?: number;
        fare?: number;
        otp?: string;
    }): Promise<string>;
    /**
     * Send delivery-specific messages
     */
    sendDeliveryMessage(conversationId: string, type: 'PACKAGE_PICKUP' | 'IN_TRANSIT' | 'DELIVERED', data: {
        orderId: string;
        driverName?: string;
        recipientName?: string;
        address?: string;
        otp?: string;
    }): Promise<string>;
    /**
     * Create or get conversation between buyer and seller
     */
    getOrCreateMarketConversation(buyerDid: string, sellerDid: string): Promise<string>;
    /**
     * Get post record for embedding
     */
    getPostRecord(postUri: string): Promise<{
        uri: string;
        cid: string;
    } | null>;
    /**
     * Send market order notification to seller with embedded post
     * Returns both conversationId and messageId
     */
    sendMarketOrderDM(buyerDid: string, sellerDid: string, orderData: {
        orderId: string;
        total: number;
        currency: string;
        itemCount: number;
        items: Array<{
            title: string;
            quantity: number;
            price: number;
            postUri?: string;
            postCid?: string;
        }>;
    }): Promise<{
        conversationId: string;
        messageId: string;
    }>;
    /**
     * Send order status update message
     */
    sendOrderStatusUpdate(conversationId: string, type: 'CONFIRMED' | 'PACKAGED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'DISPUTED', data: {
        orderId: string;
        itemTitle?: string;
        trackingNumber?: string;
        estimatedDelivery?: string;
        reason?: string;
    }): Promise<string>;
    /**
     * Get conversation messages
     */
    getMessages(conversationId: string, options?: {
        limit?: number;
        cursor?: string;
    }): Promise<{
        messages: Array<{
            id: string;
            text: string;
            sender: string;
            sentAt: Date;
        }>;
        cursor?: string;
    }>;
    /**
     * Leave/archive a conversation
     */
    leaveConversation(conversationId: string): Promise<void>;
    /**
     * Ensure the agent is initialized
     */
    private ensureInitialized;
}
export declare function getBlueskyMessaging(): BlueskyMessaging;
