/**
 * @gominiapp/core
 * Shared utilities, services, and infrastructure for GoMiniApp backend
 */
export { prisma } from './db/prisma';
export { validateDid, resolveDid, extractDid, extractUserFromToken, authMiddleware } from './auth/did';
export type { AuthenticatedRequest } from './auth/did';
export { PushNotificationService } from './notifications/push';
export { WebSocketServer, setWebSocketServer, getWebSocketServer } from './realtime/websocket';
export { RedisService, getRedisService } from './realtime/redis';
export { GeoService } from './geo/geo';
export type { Coordinates, BoundingBox, CityInfo, CityDetectionResult } from './geo/geo';
export { BlueskyMessaging, getBlueskyMessaging } from './bluesky/messaging';
export { logger, createLogger } from './utils/logger';
export { AppError, UnauthorizedError, NotFoundError, ValidationError, ConflictError, ServiceUnavailableError, RateLimitError, ErrorCode, isAppError, toAppError, errorHandler, } from './utils/errors';
export * from './types';
