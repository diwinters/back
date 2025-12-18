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
app.get('/api/cities', async (req, res, next) => {
  try {
    const cities = await prisma.city.findMany({
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
    })
    logger.info(`[/api/cities] Fetched ${cities.length} active cities`)
    res.json({ success: true, data: cities })
  } catch (error) {
    logger.error('[/api/cities] Failed to list cities', { error })
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
