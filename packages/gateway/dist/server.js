"use strict";
/**
 * Express Server Entry Point
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
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.server = exports.app = void 0;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const compression_1 = __importDefault(require("compression"));
const morgan_1 = __importDefault(require("morgan"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const http_1 = require("http");
const core_1 = require("@gominiapp/core");
// Routes
const auth_routes_1 = require("./routes/auth.routes");
const user_routes_1 = require("./routes/user.routes");
const driver_routes_1 = require("./routes/driver.routes");
const order_routes_1 = require("./routes/order.routes");
const health_routes_1 = require("./routes/health.routes");
const config_routes_1 = require("./routes/config.routes");
const admin_routes_1 = require("./routes/admin.routes");
const market_routes_1 = require("./routes/market.routes");
const cart_routes_1 = require("./routes/cart.routes");
const labeler_routes_1 = require("./routes/labeler.routes");
const wallet_1 = require("@gominiapp/wallet");
const app = (0, express_1.default)();
exports.app = app;
const server = (0, http_1.createServer)(app);
exports.server = server;
// Trust proxy for rate limiting behind reverse proxy
app.set('trust proxy', 1);
// Security middleware
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({
    origin: process.env.CORS_ORIGIN?.split(',') || '*',
    credentials: true,
}));
// Compression
app.use((0, compression_1.default)());
// Body parsing
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
// Request logging
app.use((0, morgan_1.default)('combined', {
    stream: {
        write: (message) => core_1.logger.info(message.trim()),
    },
}));
// Rate limiting
const limiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' } },
});
app.use('/api/', limiter);
// Stricter rate limit for auth
const authLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 20, // 20 auth attempts per hour
    message: { error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many auth attempts' } },
});
app.use('/api/auth/', authLimiter);
// Health check (no auth required)
app.use('/health', health_routes_1.healthRouter);
// Public config endpoints (no auth required)
app.use('/api/config', config_routes_1.configRouter);
// Direct /api/cities endpoint (alias for /api/config/cities)
// *** CANONICAL CITIES API - Use this endpoint for all city data ***
app.get('/api/cities', async (req, res, next) => {
    try {
        const { service } = req.query; // Optional filter: ?service=market
        const cities = await core_1.prisma.city.findMany({
            where: { isActive: true },
            select: {
                id: true,
                code: true,
                name: true,
                country: true,
                currency: true,
                timezone: true,
                centerLatitude: true,
                centerLongitude: true,
                radiusKm: true,
                imageUrl: true,
                enabledServices: true,
                allowCrossCityOrders: true,
                linkedCityIds: true,
                boundaryPolygon: true,
                usePolygonBoundary: true,
            },
            orderBy: { name: 'asc' }
        });
        // Filter by service if specified
        let filteredCities = cities;
        if (service && typeof service === 'string') {
            filteredCities = cities.filter(c => c.enabledServices?.includes(service) ?? true);
        }
        core_1.logger.info(`[/api/cities] Fetched ${filteredCities.length} active cities`, {
            service: service || 'all'
        });
        res.json({ success: true, data: filteredCities });
    }
    catch (error) {
        core_1.logger.error('[/api/cities] Failed to list cities', { error });
        next(error);
    }
});
// City detection endpoint - find nearest city from coordinates
app.get('/api/cities/detect', async (req, res, next) => {
    try {
        const { lat, lng, service } = req.query;
        if (!lat || !lng) {
            return res.status(400).json({
                success: false,
                error: { code: 'MISSING_COORDS', message: 'lat and lng query parameters required' }
            });
        }
        const latitude = parseFloat(lat);
        const longitude = parseFloat(lng);
        if (isNaN(latitude) || isNaN(longitude)) {
            return res.status(400).json({
                success: false,
                error: { code: 'INVALID_COORDS', message: 'lat and lng must be valid numbers' }
            });
        }
        // Use the canonical GeoService for detection
        const { GeoService } = await Promise.resolve().then(() => __importStar(require('@gominiapp/core')));
        const result = await GeoService.detectCity(latitude, longitude, service);
        core_1.logger.info('[/api/cities/detect] City detection result', {
            latitude,
            longitude,
            detectedCity: result.city?.name,
            citiesInRange: result.allCitiesInRange.length
        });
        res.json({ success: true, data: result });
    }
    catch (error) {
        core_1.logger.error('[/api/cities/detect] City detection failed', { error });
        next(error);
    }
});
// API routes
app.use('/api/auth', auth_routes_1.authRouter);
app.use('/api/users', user_routes_1.userRouter);
app.use('/api/drivers', driver_routes_1.driverRouter);
app.use('/api/orders', order_routes_1.orderRouter);
app.use('/api/admin', admin_routes_1.adminRouter);
app.use('/api/market', market_routes_1.marketRouter);
app.use('/api/cart', cart_routes_1.cartRouter);
app.use('/api/wallet', wallet_1.walletRoutes);
app.use('/api/admin/wallet', wallet_1.walletAdminRoutes);
app.use('/api/labeler', labeler_routes_1.labelerRouter);
// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: {
            code: 'NOT_FOUND',
            message: `Route ${req.method} ${req.path} not found`,
        },
    });
});
// Error handler
app.use(core_1.errorHandler);
// Initialize Redis connection
const redis = (0, core_1.getRedisService)();
// Initialize WebSocket server
const wsServer = new core_1.WebSocketServer(server, redis);
(0, core_1.setWebSocketServer)(wsServer); // Make globally accessible for order notifications
// Graceful shutdown
const shutdown = async () => {
    core_1.logger.info('Shutting down server...');
    wsServer.close();
    await redis.close();
    server.close(() => {
        core_1.logger.info('Server shut down');
        process.exit(0);
    });
    // Force shutdown after 10 seconds
    setTimeout(() => {
        core_1.logger.error('Forced shutdown');
        process.exit(1);
    }, 10000);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    core_1.logger.info(`🚀 GoMiniApp Gateway running on port ${PORT}`);
    core_1.logger.info(`📡 WebSocket server ready`);
    core_1.logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
