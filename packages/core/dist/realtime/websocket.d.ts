/**
 * WebSocket Server for Real-time Updates
 * Handles live location tracking, order status, and driver availability
 */
import { Server as HttpServer } from 'http';
import { WebSocket } from 'ws';
import { RedisService } from './redis';
export interface WSClient {
    ws: WebSocket;
    did: string;
    role: 'user' | 'driver';
    subscriptions: Set<string>;
    lastPing: number;
}
export interface WSMessage {
    type: string;
    payload: any;
    timestamp?: number;
}
export declare class WebSocketServer {
    private wss;
    private clients;
    private redis;
    private pingInterval;
    private instanceId;
    constructor(server: HttpServer, redis: RedisService);
    /**
     * Set up Redis pub/sub for cross-cluster WebSocket messaging
     */
    private setupClusterMessaging;
    private verifyClient;
    private setupServer;
    private handleMessage;
    private handleSubscribe;
    private handleUnsubscribe;
    private handleDriverLocation;
    private handleDisconnect;
    /**
     * Send message to a specific DID
     * If client not on this instance, publishes to Redis for other instances to handle
     */
    sendToDid(did: string, message: WSMessage): Promise<boolean>;
    /**
     * Broadcast message to all subscribers of a channel
     */
    broadcastToChannel(channel: string, message: WSMessage): void;
    /**
     * Broadcast to all drivers in a geographic area
     * @param excludeDriverIds - Array of driver user IDs to exclude (e.g., drivers who declined)
     */
    broadcastToNearbyDrivers(latitude: number, longitude: number, radiusKm: number, message: WSMessage, excludeDriverIds?: string[]): Promise<string[]>;
    /**
     * Send order update to user
     */
    sendOrderUpdate(userDid: string, orderId: string, status: string, data?: any): Promise<void>;
    /**
     * Send new order request to driver
     */
    sendOrderRequest(driverDid: string, orderData: any): Promise<void>;
    private send;
    private startPingInterval;
    /**
     * Get count of connected clients
     */
    getStats(): {
        total: number;
        drivers: number;
        users: number;
    };
    /**
     * Clean shutdown
     */
    close(): void;
}
/**
 * Set the global WebSocket server instance
 * Called from gateway server initialization
 */
export declare function setWebSocketServer(server: WebSocketServer): void;
/**
 * Get the global WebSocket server instance
 * Returns null if not initialized
 */
export declare function getWebSocketServer(): WebSocketServer | null;
