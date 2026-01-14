"use strict";
/**
 * Config Routes
 * Public configuration endpoints (no auth required)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.configRouter = void 0;
const express_1 = require("express");
const core_1 = require("@gominiapp/core");
const router = (0, express_1.Router)();
exports.configRouter = router;
/**
 * Detect which city a location is in based on distance from city center
 * Returns the NEAREST city if within any city's radius
 */
async function detectCity(latitude, longitude) {
    const activeCities = await core_1.prisma.city.findMany({
        where: { isActive: true },
        select: {
            id: true,
            name: true,
            currency: true,
            centerLatitude: true,
            centerLongitude: true,
            radiusKm: true,
        }
    });
    // Find the nearest city that the user is within
    let nearestCity = null;
    let nearestDistance = Infinity;
    for (const city of activeCities) {
        const distanceKm = core_1.GeoService.calculateDistance({ latitude, longitude }, { latitude: city.centerLatitude, longitude: city.centerLongitude });
        // Only consider cities where user is within the radius
        if (distanceKm <= city.radiusKm && distanceKm < nearestDistance) {
            nearestCity = city;
            nearestDistance = distanceKm;
        }
    }
    if (nearestCity) {
        core_1.logger.debug(`Detected city: ${nearestCity.name} (${nearestDistance.toFixed(1)}km from center)`);
        return {
            id: nearestCity.id,
            name: nearestCity.name,
            currency: nearestCity.currency,
            centerLatitude: nearestCity.centerLatitude,
            centerLongitude: nearestCity.centerLongitude,
        };
    }
    return null;
}
/**
 * GET /api/config/vehicle-types
 * Get active vehicle types for client display
 * Public endpoint - no auth required
 *
 * Query params:
 * - lat: latitude of user location (optional)
 * - lng: longitude of user location (optional)
 *
 * If lat/lng provided, returns city-specific pricing
 * If user is outside all cities, returns available: false
 */
router.get('/vehicle-types', async (req, res, next) => {
    try {
        const { lat, lng } = req.query;
        const hasCoordinates = lat && lng;
        const latitude = hasCoordinates ? parseFloat(lat) : null;
        const longitude = hasCoordinates ? parseFloat(lng) : null;
        // Check city if coordinates provided
        let city = null;
        let cityPricing = new Map();
        if (latitude !== null && longitude !== null && !isNaN(latitude) && !isNaN(longitude)) {
            city = await detectCity(latitude, longitude);
            if (!city) {
                // User is outside all service areas
                return res.json({
                    success: true,
                    available: false,
                    message: 'Service is not available in your area',
                    data: [],
                });
            }
            // Get city-specific pricing
            const pricing = await core_1.prisma.cityVehiclePricing.findMany({
                where: { cityId: city.id }
            });
            for (const p of pricing) {
                cityPricing.set(p.vehicleTypeCode, {
                    baseFare: p.baseFare,
                    perKmRate: p.perKmRate,
                    perMinuteRate: p.perMinuteRate,
                    minimumFare: p.minimumFare,
                    surgeMultiplier: p.surgeMultiplier,
                });
            }
        }
        const vehicleTypes = await core_1.prisma.vehicleTypeConfig.findMany({
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
            select: {
                id: true,
                code: true,
                name: true,
                description: true,
                icon: true,
                capacity: true,
                baseFare: true,
                perKmRate: true,
                perMinuteRate: true,
                minimumFare: true,
                features: true,
                sortOrder: true,
                isPromo: true,
                promoText: true,
            }
        });
        // Transform to client-friendly format with city-specific pricing
        const clientVehicleTypes = vehicleTypes.map(vt => {
            const cityPrice = cityPricing.get(vt.code);
            const baseFare = cityPrice?.baseFare ?? vt.baseFare;
            const perKmRate = cityPrice?.perKmRate ?? vt.perKmRate;
            const perMinuteRate = cityPrice?.perMinuteRate ?? vt.perMinuteRate;
            const minimumFare = cityPrice?.minimumFare ?? vt.minimumFare;
            const surgeMultiplier = cityPrice?.surgeMultiplier ?? 1.0;
            return {
                id: vt.code.toLowerCase(),
                type: vt.code.toLowerCase(),
                code: vt.code,
                name: vt.name,
                description: vt.description,
                icon: vt.icon,
                capacity: vt.capacity,
                eta: Math.floor(Math.random() * 8) + 2, // Random 2-10 min ETA (would be real in production)
                price: {
                    base: baseFare,
                    perKm: perKmRate,
                    perMile: perKmRate * 1.60934, // Convert to miles for display
                    perMinute: perMinuteRate,
                    minimum: minimumFare,
                    surgeMultiplier,
                },
                estimatedFare: Math.round((baseFare + (perKmRate * 5)) * surgeMultiplier * 100) / 100, // Base + ~5km estimate with surge
                features: vt.features,
                available: true,
                isPromo: vt.isPromo,
                promoText: vt.promoText,
            };
        });
        res.json({
            success: true,
            available: true,
            ...(city && {
                city: {
                    id: city.id,
                    name: city.name,
                    currency: city.currency,
                    centerLatitude: city.centerLatitude,
                    centerLongitude: city.centerLongitude,
                }
            }),
            data: clientVehicleTypes,
        });
    }
    catch (error) {
        core_1.logger.error('Failed to fetch vehicle types', { error });
        next(error);
    }
});
/**
 * GET /api/config/vehicle-types/:code
 * Get pricing for a specific vehicle type
 */
