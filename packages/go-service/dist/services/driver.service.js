"use strict";
/**
 * Driver Service
 * Manages driver registration, availability, and location
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DriverService = exports.updateAvailabilitySchema = exports.updateLocationSchema = exports.registerDriverSchema = void 0;
const zod_1 = require("zod");
const core_1 = require("@gominiapp/core");
// Validation schemas
exports.registerDriverSchema = zod_1.z.object({
    vehicleType: zod_1.z.string().min(1), // Dynamic - accepts any configured vehicle type
    licensePlate: zod_1.z.string().min(1),
    vehicleModel: zod_1.z.string().optional(),
    vehicleColor: zod_1.z.string().optional(),
    vehicleMake: zod_1.z.string().optional(),
    availabilityType: zod_1.z.enum(['RIDE', 'DELIVERY', 'BOTH']).default('BOTH'),
});
exports.updateLocationSchema = zod_1.z.object({
    latitude: zod_1.z.number().min(-90).max(90),
    longitude: zod_1.z.number().min(-180).max(180),
    heading: zod_1.z.number().min(0).max(360).optional(),
});
exports.updateAvailabilitySchema = zod_1.z.object({
    isOnline: zod_1.z.boolean().optional(),
    availabilityType: zod_1.z.enum(['RIDE', 'DELIVERY', 'BOTH']).optional(),
});
// Location update threshold in meters
const LOCATION_UPDATE_THRESHOLD_METERS = 80;
class DriverService {
    /**
     * Register a user as a driver
     */
    async registerDriver(userId, data) {
        const validated = exports.registerDriverSchema.parse(data);
        // Check if driver already exists
        const existingDriver = await core_1.prisma.driver.findUnique({
            where: { userId },
        });
        if (existingDriver) {
            throw new core_1.ConflictError('User is already a driver', core_1.ErrorCode.DRIVER_ALREADY_EXISTS);
        }
        // Create driver
        const driver = await core_1.prisma.driver.create({
            data: {
                userId,
                vehicleType: validated.vehicleType,
                licensePlate: validated.licensePlate,
                vehicleModel: validated.vehicleModel,
                vehicleColor: validated.vehicleColor,
                vehicleMake: validated.vehicleMake,
                availabilityType: validated.availabilityType,
            },
            include: { user: true },
        });
        core_1.logger.info('Driver registered', { driverId: driver.id, userId });
        return driver;
    }
    /**
     * Get driver by ID
     */
    async getDriver(driverId) {
        const driver = await core_1.prisma.driver.findUnique({
            where: { id: driverId },
            include: { user: true },
        });
        if (!driver) {
            throw new core_1.NotFoundError('Driver not found', core_1.ErrorCode.DRIVER_NOT_FOUND);
        }
        return driver;
    }
    /**
     * Get driver by user ID
     */
    async getDriverByUserId(userId) {
        const driver = await core_1.prisma.driver.findUnique({
            where: { userId },
            include: { user: true },
        });
        if (!driver) {
            throw new core_1.NotFoundError('Driver not found', core_1.ErrorCode.DRIVER_NOT_FOUND);
        }
        return driver;
    }
    /**
     * Update driver availability (online/offline toggle)
     */
    async updateAvailability(driverId, data) {
        const validated = exports.updateAvailabilitySchema.parse(data);
        const driver = await core_1.prisma.driver.update({
            where: { id: driverId },
            data: {
                ...(validated.isOnline !== undefined && { isOnline: validated.isOnline }),
                ...(validated.availabilityType && { availabilityType: validated.availabilityType }),
            },
            include: { user: true },
        });
        core_1.logger.info('Driver availability updated', {
            driverId,
            isOnline: driver.isOnline,
            availabilityType: driver.availabilityType,
        });
        return driver;
    }
    /**
     * Update driver location
     */
    async updateLocation(driverId, data) {
        const validated = exports.updateLocationSchema.parse(data);
        // Get current location
        const driver = await core_1.prisma.driver.findUnique({
            where: { id: driverId },
            select: {
                currentLatitude: true,
                currentLongitude: true,
            },
        });
        if (!driver) {
            throw new core_1.NotFoundError('Driver not found', core_1.ErrorCode.DRIVER_NOT_FOUND);
        }
        // Calculate distance from last location
        // *** USE SHARED GeoService - distance in meters ***
        let shouldUpdate = true;
        let distance;
        if (driver.currentLatitude && driver.currentLongitude) {
            // GeoService returns km, convert to meters
            const distanceKm = core_1.GeoService.calculateDistance({ latitude: driver.currentLatitude, longitude: driver.currentLongitude }, { latitude: validated.latitude, longitude: validated.longitude });
            distance = distanceKm * 1000; // Convert to meters
            // Only update if moved more than threshold
            shouldUpdate = distance >= LOCATION_UPDATE_THRESHOLD_METERS;
        }
        if (shouldUpdate) {
            await core_1.prisma.driver.update({
                where: { id: driverId },
                data: {
                    currentLatitude: validated.latitude,
                    currentLongitude: validated.longitude,
                    currentHeading: validated.heading,
                    lastLocationUpdate: new Date(),
                },
            });
            core_1.logger.debug('Driver location updated', { driverId, ...validated });
        }
        return { updated: shouldUpdate, distance };
    }
    /**
     * Find nearby available drivers
     */
    async findNearbyDrivers(latitude, longitude, options = {}) {
        const { radiusKm = 10, availabilityType, vehicleType, limit = 20 } = options;
        // Simple bounding box query (for production, use PostGIS)
        const latDelta = radiusKm / 111;
        const lonDelta = radiusKm / (111 * Math.cos(latitude * Math.PI / 180));
        const drivers = await core_1.prisma.driver.findMany({
            where: {
                isOnline: true,
                currentLatitude: {
                    gte: latitude - latDelta,
                    lte: latitude + latDelta,
                },
                currentLongitude: {
                    gte: longitude - lonDelta,
                    lte: longitude + lonDelta,
                },
                ...(availabilityType && availabilityType !== 'BOTH' ? {
                    OR: [
                        { availabilityType: availabilityType },
                        { availabilityType: 'BOTH' },
                    ],
                } : {}),
                ...(vehicleType ? { vehicleType: vehicleType } : {}),
            },
            include: { user: true },
            take: limit,
        });
        // Calculate actual distances and filter using shared GeoService
        return drivers
            .map(d => {
            const distKm = core_1.GeoService.calculateDistance({ latitude, longitude }, { latitude: d.currentLatitude, longitude: d.currentLongitude });
            return {
                ...d,
                distanceKm: distKm,
                etaMinutes: Math.ceil(distKm / 30 * 60), // Assume 30 km/h
            };
        })
            .filter(d => d.distanceKm <= radiusKm)
            .sort((a, b) => a.distanceKm - b.distanceKm);
    }
    /**
     * Get driver stats
     */
    async getDriverStats(driverId) {
        const driver = await core_1.prisma.driver.findUnique({
            where: { id: driverId },
        });
        if (!driver) {
            throw new core_1.NotFoundError('Driver not found', core_1.ErrorCode.DRIVER_NOT_FOUND);
        }
        return {
            totalRides: driver.totalRides,
            totalDeliveries: driver.totalDeliveries,
            rating: driver.rating,
            totalEarnings: driver.totalEarnings,
        };
    }
    /**
     * Get all online drivers
     */
    async getOnlineDrivers(options = {}) {
        const { availabilityType, vehicleType } = options;
        const drivers = await core_1.prisma.driver.findMany({
            where: {
                isOnline: true,
                ...(availabilityType && availabilityType !== 'BOTH' ? {
                    OR: [
                        { availabilityType: availabilityType },
                        { availabilityType: 'BOTH' },
                    ],
                } : {}),
                ...(vehicleType ? { vehicleType: vehicleType } : {}),
            },
            include: { user: true },
            orderBy: { lastLocationUpdate: 'desc' },
        });
        return drivers;
    }
}
exports.DriverService = DriverService;
