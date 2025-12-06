/**
 * @gominiapp/core
 * Shared utilities, services, and infrastructure for GoMiniApp backend
 */

// Database
export { prisma } from './db/prisma'

// Authentication
export { validateDid, resolveDid, extractDid, extractUserFromToken, authMiddleware } from './auth/did'
export type { AuthenticatedRequest } from './auth/did'

// Push Notifications
export { PushNotificationService } from './notifications/push'

// Real-time
export { WebSocketServer, setWebSocketServer, getWebSocketServer } from './realtime/websocket'
export { RedisService, getRedisService } from './realtime/redis'

// Geo
export { GeoService } from './geo/geo'
export type { Coordinates, BoundingBox } from './geo/geo'

// Bluesky Integration
export { BlueskyMessaging, getBlueskyMessaging } from './bluesky/messaging'

// Utilities
export { logger, createLogger } from './utils/logger'
export {
  AppError,
  UnauthorizedError,
  NotFoundError,
  ValidationError,
  ConflictError,
  ServiceUnavailableError,
  RateLimitError,
  ErrorCode,
  isAppError,
  toAppError,
  errorHandler,
} from './utils/errors'

// Types
export * from './types'
