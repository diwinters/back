"use strict";
/**
 * Wallet Package
 * City Cash Points - Digital wallet system
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.walletAdminRoutes = exports.walletRoutes = exports.walletService = void 0;
var wallet_service_1 = require("./wallet-service");
Object.defineProperty(exports, "walletService", { enumerable: true, get: function () { return __importDefault(wallet_service_1).default; } });
var wallet_routes_1 = require("./wallet-routes");
Object.defineProperty(exports, "walletRoutes", { enumerable: true, get: function () { return __importDefault(wallet_routes_1).default; } });
var wallet_admin_routes_1 = require("./wallet-admin-routes");
Object.defineProperty(exports, "walletAdminRoutes", { enumerable: true, get: function () { return __importDefault(wallet_admin_routes_1).default; } });
//# sourceMappingURL=index.js.map