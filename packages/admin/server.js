/**
 * Admin Panel API Server
 */

const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')
const multer = require('multer')
const { PrismaClient } = require('@prisma/client')
const Redis = require('ioredis')

const app = express()
const prisma = new PrismaClient()

const PORT = process.env.ADMIN_PORT || 8080
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

// Redis client for pub/sub (to notify gateway of new orders)
const redis = new Redis(REDIS_URL)
redis.on('error', (err) => console.error('Redis error:', err))
redis.on('connect', () => console.log('Redis connected'))

/**
 * Publish a new order event for the gateway WebSocket server to broadcast
 */
async function publishNewOrder(order) {
  try {
    const message = {
      type: 'broadcast_new_order',
      payload: {
        id: order.id,
        type: order.type,
        pickupLatitude: order.pickupLatitude,
        pickupLongitude: order.pickupLongitude,
        pickupAddress: order.pickupAddress,
        dropoffLatitude: order.dropoffLatitude,
        dropoffLongitude: order.dropoffLongitude,
        dropoffAddress: order.dropoffAddress,
        estimatedFare: order.estimatedFare,
        vehicleType: order.vehicleType,
        user: order.user ? {
          displayName: order.user.displayName,
        } : undefined,
      }
    }
    await redis.publish('ws:broadcast', JSON.stringify(message))
    console.log('Published new order to Redis for broadcast:', order.id)
  } catch (error) {
    console.error('Failed to publish order to Redis:', error)
  }
}

// ============================================================================
// File Upload Configuration
// ============================================================================

// Base uploads directory
const UPLOADS_DIR = path.join(__dirname, 'uploads')

// Ensure base uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true })
}

/**
 * Storage configuration with organized folder structure:
 * uploads/
 *   {did}/
 *     avatar/       - Profile photos
 *     vehicle/      - Vehicle images
 *     documents/    - License, registration, etc.
 */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Get DID from request body or params
    const did = req.body.did || req.params.did || 'unknown'
    // Sanitize DID for folder name (replace colons with underscores)
    const safeDid = did.replace(/:/g, '_')
    
    // Determine subfolder based on field name
    let subfolder = 'misc'
    if (file.fieldname === 'avatar' || file.fieldname === 'profilePhoto') {
      subfolder = 'avatar'
    } else if (file.fieldname === 'vehicleImage' || file.fieldname.startsWith('vehicle')) {
      subfolder = 'vehicle'
    } else if (file.fieldname === 'license' || file.fieldname === 'registration' || file.fieldname === 'insurance') {
      subfolder = 'documents'
    }
    
    const uploadPath = path.join(UPLOADS_DIR, safeDid, subfolder)
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true })
    }
    
    cb(null, uploadPath)
  },
  filename: (req, file, cb) => {
    // Generate unique filename with timestamp
    const ext = path.extname(file.originalname).toLowerCase()
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 8)
    cb(null, `${file.fieldname}_${timestamp}_${random}${ext}`)
  }
})

// File filter for images only
const imageFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true)
  } else {
    cb(new Error('Only JPEG, PNG, WebP, and GIF images are allowed'), false)
  }
}

// Multer upload instance
const upload = multer({
  storage,
  fileFilter: imageFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
    files: 5 // Max 5 files per upload
  }
})

// Middleware
app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// Serve uploaded files statically
app.use('/uploads', express.static(UPLOADS_DIR))

// ============================================================================
// Video Feed Config (Admin-managed)
// ============================================================================

function isValidBskyListAtUri(maybeUri) {
  if (!maybeUri || typeof maybeUri !== 'string') return false
  return maybeUri.startsWith('at://') && maybeUri.includes('/app.bsky.graph.list/')
}

/**
 * GET /api/config/video-feed
 * Public-ish endpoint used by the admin UI to display current config.
 */
app.get('/api/config/video-feed', async (req, res) => {
  try {
    const cfg = await prisma.appConfig.upsert({
      where: {id: 1},
      update: {},
      create: {id: 1},
      select: {videoFeedListUri: true, updatedAt: true},
    })

    res.json({
      success: true,
      data: {
        videoFeedListUri: cfg.videoFeedListUri || null,
        updatedAt: cfg.updatedAt,
      },
    })
  } catch (error) {
    res.status(500).json({success: false, error: error.message})
  }
})

/**
 * PUT /api/admin/config/video-feed
 * Updates the configured Bluesky List AT-URI used for the in-app video feed.
 * Admin endpoint (no auth currently; add auth before production exposure).
 */
app.put('/api/admin/config/video-feed', async (req, res) => {
  try {
    const {videoFeedListUri} = req.body || {}

    if (videoFeedListUri !== null && videoFeedListUri !== '' && !isValidBskyListAtUri(videoFeedListUri)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid list URI. Expected an at://.../app.bsky.graph.list/... AT-URI',
      })
    }

    const normalized = videoFeedListUri ? String(videoFeedListUri).trim() : null

    const cfg = await prisma.appConfig.upsert({
      where: {id: 1},
      update: {videoFeedListUri: normalized},
      create: {id: 1, videoFeedListUri: normalized},
      select: {videoFeedListUri: true, updatedAt: true},
    })

    res.json({
      success: true,
      data: {
        videoFeedListUri: cfg.videoFeedListUri || null,
        updatedAt: cfg.updatedAt,
      },
    })
  } catch (error) {
    res.status(500).json({success: false, error: error.message})
  }
})

// ============================================================================
// Database Debug Endpoints
// ============================================================================

/**
 * GET /api/debug/connection
 * Test database connection
 */
