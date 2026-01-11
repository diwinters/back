/**
 * Express Server Entry Point
 */

import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import morgan from 'morgan'
import rateLimit from 'express-rate-limit'
import { createServer } from 'http'

import { logger, errorHandler, WebSocketServer, setWebSocketServer, getRedisService, prisma } from '@gominiapp/core'

// Routes
import { authRouter } from './routes/auth.routes'
import { userRouter } from './routes/user.routes'
import { driverRouter } from './routes/driver.routes'
import { orderRouter } from './routes/order.routes'
import { healthRouter } from './routes/health.routes'
import { configRouter } from './routes/config.routes'
import { adminRouter } from './routes/admin.routes'
import { marketRouter } from './routes/market.routes'
import { cartRouter } from './routes/cart.routes'
import { labelerRouter } from './routes/labeler.routes'
import { walletRoutes, walletAdminRoutes } from '@gominiapp/wallet'

const app = express()
const server = createServer(app)

// Trust proxy for rate limiting behind reverse proxy
app.set('trust proxy', 1)

// Security middleware
app.use(helmet())
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || '*',
  credentials: true,
}))

// Compression
app.use(compression())

// Body parsing
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// Request logging
app.use(morgan('combined', {
  stream: {
    write: (message) => logger.info(message.trim()),
  },
}))

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' } },
})
app.use('/api/', limiter)

// Stricter rate limit for auth
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 20 auth attempts per hour
  message: { error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many auth attempts' } },
})
app.use('/api/auth/', authLimiter)

// Health check (no auth required)
app.use('/health', healthRouter)

// Public config endpoints (no auth required)
app.use('/api/config', configRouter)

// Direct /api/cities endpoint (alias for /api/config/cities)
// *** CANONICAL CITIES API - Use this endpoint for all city data ***
app.get('/api/cities', async (req, res, next) => {
  try {
    const { service } = req.query // Optional filter: ?service=market
    
    const cities = await prisma.city.findMany({
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
    })

    // Filter by service if specified
    let filteredCities = cities
    if (service && typeof service === 'string') {
      filteredCities = cities.filter(c => 
        (c.enabledServices as string[])?.includes(service) ?? true
      )
    }

    logger.info(`[/api/cities] Fetched ${filteredCities.length} active cities`, { 
      service: service || 'all' 
    })
    res.json({ success: true, data: filteredCities })
  } catch (error) {
    logger.error('[/api/cities] Failed to list cities', { error })
    next(error)
  }
})

// City detection endpoint - find nearest city from coordinates
app.get('/api/cities/detect', async (req, res, next) => {
  try {
    const { lat, lng, service } = req.query

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_COORDS', message: 'lat and lng query parameters required' }
      })
    }

    const latitude = parseFloat(lat as string)
    const longitude = parseFloat(lng as string)

    if (isNaN(latitude) || isNaN(longitude)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_COORDS', message: 'lat and lng must be valid numbers' }
      })
    }

    // Use the canonical GeoService for detection
    const { GeoService } = await import('@gominiapp/core')
    const result = await GeoService.detectCity(
      latitude, 
      longitude, 
      service as string | undefined
    )

    logger.info('[/api/cities/detect] City detection result', {
      latitude,
      longitude,
      detectedCity: result.city?.name,
      citiesInRange: result.allCitiesInRange.length
    })

    res.json({ success: true, data: result })
  } catch (error) {
    logger.error('[/api/cities/detect] City detection failed', { error })
    next(error)
  }
})

// API routes
app.use('/api/auth', authRouter)
app.use('/api/users', userRouter)
app.use('/api/drivers', driverRouter)
app.use('/api/orders', orderRouter)
app.use('/api/admin', adminRouter)
app.use('/api/market', marketRouter)
app.use('/api/cart', cartRouter)
app.use('/api/wallet', walletRoutes)
app.use('/api/admin/wallet', walletAdminRoutes)
app.use('/api/labeler', labelerRouter)

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
  })
})

// Error handler
app.use(errorHandler)

// Initialize Redis connection
const redis = getRedisService()

// Initialize WebSocket server
const wsServer = new WebSocketServer(server, redis)
setWebSocketServer(wsServer) // Make globally accessible for order notifications

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down server...')
  
  wsServer.close()
  await redis.close()
  
  server.close(() => {
    logger.info('Server shut down')
    process.exit(0)
  })

  // Force shutdown after 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown')
    process.exit(1)
  }, 10000)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

// Start server
const PORT = process.env.PORT || 3001

server.listen(PORT, () => {
  logger.info(`🚀 GoMiniApp Gateway running on port ${PORT}`)
  logger.info(`📡 WebSocket server ready`)
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`)
})

export { app, server }
