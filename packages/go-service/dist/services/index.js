"use strict";
/**
 * Go-Service Services
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketService = exports.updateUserSchema = exports.UserService = exports.createRatingSchema = exports.RatingService = exports.updateOrderStatusSchema = exports.acceptOrderSchema = exports.createOrderSchema = exports.OrderService = exports.updateAvailabilitySchema = exports.updateLocationSchema = exports.registerDriverSchema = exports.DriverService = void 0;
var driver_service_1 = require("./driver.service");
Object.defineProperty(exports, "DriverService", { enumerable: true, get: function () { return driver_service_1.DriverService; } });
Object.defineProperty(exports, "registerDriverSchema", { enumerable: true, get: function () { return driver_service_1.registerDriverSchema; } });
Object.defineProperty(exports, "updateLocationSchema", { enumerable: true, get: function () { return driver_service_1.updateLocationSchema; } });
Object.defineProperty(exports, "updateAvailabilitySchema", { enumerable: true, get: function () { return driver_service_1.updateAvailabilitySchema; } });
var order_service_1 = require("./order.service");
Object.defineProperty(exports, "OrderService", { enumerable: true, get: function () { return order_service_1.OrderService; } });
Object.defineProperty(exports, "createOrderSchema", { enumerable: true, get: function () { return order_service_1.createOrderSchema; } });
Object.defineProperty(exports, "acceptOrderSchema", { enumerable: true, get: function () { return order_service_1.acceptOrderSchema; } });
Object.defineProperty(exports, "updateOrderStatusSchema", { enumerable: true, get: function () { return order_service_1.updateOrderStatusSchema; } });
var rating_service_1 = require("./rating.service");
Object.defineProperty(exports, "RatingService", { enumerable: true, get: function () { return rating_service_1.RatingService; } });
Object.defineProperty(exports, "createRatingSchema", { enumerable: true, get: function () { return rating_service_1.createRatingSchema; } });
var user_service_1 = require("./user.service");
Object.defineProperty(exports, "UserService", { enumerable: true, get: function () { return user_service_1.UserService; } });
Object.defineProperty(exports, "updateUserSchema", { enumerable: true, get: function () { return user_service_1.updateUserSchema; } });
var market_service_1 = require("./market.service");
Object.defineProperty(exports, "MarketService", { enumerable: true, get: function () { return market_service_1.MarketService; } });