app.get('/api/debug/connection', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({
      success: true,
      message: 'Database connection successful',
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * GET /api/debug/tables
 * List all database tables
 */
app.get('/api/debug/tables', async (req, res) => {
  try {
    const tables = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `
    res.json({
      success: true,
      data: tables
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * GET /api/debug/stats
 * Get database statistics
 */
app.get('/api/debug/stats', async (req, res) => {
  try {
    const [userCount, driverCount, orderCount, ratingCount] = await Promise.all([
      prisma.user.count(),
      prisma.driver.count(),
      prisma.order.count(),
      prisma.rating.count()
    ])

    const onlineDrivers = await prisma.driver.count({
      where: { isOnline: true }
    })

    res.json({
      success: true,
      data: {
        users: userCount,
        drivers: driverCount,
        onlineDrivers,
        orders: orderCount,
        ratings: ratingCount
      }
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// ============================================================================
// File Upload Endpoints
// ============================================================================

/**
 * POST /api/upload/avatar/:did
 * Upload a profile avatar for a user
 */
app.post('/api/upload/avatar/:did', upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      })
    }

    const { did } = req.params
    const safeDid = did.replace(/:/g, '_')
    const fileUrl = `/uploads/${safeDid}/avatar/${req.file.filename}`

    // Update user's avatarUrl in database
    await prisma.user.updateMany({
      where: { did },
      data: { avatarUrl: fileUrl }
    })

    res.json({
      success: true,
      data: {
        filename: req.file.filename,
        url: fileUrl,
        size: req.file.size,
        mimetype: req.file.mimetype
      }
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * POST /api/upload/vehicle/:did
 * Upload vehicle image(s) for a driver
 */
app.post('/api/upload/vehicle/:did', upload.array('vehicleImage', 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No files uploaded'
      })
    }

    const { did } = req.params
    const safeDid = did.replace(/:/g, '_')
    
    const files = req.files.map(file => ({
      filename: file.filename,
      url: `/uploads/${safeDid}/vehicle/${file.filename}`,
      size: file.size,
      mimetype: file.mimetype
    }))

    // If only one image, update the driver's primary vehicle image
    if (files.length === 1) {
      const user = await prisma.user.findUnique({ where: { did } })
      if (user) {
        await prisma.driver.updateMany({
          where: { userId: user.id },
          data: { vehicleImageUrl: files[0].url }
        })
      }
    }

    res.json({
      success: true,
      data: files
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * POST /api/upload/document/:did
 * Upload document (license, registration, etc.) for a driver
 */
app.post('/api/upload/document/:did', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      })
    }

    const { did } = req.params
    const { documentType } = req.body // 'license', 'registration', 'insurance'
    const safeDid = did.replace(/:/g, '_')
    const fileUrl = `/uploads/${safeDid}/documents/${req.file.filename}`

    res.json({
      success: true,
      data: {
        filename: req.file.filename,
        url: fileUrl,
        size: req.file.size,
        mimetype: req.file.mimetype,
        documentType: documentType || 'unknown'
      }
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * GET /api/uploads/:did
 * List all uploaded files for a user
 */
app.get('/api/uploads/:did', async (req, res) => {
  try {
    const { did } = req.params
    const safeDid = did.replace(/:/g, '_')
    const userDir = path.join(UPLOADS_DIR, safeDid)

    if (!fs.existsSync(userDir)) {
      return res.json({
        success: true,
        data: { avatar: [], vehicle: [], documents: [] }
      })
    }

    const result = { avatar: [], vehicle: [], documents: [] }

    for (const subdir of ['avatar', 'vehicle', 'documents']) {
      const subdirPath = path.join(userDir, subdir)
      if (fs.existsSync(subdirPath)) {
        const files = fs.readdirSync(subdirPath)
        result[subdir] = files.map(filename => ({
          filename,
          url: `/uploads/${safeDid}/${subdir}/${filename}`
        }))
      }
    }

    res.json({ success: true, data: result })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * DELETE /api/uploads/:did/:type/:filename
 * Delete a specific uploaded file
 */
app.delete('/api/uploads/:did/:type/:filename', async (req, res) => {
  try {
    const { did, type, filename } = req.params
    const safeDid = did.replace(/:/g, '_')
    const filePath = path.join(UPLOADS_DIR, safeDid, type, filename)

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      })
    }

    fs.unlinkSync(filePath)

    res.json({
      success: true,
      message: 'File deleted successfully'
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// ============================================================================
// User CRUD Endpoints
// ============================================================================

/**
 * GET /api/users
 * List all users with pagination
 */
app.get('/api/users', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const pageSize = parseInt(req.query.pageSize) || 20
    const search = req.query.search || ''

    const where = search ? {
      OR: [
        { handle: { contains: search, mode: 'insensitive' } },
        { displayName: { contains: search, mode: 'insensitive' } },
        { did: { contains: search, mode: 'insensitive' } }
      ]
    } : {}

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: { driver: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      prisma.user.count({ where })
    ])

    res.json({
      success: true,
      data: users,
      meta: { total, page, pageSize }
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * GET /api/users/:id
 * Get user by ID
 */
app.get('/api/users/:id', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        driver: true,
        ordersAsUser: { orderBy: { requestedAt: 'desc' }, take: 10 },
        ordersAsDriver: { orderBy: { requestedAt: 'desc' }, take: 10 }
      }
    })

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      })
    }

    res.json({ success: true, data: user })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * DELETE /api/users/:id
 * Delete user
 */
app.delete('/api/users/:id', async (req, res) => {
  try {
    await prisma.user.delete({
      where: { id: req.params.id }
    })

    res.json({
      success: true,
      message: 'User deleted successfully'
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// ============================================================================
// Driver CRUD Endpoints
// ============================================================================

/**
 * GET /api/drivers
 * List all drivers
 */
app.get('/api/drivers', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const pageSize = parseInt(req.query.pageSize) || 20
    const isOnline = req.query.isOnline
    const cityId = req.query.cityId

    const where = {}
    if (isOnline !== undefined) where.isOnline = isOnline === 'true'
    if (cityId) where.cityId = cityId

    const [drivers, total] = await Promise.all([
      prisma.driver.findMany({
        where,
        include: { user: true, city: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      prisma.driver.count({ where })
    ])

    res.json({
      success: true,
      data: drivers,
      meta: { total, page, pageSize }
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * POST /api/drivers
 * Create new driver
 */
app.post('/api/drivers', async (req, res) => {
  try {
    const { did, handle, displayName, vehicleType, licensePlate, vehicleMake, vehicleModel, vehicleColor, vehicleYear, availabilityType, cityId } = req.body

    // Create or get user first
    let user = await prisma.user.findUnique({ where: { did } })
    
    if (!user) {
      user = await prisma.user.create({
        data: {
          did,
          handle: handle || `user_${did.slice(-8)}`,
          displayName: displayName || handle || 'Driver'
        }
      })
    }

    // Check if already a driver
    const existingDriver = await prisma.driver.findUnique({
      where: { userId: user.id }
    })

    if (existingDriver) {
      return res.status(400).json({
        success: false,
        error: 'User is already registered as a driver'
      })
    }

    // Create driver
    const driver = await prisma.driver.create({
      data: {
        userId: user.id,
        vehicleType: vehicleType || 'ECONOMY',
        licensePlate,
        vehicleMake,
        vehicleModel,
        vehicleColor,
        vehicleYear,
        availabilityType: availabilityType || 'BOTH',
        cityId: cityId || null
      },
      include: { user: true, city: true }
    })

    res.json({ success: true, data: driver })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * PATCH /api/drivers/:id
 * Update driver
 */
app.patch('/api/drivers/:id', async (req, res) => {
  try {
    const { isOnline, vehicleType, licensePlate, vehicleMake, vehicleModel, vehicleColor, vehicleImageUrl, cityId } = req.body

    const driver = await prisma.driver.update({
      where: { id: req.params.id },
      data: {
        ...(isOnline !== undefined && { isOnline }),
        ...(vehicleType && { vehicleType }),
        ...(licensePlate && { licensePlate }),
        ...(vehicleMake && { vehicleMake }),
        ...(vehicleModel && { vehicleModel }),
        ...(vehicleColor && { vehicleColor }),
        ...(vehicleImageUrl && { vehicleImageUrl }),
        ...(cityId !== undefined && { cityId: cityId || null })
      },
      include: { user: true, city: true }
    })

    res.json({ success: true, data: driver })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * DELETE /api/drivers/:id
 * Delete driver
 */
app.delete('/api/drivers/:id', async (req, res) => {
  try {
    await prisma.driver.delete({
      where: { id: req.params.id }
    })

    res.json({
      success: true,
      message: 'Driver deleted successfully'
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// ============================================================================
// Order CRUD Endpoints
// ============================================================================

/**
 * POST /api/orders
 * Create a new order (admin-initiated)
 */
app.post('/api/orders', async (req, res) => {
  try {
    const {
      // User identification
      userId,
      userDid,
      
      // Order type
      type, // RIDE or DELIVERY
      
      // Pickup
      pickupAddress,
      pickupName,
      pickupLatitude,
      pickupLongitude,
      
      // Dropoff
      dropoffAddress,
      dropoffName,
      dropoffLatitude,
      dropoffLongitude,
      
      // Pricing
      vehicleType,
      estimatedFare,
      
      // Delivery-specific
      packageSize,
      packageDescription,
      recipientName,
      recipientPhone,
      deliveryInstructions
    } = req.body

    // Find or create user by DID
    let user
    if (userId) {
      user = await prisma.user.findUnique({ where: { id: userId } })
    } else if (userDid) {
      // Try to find existing user
      user = await prisma.user.findUnique({ where: { did: userDid } })
      
      // If not found, create a new user with just the DID
      if (!user) {
        user = await prisma.user.create({
          data: {
            did: userDid,
            handle: `user_${userDid.slice(-8)}`,
            displayName: 'New User'
          }
        })
        console.log(`Created new user for DID: ${userDid}`)
      }
    }

    if (!user) {
      return res.status(400).json({
        success: false,
        error: 'User DID is required.'
      })
    }

    // Validate required fields
    if (!type || !['RIDE', 'DELIVERY'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid order type. Must be RIDE or DELIVERY.'
      })
    }

    if (!pickupLatitude || !pickupLongitude || !dropoffLatitude || !dropoffLongitude) {
      return res.status(400).json({
        success: false,
        error: 'Pickup and dropoff coordinates are required.'
      })
    }

    // Calculate estimated distance (simple Haversine)
    const R = 6371 // km
    const dLat = (dropoffLatitude - pickupLatitude) * Math.PI / 180
    const dLon = (dropoffLongitude - pickupLongitude) * Math.PI / 180
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(pickupLatitude * Math.PI / 180) * Math.cos(dropoffLatitude * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
    const distanceKm = R * c

    // Estimate duration (assume 30 km/h average)
    const durationMinutes = Math.round(distanceKm / 30 * 60)

    // Calculate fare if not provided
    const fare = estimatedFare || (5 + distanceKm * 1.5 + durationMinutes * 0.2)

    // Create the order
    const order = await prisma.order.create({
      data: {
        type,
        status: 'PENDING',
        userId: user.id,
        
        pickupLatitude: parseFloat(pickupLatitude),
        pickupLongitude: parseFloat(pickupLongitude),
        pickupAddress: pickupAddress || 'Pickup Location',
        pickupName: pickupName || null,
        
        dropoffLatitude: parseFloat(dropoffLatitude),
        dropoffLongitude: parseFloat(dropoffLongitude),
        dropoffAddress: dropoffAddress || 'Dropoff Location',
        dropoffName: dropoffName || null,
        
        distanceKm,
        durationMinutes,
        vehicleType: vehicleType || 'ECONOMY',
        estimatedFare: fare,
        surgeMultiplier: 1.0,
        
        // Delivery fields
        packageSize: type === 'DELIVERY' ? (packageSize || 'MEDIUM') : null,
        packageDescription: type === 'DELIVERY' ? packageDescription : null,
        recipientName: type === 'DELIVERY' ? recipientName : null,
        recipientPhone: type === 'DELIVERY' ? recipientPhone : null,
        deliveryInstructions: type === 'DELIVERY' ? deliveryInstructions : null,
      },
      include: {
        user: true
      }
    })

    // Create initial order event
    await prisma.orderEvent.create({
      data: {
        orderId: order.id,
        eventType: 'CREATED',
        metadata: { source: 'admin' }
      }
    })

    // Publish to Redis for WebSocket broadcast to drivers
    await publishNewOrder(order)

    res.json({
      success: true,
      data: order,
      message: `Order created successfully. Distance: ${distanceKm.toFixed(2)}km, ETA: ${durationMinutes}min, Fare: $${fare.toFixed(2)}`
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * GET /api/orders
 * List all orders
 */
app.get('/api/orders', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const pageSize = parseInt(req.query.pageSize) || 20
    const status = req.query.status

    const where = status ? { status } : {}

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          user: true,
          driver: true
        },
        orderBy: { requestedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      prisma.order.count({ where })
    ])

    res.json({
      success: true,
      data: orders,
      meta: { total, page, pageSize }
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * GET /api/orders/:id
 * Get order details
 */
app.get('/api/orders/:id', async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        user: true,
        driver: true,
        events: { orderBy: { createdAt: 'desc' } },
        rating: true
      }
    })

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      })
    }

    res.json({ success: true, data: order })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * DELETE /api/orders/:id
 * Delete order
 */
app.delete('/api/orders/:id', async (req, res) => {
  try {
    await prisma.order.delete({
      where: { id: req.params.id }
    })

    res.json({
      success: true,
      message: 'Order deleted successfully'
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// ============================================================================
// Vehicle Type Configuration CRUD Endpoints
// ============================================================================

/**
 * GET /api/vehicle-types
 * List all vehicle types
 */
app.get('/api/vehicle-types', async (req, res) => {
  try {
    const activeOnly = req.query.active === 'true'
    
    const vehicleTypes = await prisma.vehicleTypeConfig.findMany({
      where: activeOnly ? { isActive: true } : {},
      orderBy: { sortOrder: 'asc' }
    })

    res.json({
      success: true,
      data: vehicleTypes
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * GET /api/vehicle-types/:id
 * Get vehicle type by ID
 */
app.get('/api/vehicle-types/:id', async (req, res) => {
  try {
    const vehicleType = await prisma.vehicleTypeConfig.findUnique({
      where: { id: req.params.id }
    })

    if (!vehicleType) {
      return res.status(404).json({
        success: false,
        error: 'Vehicle type not found'
      })
    }

    res.json({ success: true, data: vehicleType })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * POST /api/vehicle-types
 * Create new vehicle type
 */
app.post('/api/vehicle-types', async (req, res) => {
  try {
    const { 
      code, name, description, icon,
      capacity, baseFare, perKmRate, perMinuteRate, minimumFare,
      features, sortOrder, isActive, isPromo, promoText, vehicleClass
    } = req.body

    if (!code || !name) {
      return res.status(400).json({
        success: false,
        error: 'Code and name are required'
      })
    }

    const vehicleType = await prisma.vehicleTypeConfig.create({
      data: {
        code: code.toUpperCase(),
        name,
        description: description || '',
        icon: icon || '🚗',
        capacity: capacity || 4,
        baseFare: baseFare || 2.50,
        perKmRate: perKmRate || 1.20,
        perMinuteRate: perMinuteRate || 0.15,
        minimumFare: minimumFare || 5.00,
        features: features || [],
        sortOrder: sortOrder || 0,
        isActive: isActive !== false,
        isPromo: isPromo || false,
        promoText,
        vehicleClass
      }
    })

    res.json({ success: true, data: vehicleType })
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({
        success: false,
        error: 'Vehicle type code already exists'
      })
    }
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * PATCH /api/vehicle-types/:id
 * Update vehicle type
 */
app.patch('/api/vehicle-types/:id', async (req, res) => {
  try {
    const { 
      code, name, description, icon,
      capacity, baseFare, perKmRate, perMinuteRate, minimumFare,
      features, sortOrder, isActive, isPromo, promoText, vehicleClass
    } = req.body

    const vehicleType = await prisma.vehicleTypeConfig.update({
      where: { id: req.params.id },
      data: {
        ...(code && { code: code.toUpperCase() }),
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(icon && { icon }),
        ...(capacity !== undefined && { capacity }),
        ...(baseFare !== undefined && { baseFare }),
        ...(perKmRate !== undefined && { perKmRate }),
        ...(perMinuteRate !== undefined && { perMinuteRate }),
        ...(minimumFare !== undefined && { minimumFare }),
        ...(features !== undefined && { features }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(isActive !== undefined && { isActive }),
        ...(isPromo !== undefined && { isPromo }),
        ...(promoText !== undefined && { promoText }),
        ...(vehicleClass !== undefined && { vehicleClass })
      }
    })

    res.json({ success: true, data: vehicleType })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * DELETE /api/vehicle-types/:id
 * Delete vehicle type
 */
app.delete('/api/vehicle-types/:id', async (req, res) => {
  try {
    await prisma.vehicleTypeConfig.delete({
      where: { id: req.params.id }
    })

    res.json({
      success: true,
      message: 'Vehicle type deleted successfully'
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * POST /api/vehicle-types/seed
 * Seed default vehicle types
 */
app.post('/api/vehicle-types/seed', async (req, res) => {
  try {
    const defaults = [
      { code: 'ECONOMY', name: 'Go', description: 'Affordable, everyday rides', icon: '🚗', capacity: 4, baseFare: 2.50, perKmRate: 1.20, perMinuteRate: 0.15, minimumFare: 5.00, features: ['4 seats', 'AC'], sortOrder: 1, isPromo: true, promoText: 'Most popular' },
      { code: 'COMFORT', name: 'Comfort', description: 'Newer cars with extra legroom', icon: '🚙', capacity: 4, baseFare: 3.50, perKmRate: 1.80, perMinuteRate: 0.25, minimumFare: 7.00, features: ['4 seats', 'Extra legroom', 'Top-rated drivers'], sortOrder: 2 },
      { code: 'GREEN', name: 'Green', description: 'Electric & hybrid vehicles', icon: '🍃', capacity: 4, baseFare: 2.80, perKmRate: 1.40, perMinuteRate: 0.18, minimumFare: 5.50, features: ['4 seats', 'Zero emissions', 'Eco-friendly'], sortOrder: 3 },
      { code: 'XL', name: 'XL', description: 'SUVs for groups up to 6', icon: '🚐', capacity: 6, baseFare: 5.00, perKmRate: 2.20, perMinuteRate: 0.35, minimumFare: 10.00, features: ['6 seats', 'Extra space', 'Luggage room'], sortOrder: 4 },
      { code: 'PREMIUM', name: 'Black', description: 'Premium rides in luxury cars', icon: '✨', capacity: 4, baseFare: 8.00, perKmRate: 3.50, perMinuteRate: 0.55, minimumFare: 15.00, features: ['4 seats', 'Luxury vehicles', 'Professional drivers'], sortOrder: 5 },
      { code: 'MOTO', name: 'Moto', description: 'Quick motorcycle rides', icon: '🏍️', capacity: 1, baseFare: 1.50, perKmRate: 0.80, perMinuteRate: 0.10, minimumFare: 3.00, features: ['1 passenger', 'Fastest option', 'Beat traffic'], sortOrder: 6 },
      { code: 'BIKE', name: 'Bike', description: 'Bicycle courier', icon: '🚲', capacity: 1, baseFare: 1.00, perKmRate: 0.50, perMinuteRate: 0.08, minimumFare: 2.00, features: ['1 passenger', 'Eco-friendly', 'Short distances'], sortOrder: 7 }
    ]

    let created = 0
    let skipped = 0

    for (const vt of defaults) {
      try {
        await prisma.vehicleTypeConfig.create({ data: vt })
        created++
      } catch (e) {
        if (e.code === 'P2002') {
          skipped++ // Already exists
        } else {
          throw e
        }
      }
    }

    res.json({
      success: true,
      message: `Seeded ${created} vehicle types, skipped ${skipped} existing`
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// ============================================================================
// City Management Endpoints
// ============================================================================

/**
 * City image storage configuration
 */
const cityStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(UPLOADS_DIR, 'cities')
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true })
    }
    cb(null, uploadPath)
  },
  filename: (req, file, cb) => {
    const cityCode = req.params.code || 'unknown'
    const ext = path.extname(file.originalname).toLowerCase()
    const timestamp = Date.now()
    cb(null, `${cityCode.toLowerCase()}_${timestamp}${ext}`)
  }
})

const cityUpload = multer({ 
  storage: cityStorage, 
  fileFilter: imageFilter, 
  limits: { fileSize: 10 * 1024 * 1024 } 
})

/**
 * POST /api/upload/city-image/:code
 * Upload city banner/background image
 */
app.post('/api/upload/city-image/:code', cityUpload.single('cityImage'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' })
    }
    const imageUrl = `/uploads/cities/${req.file.filename}`
    res.json({ success: true, imageUrl })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/cities
 * List all cities with pricing and stats
 */
app.get('/api/cities', async (req, res) => {
  try {
    const cities = await prisma.city.findMany({
      include: {
        pricing: true,
        _count: { select: { drivers: true, orders: true } }
      },
      orderBy: { name: 'asc' }
    })
    res.json(cities)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/cities
 * Create a new city
 */
app.post('/api/cities', async (req, res) => {
  try {
    const { code, name, country, timezone, currency, centerLatitude, centerLongitude, radiusKm, imageUrl, isActive } = req.body
    const city = await prisma.city.create({
      data: { 
        code: code.toUpperCase(), 
        name, 
        country: country || 'MA', 
        timezone: timezone || 'Africa/Casablanca', 
        currency: currency || 'MAD', 
        centerLatitude: parseFloat(centerLatitude), 
        centerLongitude: parseFloat(centerLongitude), 
        radiusKm: parseFloat(radiusKm) || 50, 
        imageUrl,
        isActive: isActive !== false
      }
    })
    res.json(city)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

/**
 * PUT /api/cities/:id
 * Update a city
 */
app.put('/api/cities/:id', async (req, res) => {
  try {
    const updateData = { ...req.body }
    if (updateData.code) updateData.code = updateData.code.toUpperCase()
    if (updateData.centerLatitude) updateData.centerLatitude = parseFloat(updateData.centerLatitude)
    if (updateData.centerLongitude) updateData.centerLongitude = parseFloat(updateData.centerLongitude)
    if (updateData.radiusKm) updateData.radiusKm = parseFloat(updateData.radiusKm)
    
    const city = await prisma.city.update({
      where: { id: req.params.id },
      data: updateData
    })
    res.json(city)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

/**
 * DELETE /api/cities/:id
 * Delete a city (will cascade to pricing, unlink drivers/orders)
 */
app.delete('/api/cities/:id', async (req, res) => {
  try {
    // First unlink drivers and orders
    await prisma.driver.updateMany({
      where: { cityId: req.params.id },
      data: { cityId: null }
    })
    await prisma.order.updateMany({
      where: { cityId: req.params.id },
      data: { cityId: null }
    })
    // Then delete city (pricing will cascade)
    await prisma.city.delete({ where: { id: req.params.id } })
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/cities/:id/pricing
 * Get all vehicle pricing for a city
 */
app.get('/api/cities/:id/pricing', async (req, res) => {
  try {
    const pricing = await prisma.cityVehiclePricing.findMany({
      where: { cityId: req.params.id },
      orderBy: { vehicleTypeCode: 'asc' }
    })
    res.json(pricing)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/cities/:id/pricing
 * Create or update vehicle pricing for a city
 */
app.post('/api/cities/:id/pricing', async (req, res) => {
  try {
    const { vehicleTypeCode, baseFare, perKmRate, perMinuteRate, minimumFare, surgeMultiplier } = req.body
    const pricing = await prisma.cityVehiclePricing.upsert({
      where: { cityId_vehicleTypeCode: { cityId: req.params.id, vehicleTypeCode } },
      create: { 
        cityId: req.params.id, 
        vehicleTypeCode, 
        baseFare: parseFloat(baseFare), 
        perKmRate: parseFloat(perKmRate), 
        perMinuteRate: parseFloat(perMinuteRate), 
        minimumFare: parseFloat(minimumFare), 
        surgeMultiplier: parseFloat(surgeMultiplier) || 1.0 
      },
      update: { 
        baseFare: parseFloat(baseFare), 
        perKmRate: parseFloat(perKmRate), 
        perMinuteRate: parseFloat(perMinuteRate), 
        minimumFare: parseFloat(minimumFare), 
        surgeMultiplier: parseFloat(surgeMultiplier) || 1.0 
      }
    })
    res.json(pricing)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

/**
 * DELETE /api/cities/:id/pricing/:vehicleTypeCode
 * Delete vehicle pricing for a city
 */
app.delete('/api/cities/:id/pricing/:vehicleTypeCode', async (req, res) => {
  try {
    await prisma.cityVehiclePricing.delete({
      where: { cityId_vehicleTypeCode: { cityId: req.params.id, vehicleTypeCode: req.params.vehicleTypeCode } }
    })
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/cities/seed
 * Seed default Moroccan cities (Dakhla, Laâyoune, Casablanca, Rabat)
 */
app.post('/api/cities/seed', async (req, res) => {
  try {
    const cities = [
      {
        code: 'DAKHLA',
        name: 'Dakhla',
        country: 'MA',
        timezone: 'Africa/Casablanca',
        currency: 'MAD',
        centerLatitude: 23.6848,
        centerLongitude: -15.9580,
        radiusKm: 30,
      },
      {
        code: 'LAAYOUNE',
        name: 'Laâyoune',
        country: 'MA',
        timezone: 'Africa/Casablanca',
        currency: 'MAD',
        centerLatitude: 27.1536,
        centerLongitude: -13.2033,
        radiusKm: 40,
      },
      {
        code: 'CASA',
        name: 'Casablanca',
        country: 'MA',
        timezone: 'Africa/Casablanca',
        currency: 'MAD',
        centerLatitude: 33.5731,
        centerLongitude: -7.5898,
        radiusKm: 50,
      },
      {
        code: 'RABAT',
        name: 'Rabat',
        country: 'MA',
        timezone: 'Africa/Casablanca',
        currency: 'MAD',
        centerLatitude: 34.0209,
        centerLongitude: -6.8416,
        radiusKm: 35,
      },
      {
        code: 'MARRAKECH',
        name: 'Marrakech',
        country: 'MA',
        timezone: 'Africa/Casablanca',
        currency: 'MAD',
        centerLatitude: 31.6295,
        centerLongitude: -7.9811,
        radiusKm: 40,
      },
      {
        code: 'AGADIR',
        name: 'Agadir',
        country: 'MA',
        timezone: 'Africa/Casablanca',
        currency: 'MAD',
        centerLatitude: 30.4278,
        centerLongitude: -9.5981,
        radiusKm: 35,
      },
    ]

    const results = []
    for (const city of cities) {
      const existing = await prisma.city.findUnique({ where: { code: city.code } })
      if (!existing) {
        const created = await prisma.city.create({ data: city })
        results.push({ ...created, status: 'created' })
      } else {
        results.push({ ...existing, status: 'exists' })
      }
    }

    res.json({ success: true, cities: results })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/cities/:id/seed-pricing
 * Seed default pricing for a city based on global vehicle types
 */
app.post('/api/cities/:id/seed-pricing', async (req, res) => {
  try {
    const { multiplier = 1.0 } = req.body // Optional multiplier for this city
    const vehicleTypes = await prisma.vehicleTypeConfig.findMany({ where: { isActive: true } })
    
    const results = []
    for (const vt of vehicleTypes) {
      const existing = await prisma.cityVehiclePricing.findUnique({
        where: { cityId_vehicleTypeCode: { cityId: req.params.id, vehicleTypeCode: vt.code } }
      })
      
      if (!existing) {
        const pricing = await prisma.cityVehiclePricing.create({
          data: {
            cityId: req.params.id,
            vehicleTypeCode: vt.code,
            baseFare: vt.baseFare * multiplier,
            perKmRate: vt.perKmRate * multiplier,
            perMinuteRate: vt.perMinuteRate * multiplier,
            minimumFare: vt.minimumFare * multiplier,
            surgeMultiplier: 1.0
          }
        })
        results.push({ ...pricing, status: 'created' })
      } else {
        results.push({ ...existing, status: 'exists' })
      }
    }

    res.json({ success: true, pricing: results })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// ============================================================================
// City Walkthrough Management
// ============================================================================

/**
 * GET /api/config/walkthrough/:cityId
 * Public endpoint to get walkthrough by city ID (for admin panel loading)
 */
app.get('/api/config/walkthrough/:cityId', async (req, res) => {
  try {
    const { cityId } = req.params
    
    const walkthrough = await prisma.cityWalkthrough.findUnique({
      where: { cityId },
      include: {
        city: {
          select: { id: true, name: true, code: true }
        },
        points: {
          orderBy: { order: 'asc' }
        }
      }
    })

    if (!walkthrough) {
      return res.json({
        success: true,
        available: false,
        message: 'Walkthrough not available for this city'
      })
    }

    res.json({
      success: true,
      available: true,
      data: {
        id: walkthrough.id,
        name: walkthrough.name,
        isActive: walkthrough.isActive,
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
        }))
      }
    })
  } catch (error) {
    console.error('Failed to fetch walkthrough by city', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/admin/walkthroughs
 * List all walkthroughs with their cities
 */
app.get('/api/admin/walkthroughs', async (req, res) => {
  try {
    const walkthroughs = await prisma.cityWalkthrough.findMany({
      include: {
        city: {
          select: { id: true, name: true, code: true }
        },
        points: {
          orderBy: { order: 'asc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    res.json({
      success: true,
      data: walkthroughs.map(w => ({
        id: w.id,
        cityId: w.cityId,
        city: w.city,
        name: w.name,
        isActive: w.isActive,
        defaultDurationMs: w.defaultDurationMs,
        pointCount: w.points.length,
        points: w.points.map(p => ({
          id: p.id,
          order: p.order,
          latitude: p.latitude,
          longitude: p.longitude,
          zoom: p.zoom,
          pitch: p.pitch,
          bearing: p.bearing,
          durationMs: p.durationMs,
          label: p.label,
        })),
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
      }))
    })
  } catch (error) {
    console.error('Failed to list walkthroughs', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/admin/walkthroughs/by-city/:cityId
 * Get walkthrough by cityId (for admin panel - includes inactive)
 * NOTE: Must be defined BEFORE /walkthroughs/:id to avoid matching "by-city" as id
 */
app.get('/api/admin/walkthroughs/by-city/:cityId', async (req, res) => {
  try {
    const { cityId } = req.params
    
    const walkthrough = await prisma.cityWalkthrough.findUnique({
      where: { cityId },
      include: {
        city: {
          select: { id: true, name: true, code: true, centerLatitude: true, centerLongitude: true }
        },
        points: {
          orderBy: { order: 'asc' }
        }
      }
    })

    if (!walkthrough) {
      return res.json({
        success: true,
        data: null,
        message: 'No walkthrough found for this city'
      })
    }

    res.json({
      success: true,
      data: walkthrough
    })
  } catch (error) {
    console.error('Failed to get walkthrough by city', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/admin/walkthroughs/:id
 * Get a specific walkthrough with all details
 */
app.get('/api/admin/walkthroughs/:id', async (req, res) => {
  try {
    const walkthrough = await prisma.cityWalkthrough.findUnique({
      where: { id: req.params.id },
      include: {
        city: {
          select: { id: true, name: true, code: true, centerLatitude: true, centerLongitude: true }
        },
        points: {
          orderBy: { order: 'asc' }
        }
      }
    })

    if (!walkthrough) {
      return res.status(404).json({
        success: false,
        error: 'Walkthrough not found'
      })
    }

    res.json({
      success: true,
      data: walkthrough
    })
  } catch (error) {
    console.error('Failed to get walkthrough', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/admin/walkthroughs
 * Create a new walkthrough for a city
 */
app.post('/api/admin/walkthroughs', async (req, res) => {
  try {
    const { cityId, name, isActive, defaultDurationMs, points } = req.body

    if (!cityId) {
      return res.status(400).json({
        success: false,
        error: 'cityId is required'
      })
    }

    // Check if city exists
    const city = await prisma.city.findUnique({ where: { id: cityId } })
    if (!city) {
      return res.status(404).json({
        success: false,
        error: 'City not found'
      })
    }

    // Check if walkthrough already exists for this city
    const existing = await prisma.cityWalkthrough.findUnique({
      where: { cityId }
    })

    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'A walkthrough already exists for this city. Use PUT to update.'
      })
    }

    // Create walkthrough with points
    const walkthrough = await prisma.cityWalkthrough.create({
      data: {
        cityId,
        name: name || `${city.name} Tour`,
        isActive: isActive ?? true,
        defaultDurationMs: defaultDurationMs || 3000,
        points: points && points.length > 0 ? {
          create: points.map((p, index) => ({
            order: p.order ?? index,
            latitude: p.latitude,
            longitude: p.longitude,
            zoom: p.zoom ?? 14,
            pitch: p.pitch ?? 45,
            bearing: p.bearing ?? 0,
            durationMs: p.durationMs,
            label: p.label,
          }))
        } : undefined
      },
      include: {
        city: { select: { id: true, name: true, code: true } },
        points: { orderBy: { order: 'asc' } }
      }
    })

    res.status(201).json({
      success: true,
      data: walkthrough
    })
  } catch (error) {
    console.error('Failed to create walkthrough', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * PUT /api/admin/walkthroughs/:id
 * Update an existing walkthrough
 */
app.put('/api/admin/walkthroughs/:id', async (req, res) => {
  try {
    const { name, isActive, defaultDurationMs, points } = req.body

    // Check if walkthrough exists
    const existing = await prisma.cityWalkthrough.findUnique({
      where: { id: req.params.id }
    })

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Walkthrough not found'
      })
    }

    // Update walkthrough
    const updateData = {}
    if (name !== undefined) updateData.name = name
    if (isActive !== undefined) updateData.isActive = isActive
    if (defaultDurationMs !== undefined) updateData.defaultDurationMs = defaultDurationMs

    // If points are provided, delete existing and create new
    if (points && Array.isArray(points)) {
      await prisma.walkthroughPoint.deleteMany({
        where: { walkthroughId: req.params.id }
      })

      if (points.length > 0) {
        await prisma.walkthroughPoint.createMany({
          data: points.map((p, index) => ({
            walkthroughId: req.params.id,
            order: p.order ?? index,
            latitude: p.latitude,
            longitude: p.longitude,
            zoom: p.zoom ?? 14,
            pitch: p.pitch ?? 45,
            bearing: p.bearing ?? 0,
            durationMs: p.durationMs,
            label: p.label,
          }))
        })
      }
    }

    const walkthrough = await prisma.cityWalkthrough.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        city: { select: { id: true, name: true, code: true } },
        points: { orderBy: { order: 'asc' } }
      }
    })

    res.json({
      success: true,
      data: walkthrough
    })
  } catch (error) {
    console.error('Failed to update walkthrough', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * DELETE /api/admin/walkthroughs/:id
 * Delete a walkthrough and all its points
 */
app.delete('/api/admin/walkthroughs/:id', async (req, res) => {
  try {
    // Check if walkthrough exists
    const existing = await prisma.cityWalkthrough.findUnique({
      where: { id: req.params.id }
    })

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Walkthrough not found'
      })
    }

    // Delete walkthrough (points will cascade delete)
    await prisma.cityWalkthrough.delete({
      where: { id: req.params.id }
    })

    res.json({
      success: true,
      message: 'Walkthrough deleted'
    })
  } catch (error) {
    console.error('Failed to delete walkthrough', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============================================================================
// LAREP: Infrastructure Projects Management
// ============================================================================

// Serve larep static files
app.use('/larep', express.static(path.join(__dirname, 'larep')))

// Serve LAREP landing page (public)
app.get('/larep', (req, res) => {
  res.sendFile(path.join(__dirname, 'larep', 'landing.html'))
})

// Serve projects list/admin page
app.get('/larep/projects', (req, res) => {
  res.sendFile(path.join(__dirname, 'larep', 'index.html'))
})

// Serve project view page for /larep/projects/:id
app.get('/larep/projects/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'larep', 'project.html'))
})

/**
 * GET /api/larep/stats
 * Get LAREP projects statistics
 */
app.get('/api/larep/stats', async (req, res) => {
  try {
    const [total, inProgress, completed, budgetSum] = await Promise.all([
      prisma.larepProject.count(),
      prisma.larepProject.count({ where: { status: 'IN_PROGRESS' } }),
      prisma.larepProject.count({ where: { status: 'COMPLETED' } }),
      prisma.larepProject.aggregate({ _sum: { budget: true } })
    ])

    res.json({
      success: true,
      data: {
        total,
        inProgress,
        completed,
        totalBudget: budgetSum._sum.budget || 0
      }
    })
  } catch (error) {
    console.error('Failed to get LAREP stats:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/larep/projects
 * List all projects with optional status filter
 */
app.get('/api/larep/projects', async (req, res) => {
  try {
    const { status } = req.query
    
    const where = status ? { status } : {}
    
    const projects = await prisma.larepProject.findMany({
      where,
      include: {
        points: { orderBy: { order: 'asc' } },
        images: { orderBy: { order: 'asc' } }
      },
      orderBy: { createdAt: 'desc' }
    })

    res.json({
      success: true,
      data: projects
    })
  } catch (error) {
    console.error('Failed to list LAREP projects:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/larep/projects/public
 * List all published projects (for public home page)
 */
app.get('/api/larep/projects/public', async (req, res) => {
  try {
    const projects = await prisma.larepProject.findMany({
      where: { isPublished: true },
      include: {
        points: { orderBy: { order: 'asc' } },
        images: { orderBy: { order: 'asc' } }
      },
      orderBy: { createdAt: 'desc' }
    })

    res.json({
      success: true,
      data: projects
    })
  } catch (error) {
    console.error('Failed to list public LAREP projects:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/larep/projects/:id
 * Get a single project by ID
 */
app.get('/api/larep/projects/:id', async (req, res) => {
  try {
    const project = await prisma.larepProject.findUnique({
      where: { id: req.params.id },
      include: {
        points: { orderBy: { order: 'asc' } },
        images: { orderBy: { order: 'asc' } }
      }
    })

    if (!project) {
      return res.status(404).json({
        success: false,
        error: 'Project not found'
      })
    }

    res.json({
      success: true,
      data: project
    })
  } catch (error) {
    console.error('Failed to get LAREP project:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/larep/projects/:id/public
 * Get a published project for public viewing
 */
app.get('/api/larep/projects/:id/public', async (req, res) => {
  try {
    const project = await prisma.larepProject.findFirst({
      where: { 
        id: req.params.id,
        isPublished: true
      },
      include: {
        points: { orderBy: { order: 'asc' } },
        images: { orderBy: { order: 'asc' } }
      }
    })

    if (!project) {
      return res.status(404).json({
        success: false,
        error: 'Project not found or not published'
      })
    }

    res.json({
      success: true,
      data: project
    })
  } catch (error) {
    console.error('Failed to get public LAREP project:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/larep/projects
 * Create a new project
 */
app.post('/api/larep/projects', async (req, res) => {
  try {
    const {
      name,
      executor,
      budget,
      budgetCurrency,
      executionPercent,
      description,
      status,
      isPublished,
      centerLatitude,
      centerLongitude,
      defaultDurationMs,
      points
    } = req.body

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Project name is required'
      })
    }

    const project = await prisma.larepProject.create({
      data: {
        name,
        executor,
        budget,
        budgetCurrency: budgetCurrency || 'MAD',
        executionPercent: executionPercent || 0,
        description,
        status: status || 'PLANNED',
        isPublished: isPublished || false,
        centerLatitude,
        centerLongitude,
        defaultDurationMs: defaultDurationMs || 3000,
        points: points && points.length > 0 ? {
          create: points.map((p, index) => ({
            order: p.order ?? index + 1,
            latitude: p.latitude,
            longitude: p.longitude,
            zoom: p.zoom ?? 14,
            pitch: p.pitch ?? 60,
            bearing: p.bearing ?? 0,
            durationMs: p.durationMs,
            label: p.label,
            title: p.title,
            description: p.description,
            imageUrl: p.imageUrl
          }))
        } : undefined
      },
      include: {
        points: { orderBy: { order: 'asc' } },
        images: { orderBy: { order: 'asc' } }
      }
    })

    res.status(201).json({
      success: true,
      data: project
    })
  } catch (error) {
    console.error('Failed to create LAREP project:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * PUT /api/larep/projects/:id
 * Update an existing project
 */
app.put('/api/larep/projects/:id', async (req, res) => {
  try {
    const {
      name,
      executor,
      budget,
      budgetCurrency,
      executionPercent,
      description,
      status,
      isPublished,
      centerLatitude,
      centerLongitude,
      defaultDurationMs,
      points
    } = req.body

    // Check if project exists
    const existing = await prisma.larepProject.findUnique({
      where: { id: req.params.id }
    })

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Project not found'
      })
    }

    // Build update data
    const updateData = {}
    if (name !== undefined) updateData.name = name
    if (executor !== undefined) updateData.executor = executor
    if (budget !== undefined) updateData.budget = budget
    if (budgetCurrency !== undefined) updateData.budgetCurrency = budgetCurrency
    if (executionPercent !== undefined) updateData.executionPercent = executionPercent
    if (description !== undefined) updateData.description = description
    if (status !== undefined) updateData.status = status
    if (isPublished !== undefined) updateData.isPublished = isPublished
    if (centerLatitude !== undefined) updateData.centerLatitude = centerLatitude
    if (centerLongitude !== undefined) updateData.centerLongitude = centerLongitude
    if (defaultDurationMs !== undefined) updateData.defaultDurationMs = defaultDurationMs

    // If points are provided, delete existing and create new
    if (points && Array.isArray(points)) {
      await prisma.larepProjectPoint.deleteMany({
        where: { projectId: req.params.id }
      })

      if (points.length > 0) {
        await prisma.larepProjectPoint.createMany({
          data: points.map((p, index) => ({
            projectId: req.params.id,
            order: p.order ?? index + 1,
            latitude: p.latitude,
            longitude: p.longitude,
            zoom: p.zoom ?? 14,
            pitch: p.pitch ?? 60,
            bearing: p.bearing ?? 0,
            durationMs: p.durationMs,
            label: p.label,
            title: p.title,
            description: p.description,
            imageUrl: p.imageUrl
          }))
        })
      }
    }

    const project = await prisma.larepProject.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        points: { orderBy: { order: 'asc' } },
        images: { orderBy: { order: 'asc' } }
      }
    })

    res.json({
      success: true,
      data: project
    })
  } catch (error) {
    console.error('Failed to update LAREP project:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * DELETE /api/larep/projects/:id
 * Delete a project and all its points/images
 */
app.delete('/api/larep/projects/:id', async (req, res) => {
  try {
    // Check if project exists
    const existing = await prisma.larepProject.findUnique({
      where: { id: req.params.id }
    })

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Project not found'
      })
    }

    // Delete project (points and images will cascade delete)
    await prisma.larepProject.delete({
      where: { id: req.params.id }
    })

    res.json({
      success: true,
      message: 'Project deleted'
    })
  } catch (error) {
    console.error('Failed to delete LAREP project:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/larep/projects/:id/images
 * Add images to a project
 */
app.post('/api/larep/projects/:id/images', upload.array('images', 10), async (req, res) => {
  try {
    const projectId = req.params.id
    const { captions } = req.body

    // Check if project exists
    const project = await prisma.larepProject.findUnique({
      where: { id: projectId }
    })

    if (!project) {
      return res.status(404).json({
        success: false,
        error: 'Project not found'
      })
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No images uploaded'
      })
    }

    // Get current max order
    const maxOrder = await prisma.larepProjectImage.aggregate({
      where: { projectId },
      _max: { order: true }
    })

    let currentOrder = (maxOrder._max.order || 0) + 1

    // Create image records
    const images = await Promise.all(req.files.map(async (file, index) => {
      const url = `/uploads/larep/${projectId}/${file.filename}`
      const caption = captions && Array.isArray(captions) ? captions[index] : null

      return prisma.larepProjectImage.create({
        data: {
          projectId,
          url,
          caption,
          order: currentOrder + index
        }
      })
    }))

    res.status(201).json({
      success: true,
      data: images
    })
  } catch (error) {
    console.error('Failed to upload project images:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============================================================================
// Market: Category Management CRUD Endpoints
// ============================================================================

// Storage for category icons (SVG files)
const categoryIconStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(UPLOADS_DIR, 'market', 'categories')
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true })
    }
    cb(null, uploadPath)
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 8)
    cb(null, `category_${timestamp}_${random}${ext}`)
  }
})

const categoryIconFilter = (req, file, cb) => {
  const allowedTypes = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp']
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true)
  } else {
    cb(new Error('Only SVG, PNG, JPEG, and WebP images are allowed'), false)
  }
}

const categoryIconUpload = multer({
  storage: categoryIconStorage,
  fileFilter: categoryIconFilter,
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB max
})

/**
 * GET /api/market/categories
 * List all market categories with subcategories and city assignments
 */
app.get('/api/market/categories', async (req, res) => {
  try {
    const includeInactive = req.query.includeInactive === 'true'
    
    const where = includeInactive ? {} : { isActive: true }

    const categories = await prisma.marketCategory.findMany({
      where,
      include: {
        subcategories: {
          where: includeInactive ? {} : { isActive: true },
          orderBy: { sortOrder: 'asc' }
        },
        cities: {
          include: { city: { select: { id: true, name: true, code: true } } }
        },
        _count: { select: { posts: true } }
      },
      orderBy: { sortOrder: 'asc' }
    })

    res.json({
      success: true,
      data: categories
    })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/market/categories/:id
 * Get a single category with subcategories and city assignments
 */
app.get('/api/market/categories/:id', async (req, res) => {
  try {
    const category = await prisma.marketCategory.findUnique({
      where: { id: req.params.id },
      include: {
        subcategories: { orderBy: { sortOrder: 'asc' } },
        cities: {
          include: { city: { select: { id: true, name: true, code: true } } }
        },
        _count: { select: { posts: true } }
      }
    })

    if (!category) {
      return res.status(404).json({ success: false, error: 'Category not found' })
    }

    res.json({ success: true, data: category })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/market/categories
 * Create a new category
 */
app.post('/api/market/categories', categoryIconUpload.single('icon'), async (req, res) => {
  try {
    const { name, nameAr, description, emoji, gradientStart, gradientEnd, sortOrder, isActive, isGlobal } = req.body

    if (!name) {
      return res.status(400).json({ success: false, error: 'Category name is required' })
    }

    // Check for duplicate name
    const existing = await prisma.marketCategory.findUnique({ where: { name } })
    if (existing) {
      return res.status(400).json({ success: false, error: 'Category with this name already exists' })
    }

    const iconUrl = req.file ? `/uploads/market/categories/${req.file.filename}` : null

    const category = await prisma.marketCategory.create({
      data: {
        name,
        nameAr: nameAr || null,
        description: description || null,
        emoji: emoji || null,
        iconUrl,
        gradientStart: gradientStart || null,
        gradientEnd: gradientEnd || null,
        sortOrder: parseInt(sortOrder) || 0,
        isActive: isActive !== 'false',
        isGlobal: isGlobal === 'true' || isGlobal === true
      },
      include: { subcategories: true, cities: { include: { city: true } } }
    })

    res.status(201).json({ success: true, data: category })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * PUT /api/market/categories/:id
 * Update a category
 */
app.put('/api/market/categories/:id', categoryIconUpload.single('icon'), async (req, res) => {
  try {
    const { name, nameAr, description, emoji, gradientStart, gradientEnd, sortOrder, isActive, isGlobal } = req.body

    const existing = await prisma.marketCategory.findUnique({ where: { id: req.params.id } })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Category not found' })
    }

    // Check for duplicate name if changing
    if (name && name !== existing.name) {
      const duplicate = await prisma.marketCategory.findUnique({ where: { name } })
      if (duplicate) {
        return res.status(400).json({ success: false, error: 'Category with this name already exists' })
      }
    }

    const updateData = {}
    if (name !== undefined) updateData.name = name
    if (nameAr !== undefined) updateData.nameAr = nameAr || null
    if (description !== undefined) updateData.description = description || null
    if (emoji !== undefined) updateData.emoji = emoji || null
    if (gradientStart !== undefined) updateData.gradientStart = gradientStart || null
    if (gradientEnd !== undefined) updateData.gradientEnd = gradientEnd || null
    if (sortOrder !== undefined) updateData.sortOrder = parseInt(sortOrder) || 0
    if (isActive !== undefined) updateData.isActive = isActive !== 'false'
    if (isGlobal !== undefined) updateData.isGlobal = isGlobal === 'true' || isGlobal === true
    if (req.file) updateData.iconUrl = `/uploads/market/categories/${req.file.filename}`

    const category = await prisma.marketCategory.update({
      where: { id: req.params.id },
      data: updateData,
      include: { subcategories: true, cities: { include: { city: true } } }
    })

    res.json({ success: true, data: category })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * DELETE /api/market/categories/:id
 * Delete a category (cascades to subcategories)
 */
app.delete('/api/market/categories/:id', async (req, res) => {
  try {
    const existing = await prisma.marketCategory.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { posts: true } } }
    })

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Category not found' })
    }

    if (existing._count.posts > 0) {
      return res.status(400).json({ 
        success: false, 
        error: `Cannot delete category with ${existing._count.posts} posts. Move or delete posts first.` 
      })
    }

    await prisma.marketCategory.delete({ where: { id: req.params.id } })

    res.json({ success: true, message: 'Category deleted successfully' })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============================================================================
// Market: Pin to Home Functionality
// ============================================================================

/**
 * POST /api/market/categories/:id/pin-to-home
 * Pin or unpin a category to home screen FOR A SPECIFIC CITY
 * Requires cityId in body
 */
app.post('/api/market/categories/:id/pin-to-home', async (req, res) => {
  try {
    const { id } = req.params
    const { isPinnedToHome, cityId } = req.body

    if (!cityId) {
      return res.status(400).json({ success: false, error: 'cityId is required for pin to home' })
    }

    // Check if category exists
    const category = await prisma.marketCategory.findUnique({ where: { id } })
    if (!category) {
      return res.status(404).json({ success: false, error: 'Category not found' })
    }

    // Check if category-city assignment exists
    let assignment = await prisma.categoryCity.findUnique({
      where: { categoryId_cityId: { categoryId: id, cityId } }
    })

    if (!assignment) {
      // Auto-create the assignment if it doesn't exist
      assignment = await prisma.categoryCity.create({
        data: {
          categoryId: id,
          cityId,
          isActive: true,
          isFeatured: false,
          sortOrder: 0,
          isPinnedToHome: false,
          homePinOrder: 0
        }
      })
    }

    // If pinning, check max limit (5 total per city)
    if (isPinnedToHome) {
      const [pinnedCats, pinnedSubs] = await Promise.all([
        prisma.categoryCity.count({ where: { cityId, isPinnedToHome: true } }),
        prisma.subcategoryCity.count({ where: { cityId, isPinnedToHome: true } })
      ])
      
      const totalPinned = pinnedCats + pinnedSubs
      if (totalPinned >= 5 && !assignment.isPinnedToHome) {
        return res.status(400).json({ 
          success: false, 
          error: 'Maximum 5 items can be pinned to home per city. Please unpin something first.' 
        })
      }

      // Get next order number for this city
      const maxOrder = await prisma.categoryCity.aggregate({
        _max: { homePinOrder: true },
        where: { cityId, isPinnedToHome: true }
      })
      const nextOrder = (maxOrder._max.homePinOrder || 0) + 1

      await prisma.categoryCity.update({
        where: { categoryId_cityId: { categoryId: id, cityId } },
        data: { isPinnedToHome: true, homePinOrder: nextOrder }
      })
    } else {
      await prisma.categoryCity.update({
        where: { categoryId_cityId: { categoryId: id, cityId } },
        data: { isPinnedToHome: false, homePinOrder: 0 }
      })
    }

    console.log('Category pin-to-home updated', { categoryId: id, cityId, isPinnedToHome })
    res.json({ success: true })
  } catch (error) {
    console.error('Failed to update category pin-to-home', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/market/subcategories/:id/pin-to-home
 * Pin or unpin a subcategory to home screen FOR A SPECIFIC CITY
 * Requires cityId in body
 */
app.post('/api/market/subcategories/:id/pin-to-home', async (req, res) => {
  try {
    const { id } = req.params
    const { isPinnedToHome, cityId } = req.body

    if (!cityId) {
      return res.status(400).json({ success: false, error: 'cityId is required for pin to home' })
    }

    // Check if subcategory exists
    const subcategory = await prisma.marketSubcategory.findUnique({ where: { id } })
    if (!subcategory) {
      return res.status(404).json({ success: false, error: 'Subcategory not found' })
    }

    // Check if subcategory-city assignment exists
    let assignment = await prisma.subcategoryCity.findUnique({
      where: { subcategoryId_cityId: { subcategoryId: id, cityId } }
    })

    if (!assignment) {
      // Auto-create the assignment if it doesn't exist
      assignment = await prisma.subcategoryCity.create({
        data: {
          subcategoryId: id,
          cityId,
          isActive: true,
          sortOrder: 0,
          isPinnedToHome: false,
          homePinOrder: 0
        }
      })
    }

    // If pinning, check max limit (5 total per city)
    if (isPinnedToHome) {
      const [pinnedCats, pinnedSubs] = await Promise.all([
        prisma.categoryCity.count({ where: { cityId, isPinnedToHome: true } }),
        prisma.subcategoryCity.count({ where: { cityId, isPinnedToHome: true } })
      ])
      
      const totalPinned = pinnedCats + pinnedSubs
      if (totalPinned >= 5 && !assignment.isPinnedToHome) {
        return res.status(400).json({ 
          success: false, 
          error: 'Maximum 5 items can be pinned to home per city. Please unpin something first.' 
        })
      }

      // Get next order number for this city
      const maxOrder = await prisma.subcategoryCity.aggregate({
        _max: { homePinOrder: true },
        where: { cityId, isPinnedToHome: true }
      })
      const nextOrder = (maxOrder._max.homePinOrder || 0) + 1

      await prisma.subcategoryCity.update({
        where: { subcategoryId_cityId: { subcategoryId: id, cityId } },
        data: { isPinnedToHome: true, homePinOrder: nextOrder }
      })
    } else {
      await prisma.subcategoryCity.update({
        where: { subcategoryId_cityId: { subcategoryId: id, cityId } },
        data: { isPinnedToHome: false, homePinOrder: 0 }
      })
    }

    console.log('Subcategory pin-to-home updated', { subcategoryId: id, cityId, isPinnedToHome })
    res.json({ success: true })
  } catch (error) {
    console.error('Failed to update subcategory pin-to-home', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/market/home-pinned
 * Get pinned categories/subcategories for a city's home screen
 */
app.get('/api/market/home-pinned', async (req, res) => {
  try {
    const { cityId } = req.query

    if (!cityId) {
      return res.json({ success: true, data: [] }) // No city = no pinned items
    }

    // Fetch pinned category-city assignments
    const [pinnedCategoryAssignments, pinnedSubcategoryAssignments] = await Promise.all([
      prisma.categoryCity.findMany({
        where: { 
          cityId,
          isPinnedToHome: true,
          isActive: true,
          category: { isActive: true }
        },
        orderBy: { homePinOrder: 'asc' },
        include: {
          category: {
            select: {
              id: true,
              name: true,
              nameAr: true,
              emoji: true,
              iconUrl: true,
              gradientStart: true,
              gradientEnd: true,
            }
          }
        },
        take: 5,
      }),
      prisma.subcategoryCity.findMany({
        where: { 
          cityId,
          isPinnedToHome: true,
          isActive: true,
          subcategory: { isActive: true, category: { isActive: true } }
        },
        orderBy: { homePinOrder: 'asc' },
        include: {
          subcategory: {
            select: {
              id: true,
              categoryId: true,
              name: true,
              nameAr: true,
              emoji: true,
              iconUrl: true,
              gradientStart: true,
              gradientEnd: true,
              category: { select: { id: true, name: true } }
            }
          }
        },
        take: 5,
      })
    ])

    // Transform to expected format
    const combined = [
      ...pinnedCategoryAssignments.map(a => ({
        ...a.category,
        type: 'category',
        homePinOrder: a.homePinOrder,
      })),
      ...pinnedSubcategoryAssignments.map(a => ({
        ...a.subcategory,
        type: 'subcategory',
        homePinOrder: a.homePinOrder,
      })),
    ]
      .sort((a, b) => a.homePinOrder - b.homePinOrder)
      .slice(0, 5)

    console.log(`[Market] Home-pinned for city ${cityId}:`, combined.length, 'items')
    res.json({ success: true, data: combined })
  } catch (error) {
    console.error('Failed to get home-pinned items', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============================================================================
// Market: Category-City Assignment Management
// ============================================================================

/**
 * GET /api/market/categories/:categoryId/cities
 * Get all city assignments for a category
 */
app.get('/api/market/categories/:categoryId/cities', async (req, res) => {
  try {
    const { categoryId } = req.params

    const category = await prisma.marketCategory.findUnique({ where: { id: categoryId } })
    if (!category) {
      return res.status(404).json({ success: false, error: 'Category not found' })
    }

    const assignments = await prisma.categoryCity.findMany({
      where: { categoryId },
      include: { city: { select: { id: true, name: true, code: true, isActive: true } } },
      orderBy: { city: { name: 'asc' } }
    })

    res.json({ success: true, data: assignments })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/market/categories/:categoryId/cities
 * Assign a category to a city (or update existing assignment)
 */
app.post('/api/market/categories/:categoryId/cities', async (req, res) => {
  try {
    const { categoryId } = req.params
    const { cityId, isActive, isFeatured, sortOrder } = req.body

    if (!cityId) {
      return res.status(400).json({ success: false, error: 'cityId is required' })
    }

    // Verify category exists
    const category = await prisma.marketCategory.findUnique({ where: { id: categoryId } })
    if (!category) {
      return res.status(404).json({ success: false, error: 'Category not found' })
    }

    // Verify city exists
    const city = await prisma.city.findUnique({ where: { id: cityId } })
    if (!city) {
      return res.status(404).json({ success: false, error: 'City not found' })
    }

    // Check featured limit for this city (max 3)
    const wantFeatured = isFeatured === 'true' || isFeatured === true
    if (wantFeatured) {
      const featuredCount = await prisma.categoryCity.count({
        where: { cityId, isFeatured: true, categoryId: { not: categoryId } }
      })
      if (featuredCount >= 3) {
        return res.status(400).json({ 
          success: false, 
          error: `Maximum 3 featured categories per city. ${city.name} already has 3 featured categories.` 
        })
      }
    }

    // Upsert the assignment
    const assignment = await prisma.categoryCity.upsert({
      where: { categoryId_cityId: { categoryId, cityId } },
      create: {
        categoryId,
        cityId,
        isActive: isActive !== 'false',
        isFeatured: wantFeatured,
        sortOrder: parseInt(sortOrder) || 0
      },
      update: {
        isActive: isActive !== 'false',
        isFeatured: wantFeatured,
        sortOrder: parseInt(sortOrder) || 0
      },
      include: { city: { select: { id: true, name: true, code: true } } }
    })

    res.json({ success: true, data: assignment })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * PUT /api/market/categories/:categoryId/cities/:cityId
 * Update a category-city assignment
 */
app.put('/api/market/categories/:categoryId/cities/:cityId', async (req, res) => {
  try {
    const { categoryId, cityId } = req.params
    const { isActive, isFeatured, sortOrder } = req.body

    // Verify assignment exists
    const existing = await prisma.categoryCity.findUnique({
      where: { categoryId_cityId: { categoryId, cityId } }
    })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Category-city assignment not found' })
    }

    // Check featured limit for this city (max 3)
    const wantFeatured = isFeatured === 'true' || isFeatured === true
    if (wantFeatured && !existing.isFeatured) {
      const featuredCount = await prisma.categoryCity.count({
        where: { cityId, isFeatured: true }
      })
      if (featuredCount >= 3) {
        const city = await prisma.city.findUnique({ where: { id: cityId } })
        return res.status(400).json({ 
          success: false, 
          error: `Maximum 3 featured categories per city. ${city?.name || 'This city'} already has 3 featured categories.` 
        })
      }
    }

    const assignment = await prisma.categoryCity.update({
      where: { categoryId_cityId: { categoryId, cityId } },
      data: {
        isActive: isActive !== undefined ? isActive !== 'false' : undefined,
        isFeatured: isFeatured !== undefined ? wantFeatured : undefined,
        sortOrder: sortOrder !== undefined ? parseInt(sortOrder) || 0 : undefined
      },
      include: { city: { select: { id: true, name: true, code: true } } }
    })

    res.json({ success: true, data: assignment })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * DELETE /api/market/categories/:categoryId/cities/:cityId
 * Remove a category from a city
 */
app.delete('/api/market/categories/:categoryId/cities/:cityId', async (req, res) => {
  try {
    const { categoryId, cityId } = req.params

    const existing = await prisma.categoryCity.findUnique({
      where: { categoryId_cityId: { categoryId, cityId } }
    })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Category-city assignment not found' })
    }

    await prisma.categoryCity.delete({
      where: { categoryId_cityId: { categoryId, cityId } }
    })

    res.json({ success: true, message: 'Category removed from city' })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/market/categories/:categoryId/cities/bulk
 * Bulk assign/update category to multiple cities
 */
app.post('/api/market/categories/:categoryId/cities/bulk', async (req, res) => {
  try {
    const { categoryId } = req.params
    const { cities } = req.body  // Array of { cityId, isActive, isFeatured, sortOrder }

    if (!Array.isArray(cities)) {
      return res.status(400).json({ success: false, error: 'cities must be an array' })
    }

    // Verify category exists
    const category = await prisma.marketCategory.findUnique({ where: { id: categoryId } })
    if (!category) {
      return res.status(404).json({ success: false, error: 'Category not found' })
    }

    const results = []
    const errors = []

    for (const cityConfig of cities) {
      try {
        const { cityId, isActive, isFeatured, sortOrder } = cityConfig
        
        // Verify city exists
        const city = await prisma.city.findUnique({ where: { id: cityId } })
        if (!city) {
          errors.push({ cityId, error: 'City not found' })
          continue
        }

        // Check featured limit
        const wantFeatured = isFeatured === true
        if (wantFeatured) {
          const existing = await prisma.categoryCity.findUnique({
            where: { categoryId_cityId: { categoryId, cityId } }
          })
          if (!existing?.isFeatured) {
            const featuredCount = await prisma.categoryCity.count({
              where: { cityId, isFeatured: true, categoryId: { not: categoryId } }
            })
            if (featuredCount >= 3) {
              errors.push({ cityId, error: `Max 3 featured categories in ${city.name}` })
              continue
            }
          }
        }

        const assignment = await prisma.categoryCity.upsert({
          where: { categoryId_cityId: { categoryId, cityId } },
          create: {
            categoryId,
            cityId,
            isActive: isActive !== false,
            isFeatured: wantFeatured,
            sortOrder: sortOrder || 0
          },
          update: {
            isActive: isActive !== false,
            isFeatured: wantFeatured,
            sortOrder: sortOrder || 0
          },
          include: { city: { select: { id: true, name: true, code: true } } }
        })

        results.push(assignment)
      } catch (err) {
        errors.push({ cityId: cityConfig.cityId, error: err.message })
      }
    }

    res.json({ 
      success: true, 
      data: results,
      errors: errors.length > 0 ? errors : undefined
    })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============================================================================
// Market: Subcategory Management CRUD Endpoints
// ============================================================================

/**
 * POST /api/market/categories/:categoryId/subcategories
 * Create a subcategory under a category
 */
app.post('/api/market/categories/:categoryId/subcategories', categoryIconUpload.single('icon'), async (req, res) => {
  try {
    const { categoryId } = req.params
    const { name, nameAr, description, emoji, sortOrder, isActive, gradientStart, gradientEnd } = req.body

    if (!name) {
      return res.status(400).json({ success: false, error: 'Subcategory name is required' })
    }

    // Check parent category exists
    const parentCategory = await prisma.marketCategory.findUnique({ where: { id: categoryId } })
    if (!parentCategory) {
      return res.status(404).json({ success: false, error: 'Parent category not found' })
    }

    // Check for duplicate name within category
    const existing = await prisma.marketSubcategory.findUnique({
      where: { categoryId_name: { categoryId, name } }
    })
    if (existing) {
      return res.status(400).json({ success: false, error: 'Subcategory with this name already exists in this category' })
    }

    const iconUrl = req.file ? `/uploads/market/categories/${req.file.filename}` : null

    const subcategory = await prisma.marketSubcategory.create({
      data: {
        categoryId,
        name,
        nameAr: nameAr || null,
        description: description || null,
        emoji: emoji || null,
        iconUrl,
        gradientStart: gradientStart || null,
        gradientEnd: gradientEnd || null,
        sortOrder: parseInt(sortOrder) || 0,
        isActive: isActive !== 'false'
      }
    })

    res.status(201).json({ success: true, data: subcategory })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * PUT /api/market/subcategories/:id
 * Update a subcategory
 */
app.put('/api/market/subcategories/:id', categoryIconUpload.single('icon'), async (req, res) => {
  try {
    const { name, nameAr, description, emoji, sortOrder, isActive, gradientStart, gradientEnd } = req.body

    const existing = await prisma.marketSubcategory.findUnique({ where: { id: req.params.id } })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Subcategory not found' })
    }

    // Check for duplicate name if changing
    if (name && name !== existing.name) {
      const duplicate = await prisma.marketSubcategory.findUnique({
        where: { categoryId_name: { categoryId: existing.categoryId, name } }
      })
      if (duplicate) {
        return res.status(400).json({ success: false, error: 'Subcategory with this name already exists in this category' })
      }
    }

    const updateData = {}
    if (name !== undefined) updateData.name = name
    if (nameAr !== undefined) updateData.nameAr = nameAr || null
    if (description !== undefined) updateData.description = description || null
    if (emoji !== undefined) updateData.emoji = emoji || null
    if (sortOrder !== undefined) updateData.sortOrder = parseInt(sortOrder) || 0
    if (isActive !== undefined) updateData.isActive = isActive !== 'false'
    if (gradientStart !== undefined) updateData.gradientStart = gradientStart || null
    if (gradientEnd !== undefined) updateData.gradientEnd = gradientEnd || null
    if (req.file) updateData.iconUrl = `/uploads/market/categories/${req.file.filename}`

    const subcategory = await prisma.marketSubcategory.update({
      where: { id: req.params.id },
      data: updateData
    })

    res.json({ success: true, data: subcategory })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * DELETE /api/market/subcategories/:id
 * Delete a subcategory
 */
app.delete('/api/market/subcategories/:id', async (req, res) => {
  try {
    const existing = await prisma.marketSubcategory.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { posts: true } } }
    })

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Subcategory not found' })
    }

    if (existing._count.posts > 0) {
      return res.status(400).json({ 
        success: false, 
        error: `Cannot delete subcategory with ${existing._count.posts} posts. Move or delete posts first.` 
      })
    }

    await prisma.marketSubcategory.delete({ where: { id: req.params.id } })

    res.json({ success: true, message: 'Subcategory deleted successfully' })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============================================================================
// Market: Promo Cards Management CRUD Endpoints
// ============================================================================

// Configure multer for promo card image uploads
const promoCardStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'uploads/market/promo-cards')
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true })
    }
    cb(null, uploadDir)
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    const ext = path.extname(file.originalname)
    cb(null, 'promo-' + uniqueSuffix + ext)
  }
})

const promoCardUpload = multer({
  storage: promoCardStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
    if (allowed.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, WebP, and SVG are allowed.'))
    }
  }
})

/**
 * GET /api/market/promo-cards
 * List all promo cards
 * @query includeInactive - Include inactive promo cards
 * @query position - Filter by position (1=top-left, 2=bottom-left, 3=carousel)
 * @query cityId - Filter by city (null cityId means global/all cities)
 */
app.get('/api/market/promo-cards', async (req, res) => {
  try {
    const includeInactive = req.query.includeInactive === 'true'
    const position = req.query.position ? parseInt(req.query.position) : null
    const cityId = req.query.cityId || null
    
    const where = {}
    if (!includeInactive) where.isActive = true
    if (position !== null) where.position = position
    
    // City filtering: show promo cards that are either global (null cityId) or match the user's city
    if (cityId) {
      where.OR = [
        { cityId: null },      // Global promo cards
        { cityId: cityId }     // City-specific promo cards
      ]
    }
    
    const promoCards = await prisma.marketPromoCard.findMany({
      where,
      orderBy: [
        { position: 'asc' },
        { carouselOrder: 'asc' },
        { sortOrder: 'asc' }
      ],
      include: {
        city: {
          select: { id: true, name: true, code: true }
        }
      }
    })
    
    res.json({ success: true, data: promoCards })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/market/promo-cards/:id
 * Get a single promo card
 */
app.get('/api/market/promo-cards/:id', async (req, res) => {
  try {
    const promoCard = await prisma.marketPromoCard.findUnique({
      where: { id: req.params.id }
    })
    
    if (!promoCard) {
      return res.status(404).json({ success: false, error: 'Promo card not found' })
    }
    
    res.json({ success: true, data: promoCard })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/market/promo-cards
 * Create a new promo card
 */
app.post('/api/market/promo-cards', promoCardUpload.single('image'), async (req, res) => {
  try {
    const { 
      position, title, titleAr, emoji, 
      gradientStart, gradientEnd, 
      linkUrl, linkType,
      carouselOrder, sortOrder, isActive,
      cityId
    } = req.body

    if (!title) {
      return res.status(400).json({ success: false, error: 'Title is required' })
    }

    const imageUrl = req.file ? `/uploads/market/promo-cards/${req.file.filename}` : null

    const promoCard = await prisma.marketPromoCard.create({
      data: {
        position: parseInt(position) || 1,
        title,
        titleAr: titleAr || null,
        emoji: emoji || null,
        imageUrl,
        gradientStart: gradientStart || '#667eea',
        gradientEnd: gradientEnd || '#764ba2',
        linkUrl: linkUrl || null,
        linkType: linkType || null,
        carouselOrder: parseInt(carouselOrder) || 0,
        sortOrder: parseInt(sortOrder) || 0,
        isActive: isActive !== 'false',
        cityId: cityId || null
      }
    })

    res.status(201).json({ success: true, data: promoCard })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * PUT /api/market/promo-cards/:id
 * Update a promo card
 */
app.put('/api/market/promo-cards/:id', promoCardUpload.single('image'), async (req, res) => {
  try {
    const { 
      position, title, titleAr, emoji, 
      gradientStart, gradientEnd, 
      linkUrl, linkType,
      carouselOrder, sortOrder, isActive,
      cityId
    } = req.body

    const existing = await prisma.marketPromoCard.findUnique({ where: { id: req.params.id } })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Promo card not found' })
    }

    const updateData = {}
    if (position !== undefined) updateData.position = parseInt(position)
    if (title !== undefined) updateData.title = title
    if (titleAr !== undefined) updateData.titleAr = titleAr || null
    if (emoji !== undefined) updateData.emoji = emoji || null
    if (gradientStart !== undefined) updateData.gradientStart = gradientStart
    if (gradientEnd !== undefined) updateData.gradientEnd = gradientEnd
    if (linkUrl !== undefined) updateData.linkUrl = linkUrl || null
    if (linkType !== undefined) updateData.linkType = linkType || null
    if (carouselOrder !== undefined) updateData.carouselOrder = parseInt(carouselOrder)
    if (sortOrder !== undefined) updateData.sortOrder = parseInt(sortOrder)
    if (isActive !== undefined) updateData.isActive = isActive !== 'false'
    if (cityId !== undefined) updateData.cityId = cityId || null
    
    // Handle new image upload
    if (req.file) {
      // Delete old image if exists
      if (existing.imageUrl) {
        const oldPath = path.join(__dirname, existing.imageUrl)
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath)
        }
      }
      updateData.imageUrl = `/uploads/market/promo-cards/${req.file.filename}`
    }

    const promoCard = await prisma.marketPromoCard.update({
      where: { id: req.params.id },
      data: updateData
    })

    res.json({ success: true, data: promoCard })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * DELETE /api/market/promo-cards/:id
 * Delete a promo card
 */
app.delete('/api/market/promo-cards/:id', async (req, res) => {
  try {
    const existing = await prisma.marketPromoCard.findUnique({ where: { id: req.params.id } })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Promo card not found' })
    }

    // Delete image file if exists
    if (existing.imageUrl) {
      const imagePath = path.join(__dirname, existing.imageUrl)
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath)
      }
    }

    await prisma.marketPromoCard.delete({ where: { id: req.params.id } })

    res.json({ success: true, message: 'Promo card deleted successfully' })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/market/promo-cards/seed-defaults
 * Seed default promo cards (one-time setup)
 */
app.post('/api/market/promo-cards/seed-defaults', async (req, res) => {
  try {
    // Check if any promo cards exist
    const count = await prisma.marketPromoCard.count()
    if (count > 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Promo cards already exist. Delete all to re-seed.' 
      })
    }

    // Default promo cards with sample images
    const defaults = [
      // Position 1: Top-left card
      {
        position: 1,
        title: 'Встречаем\nНовый год\nс Лавкой',
        emoji: '🎄',
        imageUrl: 'https://images.unsplash.com/photo-1512389142860-9c449e58a814?w=200&h=200&fit=crop',
        gradientStart: '#00ccff',
        gradientEnd: '#66ff66',
        sortOrder: 0,
        isActive: true
      },
      // Position 2: Bottom-left card
      {
        position: 2,
        title: 'Скидки\nна всё\nдо 50%',
        emoji: '🎁',
        imageUrl: 'https://images.unsplash.com/photo-1549465220-1a8b9238cd48?w=200&h=200&fit=crop',
        gradientStart: '#9933ff',
        gradientEnd: '#ff3399',
        sortOrder: 0,
        isActive: true
      },
      // Position 3: Carousel slides (right side)
      {
        position: 3,
        title: 'Быстрая\nдоставка\nза 15 мин',
        emoji: '🚀',
        imageUrl: 'https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?w=200&h=200&fit=crop',
        gradientStart: '#ff3333',
        gradientEnd: '#ff9933',
        carouselOrder: 0,
        sortOrder: 0,
        isActive: true
      },
      {
        position: 3,
        title: 'Свежие\nпродукты\nкаждый день',
        emoji: '🥬',
        imageUrl: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=200&h=200&fit=crop',
        gradientStart: '#00cc66',
        gradientEnd: '#66ff99',
        carouselOrder: 1,
        sortOrder: 0,
        isActive: true
      },
      {
        position: 3,
        title: 'Бесплатная\nдоставка\nот 500₽',
        emoji: '🎉',
        imageUrl: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=200&h=200&fit=crop',
        gradientStart: '#ff6633',
        gradientEnd: '#ffcc00',
        carouselOrder: 2,
        sortOrder: 0,
        isActive: true
      }
    ]

    const created = await prisma.marketPromoCard.createMany({
      data: defaults
    })

    res.status(201).json({ 
      success: true, 
      message: `Created ${created.count} default promo cards`,
      count: created.count 
    })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============================================================================
// Market: App Configuration (Branding, Icon, Delivery Banner)
// ============================================================================

/**
 * GET /api/market/config
 * Get the market app configuration
 */
app.get('/api/market/config', async (req, res) => {
  try {
    // Get or create default config
    let config = await prisma.marketConfig.findFirst()
    
    if (!config) {
      config = await prisma.marketConfig.create({
        data: {
          appName: 'Market',
          showDeliveryBanner: true,
          showCategories: true,
          showPromoCards: true,
          showSections: true
        }
      })
    }
    
    res.json({ success: true, config })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// Configure multer for market icon uploads
const marketIconStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'uploads/market/icons')
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true })
    }
    cb(null, uploadDir)
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    const ext = path.extname(file.originalname)
    cb(null, 'market-icon-' + uniqueSuffix + ext)
  }
})

const marketIconUpload = multer({
  storage: marketIconStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp']
    if (allowed.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('Invalid file type. Only SVG, PNG, JPEG, and WebP are allowed.'))
    }
  }
})

/**
 * PUT /api/market/config
 * Update the market app configuration
 */
app.put('/api/market/config', marketIconUpload.single('appIcon'), async (req, res) => {
  try {
    const {
      appName,
      appNameAr,
      appIconSvg,
      headerBgColor,
      headerTextColor,
      showDeliveryBanner,
      deliveryCost,
      deliveryTime,
      showCategories,
      showPromoCards,
      showSections
    } = req.body
    
    // Get or create config
    let config = await prisma.marketConfig.findFirst()
    const configId = config?.id
    
    const updateData = {}
    if (appName !== undefined) updateData.appName = appName
    if (appNameAr !== undefined) updateData.appNameAr = appNameAr
    if (appIconSvg !== undefined) updateData.appIconSvg = appIconSvg
    if (headerBgColor !== undefined) updateData.headerBgColor = headerBgColor
    if (headerTextColor !== undefined) updateData.headerTextColor = headerTextColor
    if (showDeliveryBanner !== undefined) updateData.showDeliveryBanner = showDeliveryBanner === 'true' || showDeliveryBanner === true
    if (deliveryCost !== undefined) updateData.deliveryCost = parseFloat(deliveryCost) || null
    if (deliveryTime !== undefined) updateData.deliveryTime = deliveryTime
    if (showCategories !== undefined) updateData.showCategories = showCategories === 'true' || showCategories === true
    if (showPromoCards !== undefined) updateData.showPromoCards = showPromoCards === 'true' || showPromoCards === true
    if (showSections !== undefined) updateData.showSections = showSections === 'true' || showSections === true
    
    // Handle icon upload
    if (req.file) {
      updateData.appIconUrl = `/uploads/market/icons/${req.file.filename}`
    }
    
    if (configId) {
      config = await prisma.marketConfig.update({
        where: { id: configId },
        data: updateData
      })
    } else {
      config = await prisma.marketConfig.create({
        data: {
          appName: 'Market',
          showDeliveryBanner: true,
          showCategories: true,
          showPromoCards: true,
          showSections: true,
          ...updateData
        }
      })
    }
    
    res.json({ success: true, config })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============================================================================
// Market: Sections Management (Featured collections, Ready food, etc.)
// ============================================================================

// Configure multer for section cover uploads
const sectionCoverStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'uploads/market/sections')
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true })
    }
    cb(null, uploadDir)
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    const ext = path.extname(file.originalname)
    cb(null, 'section-' + uniqueSuffix + ext)
  }
})

const sectionCoverUpload = multer({
  storage: sectionCoverStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp']
    if (allowed.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed.'))
    }
  }
})

/**
 * GET /api/market/sections
 * List all market sections
 * @query includeInactive - Include inactive sections
 * @query cityId - Filter by city
 * @query sectionType - Filter by section type
 */
app.get('/api/market/sections', async (req, res) => {
  try {
    const includeInactive = req.query.includeInactive === 'true'
    const cityId = req.query.cityId || null
    const sectionType = req.query.sectionType || null
    
    const where = {}
    if (!includeInactive) where.isActive = true
    if (sectionType) where.sectionType = sectionType
    
    // City filtering: show global (cityId=null) + city-specific
    if (cityId) {
      where.OR = [
        { cityId: null },
        { cityId }
      ]
    }
    
    const sections = await prisma.marketSection.findMany({
      where,
      include: {
        city: true
      },
      orderBy: { sortOrder: 'asc' }
    })
    
    res.json({ success: true, sections })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/market/sections/:id
 * Get a single section
 */
app.get('/api/market/sections/:id', async (req, res) => {
  try {
    const section = await prisma.marketSection.findUnique({
      where: { id: req.params.id },
      include: { city: true }
    })
    
    if (!section) {
      return res.status(404).json({ success: false, error: 'Section not found' })
    }
    
    res.json({ success: true, section })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/market/sections
 * Create a new section
 */
app.post('/api/market/sections', sectionCoverUpload.single('coverImage'), async (req, res) => {
  try {
    const {
      title,
      titleAr,
      subtitle,
      subtitleAr,
      sectionType,
      iconEmoji,
      iconUrl,
      bgColor,
      categoryId,
      subcategoryId,
      filterTags,
      productIds,
      maxItems,
      showViewAll,
      sortOrder,
      isActive,
      cityId
    } = req.body
    
    const coverImageUrl = req.file ? `/uploads/market/sections/${req.file.filename}` : null
    
    const section = await prisma.marketSection.create({
      data: {
        title,
        titleAr,
        subtitle,
        subtitleAr,
        sectionType: sectionType || 'GRID',
        iconEmoji,
        iconUrl,
        coverImageUrl,
        bgColor,
        categoryId,
        subcategoryId,
        filterTags,
        productIds,
        maxItems: parseInt(maxItems) || 10,
        showViewAll: showViewAll === 'true' || showViewAll === true,
        sortOrder: parseInt(sortOrder) || 0,
        isActive: isActive !== 'false' && isActive !== false,
        cityId: cityId || null
      },
      include: { city: true }
    })
    
    res.status(201).json({ success: true, section })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * PUT /api/market/sections/:id
 * Update a section
 */
app.put('/api/market/sections/:id', sectionCoverUpload.single('coverImage'), async (req, res) => {
  try {
    const { id } = req.params
    const {
      title,
      titleAr,
      subtitle,
      subtitleAr,
      sectionType,
      iconEmoji,
      iconUrl,
      bgColor,
      categoryId,
      subcategoryId,
      filterTags,
      productIds,
      maxItems,
      showViewAll,
      sortOrder,
      isActive,
      cityId
    } = req.body
    
    const existing = await prisma.marketSection.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Section not found' })
    }
    
    const updateData = {}
    if (title !== undefined) updateData.title = title
    if (titleAr !== undefined) updateData.titleAr = titleAr
    if (subtitle !== undefined) updateData.subtitle = subtitle
    if (subtitleAr !== undefined) updateData.subtitleAr = subtitleAr
    if (sectionType !== undefined) updateData.sectionType = sectionType
    if (iconEmoji !== undefined) updateData.iconEmoji = iconEmoji
    if (iconUrl !== undefined) updateData.iconUrl = iconUrl
    if (bgColor !== undefined) updateData.bgColor = bgColor
    if (categoryId !== undefined) updateData.categoryId = categoryId
    if (subcategoryId !== undefined) updateData.subcategoryId = subcategoryId
    if (filterTags !== undefined) updateData.filterTags = filterTags
    if (productIds !== undefined) updateData.productIds = productIds
    if (maxItems !== undefined) updateData.maxItems = parseInt(maxItems)
    if (showViewAll !== undefined) updateData.showViewAll = showViewAll === 'true' || showViewAll === true
    if (sortOrder !== undefined) updateData.sortOrder = parseInt(sortOrder)
    if (isActive !== undefined) updateData.isActive = isActive === 'true' || isActive === true
    if (cityId !== undefined) updateData.cityId = cityId || null
    
    if (req.file) {
      updateData.coverImageUrl = `/uploads/market/sections/${req.file.filename}`
    }
    
    const section = await prisma.marketSection.update({
      where: { id },
      data: updateData,
      include: { city: true }
    })
    
    res.json({ success: true, section })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * DELETE /api/market/sections/:id
 * Delete a section
 */
app.delete('/api/market/sections/:id', async (req, res) => {
  try {
    const { id } = req.params
    
    const existing = await prisma.marketSection.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Section not found' })
    }
    
    await prisma.marketSection.delete({ where: { id } })
    
    res.json({ success: true, message: 'Section deleted' })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/market/sections/seed-defaults
 * Seed default sections (like Yandex Lavka style)
 */
app.post('/api/market/sections/seed-defaults', async (req, res) => {
  try {
    // Clear existing sections first (optional)
    // await prisma.marketSection.deleteMany({})
    
    const defaults = [
      {
        title: 'Featured Products',
        titleAr: 'منتجات مميزة',
        sectionType: 'FEATURED',
        iconEmoji: '⭐',
        sortOrder: 0,
        maxItems: 6,
        showViewAll: true,
        isActive: true
      },
      {
        title: 'Ready Food',
        titleAr: 'طعام جاهز',
        sectionType: 'BANNER',
        iconEmoji: '🍕',
        bgColor: '#FF6B35',
        sortOrder: 1,
        maxItems: 8,
        showViewAll: true,
        isActive: true
      },
      {
        title: 'Fresh Vegetables',
        titleAr: 'خضروات طازجة',
        sectionType: 'HORIZONTAL',
        iconEmoji: '🥬',
        bgColor: '#4CAF50',
        sortOrder: 2,
        maxItems: 10,
        showViewAll: true,
        isActive: true
      },
      {
        title: 'Dairy & Eggs',
        titleAr: 'ألبان وبيض',
        sectionType: 'GRID',
        iconEmoji: '🥛',
        sortOrder: 3,
        maxItems: 8,
        showViewAll: true,
        isActive: true
      },
      {
        title: 'Popular Now',
        titleAr: 'رائج الآن',
        sectionType: 'HORIZONTAL',
        iconEmoji: '🔥',
        sortOrder: 4,
        maxItems: 12,
        showViewAll: true,
        isActive: true
      }
    ]

    const created = await prisma.marketSection.createMany({
      data: defaults
    })

    res.status(201).json({ 
      success: true, 
      message: `Created ${created.count} default sections`,
      count: created.count 
    })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============================================================================
// Market: Seller Management Endpoints
// ============================================================================

/**
 * GET /api/market/sellers
 * List all sellers with filtering
 */
app.get('/api/market/sellers', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const pageSize = parseInt(req.query.pageSize) || 20
    const status = req.query.status
    const search = req.query.search || ''

    const where = {}
    if (status) where.status = status
    if (search) {
      where.OR = [
        { storeName: { contains: search, mode: 'insensitive' } },
        { user: { handle: { contains: search, mode: 'insensitive' } } },
        { user: { displayName: { contains: search, mode: 'insensitive' } } }
      ]
    }

    const [sellers, total] = await Promise.all([
      prisma.marketSeller.findMany({
        where,
        include: {
          user: true,
          _count: { select: { posts: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      prisma.marketSeller.count({ where })
    ])

    res.json({
      success: true,
      data: sellers,
      meta: { total, page, pageSize }
    })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/market/sellers/me
 * Get current user's seller profile (by DID)
 * NOTE: This route MUST be defined BEFORE /api/market/sellers/:id
 */
app.get('/api/market/sellers/me', async (req, res) => {
  try {
    const did = req.query.did
    
    console.log('[Market] Looking up seller for DID:', did)
    
    if (!did) {
      return res.status(400).json({ success: false, error: 'DID is required' })
    }

    // First try to find the user by DID
    const user = await prisma.user.findUnique({ where: { did } })
    console.log('[Market] User found:', user ? user.id : 'null')
    
    let seller = null
    
    if (user) {
      // If user exists, find seller by userId
      seller = await prisma.marketSeller.findUnique({
        where: { userId: user.id },
        include: {
          user: true,
          posts: {
            where: { isArchived: false }, // Only get non-archived posts
            include: { category: true, subcategory: true },
            orderBy: { createdAt: 'desc' }
          }
        }
      })
      console.log('[Market] Seller by userId:', seller ? seller.id : 'null')
    }
    
    // If no seller found via user, try finding seller where user.did matches
    if (!seller) {
      seller = await prisma.marketSeller.findFirst({
        where: { user: { did: did } },
        include: {
          user: true,
          posts: {
            where: { isArchived: false }, // Only get non-archived posts
            include: { category: true, subcategory: true },
            orderBy: { createdAt: 'desc' }
          }
        }
      })
      console.log('[Market] Seller by user.did:', seller ? seller.id : 'null')
    }
    
    // Debug: List all sellers to see what's in the database
    if (!seller) {
      const allSellers = await prisma.marketSeller.findMany({
        include: { user: { select: { did: true, handle: true } } },
        take: 5
      })
      console.log('[Market] All sellers in DB:', JSON.stringify(allSellers.map(s => ({ 
        id: s.id, 
        storeName: s.storeName,
        userId: s.userId,
        userDid: s.user?.did,
        userHandle: s.user?.handle
      }))))
    }

    // Enrich posts with edit history info
    if (seller && seller.posts) {
      const postsWithEditInfo = await Promise.all(seller.posts.map(async (post) => {
        // Check if any archived post was replaced by this one
        const directPredecessor = await prisma.marketPost.findFirst({
          where: { replacedById: post.id }
        })
        
        let editCount = 0
        if (directPredecessor) {
          editCount = await countPredecessors(post.id, post.sellerId)
        }
        
        return {
          ...post,
          hasBeenEdited: !!directPredecessor,
          editCount
        }
      }))
      
      seller = { ...seller, posts: postsWithEditInfo }
    }

    // Return seller (can be null if not a seller)
    res.json({ success: true, data: seller })
  } catch (error) {
    console.error('[Market] Error looking up seller:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/market/sellers/:id
 * Get seller details
 */
app.get('/api/market/sellers/:id', async (req, res) => {
  try {
    const seller = await prisma.marketSeller.findUnique({
      where: { id: req.params.id },
      include: {
        user: true,
        posts: {
          include: { category: true, subcategory: true },
          orderBy: { createdAt: 'desc' },
          take: 20
        }
      }
    })

    if (!seller) {
      return res.status(404).json({ success: false, error: 'Seller not found' })
    }

    res.json({ success: true, data: seller })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/market/sellers/:id/approve
 * Approve a seller application
 */
app.post('/api/market/sellers/:id/approve', async (req, res) => {
  try {
    const seller = await prisma.marketSeller.findUnique({ where: { id: req.params.id } })
    
    if (!seller) {
      return res.status(404).json({ success: false, error: 'Seller not found' })
    }

    if (seller.status === 'APPROVED') {
      return res.status(400).json({ success: false, error: 'Seller is already approved' })
    }

    const updatedSeller = await prisma.marketSeller.update({
      where: { id: req.params.id },
      data: {
        status: 'APPROVED',
        verifiedAt: new Date(),
        rejectionReason: null
      },
      include: { user: true }
    })

    res.json({ success: true, data: updatedSeller, message: 'Seller approved successfully' })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/market/sellers/:id/reject
 * Reject a seller application
 */
app.post('/api/market/sellers/:id/reject', async (req, res) => {
  try {
    const { reason } = req.body
    
    const seller = await prisma.marketSeller.findUnique({ where: { id: req.params.id } })
    
    if (!seller) {
      return res.status(404).json({ success: false, error: 'Seller not found' })
    }

    const updatedSeller = await prisma.marketSeller.update({
      where: { id: req.params.id },
      data: {
        status: 'REJECTED',
        rejectionReason: reason || 'Application did not meet requirements',
        verifiedAt: null
      },
      include: { user: true }
    })

    res.json({ success: true, data: updatedSeller, message: 'Seller rejected' })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/market/sellers/:id/suspend
 * Suspend a seller
 */
app.post('/api/market/sellers/:id/suspend', async (req, res) => {
  try {
    const { reason } = req.body
    
    const seller = await prisma.marketSeller.findUnique({ where: { id: req.params.id } })
    
    if (!seller) {
      return res.status(404).json({ success: false, error: 'Seller not found' })
    }

    const updatedSeller = await prisma.marketSeller.update({
      where: { id: req.params.id },
      data: {
        status: 'SUSPENDED',
        rejectionReason: reason || 'Account suspended'
      },
      include: { user: true }
    })

    res.json({ success: true, data: updatedSeller, message: 'Seller suspended' })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * DELETE /api/market/sellers/:id
 * Delete a seller (and all their posts)
 */
app.delete('/api/market/sellers/:id', async (req, res) => {
  try {
    const seller = await prisma.marketSeller.findUnique({ where: { id: req.params.id } })
    
    if (!seller) {
      return res.status(404).json({ success: false, error: 'Seller not found' })
    }

    await prisma.marketSeller.delete({ where: { id: req.params.id } })

    res.json({ success: true, message: 'Seller and all posts deleted successfully' })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============================================================================
// Market: Post Moderation Endpoints
// ============================================================================

/**
 * GET /api/market/posts
 * List all market posts with filtering
 */
app.get('/api/market/posts', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const pageSize = parseInt(req.query.pageSize) || 20
    const status = req.query.status
    const categoryId = req.query.categoryId
    const cityId = req.query.cityId
    const sellerId = req.query.sellerId
    const search = req.query.search || ''

    const where = {}
    if (status) where.status = status
    if (categoryId) where.categoryId = categoryId
    if (cityId) where.cityId = cityId
    if (sellerId) where.sellerId = sellerId
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ]
    }

    const [posts, total] = await Promise.all([
      prisma.marketPost.findMany({
        where,
        include: {
          seller: { include: { user: true } },
          category: true,
          subcategory: true,
          city: true  // Include city relation
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      prisma.marketPost.count({ where })
    ])

    // For each post, check if it has previous versions (other posts replaced by this one)
    const postsWithEditInfo = await Promise.all(posts.map(async (post) => {
      // Count how many posts have been archived and eventually replaced by this one
      const previousVersionsCount = await prisma.marketPost.count({
        where: {
          sellerId: post.sellerId,
          isArchived: true,
          replacedById: { not: null }
        }
      })
      
      // More accurate: check if this specific post has predecessors
      // Look for posts where replacedById points to this post
      const directPredecessor = await prisma.marketPost.findFirst({
        where: { replacedById: post.id }
      })
      
      return {
        ...post,
        hasBeenEdited: !!directPredecessor,
        editCount: directPredecessor ? await countPredecessors(post.id, post.sellerId) : 0
      }
    }))

    res.json({
      success: true,
      data: postsWithEditInfo,
      meta: { total, page, pageSize }
    })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// Helper function to count predecessor versions
async function countPredecessors(postId, sellerId) {
  let count = 0
  const archivedPosts = await prisma.marketPost.findMany({
    where: { sellerId, isArchived: true },
    select: { id: true, replacedById: true }
  })
  
  // Build a map for quick lookup
  const replacementMap = {}
  for (const p of archivedPosts) {
    if (p.replacedById) {
      replacementMap[p.replacedById] = replacementMap[p.replacedById] || []
      replacementMap[p.replacedById].push(p.id)
    }
  }
  
  // Count predecessors recursively
  const countPreds = (id) => {
    const preds = replacementMap[id] || []
    let c = preds.length
    for (const predId of preds) {
      c += countPreds(predId)
    }
    return c
  }
  
  return countPreds(postId)
}

/**
 * GET /api/market/posts/pending
 * List pending posts awaiting approval
 */
app.get('/api/market/posts/pending', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const pageSize = parseInt(req.query.pageSize) || 20

    const [posts, total] = await Promise.all([
      prisma.marketPost.findMany({
        where: { status: 'PENDING_REVIEW' },
        include: {
          seller: { include: { user: true } },
          category: true,
          subcategory: true
        },
        orderBy: { createdAt: 'asc' }, // Oldest first
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      prisma.marketPost.count({ where: { status: 'PENDING_REVIEW' } })
    ])

    res.json({
      success: true,
      data: posts,
      meta: { total, page, pageSize }
    })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/market/posts/active
 * Get active posts for market display (public)
 * NOTE: This route MUST be defined BEFORE /api/market/posts/:id
 * @query cityId - Filter by city (STRICT - only posts with matching cityId)
 * @query search - Search in title and description
 * @query sortBy - Sort order: newest, price_asc, price_desc, best_selling
 */
app.get('/api/market/posts/active', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const pageSize = parseInt(req.query.pageSize) || 20
    const categoryId = req.query.categoryId
    const subcategoryId = req.query.subcategoryId
    const inStockOnly = req.query.inStockOnly !== 'false' // Default to true
    const cityId = req.query.cityId || null
    const search = req.query.search || null
    const sortBy = req.query.sortBy || 'newest'

    const where = { 
      status: 'ACTIVE',
      isArchived: false  // Exclude archived posts
    }
    if (categoryId) where.categoryId = categoryId
    if (subcategoryId) where.subcategoryId = subcategoryId
    if (inStockOnly) where.isInStock = true
    
    // Search filter - search in title and description
    if (search && search.trim()) {
      where.AND = [
        {
          OR: [
            { title: { contains: search.trim(), mode: 'insensitive' } },
            { description: { contains: search.trim(), mode: 'insensitive' } }
          ]
        }
      ]
    }
    
    // STRICT City filtering: only posts with matching cityId when specified
    // Posts with cityId=null will NOT show when a city is selected
    if (cityId) {
      where.cityId = cityId
      console.log(`[Market] Filtering by cityId: ${cityId} (STRICT - no null cityId posts)`)
    } else {
      console.log(`[Market] No city filter - showing all posts`)
    }

    // Determine sort order
    let orderBy = { createdAt: 'desc' }
    switch (sortBy) {
      case 'price_asc':
        orderBy = { price: 'asc' }
        break
      case 'price_desc':
        orderBy = { price: 'desc' }
        break
      case 'best_selling':
        orderBy = { soldCount: 'desc' }
        break
      case 'newest':
      default:
        orderBy = { createdAt: 'desc' }
    }

    console.log('[Market] GET /posts/active query:', req.query)
    console.log('[Market] GET /posts/active where:', JSON.stringify(where))

    const [posts, total] = await Promise.all([
      prisma.marketPost.findMany({
        where,
        include: {
          seller: { include: { user: { select: { handle: true, displayName: true, avatarUrl: true } } } },
          category: true,
          subcategory: true
        },
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      prisma.marketPost.count({ where })
    ])

    console.log(`[Market] Found ${posts.length} active posts (total: ${total})`)

    res.json({
      success: true,
      data: posts,
      meta: { total, page, pageSize }
    })
  } catch (error) {
    console.error('[Market] Error fetching active posts:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/market/posts/lookup-by-uris
 * Batch lookup market posts by their postUris
 * Returns a map of postUri -> MarketPost (only for posts that exist in market)
 */
app.post('/api/market/posts/lookup-by-uris', async (req, res) => {
  try {
    const { postUris } = req.body
    
    if (!Array.isArray(postUris) || postUris.length === 0) {
      return res.json({ success: true, data: {} })
    }

    // Limit batch size to prevent abuse
    const limitedUris = postUris.slice(0, 100)

    const posts = await prisma.marketPost.findMany({
      where: {
        postUri: { in: limitedUris },
        status: 'ACTIVE',
        isArchived: false
      },
      include: {
        seller: { include: { user: true } },
        category: true,
        subcategory: true
      }
    })

    // Convert to a map of postUri -> MarketPost for easy lookup
    const postMap = {}
    for (const post of posts) {
      postMap[post.postUri] = post
    }

    res.json({ success: true, data: postMap })
  } catch (error) {
    console.error('[Market] Error looking up posts by URIs:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/market/posts/:id
 * Get post details
 */
app.get('/api/market/posts/:id', async (req, res) => {
  try {
    const post = await prisma.marketPost.findUnique({
      where: { id: req.params.id },
      include: {
        seller: { include: { user: true } },
        category: true,
        subcategory: true
      }
    })

    if (!post) {
      return res.status(404).json({ success: false, error: 'Post not found' })
    }

    res.json({ success: true, data: post })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/market/posts/:id/approve
 * Approve a post for display in market
 */
app.post('/api/market/posts/:id/approve', async (req, res) => {
  try {
    const post = await prisma.marketPost.findUnique({ where: { id: req.params.id } })
    
    if (!post) {
      return res.status(404).json({ success: false, error: 'Post not found' })
    }

    const updatedPost = await prisma.marketPost.update({
      where: { id: req.params.id },
      data: {
        status: 'ACTIVE',
        reviewedAt: new Date(),
        rejectionReason: null
      },
      include: {
        seller: { include: { user: true } },
        category: true
      }
    })

    res.json({ success: true, data: updatedPost, message: 'Post approved and is now visible in market' })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/market/posts/:id/reject
 * Reject a post
 */
app.post('/api/market/posts/:id/reject', async (req, res) => {
  try {
    const { reason } = req.body
    
    const post = await prisma.marketPost.findUnique({ where: { id: req.params.id } })
    
    if (!post) {
      return res.status(404).json({ success: false, error: 'Post not found' })
    }

    const updatedPost = await prisma.marketPost.update({
      where: { id: req.params.id },
      data: {
        status: 'REJECTED',
        reviewedAt: new Date(),
        rejectionReason: reason || 'Post did not meet marketplace guidelines'
      },
      include: {
        seller: { include: { user: true } },
        category: true
      }
    })

    res.json({ success: true, data: updatedPost, message: 'Post rejected' })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * PUT /api/market/posts/:id/category
 * Admin: Update post category and/or subcategory
 */
app.put('/api/market/posts/:id/category', async (req, res) => {
  try {
    const { categoryId, subcategoryId } = req.body
    const postId = req.params.id

    const post = await prisma.marketPost.findUnique({ where: { id: postId } })
    if (!post) {
      return res.status(404).json({ success: false, error: 'Post not found' })
    }

    const updateData = {}

    // Validate and set category if provided
    if (categoryId !== undefined) {
      if (categoryId) {
        const category = await prisma.marketCategory.findUnique({ where: { id: categoryId } })
        if (!category) {
          return res.status(400).json({ success: false, error: 'Category not found' })
        }
        updateData.categoryId = categoryId
        // Clear subcategory if changing category (unless new subcategoryId provided)
        if (categoryId !== post.categoryId && !subcategoryId) {
          updateData.subcategoryId = null
        }
      } else {
        updateData.categoryId = null
        updateData.subcategoryId = null
      }
    }

    // Validate and set subcategory if provided
    if (subcategoryId !== undefined) {
      if (subcategoryId) {
        const subcategory = await prisma.marketSubcategory.findUnique({ where: { id: subcategoryId } })
        if (!subcategory) {
          return res.status(400).json({ success: false, error: 'Subcategory not found' })
        }
        // Ensure subcategory belongs to the post's category
        const targetCategoryId = updateData.categoryId || post.categoryId
        if (subcategory.categoryId !== targetCategoryId) {
          return res.status(400).json({ success: false, error: 'Subcategory does not belong to the selected category' })
        }
        updateData.subcategoryId = subcategoryId
      } else {
        updateData.subcategoryId = null
      }
    }

    const updatedPost = await prisma.marketPost.update({
      where: { id: postId },
      data: updateData,
      include: {
        seller: { include: { user: true } },
        category: true,
        subcategory: true
      }
    })

    res.json({ success: true, data: updatedPost, message: 'Post category updated' })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * PUT /api/market/posts/bulk/category
 * Admin: Bulk update category/subcategory for multiple posts
 */
app.put('/api/market/posts/bulk/category', async (req, res) => {
  try {
    const { postIds, categoryId, subcategoryId } = req.body

    if (!postIds || !Array.isArray(postIds) || postIds.length === 0) {
      return res.status(400).json({ success: false, error: 'postIds array is required' })
    }

    // Validate category if provided
    if (categoryId) {
      const category = await prisma.marketCategory.findUnique({ where: { id: categoryId } })
      if (!category) {
        return res.status(400).json({ success: false, error: 'Category not found' })
      }
    }

    // Validate subcategory if provided
    if (subcategoryId) {
      const subcategory = await prisma.marketSubcategory.findUnique({ where: { id: subcategoryId } })
      if (!subcategory) {
        return res.status(400).json({ success: false, error: 'Subcategory not found' })
      }
      if (categoryId && subcategory.categoryId !== categoryId) {
        return res.status(400).json({ success: false, error: 'Subcategory does not belong to the selected category' })
      }
    }

    const updateData = {}
    if (categoryId !== undefined) updateData.categoryId = categoryId || null
    if (subcategoryId !== undefined) updateData.subcategoryId = subcategoryId || null

    // If changing category but not providing subcategory, clear subcategory
    if (categoryId && !subcategoryId) {
      updateData.subcategoryId = null
    }

    const result = await prisma.marketPost.updateMany({
      where: { id: { in: postIds } },
      data: updateData
    })

    res.json({ 
      success: true, 
      data: { updatedCount: result.count },
      message: `Updated ${result.count} posts` 
    })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * DELETE /api/market/posts/:id
 * Delete a post (admin or owning seller)
 */
app.delete('/api/market/posts/:id', async (req, res) => {
  try {
    const { did } = req.query
    const postId = req.params.id
    
    const post = await prisma.marketPost.findUnique({ 
      where: { id: postId },
      include: { seller: true }
    })
    
    if (!post) {
      return res.status(404).json({ success: false, error: 'Post not found' })
    }

    // If DID is provided, verify ownership
    if (did) {
      const user = await prisma.user.findUnique({ where: { did } })
      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' })
      }
      
      const seller = await prisma.marketSeller.findUnique({ where: { userId: user.id } })
      if (!seller || post.sellerId !== seller.id) {
        return res.status(403).json({ success: false, error: 'You can only delete your own posts' })
      }
    }

    await prisma.marketPost.delete({ where: { id: postId } })

    res.json({ success: true, data: { deleted: true }, message: 'Post deleted successfully' })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/market/posts/:id/history
 * Get post edit history (all versions)
 */
app.get('/api/market/posts/:id/history', async (req, res) => {
  try {
    const postId = req.params.id
    
    // Find the current post
    const currentPost = await prisma.marketPost.findUnique({
      where: { id: postId },
      include: {
        seller: { include: { user: true } },
        category: true,
        subcategory: true
      }
    })

    if (!currentPost) {
      return res.status(404).json({ success: false, error: 'Post not found' })
    }

    // Find all previous versions (posts that were archived and led to this one)
    const history = []
    let searchId = postId
    
    // Walk backwards through the chain - find posts where replacedById = current
    // We need to find posts that were replaced BY this post
    const previousVersions = await prisma.marketPost.findMany({
      where: {
        sellerId: currentPost.sellerId,
        isArchived: true
      },
      include: {
        category: true,
        subcategory: true
      },
      orderBy: { createdAt: 'desc' }
    })

    // Build the chain by finding posts that eventually led to this post
    // A post P is a previous version if there's a chain P -> ... -> currentPost via replacedById
    const buildChain = async (targetId) => {
      const chain = []
      
      // Find all archived posts from this seller and trace replacedById chains
      for (const archivedPost of previousVersions) {
        // Check if this archived post's replacement chain leads to our target
        let checkId = archivedPost.replacedById
        let depth = 0
        const maxDepth = 50 // Prevent infinite loops
        
        while (checkId && depth < maxDepth) {
          if (checkId === targetId) {
            // This archived post is a previous version
            chain.push(archivedPost)
            break
          }
          // Follow the chain
          const nextPost = await prisma.marketPost.findUnique({
            where: { id: checkId },
            select: { replacedById: true }
          })
          checkId = nextPost?.replacedById
          depth++
        }
      }
      
      return chain
    }

    const previousChain = await buildChain(postId)
    
    // Sort by createdAt ascending (oldest first)
    previousChain.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))

    // Build the complete history with version numbers
    const fullHistory = previousChain.map((post, index) => ({
      version: index + 1,
      id: post.id,
      title: post.title,
      description: post.description,
      price: post.price,
      currency: post.currency,
      status: post.status,
      categoryId: post.categoryId,
      categoryName: post.category?.name,
      subcategoryId: post.subcategoryId,
      subcategoryName: post.subcategory?.name,
      createdAt: post.createdAt,
      isArchived: post.isArchived,
      replacedById: post.replacedById
    }))

    // Add current version as the latest
    fullHistory.push({
      version: fullHistory.length + 1,
      id: currentPost.id,
      title: currentPost.title,
      description: currentPost.description,
      price: currentPost.price,
      currency: currentPost.currency,
      status: currentPost.status,
      categoryId: currentPost.categoryId,
      categoryName: currentPost.category?.name,
      subcategoryId: currentPost.subcategoryId,
      subcategoryName: currentPost.subcategory?.name,
      createdAt: currentPost.createdAt,
      isArchived: currentPost.isArchived,
      replacedById: currentPost.replacedById,
      isCurrent: true
    })

    res.json({
      success: true,
      data: {
        currentPost,
        totalVersions: fullHistory.length,
        hasBeenEdited: fullHistory.length > 1,
        history: fullHistory
      }
    })
  } catch (error) {
    console.error('Error fetching post history:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============================================================================
// Market: Orders Admin Endpoints
// ============================================================================

/**
 * GET /api/market/orders
 * List all market orders (admin view)
 */
app.get('/api/market/orders', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const pageSize = parseInt(req.query.pageSize) || 20
    const status = req.query.status
    const search = req.query.search || ''

    const where = {}
    if (status) where.status = status
    if (search) {
      where.OR = [
        { buyerDid: { contains: search, mode: 'insensitive' } },
        { id: { contains: search, mode: 'insensitive' } },
        { items: { some: { marketPost: { title: { contains: search, mode: 'insensitive' } } } } }
      ]
    }

    const [orders, total] = await Promise.all([
      prisma.marketOrder.findMany({
        where,
        include: {
          items: {
            include: {
              marketPost: {
                select: { id: true, title: true, postUri: true, price: true }
              },
              seller: {
                select: { id: true, storeName: true, user: { select: { did: true } } }
              },
              escrowHold: true
            }
          },
          conversations: {
            include: {
              seller: {
                select: { id: true, storeName: true }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      prisma.marketOrder.count({ where })
    ])

    res.json({
      success: true,
      data: orders,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize)
      }
    })
  } catch (error) {
    console.error('[Market Orders] List error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/market/orders/:id
 * Get market order details
 */
app.get('/api/market/orders/:id', async (req, res) => {
  try {
    const order = await prisma.marketOrder.findUnique({
      where: { id: req.params.id },
      include: {
        items: {
          include: {
            marketPost: true,
            seller: true,
            escrowHold: true,
            dispute: true
          }
        },
        conversations: {
          include: {
            seller: true
          }
        }
      }
    })

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' })
    }

    res.json({ success: true, data: order })
  } catch (error) {
    console.error('[Market Orders] Get order error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * PUT /api/market/orders/:id/status
 * Update market order status (admin)
 */
app.put('/api/market/orders/:id/status', async (req, res) => {
  try {
    const { status } = req.body
    const validStatuses = ['PENDING', 'PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED']
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' })
    }
    
    const order = await prisma.marketOrder.update({
      where: { id: req.params.id },
      data: { status }
    })
    
    console.log(`[Market Orders] Admin updated order ${req.params.id} status to ${status}`)
    res.json({ success: true, data: order })
  } catch (error) {
    console.error('[Market Orders] Update status error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * PUT /api/market/orders/items/:itemId/status
 * Update market order item status (admin)
 */
app.put('/api/market/orders/items/:itemId/status', async (req, res) => {
  try {
    const { status } = req.body
    const validStatuses = ['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'DISPUTED', 'REFUNDED']
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' })
    }
    
    const item = await prisma.marketOrderItem.update({
      where: { id: req.params.itemId },
      data: { status }
    })
    
    console.log(`[Market Orders] Admin updated item ${req.params.itemId} status to ${status}`)
    res.json({ success: true, data: item })
  } catch (error) {
    console.error('[Market Orders] Update item status error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/market/orders/items/:itemId/release-escrow
 * Release escrow for an order item (admin)
 */
app.post('/api/market/orders/items/:itemId/release-escrow', async (req, res) => {
  try {
    const item = await prisma.marketOrderItem.findUnique({
      where: { id: req.params.itemId },
      include: { escrowHold: true, seller: true }
    })
    
    if (!item) {
      return res.status(404).json({ success: false, error: 'Item not found' })
    }
    
    if (!item.escrowHold) {
      return res.status(400).json({ success: false, error: 'No escrow hold for this item' })
    }
    
    if (item.escrowHold.status !== 'HELD') {
      return res.status(400).json({ success: false, error: 'Escrow is not in HELD status' })
    }
    
    // Update escrow status
    await prisma.escrowHold.update({
      where: { id: item.escrowHold.id },
      data: { 
        status: 'RELEASED',
        releasedAt: new Date()
      }
    })
    
    // Update item status to delivered if not already
    await prisma.marketOrderItem.update({
      where: { id: req.params.itemId },
      data: { status: 'DELIVERED' }
    })
    
    // TODO: Transfer funds to seller's wallet
    // For now, just log it
    console.log(`[Market Orders] Admin released escrow for item ${req.params.itemId}, amount: ${item.escrowHold.amount}`)
    
    res.json({ success: true, message: 'Escrow released successfully' })
  } catch (error) {
    console.error('[Market Orders] Release escrow error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/market/orders/:id/cancel
 * Cancel a market order (admin)
 */
app.post('/api/market/orders/:id/cancel', async (req, res) => {
  try {
    const order = await prisma.marketOrder.findUnique({
      where: { id: req.params.id },
      include: { 
        items: { include: { escrowHold: true } }
      }
    })
    
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' })
    }
    
    if (['DELIVERED', 'REFUNDED', 'CANCELLED'].includes(order.status)) {
      return res.status(400).json({ success: false, error: 'Cannot cancel order in current status' })
    }
    
    // Cancel all items and refund escrow
    for (const item of order.items) {
      await prisma.marketOrderItem.update({
        where: { id: item.id },
        data: { status: 'CANCELLED' }
      })
      
      if (item.escrowHold && item.escrowHold.status === 'HELD') {
        await prisma.escrowHold.update({
          where: { id: item.escrowHold.id },
          data: { 
            status: 'REFUNDED',
            releasedAt: new Date()
          }
        })
      }
    }
    
    // Update order status
    const updatedOrder = await prisma.marketOrder.update({
      where: { id: req.params.id },
      data: { status: 'CANCELLED' }
    })
    
    // TODO: Refund to buyer's wallet if payment was made
    console.log(`[Market Orders] Admin cancelled order ${req.params.id}`)
    
    res.json({ success: true, data: updatedOrder })
  } catch (error) {
    console.error('[Market Orders] Cancel order error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/market/disputes
 * List all market order disputes (admin view)
 */
app.get('/api/market/disputes', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const pageSize = parseInt(req.query.pageSize) || 20
    const status = req.query.status

    const where = {}
    if (status) where.status = status

    const [disputes, total] = await Promise.all([
      prisma.marketOrderDispute.findMany({
        where,
        include: {
          orderItem: {
            include: {
              order: true,
              marketPost: {
                select: { id: true, title: true, postUri: true, price: true }
              },
              seller: {
                select: { id: true, storeName: true, user: { select: { did: true } } }
              },
              escrowHold: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      prisma.marketOrderDispute.count({ where })
    ])

    res.json({
      success: true,
      data: disputes,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize)
      }
    })
  } catch (error) {
    console.error('[Market Disputes] List error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * PUT /api/market/disputes/:id/resolve
 * Resolve a market order dispute (admin action)
 */
app.put('/api/market/disputes/:id/resolve', async (req, res) => {
  try {
    const { id } = req.params
    const { resolution, adminNotes, refundPercentage } = req.body

    if (!resolution || !['SELLER_WIN', 'BUYER_WIN', 'PARTIAL_REFUND'].includes(resolution)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Valid resolution required: SELLER_WIN, BUYER_WIN, or PARTIAL_REFUND' 
      })
    }

    const dispute = await prisma.marketOrderDispute.findUnique({
      where: { id },
      include: {
        orderItem: {
          include: {
            order: true,
            escrowHold: true,
            seller: true
          }
        }
      }
    })

    if (!dispute) {
      return res.status(404).json({ success: false, error: 'Dispute not found' })
    }

    if (dispute.status !== 'PENDING') {
      return res.status(400).json({ success: false, error: 'Dispute already resolved' })
    }

    // Handle escrow based on resolution
    const escrow = dispute.orderItem.escrowHold
    const buyerDid = dispute.orderItem.order.buyerDid
    const sellerDid = dispute.orderItem.seller.did

    if (escrow && escrow.status === 'PENDING') {
      if (resolution === 'BUYER_WIN') {
        // Full refund to buyer
        await prisma.$transaction([
          prisma.escrowHold.update({
            where: { id: escrow.id },
            data: { status: 'REFUNDED', releasedAt: new Date() }
          }),
          prisma.wallet.update({
            where: { did: buyerDid },
            data: { balance: { increment: escrow.amount } }
          }),
          prisma.walletTransaction.create({
            data: {
              walletId: (await prisma.wallet.findUnique({ where: { did: buyerDid } })).id,
              type: 'REFUND',
              amount: escrow.amount,
              description: `Dispute refund for order item ${dispute.orderItemId}`,
              referenceType: 'ESCROW_REFUND',
              referenceId: escrow.id
            }
          })
        ])
      } else if (resolution === 'SELLER_WIN') {
        // Release to seller
        await prisma.$transaction([
          prisma.escrowHold.update({
            where: { id: escrow.id },
            data: { status: 'RELEASED', releasedAt: new Date() }
          }),
          prisma.wallet.update({
            where: { did: sellerDid },
            data: { balance: { increment: escrow.amount } }
          }),
          prisma.walletTransaction.create({
            data: {
              walletId: (await prisma.wallet.findUnique({ where: { did: sellerDid } })).id,
              type: 'CREDIT',
              amount: escrow.amount,
              description: `Dispute resolved - payment for order item ${dispute.orderItemId}`,
              referenceType: 'ESCROW_RELEASE',
              referenceId: escrow.id
            }
          })
        ])
      } else if (resolution === 'PARTIAL_REFUND') {
        // Split the funds
        const percentage = refundPercentage || 50
        const refundAmount = Math.floor(escrow.amount * (percentage / 100))
        const sellerAmount = escrow.amount - refundAmount

        const [buyerWallet, sellerWallet] = await Promise.all([
          prisma.wallet.findUnique({ where: { did: buyerDid } }),
          prisma.wallet.findUnique({ where: { did: sellerDid } })
        ])

        await prisma.$transaction([
          prisma.escrowHold.update({
            where: { id: escrow.id },
            data: { status: 'RELEASED', releasedAt: new Date() }
          }),
          prisma.wallet.update({
            where: { did: buyerDid },
            data: { balance: { increment: refundAmount } }
          }),
          prisma.wallet.update({
            where: { did: sellerDid },
            data: { balance: { increment: sellerAmount } }
          }),
          prisma.walletTransaction.create({
            data: {
              walletId: buyerWallet.id,
              type: 'REFUND',
              amount: refundAmount,
              description: `Partial refund (${percentage}%) for order item ${dispute.orderItemId}`,
              referenceType: 'ESCROW_REFUND',
              referenceId: escrow.id
            }
          }),
          prisma.walletTransaction.create({
            data: {
              walletId: sellerWallet.id,
              type: 'CREDIT',
              amount: sellerAmount,
              description: `Partial payment (${100 - percentage}%) for order item ${dispute.orderItemId}`,
              referenceType: 'ESCROW_RELEASE',
              referenceId: escrow.id
            }
          })
        ])
      }
    }

    // Update dispute status
    const updatedDispute = await prisma.marketOrderDispute.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        resolution,
        adminNotes: adminNotes || null,
        resolvedAt: new Date()
      },
      include: {
        orderItem: {
          include: {
            order: true,
            marketPost: true,
            seller: true
          }
        }
      }
    })

    // Update order item status
    await prisma.marketOrderItem.update({
      where: { id: dispute.orderItemId },
      data: { 
        status: resolution === 'BUYER_WIN' ? 'REFUNDED' : 'DELIVERED',
        deliveredAt: resolution !== 'BUYER_WIN' ? new Date() : null
      }
    })

    res.json({ success: true, data: updatedDispute })
  } catch (error) {
    console.error('[Market Disputes] Resolve error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============================================================================
// Market: Public API Endpoints (for mobile app)
// ============================================================================

/**
 * POST /api/market/sellers/apply
 * Apply to become a seller (from mobile app)
 */
app.post('/api/market/sellers/apply', async (req, res) => {
  try {
    const { did, storeName, storeDescription, contactPhone, contactEmail, cityId } = req.body

    if (!did || !storeName) {
      return res.status(400).json({ success: false, error: 'DID and store name are required' })
    }

    // Find or create user
    let user = await prisma.user.findUnique({ where: { did } })
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found. Please login first.' })
    }

    // Check if already a seller
    const existingSeller = await prisma.marketSeller.findUnique({ where: { userId: user.id } })
    if (existingSeller) {
      return res.status(400).json({ 
        success: false, 
        error: 'You already have a seller application',
        data: { status: existingSeller.status }
      })
    }

    // Validate city if provided
    if (cityId) {
      const city = await prisma.city.findUnique({ where: { id: cityId } })
      if (!city) {
        return res.status(400).json({ success: false, error: 'Invalid city' })
      }
    }

    const seller = await prisma.marketSeller.create({
      data: {
        userId: user.id,
        storeName,
        storeDescription: storeDescription || null,
        contactPhone: contactPhone || null,
        contactEmail: contactEmail || null,
        cityId: cityId || null,  // null = multi-city/national seller
        status: 'PENDING'
      },
      include: { 
        user: true,
        city: { select: { id: true, name: true, code: true } }
      }
    })

    res.status(201).json({ 
      success: true, 
      data: seller,
      message: 'Application submitted successfully. You will be notified once approved.'
    })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/market/posts/submit
 * Submit a post for market (from mobile app)
 */
app.post('/api/market/posts/submit', async (req, res) => {
  try {
    const { did, postUri, postCid, categoryId, subcategoryId, title, description, price, currency, quantity, cityId } = req.body

    console.log('[Market] Post submit request - cityId:', cityId)

    if (!did || !postUri || !postCid || !categoryId || !title) {
      return res.status(400).json({ 
        success: false, 
        error: 'DID, post URI, post CID, category, and title are required' 
      })
    }

    // Find user and seller
    const user = await prisma.user.findUnique({ where: { did } })
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' })
    }

    const seller = await prisma.marketSeller.findUnique({ where: { userId: user.id } })
    if (!seller) {
      return res.status(403).json({ success: false, error: 'You must be an approved seller to submit posts' })
    }

    if (seller.status !== 'APPROVED') {
      return res.status(403).json({ 
        success: false, 
        error: `Cannot submit posts. Your seller status is: ${seller.status}` 
      })
    }

    // Check category exists
    const category = await prisma.marketCategory.findUnique({ where: { id: categoryId } })
    if (!category || !category.isActive) {
      return res.status(400).json({ success: false, error: 'Invalid or inactive category' })
    }

    // Check subcategory if provided
    if (subcategoryId) {
      const subcategory = await prisma.marketSubcategory.findUnique({ where: { id: subcategoryId } })
      if (!subcategory || !subcategory.isActive || subcategory.categoryId !== categoryId) {
        return res.status(400).json({ success: false, error: 'Invalid or inactive subcategory' })
      }
    }

    // Check for duplicate post
    const existingPost = await prisma.marketPost.findUnique({ where: { postUri } })
    if (existingPost) {
      return res.status(400).json({ success: false, error: 'This post has already been submitted to the market' })
    }

    // Parse quantity with default of 1
    const parsedQuantity = quantity !== undefined ? parseInt(quantity, 10) : 1
    const validQuantity = isNaN(parsedQuantity) || parsedQuantity < 0 ? 1 : parsedQuantity

    // Use provided cityId, or fall back to seller's city
    let postCityId = cityId || seller.cityId || null
    
    // Validate city exists if provided
    if (postCityId) {
      const city = await prisma.city.findUnique({ where: { id: postCityId } })
      if (!city) {
        console.log('[Market] City not found, setting to null:', postCityId)
        postCityId = null // City doesn't exist, make it global
      }
    }
    console.log('[Market] Final cityId for post:', postCityId)

    const post = await prisma.marketPost.create({
      data: {
        sellerId: seller.id,
        postUri,
        postCid,
        categoryId,
        subcategoryId: subcategoryId || null,
        title,
        description: description || null,
        price: price ? parseFloat(price) : null,
        currency: currency || 'MAD',
        quantity: validQuantity,
        isInStock: validQuantity > 0,
        cityId: postCityId,  // Use submitted cityId or fallback to seller's city
        status: 'PENDING_REVIEW'
      },
      include: {
        seller: { include: { user: true } },
        category: true,
        subcategory: true,
        city: { select: { id: true, name: true, code: true } }
      }
    })

    console.log('[Market] Post created with city:', post.city?.name || 'Global')

    res.status(201).json({ 
      success: true, 
      data: post,
      message: 'Post submitted for review. It will appear in the market once approved.'
    })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * PUT /api/market/posts/:id/inventory
 * Update inventory quantity for a post (seller only)
 */
app.put('/api/market/posts/:id/inventory', async (req, res) => {
  try {
    const { did, quantity } = req.body
    const postId = req.params.id

    if (!did) {
      return res.status(400).json({ success: false, error: 'DID is required' })
    }

    if (quantity === undefined || quantity < 0) {
      return res.status(400).json({ success: false, error: 'Valid quantity is required (0 or greater)' })
    }

    // Find user and seller
    const user = await prisma.user.findUnique({ where: { did } })
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' })
    }

    const seller = await prisma.marketSeller.findUnique({ where: { userId: user.id } })
    if (!seller) {
      return res.status(403).json({ success: false, error: 'You must be a seller to update inventory' })
    }

    // Find and verify post ownership
    const post = await prisma.marketPost.findUnique({ where: { id: postId } })
    if (!post) {
      return res.status(404).json({ success: false, error: 'Post not found' })
    }

    if (post.sellerId !== seller.id) {
      return res.status(403).json({ success: false, error: 'You can only update inventory for your own posts' })
    }

    const parsedQuantity = parseInt(quantity, 10)
    
    // Build update data
    const updateData = {
      quantity: parsedQuantity,
      isInStock: parsedQuantity > 0
    }
    
    // If restocking and status was SOLD, set it back to ACTIVE
    if (parsedQuantity > 0 && post.status === 'SOLD') {
      updateData.status = 'ACTIVE'
    }
    
    const updatedPost = await prisma.marketPost.update({
      where: { id: postId },
      data: updateData,
      include: {
        category: true,
        subcategory: true
      }
    })

    res.json({ 
      success: true, 
      data: updatedPost,
      message: parsedQuantity > 0 ? 'Inventory updated' : 'Product marked as out of stock'
    })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/market/posts/:id/sold
 * Record a sale (decrement quantity, increment soldCount)
 */
app.post('/api/market/posts/:id/sold', async (req, res) => {
  try {
    const { did, quantitySold = 1 } = req.body
    const postId = req.params.id

    if (!did) {
      return res.status(400).json({ success: false, error: 'DID is required' })
    }

    // Find user and seller
    const user = await prisma.user.findUnique({ where: { did } })
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' })
    }

    const seller = await prisma.marketSeller.findUnique({ where: { userId: user.id } })
    if (!seller) {
      return res.status(403).json({ success: false, error: 'You must be a seller to record sales' })
    }

    // Find and verify post ownership
    const post = await prisma.marketPost.findUnique({ where: { id: postId } })
    if (!post) {
      return res.status(404).json({ success: false, error: 'Post not found' })
    }

    if (post.sellerId !== seller.id) {
      return res.status(403).json({ success: false, error: 'You can only record sales for your own posts' })
    }

    const qty = parseInt(quantitySold, 10) || 1
    const newQuantity = Math.max(0, post.quantity - qty)
    const newSoldCount = post.soldCount + qty

    const updatedPost = await prisma.marketPost.update({
      where: { id: postId },
      data: {
        quantity: newQuantity,
        soldCount: newSoldCount,
        isInStock: newQuantity > 0,
        // Auto-mark as SOLD if quantity reaches 0 and status was ACTIVE
        status: newQuantity === 0 && post.status === 'ACTIVE' ? 'SOLD' : post.status
      },
      include: {
        category: true,
        subcategory: true
      }
    })

    res.json({ 
      success: true, 
      data: updatedPost,
      message: newQuantity > 0 
        ? `Sale recorded. ${newQuantity} remaining.` 
        : 'Sale recorded. Product is now out of stock.'
    })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/market/posts/:id/archive
 * Archive a post (for edits - replaced by new post)
 */
app.post('/api/market/posts/:id/archive', async (req, res) => {
  try {
    const { did, replacedById } = req.body
    const postId = req.params.id

    if (!did) {
      return res.status(400).json({ success: false, error: 'DID is required' })
    }

    // Find user and seller
    const user = await prisma.user.findUnique({ where: { did } })
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' })
    }

    const seller = await prisma.marketSeller.findUnique({ where: { userId: user.id } })
    if (!seller) {
      return res.status(403).json({ success: false, error: 'You must be a seller to archive posts' })
    }

    // Find and verify post ownership
    const post = await prisma.marketPost.findUnique({ where: { id: postId } })
    if (!post) {
      return res.status(404).json({ success: false, error: 'Post not found' })
    }

    if (post.sellerId !== seller.id) {
      return res.status(403).json({ success: false, error: 'You can only archive your own posts' })
    }

    const updatedPost = await prisma.marketPost.update({
      where: { id: postId },
      data: {
        isArchived: true,
        replacedById: replacedById || null,
        status: 'REMOVED'
      }
    })

    res.json({ 
      success: true, 
      data: updatedPost,
      message: 'Post archived successfully'
    })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/market/stats
 * Get market statistics for admin dashboard
 */
app.get('/api/market/stats', async (req, res) => {
  try {
    const [
      totalSellers,
      pendingSellers,
      approvedSellers,
      totalPosts,
      pendingPosts,
      activePosts,
      totalCategories
    ] = await Promise.all([
      prisma.marketSeller.count(),
      prisma.marketSeller.count({ where: { status: 'PENDING' } }),
      prisma.marketSeller.count({ where: { status: 'APPROVED' } }),
      prisma.marketPost.count(),
      prisma.marketPost.count({ where: { status: 'PENDING_REVIEW' } }),
      prisma.marketPost.count({ where: { status: 'ACTIVE' } }),
      prisma.marketCategory.count({ where: { isActive: true } })
    ])

    res.json({
      success: true,
      data: {
        sellers: {
          total: totalSellers,
          pending: pendingSellers,
          approved: approvedSellers
        },
        posts: {
          total: totalPosts,
          pending: pendingPosts,
          active: activePosts
        },
        categories: totalCategories
      }
    })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============================================================================
// Debug Route - Check all market posts
// ============================================================================

app.get('/api/market/debug/posts', async (req, res) => {
  try {
    const allPosts = await prisma.marketPost.findMany({
      include: {
        seller: true,
        category: true
      }
    })
    
    console.log('[Market Debug] All posts:')
    allPosts.forEach(p => {
      console.log(`  - ${p.id}: "${p.title}" status=${p.status} archived=${p.isArchived} inStock=${p.isInStock} qty=${p.quantity}`)
    })
    
    res.json({
      success: true,
      total: allPosts.length,
      posts: allPosts.map(p => ({
        id: p.id,
        title: p.title,
        status: p.status,
        isArchived: p.isArchived,
        isInStock: p.isInStock,
        quantity: p.quantity,
        sellerId: p.sellerId,
        categoryId: p.categoryId
      }))
    })
  } catch (error) {
    console.error('[Market Debug] Error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============================================================================
// CART API ROUTES
// ============================================================================

/**
 * Helper: Get or create cart for user
 */
async function getOrCreateCart(did) {
  // Find or create user first
  let user = await prisma.user.findUnique({ where: { did } })
  if (!user) {
    user = await prisma.user.create({ data: { did } })
  }

  // Find or create cart
  let cart = await prisma.cart.findUnique({
    where: { userId: user.id },
    include: {
      items: {
        include: {
          post: {
            select: {
              id: true,
              postUri: true,
              title: true,
              description: true,
              price: true,
              currency: true,
              quantity: true,
              isInStock: true,
              seller: {
                include: {
                  user: { select: { did: true, handle: true, displayName: true, avatarUrl: true } }
                }
              },
              category: true
            }
          }
        }
      }
    }
  })

  if (!cart) {
    cart = await prisma.cart.create({
      data: { userId: user.id },
      include: {
        items: {
          include: {
            post: {
              select: {
                id: true,
                postUri: true,
                title: true,
                description: true,
                price: true,
                currency: true,
                quantity: true,
                isInStock: true,
                seller: {
                  include: {
                    user: { select: { did: true, handle: true, displayName: true, avatarUrl: true } }
                  }
                },
                category: true
              }
            }
          }
        }
      }
    })
  }

  return cart
}

/**
 * Helper: Get market settings (singleton)
 */
async function getMarketSettings() {
  let settings = await prisma.marketSettings.findUnique({ where: { id: 1 } })
  
  if (!settings) {
    settings = await prisma.marketSettings.create({
      data: {
        id: 1,
        tvaRate: 0.20,
        tvaEnabled: true,
        serviceFeeRate: 0.05,
        serviceFeeMin: 5,
        serviceFeeMax: null,
        serviceFeeEnabled: true,
        defaultCurrency: 'MAD'
      }
    })
  }

  return settings
}

/**
 * GET /api/cart - Get cart with totals
 */
app.get('/api/cart', async (req, res) => {
  try {
    const did = req.query.did
    console.log(`[Cart] GET / did=${did}`)
    
    if (!did) {
      return res.status(400).json({ success: false, error: 'did query parameter required' })
    }

    const cart = await getOrCreateCart(did)
    const settings = await getMarketSettings()

    // Calculate totals
    let subtotal = 0
    let totalShipping = 0
    const itemsWithTotals = cart.items.map(item => {
      const itemTotal = (item.post.price || 0) * item.quantity
      subtotal += itemTotal
      return {
        ...item,
        itemTotal,
        shippingCost: 0
      }
    })

    // Calculate fees
    const serviceFee = settings.serviceFeeEnabled 
      ? Math.max(subtotal * settings.serviceFeeRate, settings.serviceFeeMin)
      : 0

    const tvaAmount = settings.tvaEnabled 
      ? (subtotal + serviceFee) * settings.tvaRate 
      : 0

    const total = subtotal + totalShipping + serviceFee + tvaAmount

    res.json({
      success: true,
      data: {
        cart: {
          ...cart,
          items: itemsWithTotals
        },
        totals: {
          subtotal,
          shipping: totalShipping,
          serviceFee,
          serviceFeeRate: settings.serviceFeeRate,
          tvaAmount,
          tvaRate: settings.tvaRate,
          total,
          currency: settings.defaultCurrency,
          itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0)
        }
      }
    })
  } catch (error) {
    console.error('[Cart] Error fetching cart:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/cart/items - Add item to cart
 */
app.post('/api/cart/items', async (req, res) => {
  try {
    console.log(`[Cart] POST /items`, req.body)
    const { did, postId, quantity = 1 } = req.body

    if (!did || !postId) {
      return res.status(400).json({ success: false, error: 'did and postId are required' })
    }

    const cart = await getOrCreateCart(did)

    // Verify post exists and is active
    const post = await prisma.marketPost.findUnique({
      where: { id: postId }
    })

    if (!post) {
      return res.status(404).json({ success: false, error: 'Product not found' })
    }
    if (post.status !== 'ACTIVE' || post.isArchived) {
      return res.status(400).json({ success: false, error: 'Product is not available' })
    }
    if (!post.isInStock || post.quantity < quantity) {
      return res.status(400).json({ success: false, error: 'Insufficient stock' })
    }

    // Check if item already in cart
    const existingItem = cart.items.find(item => item.postId === postId)

    let result
    if (existingItem) {
      // Update quantity
      const newQuantity = existingItem.quantity + quantity
      if (newQuantity > post.quantity) {
        return res.status(400).json({ success: false, error: 'Insufficient stock' })
      }

      result = await prisma.cartItem.update({
        where: { id: existingItem.id },
        data: { quantity: newQuantity },
        include: {
          post: {
            include: {
              seller: {
                include: {
                  user: { select: { did: true, handle: true, displayName: true, avatarUrl: true } }
                }
              }
            }
          }
        }
      })
    } else {
      // Add new item
      result = await prisma.cartItem.create({
        data: {
          cartId: cart.id,
          postId: postId,
          quantity: quantity,
          priceAtAdd: post.price || 0
        },
        include: {
          post: {
            include: {
              seller: {
                include: {
                  user: { select: { did: true, handle: true, displayName: true, avatarUrl: true } }
                }
              }
            }
          }
        }
      })
    }

    res.json({ success: true, data: result })
  } catch (error) {
    console.error('[Cart] Error adding to cart:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * PUT /api/cart/items/:itemId - Update cart item
 */
app.put('/api/cart/items/:itemId', async (req, res) => {
  try {
    console.log(`[Cart] PUT /items/${req.params.itemId}`, req.body)
    const { did, quantity } = req.body
    const { itemId } = req.params

    if (!did) {
      return res.status(400).json({ success: false, error: 'did is required' })
    }

    const cart = await getOrCreateCart(did)
    const item = cart.items.find(i => i.id === itemId)
    
    if (!item) {
      return res.status(404).json({ success: false, error: 'Cart item not found' })
    }

    if (quantity <= 0) {
      // Remove item
      await prisma.cartItem.delete({ where: { id: itemId } })
      return res.json({ success: true, data: null })
    }

    // Check stock
    const post = await prisma.marketPost.findUnique({ where: { id: item.postId } })
    if (!post || quantity > post.quantity) {
      return res.status(400).json({ success: false, error: 'Insufficient stock' })
    }

    const result = await prisma.cartItem.update({
      where: { id: itemId },
      data: { quantity },
      include: {
        post: {
          include: {
            seller: {
              include: {
                user: { select: { did: true, handle: true, displayName: true, avatarUrl: true } }
              }
            }
          }
        }
      }
    })

    res.json({ success: true, data: result })
  } catch (error) {
    console.error('[Cart] Error updating cart item:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * DELETE /api/cart/items/:itemId - Remove item from cart
 */
app.delete('/api/cart/items/:itemId', async (req, res) => {
  try {
    const did = req.query.did
    const { itemId } = req.params
    console.log(`[Cart] DELETE /items/${itemId} did=${did}`)

    if (!did) {
      return res.status(400).json({ success: false, error: 'did query parameter required' })
    }

    const cart = await getOrCreateCart(did)
    const item = cart.items.find(i => i.id === itemId)
    
    if (!item) {
      return res.status(404).json({ success: false, error: 'Cart item not found' })
    }

    await prisma.cartItem.delete({ where: { id: itemId } })
    res.json({ success: true })
  } catch (error) {
    console.error('[Cart] Error removing from cart:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * DELETE /api/cart - Clear entire cart
 */
app.delete('/api/cart', async (req, res) => {
  try {
    const did = req.query.did
    console.log(`[Cart] DELETE / did=${did}`)

    if (!did) {
      return res.status(400).json({ success: false, error: 'did query parameter required' })
    }

    const cart = await getOrCreateCart(did)
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } })
    
    res.json({ success: true })
  } catch (error) {
    console.error('[Cart] Error clearing cart:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/cart/settings - Get market settings (TVA, service fee)
 */
app.get('/api/cart/settings', async (req, res) => {
  try {
    const settings = await getMarketSettings()
    res.json({
      success: true,
      data: {
        tvaRate: settings.tvaRate,
        tvaEnabled: settings.tvaEnabled,
        serviceFeeRate: settings.serviceFeeRate,
        serviceFeeMin: settings.serviceFeeMin,
        serviceFeeMax: settings.serviceFeeMax,
        serviceFeeEnabled: settings.serviceFeeEnabled,
        defaultCurrency: settings.defaultCurrency,
        updatedAt: settings.updatedAt
      }
    })
  } catch (error) {
    console.error('[Cart] Error fetching settings:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============================================================================
// Market Settings API
// ============================================================================

/**
 * GET /api/settings - Get market settings (tax, service fee config)
 */
app.get('/api/settings', async (req, res) => {
  try {
    console.log('[Settings] GET /')
    const settings = await getMarketSettings()
    res.json({ success: true, data: settings })
  } catch (error) {
    console.error('[Settings] Error fetching settings:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * PUT /api/settings - Update market settings
 */
app.put('/api/settings', async (req, res) => {
  try {
    console.log('[Settings] PUT /', req.body)
    
    const {
      // Tax settings
      tvaRate,
      tvaEnabled,
      // Service fee settings
      serviceFeeRate,
      serviceFeeMin,
      serviceFeeMax,
      serviceFeeEnabled,
      // Currency
      defaultCurrency
    } = req.body

    const updateData = {}

    // Tax settings
    if (tvaRate !== undefined) updateData.tvaRate = parseFloat(tvaRate)
    if (tvaEnabled !== undefined) updateData.tvaEnabled = Boolean(tvaEnabled)
    
    // Service fee settings
    if (serviceFeeRate !== undefined) updateData.serviceFeeRate = parseFloat(serviceFeeRate)
    if (serviceFeeMin !== undefined) updateData.serviceFeeMin = parseFloat(serviceFeeMin)
    if (serviceFeeMax !== undefined) updateData.serviceFeeMax = serviceFeeMax ? parseFloat(serviceFeeMax) : null
    if (serviceFeeEnabled !== undefined) updateData.serviceFeeEnabled = Boolean(serviceFeeEnabled)
    
    // Currency
    if (defaultCurrency !== undefined) updateData.defaultCurrency = defaultCurrency

    const settings = await prisma.marketSettings.upsert({
      where: { id: 1 },
      update: updateData,
      create: {
        id: 1,
        ...updateData
      }
    })

    res.json({ success: true, data: settings })
  } catch (error) {
    console.error('[Settings] Error updating settings:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============================================================================
// CHECKOUT & PAYMENTS (Stripe Integration)
// ============================================================================

// Initialize Stripe (only if secret key is configured)
let stripe = null
if (process.env.STRIPE_SECRET_KEY) {
  const Stripe = require('stripe')
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  console.log('✅ Stripe initialized')
} else {
  console.warn('⚠️ STRIPE_SECRET_KEY not set - payments disabled')
}

/**
 * POST /api/checkout/create-intent
 * Create a Stripe PaymentIntent for checkout
 */
app.post('/api/checkout/create-intent', async (req, res) => {
  try {
    if (!stripe) {
      return res.status(503).json({ 
        success: false, 
        error: 'Payment system not configured' 
      })
    }

    const { did, cartItems, shippingAddress, buyerMessage, currency = 'MAD' } = req.body

    if (!did || !cartItems || cartItems.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid checkout data - DID and cart items required' 
      })
    }

    // Fetch market settings for fees
    const settings = await prisma.marketSettings.findUnique({ where: { id: 1 } })
    const serviceFeeRate = settings?.serviceFeeRate || 0.05

    // Calculate totals and validate items
    let subtotal = 0
    const orderItems = []

    for (const item of cartItems) {
      const marketPost = await prisma.marketPost.findUnique({
        where: { id: item.postId },
        include: { seller: true }
      })

      if (!marketPost) {
        return res.status(400).json({ 
          success: false, 
          error: `Product not found: ${item.postId}` 
        })
      }

      if (marketPost.status !== 'ACTIVE') {
        return res.status(400).json({ 
          success: false, 
          error: `Product not available: ${marketPost.title}` 
        })
      }

      const price = marketPost.price || 0
      const itemTotal = price * item.quantity
      subtotal += itemTotal

      orderItems.push({
        postId: item.postId,
        sellerId: marketPost.sellerId,
        sellerDid: marketPost.seller.did,
        title: marketPost.title,
        price: price,
        quantity: item.quantity,
        total: itemTotal,
      })
    }

    // Calculate fees
    const shippingFee = 0 // Free shipping for now
    const serviceFee = Math.round(subtotal * serviceFeeRate * 100) / 100
    const total = subtotal + shippingFee + serviceFee

    // Create Stripe PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(total * 100), // Stripe uses cents/smallest currency unit
      currency: currency.toLowerCase(),
      metadata: {
        buyerDid: did,
        itemCount: orderItems.length,
        orderItems: JSON.stringify(orderItems.map(i => ({ 
          postId: i.postId, 
          qty: i.quantity,
          sellerId: i.sellerId
        }))),
      },
      automatic_payment_methods: {
        enabled: true,
      },
    })

    // Create pending order in database
    const order = await prisma.marketOrder.create({
      data: {
        buyerDid: did,
        status: 'PENDING_PAYMENT',
        subtotal,
        shippingFee,
        serviceFee,
        total,
        currency,
        shippingAddress: shippingAddress || null,
        buyerMessage: buyerMessage || null,
        stripePaymentIntentId: paymentIntent.id,
        items: {
          create: orderItems.map(item => ({
            marketPostId: item.postId,
            sellerId: item.sellerId,
            title: item.title,
            price: item.price,
            quantity: item.quantity,
            total: item.total,
          }))
        }
      },
      include: { items: true }
    })

    console.log(`[Checkout] Created order ${order.id} with PaymentIntent ${paymentIntent.id}`)

    res.json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      orderId: order.id,
      subtotal,
      shippingFee,
      serviceFee,
      total,
      currency,
    })
  } catch (error) {
    console.error('[Checkout] Create payment intent error:', error)
    res.status(500).json({ success: false, error: 'Failed to create payment' })
  }
})

/**
 * POST /api/checkout/create-order
 * Create an order directly for wallet/COD payments (no Stripe required)
 */
app.post('/api/checkout/create-order', async (req, res) => {
  try {
    const { did, cartItems, shippingAddress, buyerMessage, currency = 'MAD', paymentMethod = 'WALLET' } = req.body

    if (!did || !cartItems || cartItems.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid checkout data - DID and cart items required' 
      })
    }

    // Fetch market settings for fees
    const settings = await prisma.marketSettings.findUnique({ where: { id: 1 } })
    const serviceFeeRate = settings?.serviceFeeRate || 0.05

    // Calculate totals and validate items
    let subtotal = 0
    const orderItems = []

    for (const item of cartItems) {
      const marketPost = await prisma.marketPost.findUnique({
        where: { id: item.postId },
        include: { seller: true }
      })

      if (!marketPost) {
        return res.status(400).json({ 
          success: false, 
          error: `Product not found: ${item.postId}` 
        })
      }

      if (marketPost.status !== 'ACTIVE') {
        return res.status(400).json({ 
          success: false, 
          error: `Product not available: ${marketPost.title}` 
        })
      }

      const price = marketPost.price || 0
      const itemTotal = price * item.quantity
      subtotal += itemTotal

      orderItems.push({
        postId: item.postId,
        sellerId: marketPost.sellerId,
        sellerDid: marketPost.seller.did,
        title: marketPost.title,
        price: price,
        quantity: item.quantity,
        total: itemTotal,
        postUri: marketPost.postUri,
        postCid: marketPost.postCid,
      })
    }

    // Calculate fees
    const shippingFee = 0 // Free shipping for now
    const serviceFee = Math.round(subtotal * serviceFeeRate * 100) / 100
    const total = subtotal + shippingFee + serviceFee

    // Create order in database (no Stripe)
    const order = await prisma.marketOrder.create({
      data: {
        buyerDid: did,
        status: 'PENDING_PAYMENT',
        subtotal,
        shippingFee,
        serviceFee,
        total,
        currency,
        shippingAddress: shippingAddress || null,
        buyerMessage: buyerMessage || null,
        paymentMethod: paymentMethod,
        items: {
          create: orderItems.map(item => ({
            marketPostId: item.postId,
            sellerId: item.sellerId,
            title: item.title,
            price: item.price,
            quantity: item.quantity,
            total: item.total,
            postUri: item.postUri || null,
            postCid: item.postCid || null,
          }))
        }
      },
      include: { items: true }
    })

    console.log(`[Checkout] Created order ${order.id} for ${paymentMethod} payment`)

    res.json({
      success: true,
      orderId: order.id,
      subtotal,
      shippingFee,
      serviceFee,
      total,
      currency,
    })
  } catch (error) {
    console.error('[Checkout] Create order error:', error)
    res.status(500).json({ success: false, error: error.message || 'Failed to create order' })
  }
})

/**
 * POST /api/webhooks/stripe
 * Handle Stripe webhook events (payment success/failure)
 * IMPORTANT: This endpoint needs raw body, must be registered before express.json()
 */
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) {
    return res.status(503).send('Payment system not configured')
  }

  const sig = req.headers['stripe-signature']
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!webhookSecret) {
    console.error('[Stripe Webhook] STRIPE_WEBHOOK_SECRET not configured')
    return res.status(500).send('Webhook secret not configured')
  }

  let event

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret)
  } catch (err) {
    console.error('[Stripe Webhook] Signature verification failed:', err.message)
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }

  // Handle the event
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const paymentIntent = event.data.object
      
      // Update order status
      const order = await prisma.marketOrder.updateMany({
        where: { stripePaymentIntentId: paymentIntent.id },
        data: { 
          status: 'PAID',
          paidAt: new Date(),
        }
      })
      
      console.log(`[Stripe Webhook] Payment succeeded: ${paymentIntent.id}`)
      
      // TODO: Send notification to buyer and seller(s)
      // TODO: Create chat thread between buyer and seller(s)
      break
    }

    case 'payment_intent.payment_failed': {
      const failedPayment = event.data.object
      
      await prisma.marketOrder.updateMany({
        where: { stripePaymentIntentId: failedPayment.id },
        data: { status: 'CANCELLED' }
      })
      
      console.log(`[Stripe Webhook] Payment failed: ${failedPayment.id}`)
      break
    }

    default:
      console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`)
  }

  res.json({ received: true })
})

/**
 * POST /api/checkout/confirm
 * Confirm payment, create escrow holds, and send DMs to sellers
 */
app.post('/api/checkout/confirm', async (req, res) => {
  try {
    const { orderId, paymentIntentId, paymentMethod = 'WALLET' } = req.body

    if (!orderId && !paymentIntentId) {
      return res.status(400).json({ 
        success: false, 
        error: 'orderId or paymentIntentId required' 
      })
    }

    const where = orderId 
      ? { id: orderId }
      : { stripePaymentIntentId: paymentIntentId }

    // Get the order with all relations needed
    const order = await prisma.marketOrder.findFirst({
      where,
      include: { 
        items: {
          include: {
            marketPost: true,
            seller: {
              include: { user: true }
            }
          }
        }
      }
    })

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' })
    }

    // Check if already paid
    if (order.status === 'PAID' || order.status === 'PROCESSING') {
      return res.json({ success: true, data: order, message: 'Order already confirmed' })
    }

    // For WALLET payments, create escrow holds
    if (paymentMethod === 'WALLET') {
      // Get buyer's wallet
      const buyerWallet = await prisma.wallet.findUnique({
        where: { did: order.buyerDid }
      })

      if (!buyerWallet) {
        return res.status(400).json({ success: false, error: 'Buyer wallet not found' })
      }

      if (buyerWallet.balance < order.total) {
        return res.status(400).json({ 
          success: false, 
          error: 'Insufficient wallet balance',
          required: order.total,
          available: buyerWallet.balance
        })
      }

      // Deduct from buyer wallet
      await prisma.wallet.update({
        where: { id: buyerWallet.id },
        data: { balance: { decrement: order.total } }
      })

      // Create wallet transaction for buyer
      await prisma.walletTransaction.create({
        data: {
          walletId: buyerWallet.id,
          type: 'ESCROW',
          amount: -order.total,
          currency: order.currency,
          description: `Order #${order.id.slice(-6).toUpperCase()} - Payment held in escrow`,
          status: 'COMPLETED',
          referenceId: order.id,
        }
      })

      // Group items by seller for escrow creation
      const itemsBySeller = order.items.reduce((acc, item) => {
        if (!acc[item.sellerId]) {
          acc[item.sellerId] = {
            seller: item.seller,
            items: [],
            total: 0,
          }
        }
        acc[item.sellerId].items.push(item)
        acc[item.sellerId].total += item.total
        return acc
      }, {})

      // Get market settings for fee calculation
      const settings = await prisma.marketSettings.findUnique({ where: { id: 1 } })
      const serviceFeeRate = settings?.serviceFeeRate || 0.05

      // Create escrow holds for each seller
      for (const sellerId of Object.keys(itemsBySeller)) {
        const sellerData = itemsBySeller[sellerId]
        const sellerTotal = sellerData.total
        const platformFee = Math.round(sellerTotal * serviceFeeRate * 100) / 100
        const sellerAmount = sellerTotal - platformFee

        // Get or create seller's wallet
        let sellerWallet = await prisma.wallet.findUnique({
          where: { did: sellerData.seller.user.did }
        })

        if (!sellerWallet) {
          sellerWallet = await prisma.wallet.create({
            data: {
              did: sellerData.seller.user.did,
              balance: 0,
              currency: order.currency,
            }
          })
        }

        // Create escrow hold
        const escrowHold = await prisma.escrowHold.create({
          data: {
            buyerWalletId: buyerWallet.id,
            sellerWalletId: sellerWallet.id,
            amount: sellerTotal,
            feeAmount: platformFee,
            sellerAmount: sellerAmount,
            orderId: order.id,
            status: 'HELD',
            releaseAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Auto-release after 7 days
          }
        })

        // Update order items with escrow reference
        await prisma.marketOrderItem.updateMany({
          where: {
            orderId: order.id,
            sellerId: sellerId,
          },
          data: {
            escrowHoldId: escrowHold.id,
            postUri: sellerData.items[0].marketPost.postUri,
            postCid: sellerData.items[0].marketPost.postCid,
          }
        })
      }
    }

    // Update order status to PAID
    const updatedOrder = await prisma.marketOrder.update({
      where: { id: order.id },
      data: { 
        status: 'PAID',
        paidAt: new Date(),
      },
      include: { 
        items: {
          include: {
            marketPost: true,
            seller: {
              include: { user: true }
            }
          }
        },
        conversations: true
      }
    })

    // Note: DMs are now sent from the client app using user's session
    console.log(`[Checkout] Confirmed order ${order.id} via ${paymentMethod}`)

    res.json({ success: true, data: updatedOrder })
  } catch (error) {
    console.error('[Checkout] Confirm error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/orders/:id
 * Get order details
 */
app.get('/api/orders/:id', async (req, res) => {
  try {
    const order = await prisma.marketOrder.findUnique({
      where: { id: req.params.id },
      include: {
        items: {
          include: {
            marketPost: true,
            seller: true,
          }
        }
      }
    })

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' })
    }

    res.json({ success: true, data: order })
  } catch (error) {
    console.error('[Orders] Get order error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/orders
 * Get orders for a user (as buyer or seller)
 */
app.get('/api/orders', async (req, res) => {
  try {
    const { did, role = 'buyer', status, page = 1, pageSize = 20 } = req.query

    if (!did) {
      return res.status(400).json({ success: false, error: 'DID required' })
    }

    let where = {}
    
    if (role === 'seller') {
      // Get orders containing items from this seller
      const seller = await prisma.marketSeller.findUnique({ where: { did } })
      if (seller) {
        where = { items: { some: { sellerId: seller.id } } }
      } else {
        return res.json({ success: true, data: [], total: 0 })
      }
    } else {
      where = { buyerDid: did }
    }

    if (status) {
      where.status = status
    }

    const [orders, total] = await Promise.all([
      prisma.marketOrder.findMany({
        where,
        include: {
          items: {
            include: {
              marketPost: true,
              seller: true,
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(pageSize),
        take: parseInt(pageSize),
      }),
      prisma.marketOrder.count({ where })
    ])

    res.json({ 
      success: true, 
      data: orders,
      total,
      page: parseInt(page),
      pageSize: parseInt(pageSize),
      totalPages: Math.ceil(total / parseInt(pageSize))
    })
  } catch (error) {
    console.error('[Orders] Get orders error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * PUT /api/orders/:id/status
 * Update order status (for sellers to mark shipped, etc.)
 */
app.put('/api/orders/:id/status', async (req, res) => {
  try {
    const { status, sellerDid } = req.body
    const orderId = req.params.id

    const validStatuses = ['PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED']
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ 
        success: false, 
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` 
      })
    }

    const updateData = { status }
    if (status === 'SHIPPED') updateData.shippedAt = new Date()
    if (status === 'DELIVERED') updateData.deliveredAt = new Date()

    const order = await prisma.marketOrder.update({
      where: { id: orderId },
      data: updateData,
      include: { items: true }
    })

    console.log(`[Orders] Updated order ${orderId} status to ${status}`)

    res.json({ success: true, data: order })
  } catch (error) {
    console.error('[Orders] Update status error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * PUT /api/orders/items/:itemId/status
 * Update individual order item status (seller actions)
 */
app.put('/api/orders/items/:itemId/status', async (req, res) => {
  try {
    const { status, did, trackingNumber, estimatedDelivery } = req.body
    const itemId = req.params.itemId

    const validStatuses = ['CONFIRMED', 'PACKAGED', 'SHIPPED', 'DELIVERED', 'CANCELLED']
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ 
        success: false, 
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` 
      })
    }

    // Get the item with order and seller info
    const item = await prisma.marketOrderItem.findUnique({
      where: { id: itemId },
      include: { 
        order: {
          include: { conversations: true }
        },
        seller: {
          include: { user: true }
        },
        marketPost: true
      }
    })

    if (!item) {
      return res.status(404).json({ success: false, error: 'Order item not found' })
    }

    // Verify the requester is the seller
    if (did && did !== item.seller.user.did) {
      return res.status(403).json({ success: false, error: 'Not authorized to update this item' })
    }

    // Build update data
    const updateData = { status }
    if (status === 'CONFIRMED') updateData.confirmedAt = new Date()
    if (status === 'SHIPPED') updateData.shippedAt = new Date()
    if (status === 'DELIVERED') updateData.deliveredAt = new Date()

    // Update the item
    const updatedItem = await prisma.marketOrderItem.update({
      where: { id: itemId },
      data: updateData,
      include: {
        order: true,
        seller: { include: { user: true } }
      }
    })

    // Send status update DM
    const conversation = item.order.conversations.find(c => c.sellerId === item.sellerId)
    if (conversation) {
      sendOrderStatusDM(conversation.conversationId, status, {
        orderId: item.orderId,
        itemTitle: item.title,
        trackingNumber,
        estimatedDelivery,
      }).catch(err => console.error('[Order Status DM] Failed:', err))
    }

    // Check if all items are delivered - if so, update order status
    const allItems = await prisma.marketOrderItem.findMany({
      where: { orderId: item.orderId }
    })
    const allDelivered = allItems.every(i => i.status === 'DELIVERED')
    
    if (allDelivered) {
      await prisma.marketOrder.update({
        where: { id: item.orderId },
        data: { status: 'DELIVERED', deliveredAt: new Date() }
      })
    }

    console.log(`[Orders] Updated item ${itemId} status to ${status}`)

    res.json({ success: true, data: updatedItem })
  } catch (error) {
    console.error('[Orders] Update item status error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/orders/items/:itemId/confirm-delivery
 * Buyer confirms delivery - releases escrow to seller
 */
app.post('/api/orders/items/:itemId/confirm-delivery', async (req, res) => {
  try {
    const { did } = req.body
    const itemId = req.params.itemId

    // Get the item with escrow info
    const item = await prisma.marketOrderItem.findUnique({
      where: { id: itemId },
      include: { 
        order: true,
        seller: { include: { user: true } }
      }
    })

    if (!item) {
      return res.status(404).json({ success: false, error: 'Order item not found' })
    }

    // Verify the requester is the buyer
    if (did !== item.order.buyerDid) {
      return res.status(403).json({ success: false, error: 'Not authorized' })
    }

    // Get the escrow hold
    const escrowHold = await prisma.escrowHold.findFirst({
      where: { 
        orderId: item.orderId,
        status: 'HELD'
      },
      include: {
        sellerWallet: true
      }
    })

    if (escrowHold) {
      // Release escrow to seller
      await prisma.$transaction([
        // Update seller wallet balance
        prisma.wallet.update({
          where: { id: escrowHold.sellerWalletId },
          data: { balance: { increment: escrowHold.sellerAmount } }
        }),
        // Mark escrow as released
        prisma.escrowHold.update({
          where: { id: escrowHold.id },
          data: { 
            status: 'RELEASED',
            releasedAt: new Date()
          }
        }),
        // Create transaction record for seller
        prisma.walletTransaction.create({
          data: {
            walletId: escrowHold.sellerWalletId,
            type: 'SALE',
            amount: escrowHold.sellerAmount,
            currency: item.order.currency,
            description: `Sale - Order #${item.orderId.slice(-6).toUpperCase()}`,
            status: 'COMPLETED',
            referenceId: item.orderId,
          }
        })
      ])
    }

    // Update item status to delivered
    await prisma.marketOrderItem.update({
      where: { id: itemId },
      data: { 
        status: 'DELIVERED',
        deliveredAt: new Date()
      }
    })

    console.log(`[Orders] Delivery confirmed for item ${itemId}, escrow released`)

    res.json({ success: true, message: 'Delivery confirmed, payment released to seller' })
  } catch (error) {
    console.error('[Orders] Confirm delivery error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/orders/items/:itemId/dispute
 * Open a dispute for an order item
 */
app.post('/api/orders/items/:itemId/dispute', async (req, res) => {
  try {
    const { did, reason, description, evidence } = req.body
    const itemId = req.params.itemId

    // Get the item with order info
    const item = await prisma.marketOrderItem.findUnique({
      where: { id: itemId },
      include: { 
        order: true,
        seller: { include: { user: true } }
      }
    })

    if (!item) {
      return res.status(404).json({ success: false, error: 'Order item not found' })
    }

    // Determine initiator type
    const isBuyer = did === item.order.buyerDid
    const isSeller = did === item.seller.user.did
    
    if (!isBuyer && !isSeller) {
      return res.status(403).json({ success: false, error: 'Not authorized to dispute this order' })
    }

    // Create dispute
    const dispute = await prisma.marketOrderDispute.create({
      data: {
        orderItemId: itemId,
        initiatorDid: did,
        initiatorType: isBuyer ? 'BUYER' : 'SELLER',
        reason: reason,
        description: description,
        evidence: evidence || null,
        status: 'OPEN'
      }
    })

    // Update item status to disputed
    await prisma.marketOrderItem.update({
      where: { id: itemId },
      data: { status: 'DISPUTED' }
    })

    // Update escrow status if exists
    if (item.escrowHoldId) {
      await prisma.escrowHold.update({
        where: { id: item.escrowHoldId },
        data: { 
          status: 'DISPUTED',
          disputeReason: reason,
          disputedAt: new Date()
        }
      })
    }

    // Send dispute notification DM
    const conversation = await prisma.marketOrderConversation.findFirst({
      where: { orderId: item.orderId, sellerId: item.sellerId }
    })
    if (conversation) {
      sendOrderStatusDM(conversation.conversationId, 'DISPUTED', {
        orderId: item.orderId,
        itemTitle: item.title,
        reason: description || reason,
      }).catch(err => console.error('[Dispute DM] Failed:', err))
    }

    console.log(`[Orders] Dispute opened for item ${itemId} by ${isBuyer ? 'buyer' : 'seller'}`)

    res.json({ success: true, data: dispute })
  } catch (error) {
    console.error('[Orders] Open dispute error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/orders/active/:conversationId
 * Get active orders for a specific buyer-seller conversation
 */
app.get('/api/orders/active/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params

    const conversations = await prisma.marketOrderConversation.findMany({
      where: { conversationId },
      include: {
        order: {
          include: {
            items: {
              include: {
                marketPost: true,
                seller: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    // Filter to active orders only (not delivered, cancelled, or refunded)
    const activeOrders = conversations
      .map(c => c.order)
      .filter(order => !['DELIVERED', 'CANCELLED', 'REFUNDED'].includes(order.status))

    res.json({ success: true, data: activeOrders })
  } catch (error) {
    console.error('[Orders] Get active orders error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * Helper function to send order status update DMs
 */
async function sendOrderStatusDM(conversationId, status, data) {
  try {
    if (!process.env.BSKY_SERVICE_IDENTIFIER || !process.env.BSKY_SERVICE_PASSWORD) {
      return
    }

    const { BlueskyMessaging } = await import('@social-app/core/bluesky/messaging.js')
    const messaging = new BlueskyMessaging(
      process.env.BSKY_SERVICE_IDENTIFIER,
      process.env.BSKY_SERVICE_PASSWORD
    )
    await messaging.initialize()
    
    await messaging.sendOrderStatusUpdate(conversationId, status, data)
  } catch (error) {
    console.error('[Order Status DM] Error:', error)
  }
}

/**
 * GET /api/orders/buyer/:did
 * Get all orders for a buyer
 */
app.get('/api/orders/buyer/:did', async (req, res) => {
  try {
    const { did } = req.params
    const { status, page = 1, limit = 20 } = req.query

    console.log(`[Orders] GET buyer orders for DID: ${did.substring(0, 25)}...`)

    const where = { buyerDid: did }
    if (status) where.status = status

    const [orders, total] = await Promise.all([
      prisma.marketOrder.findMany({
        where,
        include: {
          items: {
            include: {
              marketPost: true,
              seller: {
                include: { user: { select: { did: true, handle: true, displayName: true, avatarUrl: true } } }
              }
            }
          },
          conversations: true
        },
        orderBy: { createdAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit)
      }),
      prisma.marketOrder.count({ where })
    ])

    console.log(`[Orders] Found ${orders.length} orders for buyer (total: ${total})`)

    res.json({ 
      success: true, 
      data: orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    })
  } catch (error) {
    console.error('[Orders] Get buyer orders error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/orders/seller/:did
 * Get all orders for a seller (items sold by this seller)
 */
app.get('/api/orders/seller/:did', async (req, res) => {
  try {
    const { did } = req.params
    const { status, page = 1, limit = 20 } = req.query

    // Get seller by DID
    const seller = await prisma.marketSeller.findFirst({
      where: { user: { did } }
    })

    if (!seller) {
      return res.json({ success: true, data: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } })
    }

    // Get order items for this seller
    const itemWhere = { sellerId: seller.id }
    if (status) itemWhere.status = status

    const [items, total] = await Promise.all([
      prisma.marketOrderItem.findMany({
        where: itemWhere,
        include: {
          order: {
            select: {
              id: true,
              buyerDid: true,
              status: true,
              paymentMethod: true,
              currency: true,
              createdAt: true,
              shippingAddress: true
            }
          },
          marketPost: true,
          escrowHold: {
            select: { id: true, status: true, sellerAmount: true, releasedAt: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit)
      }),
      prisma.marketOrderItem.count({ where: itemWhere })
    ])

    // Group items by order for easier display
    const orderMap = new Map()
    for (const item of items) {
      const orderId = item.orderId
      if (!orderMap.has(orderId)) {
        orderMap.set(orderId, {
          orderId,
          order: item.order,
          items: []
        })
      }
      orderMap.get(orderId).items.push({
        id: item.id,
        title: item.title,
        price: item.price,
        quantity: item.quantity,
        status: item.status,
        postUri: item.postUri,
        escrow: item.escrowHold,
        confirmedAt: item.confirmedAt,
        shippedAt: item.shippedAt,
        deliveredAt: item.deliveredAt,
        createdAt: item.createdAt
      })
    }

    res.json({ 
      success: true, 
      data: Array.from(orderMap.values()),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    })
  } catch (error) {
    console.error('[Orders] Get seller orders error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/orders/disputes
 * Get all disputes (admin)
 */
app.get('/api/orders/disputes', async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query

    const where = {}
    if (status) where.status = status

    const [disputes, total] = await Promise.all([
      prisma.marketOrderDispute.findMany({
        where,
        include: {
          orderItem: {
            include: {
              order: true,
              seller: {
                include: { user: { select: { did: true, handle: true, displayName: true } } }
              },
              escrowHold: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit)
      }),
      prisma.marketOrderDispute.count({ where })
    ])

    res.json({ 
      success: true, 
      data: disputes,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    })
  } catch (error) {
    console.error('[Orders] Get disputes error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * PUT /api/orders/disputes/:id/resolve
 * Resolve a dispute (admin)
 */
app.put('/api/orders/disputes/:id/resolve', async (req, res) => {
  try {
    const { resolution, notes, winnerType } = req.body
    const disputeId = req.params.id

    const dispute = await prisma.marketOrderDispute.findUnique({
      where: { id: disputeId },
      include: {
        orderItem: {
          include: {
            order: true,
            seller: { include: { user: true } },
            escrowHold: true
          }
        }
      }
    })

    if (!dispute) {
      return res.status(404).json({ success: false, error: 'Dispute not found' })
    }

    // Update dispute
    const updatedDispute = await prisma.marketOrderDispute.update({
      where: { id: disputeId },
      data: {
        status: 'RESOLVED',
        resolution,
        resolverNotes: notes,
        resolvedAt: new Date()
      }
    })

    // Handle escrow based on resolution
    const escrow = dispute.orderItem.escrowHold
    if (escrow && escrow.status === 'DISPUTED') {
      if (resolution === 'BUYER_WIN' || resolution === 'FULL_REFUND') {
        // Refund buyer
        const buyerWallet = await prisma.wallet.findFirst({
          where: { userDid: dispute.orderItem.order.buyerDid }
        })
        if (buyerWallet) {
          await prisma.$transaction([
            prisma.wallet.update({
              where: { id: buyerWallet.id },
              data: { balance: { increment: escrow.buyerAmount } }
            }),
            prisma.escrowHold.update({
              where: { id: escrow.id },
              data: { status: 'REFUNDED', releasedAt: new Date() }
            }),
            prisma.walletTransaction.create({
              data: {
                walletId: buyerWallet.id,
                type: 'REFUND',
                amount: escrow.buyerAmount,
                currency: dispute.orderItem.order.currency,
                description: `Dispute refund - Order #${dispute.orderItem.orderId.slice(-6).toUpperCase()}`,
                status: 'COMPLETED',
                referenceId: disputeId
              }
            })
          ])
        }
      } else if (resolution === 'SELLER_WIN') {
        // Release to seller
        await prisma.$transaction([
          prisma.wallet.update({
            where: { id: escrow.sellerWalletId },
            data: { balance: { increment: escrow.sellerAmount } }
          }),
          prisma.escrowHold.update({
            where: { id: escrow.id },
            data: { status: 'RELEASED', releasedAt: new Date() }
          }),
          prisma.walletTransaction.create({
            data: {
              walletId: escrow.sellerWalletId,
              type: 'SALE',
              amount: escrow.sellerAmount,
              currency: dispute.orderItem.order.currency,
              description: `Dispute resolved - Order #${dispute.orderItem.orderId.slice(-6).toUpperCase()}`,
              status: 'COMPLETED',
              referenceId: disputeId
            }
          })
        ])
      } else if (resolution === 'PARTIAL_REFUND') {
        // Split - refund partial to buyer, rest to seller
        const buyerRefund = Math.floor(escrow.buyerAmount * 0.5)
        const sellerPayout = escrow.sellerAmount - Math.floor(escrow.sellerAmount * 0.5)
        
        const buyerWallet = await prisma.wallet.findFirst({
          where: { userDid: dispute.orderItem.order.buyerDid }
        })
        
        if (buyerWallet) {
          await prisma.$transaction([
            prisma.wallet.update({
              where: { id: buyerWallet.id },
              data: { balance: { increment: buyerRefund } }
            }),
            prisma.wallet.update({
              where: { id: escrow.sellerWalletId },
              data: { balance: { increment: sellerPayout } }
            }),
            prisma.escrowHold.update({
              where: { id: escrow.id },
              data: { status: 'RELEASED', releasedAt: new Date() }
            }),
            prisma.walletTransaction.create({
              data: {
                walletId: buyerWallet.id,
                type: 'REFUND',
                amount: buyerRefund,
                currency: dispute.orderItem.order.currency,
                description: `Partial dispute refund - Order #${dispute.orderItem.orderId.slice(-6).toUpperCase()}`,
                status: 'COMPLETED',
                referenceId: disputeId
              }
            }),
            prisma.walletTransaction.create({
              data: {
                walletId: escrow.sellerWalletId,
                type: 'SALE',
                amount: sellerPayout,
                currency: dispute.orderItem.order.currency,
                description: `Partial dispute release - Order #${dispute.orderItem.orderId.slice(-6).toUpperCase()}`,
                status: 'COMPLETED',
                referenceId: disputeId
              }
            })
          ])
        }
      }
    }

    console.log(`[Disputes] Resolved dispute ${disputeId} with resolution: ${resolution}`)

    res.json({ success: true, data: updatedDispute })
  } catch (error) {
    console.error('[Orders] Resolve dispute error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============================================================================
// Wallet Admin API Routes
// ============================================================================

/**
 * GET /api/admin/wallet/stats
 * Get wallet system stats
 */
app.get('/api/admin/wallet/stats', async (req, res) => {
  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    const [
      totalWallets,
      totalBalanceResult,
      todayDeposits,
      todayWithdrawals,
      todayFees,
      pendingEscrow,
      totalCashPoints,
      activeCashPoints,
      verifiedCashPoints,
      totalAgents,
      todayTransactions,
      todayNewWallets,
      activeEscrows,
      disputedEscrows
    ] = await Promise.all([
      prisma.wallet.count(),
      prisma.wallet.aggregate({ _sum: { balance: true } }),
      prisma.walletTransaction.aggregate({
        where: {
          type: { in: ['DEPOSIT_CASH', 'DEPOSIT_CARD', 'DEPOSIT_BANK'] },
          status: 'COMPLETED',
          createdAt: { gte: today }
        },
        _sum: { amount: true }
      }),
      prisma.walletTransaction.aggregate({
        where: {
          type: { in: ['WITHDRAWAL_CASH', 'WITHDRAWAL_BANK'] },
          status: 'COMPLETED',
          createdAt: { gte: today }
        },
        _sum: { amount: true }
      }),
      prisma.walletTransaction.aggregate({
        where: {
          type: { in: ['FEE_PLATFORM'] },
          createdAt: { gte: today }
        },
        _sum: { amount: true }
      }),
      prisma.escrowHold.aggregate({
        where: { status: 'HELD' },
        _sum: { amount: true }
      }),
      prisma.cashPoint.count(),
      prisma.cashPoint.count({ where: { isActive: true } }),
      prisma.cashPoint.count({ where: { isVerified: true } }),
      prisma.cashPointAgent.count(),
      prisma.walletTransaction.count({ where: { createdAt: { gte: today } } }),
      prisma.wallet.count({ where: { createdAt: { gte: today } } }),
      prisma.escrowHold.count({ where: { status: 'HELD' } }),
      prisma.escrowHold.count({ where: { status: 'DISPUTED' } })
    ])
    
    res.json({
      success: true,
      data: {
        totalWallets,
        totalBalance: totalBalanceResult._sum.balance || 0,
        todayDeposits: todayDeposits._sum.amount || 0,
        todayWithdrawals: Math.abs(todayWithdrawals._sum.amount || 0),
        todayFees: todayFees._sum.amount || 0,
        pendingEscrow: pendingEscrow._sum.amount || 0,
        totalCashPoints,
        activeCashPoints,
        verifiedCashPoints,
        totalAgents,
        todayTransactions,
        todayNewWallets,
        activeEscrows,
        disputedEscrows
      }
    })
  } catch (error) {
    console.error('[Admin Wallet] Stats error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/admin/wallet/users
 * Search users for top-up
 */
app.get('/api/admin/wallet/users', async (req, res) => {
  try {
    const { search } = req.query
    
    if (!search || search.length < 2) {
      return res.json({ success: true, data: [] })
    }
    
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { handle: { contains: search, mode: 'insensitive' } },
          { displayName: { contains: search, mode: 'insensitive' } },
          { did: { contains: search } }
        ]
      },
      take: 20
    })
    
    // Get wallets for these users separately
    const userDids = users.map(u => u.did)
    const wallets = await prisma.wallet.findMany({
      where: { userDid: { in: userDids } },
      select: { userDid: true, balance: true, pendingBalance: true }
    })
    
    // Merge wallet info with users
    const walletsMap = new Map(wallets.map(w => [w.userDid, w]))
    const usersWithWallets = users.map(user => {
      const wallet = walletsMap.get(user.did)
      return {
        ...user,
        wallet: wallet ? { available: wallet.balance, pending: wallet.pendingBalance } : null
      }
    })
    
    res.json({ success: true, data: usersWithWallets })
  } catch (error) {
    console.error('[Admin Wallet] Search users error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/admin/wallet/top-up
 * Admin top-up a user's wallet
 */
app.post('/api/admin/wallet/top-up', async (req, res) => {
  try {
    const { userDid, amount, reason, adminNote } = req.body
    
    if (!userDid || !amount) {
      return res.status(400).json({ success: false, error: 'User DID and amount are required' })
    }
    
    if (amount <= 0) {
      return res.status(400).json({ success: false, error: 'Amount must be positive' })
    }
    
    // Find or create wallet
    let wallet = await prisma.wallet.findUnique({ where: { userDid } })
    
    if (!wallet) {
      wallet = await prisma.wallet.create({
        data: {
          userDid,
          balance: 0,
          pendingBalance: 0,
          currency: 'MAD'
        }
      })
    }
    
    // Create transaction and update wallet balance
    const result = await prisma.$transaction(async (tx) => {
      const transaction = await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'DEPOSIT_CASH',
          status: 'COMPLETED',
          amount,
          fee: 0,
          netAmount: amount,
          description: reason || 'Admin top-up',
          metadata: {
            adminTopUp: true,
            adminNote: adminNote || '',
            topUpDate: new Date().toISOString()
          }
        }
      })
      
      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: { increment: amount },
          lifetimeEarned: { increment: amount }
        }
      })
      
      return { transaction, wallet: updatedWallet }
    })
    
    console.log(`[Admin Wallet] Top-up successful: ${amount} MAD to user ${userDid}`)
    res.json({ success: true, data: result, message: `Successfully added ${amount} MAD to wallet` })
  } catch (error) {
    console.error('[Admin Wallet] Top-up error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/admin/wallet/deduct
 * Admin deduct from a user's wallet
 */
app.post('/api/admin/wallet/deduct', async (req, res) => {
  try {
    const { userDid, amount, reason, adminNote } = req.body
    
    if (!userDid || !amount) {
      return res.status(400).json({ success: false, error: 'User DID and amount are required' })
    }
    
    if (amount <= 0) {
      return res.status(400).json({ success: false, error: 'Amount must be positive' })
    }
    
    const wallet = await prisma.wallet.findUnique({ where: { userDid } })
    
    if (!wallet) {
      return res.status(404).json({ success: false, error: 'User wallet not found' })
    }
    
    if (wallet.balance < amount) {
      return res.status(400).json({ success: false, error: 'Insufficient balance for deduction' })
    }
    
    const result = await prisma.$transaction(async (tx) => {
      const transaction = await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'WITHDRAWAL_CASH',
          status: 'COMPLETED',
          amount: -amount,
          fee: 0,
          netAmount: -amount,
          description: reason || 'Admin deduction',
          metadata: {
            adminDeduction: true,
            adminNote: adminNote || '',
            deductionDate: new Date().toISOString()
          }
        }
      })
      
      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: { decrement: amount },
          lifetimeSpent: { increment: amount }
        }
      })
      
      return { transaction, wallet: updatedWallet }
    })
    
    console.log(`[Admin Wallet] Deduction successful: ${amount} MAD from user ${userDid}`)
    res.json({ success: true, data: result, message: `Successfully deducted ${amount} MAD from wallet` })
  } catch (error) {
    console.error('[Admin Wallet] Deduction error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/admin/wallet/transactions
 * List all transactions with filters
 */
app.get('/api/admin/wallet/transactions', async (req, res) => {
  try {
    const { type, status, userDid, page = '1', limit = '20' } = req.query
    
    const where = {}
    if (type) where.type = type
    if (status) where.status = status
    if (userDid) where.wallet = { userDid: userDid }
    
    const pageNum = parseInt(page)
    const limitNum = parseInt(limit)
    const skip = (pageNum - 1) * limitNum
    
    const [transactions, total] = await Promise.all([
      prisma.walletTransaction.findMany({
        where,
        include: {
          wallet: { select: { userDid: true } },
          cashPoint: { select: { name: true, type: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: limitNum,
        skip
      }),
      prisma.walletTransaction.count({ where })
    ])
    
    res.json({
      success: true,
      data: transactions,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    })
  } catch (error) {
    console.error('[Admin Wallet] List transactions error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/admin/wallet/fees
 * List all fee configurations
 */
app.get('/api/admin/wallet/fees', async (req, res) => {
  try {
    const { cityId, isActive } = req.query
    
    const fees = await prisma.walletFeeConfig.findMany({
      where: {
        ...(cityId ? { cityId } : {}),
        ...(isActive !== undefined ? { isActive: isActive === 'true' } : {})
      },
      include: {
        city: { select: { id: true, name: true, code: true } }
      },
      orderBy: { code: 'asc' }
    })
    
    res.json({ success: true, data: fees })
  } catch (error) {
    console.error('[Admin Wallet] List fees error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/admin/wallet/fees
 * Create a fee configuration
 */
app.post('/api/admin/wallet/fees', async (req, res) => {
  try {
    const { name, code, description, type, value, minAmount, maxAmount, tiers, appliesTo, cityId, isActive } = req.body
    
    if (!name || !code || !type || value === undefined) {
      return res.status(400).json({ success: false, error: 'Missing required fields' })
    }
    
    const fee = await prisma.walletFeeConfig.create({
      data: {
        name,
        code,
        description,
        type,
        value,
        minAmount,
        maxAmount,
        tiers,
        appliesTo: appliesTo || [],
        cityId: cityId || null,
        isActive: isActive !== false
      }
    })
    
    res.json({ success: true, data: fee })
  } catch (error) {
    console.error('[Admin Wallet] Create fee error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * PUT /api/admin/wallet/fees/:id
 * Update a fee configuration
 */
app.put('/api/admin/wallet/fees/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { name, description, type, value, minAmount, maxAmount, tiers, appliesTo, isActive } = req.body
    
    const fee = await prisma.walletFeeConfig.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(type && { type }),
        ...(value !== undefined && { value }),
        ...(minAmount !== undefined && { minAmount }),
        ...(maxAmount !== undefined && { maxAmount }),
        ...(tiers !== undefined && { tiers }),
        ...(appliesTo && { appliesTo }),
        ...(isActive !== undefined && { isActive })
      }
    })
    
    res.json({ success: true, data: fee })
  } catch (error) {
    console.error('[Admin Wallet] Update fee error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * DELETE /api/admin/wallet/fees/:id
 * Delete a fee configuration
 */
app.delete('/api/admin/wallet/fees/:id', async (req, res) => {
  try {
    const { id } = req.params
    await prisma.walletFeeConfig.delete({ where: { id } })
    res.json({ success: true })
  } catch (error) {
    console.error('[Admin Wallet] Delete fee error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/admin/wallet/config
 * List all wallet configs
 */
app.get('/api/admin/wallet/config', async (req, res) => {
  try {
    const { cityId } = req.query
    
    const configs = await prisma.walletConfig.findMany({
      where: cityId ? { cityId } : {},
      include: {
        city: { select: { id: true, name: true, code: true } }
      },
      orderBy: { key: 'asc' }
    })
    
    res.json({ success: true, data: configs })
  } catch (error) {
    console.error('[Admin Wallet] List configs error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * PUT /api/admin/wallet/config
 * Set a wallet config value (upsert)
 */
app.put('/api/admin/wallet/config', async (req, res) => {
  try {
    const { key, value, description, cityId, isActive } = req.body
    
    if (!key || value === undefined) {
      return res.status(400).json({ success: false, error: 'Key and value required' })
    }
    
    // Check if config exists
    const existing = await prisma.walletConfig.findFirst({ where: { key } })
    
    let config
    if (existing) {
      config = await prisma.walletConfig.update({
        where: { id: existing.id },
        data: {
          value: String(value),
          ...(description && { description }),
          ...(isActive !== undefined && { isActive })
        }
      })
    } else {
      config = await prisma.walletConfig.create({
        data: {
          key,
          value: String(value),
          description,
          cityId: cityId || null,
          isActive: isActive !== false
        }
      })
    }
    
    res.json({ success: true, data: config })
  } catch (error) {
    console.error('[Admin Wallet] Set config error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/admin/wallet/cash-points
 * List all cash points
 */
app.get('/api/admin/wallet/cash-points', async (req, res) => {
  try {
    const { cityId, type, isActive, isVerified } = req.query
    
    const cashPoints = await prisma.cashPoint.findMany({
      where: {
        ...(cityId ? { cityId } : {}),
        ...(type ? { type } : {}),
        ...(isActive !== undefined ? { isActive: isActive === 'true' } : {}),
        ...(isVerified !== undefined ? { isVerified: isVerified === 'true' } : {})
      },
      include: {
        city: { select: { id: true, name: true, code: true } },
        agent: { select: { id: true, name: true, phone: true } }
      },
      orderBy: { createdAt: 'desc' }
    })
    
    res.json({ success: true, data: cashPoints })
  } catch (error) {
    console.error('[Admin Wallet] List cash points error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/admin/wallet/cash-points
 * Create a cash point
 */
app.post('/api/admin/wallet/cash-points', async (req, res) => {
  try {
    const { 
      name, nameAr, type, cityId, address, addressAr, 
      latitude, longitude, operatingHours, phone,
      dailyDepositLimit, dailyWithdrawalLimit, agentId,
      isActive, isVerified
    } = req.body
    
    if (!name || !type) {
      return res.status(400).json({ success: false, error: 'Name and type required' })
    }
    
    if (!cityId) {
      return res.status(400).json({ success: false, error: 'City is required for cash points' })
    }
    
    // Verify city exists
    const city = await prisma.city.findUnique({ where: { id: cityId } })
    if (!city) {
      return res.status(400).json({ success: false, error: 'City not found' })
    }
    
    const cashPoint = await prisma.cashPoint.create({
      data: {
        name,
        nameAr,
        type,
        city: { connect: { id: cityId } },
        address,
        addressAr,
        latitude: latitude || 0,
        longitude: longitude || 0,
        operatingHours,
        phone,
        dailyDepositLimit: dailyDepositLimit || 50000,
        dailyWithdrawalLimit: dailyWithdrawalLimit || 20000,
        agentId: agentId || null,
        isActive: isActive !== false,
        isVerified: isVerified === true
      },
      include: {
        city: { select: { id: true, name: true, code: true } },
        agent: { select: { id: true, name: true, phone: true } }
      }
    })
    
    res.json({ success: true, data: cashPoint })
  } catch (error) {
    console.error('[Admin Wallet] Create cash point error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * PUT /api/admin/wallet/cash-points/:id
 * Update a cash point
 */
app.put('/api/admin/wallet/cash-points/:id', async (req, res) => {
  try {
    const { id } = req.params
    const updates = req.body
    
    const cashPoint = await prisma.cashPoint.update({
      where: { id },
      data: updates
    })
    
    res.json({ success: true, data: cashPoint })
  } catch (error) {
    console.error('[Admin Wallet] Update cash point error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * DELETE /api/admin/wallet/cash-points/:id
 * Delete a cash point
 */
app.delete('/api/admin/wallet/cash-points/:id', async (req, res) => {
  try {
    const { id } = req.params
    await prisma.cashPoint.delete({ where: { id } })
    res.json({ success: true })
  } catch (error) {
    console.error('[Admin Wallet] Delete cash point error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/admin/wallet/agents
 * List all agents
 */
app.get('/api/admin/wallet/agents', async (req, res) => {
  try {
    const { isActive, isVerified } = req.query
    
    const agents = await prisma.cashPointAgent.findMany({
      where: {
        ...(isActive !== undefined ? { isActive: isActive === 'true' } : {}),
        ...(isVerified !== undefined ? { isVerified: isVerified === 'true' } : {})
      },
      include: {
        _count: { select: { cashPoints: true } }
      },
      orderBy: { createdAt: 'desc' }
    })
    
    res.json({ success: true, data: agents })
  } catch (error) {
    console.error('[Admin Wallet] List agents error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/admin/wallet/agents
 * Create an agent
 */
app.post('/api/admin/wallet/agents', async (req, res) => {
  try {
    const { userDid, name, phone, email, nationalId, commissionRate, isVerified, isActive } = req.body
    
    if (!name) {
      return res.status(400).json({ success: false, error: 'Name required' })
    }
    
    const agent = await prisma.cashPointAgent.create({
      data: {
        userDid,
        name,
        phone,
        email,
        nationalId,
        commissionRate: commissionRate || 0.01,
        isVerified: isVerified === true,
        isActive: isActive !== false
      }
    })
    
    res.json({ success: true, data: agent })
  } catch (error) {
    console.error('[Admin Wallet] Create agent error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * PUT /api/admin/wallet/agents/:id
 * Update an agent
 */
app.put('/api/admin/wallet/agents/:id', async (req, res) => {
  try {
    const { id } = req.params
    const updates = req.body
    
    const agent = await prisma.cashPointAgent.update({
      where: { id },
      data: updates
    })
    
    res.json({ success: true, data: agent })
  } catch (error) {
    console.error('[Admin Wallet] Update agent error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/admin/wallet/escrow
 * List all escrow holds
 */
app.get('/api/admin/wallet/escrow', async (req, res) => {
  try {
    const { status, page = '1', limit = '20' } = req.query
    
    const pageNum = parseInt(page)
    const limitNum = parseInt(limit)
    const skip = (pageNum - 1) * limitNum
    
    const where = status ? { status } : {}
    
    const [escrows, total] = await Promise.all([
      prisma.escrowHold.findMany({
        where,
        include: {
          buyerWallet: { select: { userDid: true } },
          sellerWallet: { select: { userDid: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: limitNum,
        skip
      }),
      prisma.escrowHold.count({ where })
    ])
    
    res.json({
      success: true,
      data: escrows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    })
  } catch (error) {
    console.error('[Admin Wallet] List escrow error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/admin/wallet/escrow/:id/release
 * Admin force release escrow to seller
 */
app.post('/api/admin/wallet/escrow/:id/release', async (req, res) => {
  try {
    const { id } = req.params
    
    const escrow = await prisma.escrowHold.findUnique({
      where: { id },
      include: { sellerWallet: true }
    })
    
    if (!escrow) {
      return res.status(404).json({ success: false, error: 'Escrow not found' })
    }
    
    if (escrow.status !== 'HELD') {
      return res.status(400).json({ success: false, error: 'Escrow not in HELD status' })
    }
    
    // Release to seller
    await prisma.$transaction([
      // Update escrow
      prisma.escrowHold.update({
        where: { id },
        data: {
          status: 'RELEASED',
          releasedAt: new Date()
        }
      }),
      // Credit seller wallet
      prisma.wallet.update({
        where: { id: escrow.sellerWalletId },
        data: {
          balance: { increment: escrow.sellerAmount },
          lifetimeEarned: { increment: escrow.sellerAmount }
        }
      }),
      // Create transaction record
      prisma.walletTransaction.create({
        data: {
          walletId: escrow.sellerWalletId,
          type: 'ESCROW_RELEASE',
          amount: escrow.sellerAmount,
          netAmount: escrow.sellerAmount,
          status: 'COMPLETED',
          referenceId: escrow.id,
          referenceType: 'ESCROW',
          description: 'Admin released escrow'
        }
      })
    ])
    
    res.json({ success: true, message: 'Escrow released to seller' })
  } catch (error) {
    console.error('[Admin Wallet] Release escrow error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/admin/wallet/escrow/:id/refund
 * Admin force refund escrow to buyer
 */
app.post('/api/admin/wallet/escrow/:id/refund', async (req, res) => {
  try {
    const { id } = req.params
    const { reason } = req.body
    
    const escrow = await prisma.escrowHold.findUnique({
      where: { id },
      include: { buyerWallet: true }
    })
    
    if (!escrow) {
      return res.status(404).json({ success: false, error: 'Escrow not found' })
    }
    
    if (escrow.status !== 'HELD' && escrow.status !== 'DISPUTED') {
      return res.status(400).json({ success: false, error: 'Escrow cannot be refunded' })
    }
    
    // Refund to buyer
    await prisma.$transaction([
      // Update escrow
      prisma.escrowHold.update({
        where: { id },
        data: {
          status: 'REFUNDED',
          resolution: reason || 'Admin refund'
        }
      }),
      // Credit buyer wallet
      prisma.wallet.update({
        where: { id: escrow.buyerWalletId },
        data: {
          balance: { increment: escrow.amount }
        }
      }),
      // Create transaction record
      prisma.walletTransaction.create({
        data: {
          walletId: escrow.buyerWalletId,
          type: 'REFUND',
          amount: escrow.amount,
          netAmount: escrow.amount,
          status: 'COMPLETED',
          referenceId: escrow.id,
          referenceType: 'ESCROW',
          description: reason || 'Admin refund'
        }
      })
    ])
    
    res.json({ success: true, message: 'Escrow refunded to buyer' })
  } catch (error) {
    console.error('[Admin Wallet] Refund escrow error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/admin/wallet/seed
 * Seed default fee configurations and wallet settings
 */
app.post('/api/admin/wallet/seed', async (req, res) => {
  try {
    const defaultFees = [
      { code: 'platform_fee_market', name: 'Market Platform Fee', type: 'PERCENTAGE', value: 8, appliesTo: ['MARKET'] },
      { code: 'platform_fee_ride', name: 'Ride Platform Fee', type: 'PERCENTAGE', value: 5, appliesTo: ['RIDE'] },
      { code: 'deposit_fee_cash', name: 'Cash Deposit Fee', type: 'FIXED', value: 0, appliesTo: ['DEPOSIT'] },
      { code: 'deposit_fee_card', name: 'Card Deposit Fee', type: 'PERCENTAGE', value: 2.9, minAmount: 3, appliesTo: ['DEPOSIT'] },
      { code: 'deposit_fee_bank', name: 'Bank Deposit Fee', type: 'FIXED', value: 0, appliesTo: ['DEPOSIT'] },
      { code: 'withdrawal_fee_cash', name: 'Cash Withdrawal Fee', type: 'FIXED', value: 5, appliesTo: ['WITHDRAWAL'] },
      { code: 'withdrawal_fee_bank', name: 'Bank Withdrawal Fee', type: 'FIXED', value: 10, appliesTo: ['WITHDRAWAL'] },
      { code: 'cod_fee', name: 'Cash on Delivery Fee', type: 'FIXED', value: 5, appliesTo: ['MARKET'] }
    ]
    
    const defaultConfigs = [
      { key: 'min_withdrawal', value: '20', description: 'Minimum withdrawal amount (MAD)' },
      { key: 'max_withdrawal_daily', value: '5000', description: 'Maximum daily withdrawal (MAD)' },
      { key: 'max_deposit_daily', value: '10000', description: 'Maximum daily deposit (MAD)' },
      { key: 'escrow_release_days', value: '7', description: 'Auto-release escrow after days' },
      { key: 'agent_commission', value: '0.01', description: 'Agent commission rate (1%)' }
    ]
    
    // Seed fees (skip if exists)
    for (const fee of defaultFees) {
      const existing = await prisma.walletFeeConfig.findFirst({ where: { code: fee.code } })
      if (!existing) {
        await prisma.walletFeeConfig.create({ data: fee })
      }
    }
    
    // Seed configs (skip if exists)
    for (const config of defaultConfigs) {
      const existing = await prisma.walletConfig.findFirst({ where: { key: config.key } })
      if (!existing) {
        await prisma.walletConfig.create({ data: config })
      }
    }
    
    res.json({ success: true, message: 'Default configurations seeded' })
  } catch (error) {
    console.error('[Admin Wallet] Seed error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============================================================================
// User Addresses Routes
// ============================================================================

/**
 * GET /api/users/:did/addresses
 * Get all saved addresses for a user
 */
app.get('/api/users/:did/addresses', async (req, res) => {
  try {
    const { did } = req.params
    
    // Find user by DID
    const user = await prisma.user.findUnique({ where: { did } })
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' })
    }
    
    const addresses = await prisma.userAddress.findMany({
      where: { userId: user.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }]
    })
    
    res.json({ success: true, data: addresses })
  } catch (error) {
    console.error('[User Addresses] Error fetching addresses:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/users/:did/addresses
 * Create new address for a user
 */
app.post('/api/users/:did/addresses', async (req, res) => {
  try {
    const { did } = req.params
    const { label, fullName, phone, street, city, state, postalCode, country, isDefault } = req.body
    
    // Find or create user
    let user = await prisma.user.findUnique({ where: { did } })
    if (!user) {
      user = await prisma.user.create({
        data: {
          did,
          handle: `user_${did.slice(-8)}`,
          displayName: 'New User'
        }
      })
    }
    
    // If this is set as default, unset other defaults
    if (isDefault) {
      await prisma.userAddress.updateMany({
        where: { userId: user.id, isDefault: true },
        data: { isDefault: false }
      })
    }
    
    const address = await prisma.userAddress.create({
      data: {
        userId: user.id,
        label: label || 'Home',
        fullName,
        phone,
        street,
        city,
        state: state || '',
        postalCode: postalCode || '',
        country: country || 'Morocco',
        isDefault: isDefault || false
      }
    })
    
    res.json({ success: true, data: address })
  } catch (error) {
    console.error('[User Addresses] Error creating address:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * PUT /api/users/:did/addresses/:id
 * Update an address
 */
app.put('/api/users/:did/addresses/:id', async (req, res) => {
  try {
    const { did, id } = req.params
    const { label, fullName, phone, street, city, state, postalCode, country, isDefault } = req.body
    
    // Find user
    const user = await prisma.user.findUnique({ where: { did } })
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' })
    }
    
    // Verify address belongs to user
    const existing = await prisma.userAddress.findFirst({
      where: { id, userId: user.id }
    })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Address not found' })
    }
    
    // If this is set as default, unset other defaults
    if (isDefault && !existing.isDefault) {
      await prisma.userAddress.updateMany({
        where: { userId: user.id, isDefault: true },
        data: { isDefault: false }
      })
    }
    
    const address = await prisma.userAddress.update({
      where: { id },
      data: {
        label,
        fullName,
        phone,
        street,
        city,
        state,
        postalCode,
        country,
        isDefault
      }
    })
    
    res.json({ success: true, data: address })
  } catch (error) {
    console.error('[User Addresses] Error updating address:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * DELETE /api/users/:did/addresses/:id
 * Delete an address
 */
app.delete('/api/users/:did/addresses/:id', async (req, res) => {
  try {
    const { did, id } = req.params
    
    // Find user
    const user = await prisma.user.findUnique({ where: { did } })
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' })
    }
    
    // Verify address belongs to user
    const existing = await prisma.userAddress.findFirst({
      where: { id, userId: user.id }
    })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Address not found' })
    }
    
    await prisma.userAddress.delete({ where: { id } })
    
    res.json({ success: true, message: 'Address deleted' })
  } catch (error) {
    console.error('[User Addresses] Error deleting address:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * PUT /api/users/:did/addresses/:id/set-default
 * Set an address as default
 */
app.put('/api/users/:did/addresses/:id/set-default', async (req, res) => {
  try {
    const { did, id } = req.params
    
    // Find user
    const user = await prisma.user.findUnique({ where: { did } })
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' })
    }
    
    // Verify address belongs to user
    const existing = await prisma.userAddress.findFirst({
      where: { id, userId: user.id }
    })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Address not found' })
    }
    
    // Unset all defaults
    await prisma.userAddress.updateMany({
      where: { userId: user.id, isDefault: true },
      data: { isDefault: false }
    })
    
    // Set this as default
    const address = await prisma.userAddress.update({
      where: { id },
      data: { isDefault: true }
    })
    
    res.json({ success: true, data: address })
  } catch (error) {
    console.error('[User Addresses] Error setting default address:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============================================================================
// Market Checkout & Promo Code Routes
// ============================================================================

/**
 * GET /api/market/checkout-config
 * Get checkout configuration for a city
 */
app.get('/api/market/checkout-config', async (req, res) => {
  try {
    const { cityId } = req.query
    
    const config = await prisma.checkoutConfig.findFirst({
      where: { cityId: cityId || null },
      orderBy: { createdAt: 'desc' }
    })
    
    res.json({ success: true, data: config })
  } catch (error) {
    console.error('[Market] Error fetching checkout config:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/market/checkout-config/all
 * Get all checkout configurations
 */
app.get('/api/market/checkout-config/all', async (req, res) => {
  try {
    const configs = await prisma.checkoutConfig.findMany({
      orderBy: { createdAt: 'desc' }
    })
    
    res.json({ success: true, data: configs })
  } catch (error) {
    console.error('[Market] Error fetching all checkout configs:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * PUT /api/market/checkout-config
 * Update or create checkout configuration
 */
app.put('/api/market/checkout-config', async (req, res) => {
  try {
    const { cityId, ...data } = req.body
    
    // Check if config exists for this city
    const existing = await prisma.checkoutConfig.findFirst({
      where: { cityId: cityId || null }
    })
    
    let config
    if (existing) {
      // Update existing
      config = await prisma.checkoutConfig.update({
        where: { id: existing.id },
        data
      })
    } else {
      // Create new
      config = await prisma.checkoutConfig.create({
        data: {
          cityId: cityId || null,
          ...data
        }
      })
    }
    
    res.json({ success: true, data: config })
  } catch (error) {
    console.error('[Market] Error saving checkout config:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * DELETE /api/market/checkout-config/:id
 * Delete checkout configuration
 */
app.delete('/api/market/checkout-config/:id', async (req, res) => {
  try {
    await prisma.checkoutConfig.delete({
      where: { id: req.params.id }
    })
    
    res.json({ success: true, message: 'Checkout config deleted' })
  } catch (error) {
    console.error('[Market] Error deleting checkout config:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/market/promo-codes
 * Get all promo codes
 */
app.get('/api/market/promo-codes', async (req, res) => {
  try {
    const { cityId } = req.query
    
    const promoCodes = await prisma.promoCode.findMany({
      where: cityId ? { cityId } : {},
      orderBy: { createdAt: 'desc' }
    })
    
    res.json({ success: true, data: promoCodes })
  } catch (error) {
    console.error('[Market] Error fetching promo codes:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/market/promo-codes
 * Create new promo code
 */
app.post('/api/market/promo-codes', async (req, res) => {
  try {
    const promoCode = await prisma.promoCode.create({
      data: req.body
    })
    
    res.json({ success: true, data: promoCode })
  } catch (error) {
    console.error('[Market] Error creating promo code:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * PUT /api/market/promo-codes/:id
 * Update promo code
 */
app.put('/api/market/promo-codes/:id', async (req, res) => {
  try {
    const promoCode = await prisma.promoCode.update({
      where: { id: req.params.id },
      data: req.body
    })
    
    res.json({ success: true, data: promoCode })
  } catch (error) {
    console.error('[Market] Error updating promo code:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * DELETE /api/market/promo-codes/:id
 * Delete promo code
 */
app.delete('/api/market/promo-codes/:id', async (req, res) => {
  try {
    await prisma.promoCode.delete({
      where: { id: req.params.id }
    })
    
    res.json({ success: true, message: 'Promo code deleted' })
  } catch (error) {
    console.error('[Market] Error deleting promo code:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============================================================================
// Market Best Sellers (Admin Curated)
// ============================================================================

/**
 * GET /api/market/best-sellers/admin
 * Get all admin-curated best sellers for a city
 */
app.get('/api/market/best-sellers/admin', async (req, res) => {
  try {
    const { cityId } = req.query

    const bestSellers = await prisma.marketBestSeller.findMany({
      where: cityId ? { cityId } : {},
      orderBy: [
        { cityId: 'asc' },
        { sortOrder: 'asc' },
      ],
      include: {
        city: { select: { id: true, name: true, nameAr: true } },
        marketPost: { select: { id: true, title: true, price: true } },
      },
    })

    res.json({ success: true, data: bestSellers })
  } catch (error) {
    console.error('[Market] Error fetching admin best sellers:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/market/best-sellers/admin
 * Add a product as best seller by its post URI
 */
app.post('/api/market/best-sellers/admin', async (req, res) => {
  try {
    const { cityId, postUri, title, price, sortOrder = 0 } = req.body

    if (!cityId || !postUri) {
      return res.status(400).json({ 
        success: false, 
        error: 'cityId and postUri are required' 
      })
    }

    // Check if already exists
    const existing = await prisma.marketBestSeller.findFirst({
      where: { cityId, postUri },
    })

    if (existing) {
      return res.status(400).json({ 
        success: false, 
        error: 'This post is already a best seller for this city' 
      })
    }

    // Try to find linked MarketPost by URI
    let marketPostId = null
    const marketPost = await prisma.marketPost.findFirst({
      where: { postUri },
    })
    if (marketPost) {
      marketPostId = marketPost.id
    }

    // Get max sortOrder for this city
    const maxOrder = await prisma.marketBestSeller.aggregate({
      where: { cityId },
      _max: { sortOrder: true },
    })
    const newSortOrder = sortOrder || (maxOrder._max.sortOrder ?? -1) + 1

    const bestSeller = await prisma.marketBestSeller.create({
      data: {
        cityId,
        postUri,
        marketPostId,
        title,
        price,
        sortOrder: newSortOrder,
        isActive: true,
      },
      include: {
        city: { select: { id: true, name: true, nameAr: true } },
        marketPost: { select: { id: true, title: true, price: true } },
      },
    })

    console.log('[Market] Best seller added:', { cityId, postUri })
    res.json({ success: true, data: bestSeller })
  } catch (error) {
    console.error('[Market] Error adding best seller:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * PUT /api/market/best-sellers/admin/:id
 * Update a best seller entry
 */
app.put('/api/market/best-sellers/admin/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { sortOrder, isActive, title, price } = req.body

    const bestSeller = await prisma.marketBestSeller.update({
      where: { id },
      data: {
        ...(sortOrder !== undefined && { sortOrder }),
        ...(isActive !== undefined && { isActive }),
        ...(title !== undefined && { title }),
        ...(price !== undefined && { price }),
      },
      include: {
        city: { select: { id: true, name: true, nameAr: true } },
        marketPost: { select: { id: true, title: true, price: true } },
      },
    })

    console.log('[Market] Best seller updated:', { id })
    res.json({ success: true, data: bestSeller })
  } catch (error) {
    console.error('[Market] Error updating best seller:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * PUT /api/market/best-sellers/admin/reorder
 * Reorder best sellers for a city
 */
app.put('/api/market/best-sellers/admin/reorder', async (req, res) => {
  try {
    const { cityId, orderedIds } = req.body

    if (!cityId || !orderedIds || !Array.isArray(orderedIds)) {
      return res.status(400).json({ 
        success: false, 
        error: 'cityId and orderedIds array are required' 
      })
    }

    // Update sort orders in a transaction
    await prisma.$transaction(
      orderedIds.map((id, index) =>
        prisma.marketBestSeller.update({
          where: { id },
          data: { sortOrder: index },
        })
      )
    )

    console.log('[Market] Best sellers reordered for city:', cityId)
    res.json({ success: true })
  } catch (error) {
    console.error('[Market] Error reordering best sellers:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * DELETE /api/market/best-sellers/admin/:id
 * Remove a product from best sellers
 */
app.delete('/api/market/best-sellers/admin/:id', async (req, res) => {
  try {
    const { id } = req.params

    await prisma.marketBestSeller.delete({
      where: { id },
    })

    console.log('[Market] Best seller removed:', { id })
    res.json({ success: true, message: 'Best seller removed' })
  } catch (error) {
    console.error('[Market] Error removing best seller:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============================================================================
// Server Start
// ============================================================================

app.listen(PORT, () => {
  console.log(`🔧 Admin Panel running on http://localhost:${PORT}`)
})

// Graceful shutdown
process.on('SIGTERM', async () => {
  await prisma.$disconnect()
  process.exit(0)
})
