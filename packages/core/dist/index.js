"use strict";
/**
 * @gominiapp/core
 * Shared utilities, services, and infrastructure for GoMiniApp backend
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = exports.toAppError = exports.isAppError = exports.ErrorCode = exports.RateLimitError = exports.ServiceUnavailableError = exports.ConflictError = exports.ValidationError = exports.NotFoundError = exports.UnauthorizedError = exports.AppError = exports.createLogger = exports.logger = exports.getBlueskyMessaging = exports.BlueskyMessaging = exports.GeoService = exports.getRedisService = exports.RedisService = exports.getWebSocketServer = exports.setWebSocketServer = exports.WebSocketServer = exports.PushNotificationService = exports.authMiddleware = exports.extractUserFromToken = exports.extractDid = exports.resolveDid = exports.validateDid = exports.prisma = void 0;
// Database
var prisma_1 = require("./db/prisma");
Object.defineProperty(exports, "prisma", { enumerable: true, get: function () { return prisma_1.prisma; } });
// Authentication
var did_1 = require("./auth/did");
Object.defineProperty(exports, "validateDid", { enumerable: true, get: function () { return did_1.validateDid; } });
Object.defineProperty(exports, "resolveDid", { enumerable: true, get: function () { return did_1.resolveDid; } });
Object.defineProperty(exports, "extractDid", { enumerable: true, get: function () { return did_1.extractDid; } });
Object.defineProperty(exports, "extractUserFromToken", { enumerable: true, get: function () { return did_1.extractUserFromToken; } });
Object.defineProperty(exports, "authMiddleware", { enumerable: true, get: function () { return did_1.authMiddleware; } });
// Push Notifications
var push_1 = require("./notifications/push");
Object.defineProperty(exports, "PushNotificationService", { enumerable: true, get: function () { return push_1.PushNotificationService; } });
// Real-time
var websocket_1 = require("./realtime/websocket");
Object.defineProperty(exports, "WebSocketServer", { enumerable: true, get: function () { return websocket_1.WebSocketServer; } });
Object.defineProperty(exports, "setWebSocketServer", { enumerable: true, get: function () { return websocket_1.setWebSocketServer; } });
Object.defineProperty(exports, "getWebSocketServer", { enumerable: true, get: function () { return websocket_1.getWebSocketServer; } });
var redis_1 = require("./realtime/redis");
Object.defineProperty(exports, "RedisService", { enumerable: true, get: function () { return redis_1.RedisService; } });
Object.defineProperty(exports, "getRedisService", { enumerable: true, get: function () { return redis_1.getRedisService; } });
// Geo
var geo_1 = require("./geo/geo");
Object.defineProperty(exports, "GeoService", { enumerable: true, get: function () { return geo_1.GeoService; } });
// Bluesky Integration
var messaging_1 = require("./bluesky/messaging");
Object.defineProperty(exports, "BlueskyMessaging", { enumerable: true, get: function () { return messaging_1.BlueskyMessaging; } });
Object.defineProperty(exports, "getBlueskyMessaging", { enumerable: true, get: function () { return messaging_1.getBlueskyMessaging; } });
// Utilities
var logger_1 = require("./utils/logger");
Object.defineProperty(exports, "logger", { enumerable: true, get: function () { return logger_1.logger; } });
Object.defineProperty(exports, "createLogger", { enumerable: true, get: function () { return logger_1.createLogger; } });
var errors_1 = require("./utils/errors");
Object.defineProperty(exports, "AppError", { enumerable: true, get: function () { return errors_1.AppError; } });
Object.defineProperty(exports, "UnauthorizedError", { enumerable: true, get: function () { return errors_1.UnauthorizedError; } });
Object.defineProperty(exports, "NotFoundError", { enumerable: true, get: function () { return errors_1.NotFoundError; } });
Object.defineProperty(exports, "ValidationError", { enumerable: true, get: function () { return errors_1.ValidationError; } });
Object.defineProperty(exports, "ConflictError", { enumerable: true, get: function () { return errors_1.ConflictError; } });
Object.defineProperty(exports, "ServiceUnavailableError", { enumerable: true, get: function () { return errors_1.ServiceUnavailableError; } });
Object.defineProperty(exports, "RateLimitError", { enumerable: true, get: function () { return errors_1.RateLimitError; } });
Object.defineProperty(exports, "ErrorCode", { enumerable: true, get: function () { return errors_1.ErrorCode; } });
Object.defineProperty(exports, "isAppError", { enumerable: true, get: function () { return errors_1.isAppError; } });
Object.defineProperty(exports, "toAppError", { enumerable: true, get: function () { return errors_1.toAppError; } });
Object.defineProperty(exports, "errorHandler", { enumerable: true, get: function () { return errors_1.errorHandler; } });
// Types
__exportStar(require("./types"), exports);
