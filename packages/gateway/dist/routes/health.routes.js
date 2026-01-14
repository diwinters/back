"use strict";
/**
 * Health Check Routes
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.healthRouter = void 0;
const express_1 = require("express");
const core_1 = require("@gominiapp/core");
const router = (0, express_1.Router)();
exports.healthRouter = router;
router.get('/', async (req, res) => {
    const checks = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: {
            database: 'unknown',
            redis: 'unknown',
        },
    };
    try {
        // Check database
        await core_1.prisma.$queryRaw `SELECT 1`;
        checks.services.database = 'healthy';
    }
    catch {
        checks.services.database = 'unhealthy';
        checks.status = 'degraded';
    }
    try {
        // Check Redis
        const redis = (0, core_1.getRedisService)();
        await redis.ping();
        checks.services.redis = 'healthy';
    }
    catch {
        checks.services.redis = 'unhealthy';
        checks.status = 'degraded';
    }
    const statusCode = checks.status === 'ok' ? 200 : 503;
    res.status(statusCode).json(checks);
});
router.get('/ready', async (req, res) => {
    try {
        await core_1.prisma.$queryRaw `SELECT 1`;
        res.json({ ready: true });
    }
    catch {
        res.status(503).json({ ready: false });
    }
});
router.get('/live', (req, res) => {
    res.json({ live: true });
});
