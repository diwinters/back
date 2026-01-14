"use strict";
/**
 * Shared Types
 * Common type definitions used across packages
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrderEventType = exports.PackageSize = exports.OrderStatus = exports.OrderType = exports.AvailabilityType = void 0;
// Enums
var client_1 = require("@prisma/client");
Object.defineProperty(exports, "AvailabilityType", { enumerable: true, get: function () { return client_1.AvailabilityType; } });
Object.defineProperty(exports, "OrderType", { enumerable: true, get: function () { return client_1.OrderType; } });
Object.defineProperty(exports, "OrderStatus", { enumerable: true, get: function () { return client_1.OrderStatus; } });
Object.defineProperty(exports, "PackageSize", { enumerable: true, get: function () { return client_1.PackageSize; } });
Object.defineProperty(exports, "OrderEventType", { enumerable: true, get: function () { return client_1.OrderEventType; } });