router.get('/vehicle-types/:code', async (req, res, next) => {
    try {
        const vehicleType = await core_1.prisma.vehicleTypeConfig.findUnique({
            where: { code: req.params.code.toUpperCase() }
        });
        if (!vehicleType) {
            return res.status(404).json({
                success: false,
                error: 'Vehicle type not found'
            });
        }
        res.json({
            success: true,
            data: {
                code: vehicleType.code,
                name: vehicleType.name,
                baseFare: vehicleType.baseFare,
                perKmRate: vehicleType.perKmRate,
                perMinuteRate: vehicleType.perMinuteRate,
                minimumFare: vehicleType.minimumFare,
            }
        });
    }
    catch (error) {
        next(error);
    }
});
// =============================================================================
// VIDEO FEED CONFIG (Admin-managed)
// =============================================================================
/**
 * GET /api/config/video-feed
 * Returns the Bluesky List AT-URI configured by admin for the app's video feed.
 * Also returns the labeler configuration for filtering app-specific posts.
 * Public endpoint - no auth required.
 */
router.get('/video-feed', async (req, res, next) => {
    try {
        const cfg = await core_1.prisma.appConfig.upsert({
            where: { id: 1 },
            update: {},
            create: { id: 1 },
            select: {
                videoFeedListUri: true,
                labelerDid: true,
                labelerLabelValue: true,
                updatedAt: true
            },
        });
        res.json({
            success: true,
            data: {
                videoFeedListUri: cfg.videoFeedListUri ?? null,
                labelerDid: cfg.labelerDid ?? null,
                labelerLabelValue: cfg.labelerLabelValue ?? 'raceef-post',
                updatedAt: cfg.updatedAt,
            },
        });
    }
    catch (error) {
        core_1.logger.error('Failed to fetch video feed config', { error });
        next(error);
    }
});
// =============================================================================
// WALKTHROUGH ENDPOINTS (Cinematic City Tour)
// =============================================================================
/**
 * GET /api/config/walkthrough/by-location
 * Get walkthrough for user's current location
 * NOTE: This route MUST be defined before /walkthrough/:cityId to avoid matching "by-location" as cityId
 */
router.get('/walkthrough/by-location', async (req, res, next) => {
    try {
        const { lat, lng } = req.query;
        if (!lat || !lng) {
            return res.status(400).json({
                success: false,
                error: 'lat and lng query parameters are required'
            });
        }
        const latitude = parseFloat(lat);
        const longitude = parseFloat(lng);
        if (isNaN(latitude) || isNaN(longitude)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid coordinates'
            });
        }
        const city = await detectCity(latitude, longitude);
        if (!city) {
            return res.json({
                success: true,
                available: false,
                message: 'No city found at this location'
            });
        }
        const walkthrough = await core_1.prisma.cityWalkthrough.findUnique({
            where: { cityId: city.id },
            include: {
                city: {
                    select: { id: true, name: true, code: true }
                },
                points: {
                    orderBy: { order: 'asc' }
                }
            }
        });
        if (!walkthrough || !walkthrough.isActive) {
            return res.json({
                success: true,
                available: false,
                message: 'Walkthrough not configured for this city'
            });
        }
        res.json({
            success: true,
            available: true,
            data: {
                id: walkthrough.id,
                name: walkthrough.name,
                city: walkthrough.city,
                defaultDurationMs: walkthrough.defaultDurationMs,
                points: walkthrough.points.map(p => ({
                    id: p.id,
                    order: p.order,
                    latitude: p.latitude,
                    longitude: p.longitude,
                    zoom: p.zoom,
                    pitch: p.pitch,
                    bearing: p.bearing,
                    durationMs: p.durationMs || walkthrough.defaultDurationMs,
                    label: p.label,
                    // Rich content for tour stop display
                    title: p.title,
                    description: p.description,
                    imageUrl: p.imageUrl,
                }))
            }
        });
    }
    catch (error) {
        core_1.logger.error('Failed to fetch walkthrough by location', { error });
        next(error);
    }
});
/**
 * GET /api/config/walkthrough/:cityId
 * Get walkthrough configuration for a city (public, for client playback)
 */
router.get('/walkthrough/:cityId', async (req, res, next) => {
    try {
        const { cityId } = req.params;
        const walkthrough = await core_1.prisma.cityWalkthrough.findUnique({
            where: { cityId },
            include: {
                city: {
                    select: { id: true, name: true, code: true }
                },
                points: {
                    orderBy: { order: 'asc' }
                }
            }
        });
        if (!walkthrough || !walkthrough.isActive) {
            return res.json({
                success: true,
                available: false,
                message: 'Walkthrough not available for this city'
            });
        }
        res.json({
            success: true,
            available: true,
            data: {
                id: walkthrough.id,
                name: walkthrough.name,
                city: walkthrough.city,
                defaultDurationMs: walkthrough.defaultDurationMs,
                points: walkthrough.points.map(p => ({
                    id: p.id,
                    order: p.order,
                    latitude: p.latitude,
                    longitude: p.longitude,
                    zoom: p.zoom,
                    pitch: p.pitch,
                    bearing: p.bearing,
                    durationMs: p.durationMs || walkthrough.defaultDurationMs,
                    label: p.label,
                    // Rich content for tour stop display
                    title: p.title,
                    description: p.description,
                    imageUrl: p.imageUrl,
                }))
            }
        });
    }
    catch (error) {
        core_1.logger.error('Failed to fetch walkthrough', { error });
        next(error);
    }
});
// =============================================================================
// CITIES LIST (Public endpoint for Market/Go mini apps)
// =============================================================================
/**
 * GET /api/config/cities
 * List all active cities (for client selection/filtering)
 * Public endpoint - no auth required
 */
router.get('/cities', async (req, res, next) => {
    try {
        const cities = await core_1.prisma.city.findMany({
            where: { isActive: true },
            select: {
                id: true,
                code: true,
                name: true,
                country: true,
                currency: true,
                centerLatitude: true,
                centerLongitude: true,
                radiusKm: true,
                imageUrl: true,
            },
            orderBy: { name: 'asc' }
        });
        core_1.logger.info(`Fetched ${cities.length} active cities`);
        res.json({
            success: true,
            data: cities
        });
    }
    catch (error) {
        core_1.logger.error('Failed to list cities', { error });
        next(error);
    }
});
