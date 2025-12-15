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
 * List all market categories with subcategories
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
 * Get a single category with subcategories
 */
app.get('/api/market/categories/:id', async (req, res) => {
  try {
    const category = await prisma.marketCategory.findUnique({
      where: { id: req.params.id },
      include: {
        subcategories: { orderBy: { sortOrder: 'asc' } },
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
    const { name, nameAr, description, emoji, gradientStart, gradientEnd, sortOrder, isActive } = req.body

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
        isActive: isActive !== 'false'
      },
      include: { subcategories: true }
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
    const { name, nameAr, description, emoji, gradientStart, gradientEnd, sortOrder, isActive } = req.body

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
    if (req.file) updateData.iconUrl = `/uploads/market/categories/${req.file.filename}`

    const category = await prisma.marketCategory.update({
      where: { id: req.params.id },
      data: updateData,
      include: { subcategories: true }
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
// Market: Subcategory Management CRUD Endpoints
// ============================================================================

/**
 * POST /api/market/categories/:categoryId/subcategories
 * Create a subcategory under a category
 */
app.post('/api/market/categories/:categoryId/subcategories', categoryIconUpload.single('icon'), async (req, res) => {
  try {
    const { categoryId } = req.params
    const { name, nameAr, description, emoji, sortOrder, isActive } = req.body

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
    const { name, nameAr, description, emoji, sortOrder, isActive } = req.body

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
    const sellerId = req.query.sellerId
    const search = req.query.search || ''

    const where = {}
    if (status) where.status = status
    if (categoryId) where.categoryId = categoryId
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
          subcategory: true
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
 */
app.get('/api/market/posts/active', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const pageSize = parseInt(req.query.pageSize) || 20
    const categoryId = req.query.categoryId
    const subcategoryId = req.query.subcategoryId
    const inStockOnly = req.query.inStockOnly !== 'false' // Default to true

    const where = { 
      status: 'ACTIVE',
      isArchived: false  // Exclude archived posts
    }
    if (categoryId) where.categoryId = categoryId
    if (subcategoryId) where.subcategoryId = subcategoryId
    if (inStockOnly) where.isInStock = true

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
        orderBy: { createdAt: 'desc' },
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
// Market: Public API Endpoints (for mobile app)
// ============================================================================

/**
 * POST /api/market/sellers/apply
 * Apply to become a seller (from mobile app)
 */
app.post('/api/market/sellers/apply', async (req, res) => {
  try {
    const { did, storeName, storeDescription, contactPhone, contactEmail } = req.body

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

    const seller = await prisma.marketSeller.create({
      data: {
        userId: user.id,
        storeName,
        storeDescription: storeDescription || null,
        contactPhone: contactPhone || null,
        contactEmail: contactEmail || null,
        status: 'PENDING'
      },
      include: { user: true }
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
    const { did, postUri, postCid, categoryId, subcategoryId, title, description, price, currency, quantity, isPrime } = req.body

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

    // Validate Prime status - can only mark as Prime if seller is Prime
    const shouldBePrime = isPrime && seller.isPrime
    if (isPrime && !seller.isPrime) {
      console.log(`[Market] Seller ${seller.id} tried to create Prime post but is not Prime seller`)
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
        isPrime: shouldBePrime,
        status: 'PENDING_REVIEW'
      },
      include: {
        seller: { include: { user: true } },
        category: true,
        subcategory: true
      }
    })

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
            include: {
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
              include: {
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
        primeCommissionRate: 0.10,
        primeMonthlyFee: 0,
        primeMinimumPayout: 100,
        primeFreeShipping: true,
        primeAutoApprove: false,
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
        // Prime settings
        primeCommissionRate: settings.primeCommissionRate,
        primeMonthlyFee: settings.primeMonthlyFee,
        primeMinimumPayout: settings.primeMinimumPayout,
        primeFreeShipping: settings.primeFreeShipping,
        primeAutoApprove: settings.primeAutoApprove,
        updatedAt: settings.updatedAt
      }
    })
  } catch (error) {
    console.error('[Cart] Error fetching settings:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============================================================================
// PRIME SELLER API ROUTES
// ============================================================================

/**
 * GET /api/prime/status - Get Prime status for a seller
 */
app.get('/api/prime/status', async (req, res) => {
  try {
    const did = req.query.did
    console.log(`[Prime] GET /status did=${did}`)

    if (!did) {
      return res.status(400).json({ success: false, error: 'did query parameter required' })
    }

    const seller = await prisma.marketSeller.findFirst({
      where: { user: { did } },
      include: { user: true }
    })

    if (!seller) {
      return res.json({
        success: true,
        data: {
          isSeller: false,
          isPrime: false,
          primeStatus: 'NOT_REQUESTED'
        }
      })
    }

    res.json({
      success: true,
      data: {
        isSeller: true,
        sellerId: seller.id,
        sellerStatus: seller.status,
        isPrime: seller.isPrime,
        primeStatus: seller.primeStatus,
        primeRequestedAt: seller.primeRequestedAt,
        primeApprovedAt: seller.primeApprovedAt,
        primeRejectionReason: seller.primeRejectionReason,
        stripeOnboarded: seller.stripeOnboarded
      }
    })
  } catch (error) {
    console.error('[Prime] Error fetching status:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/prime/request - Request Prime status
 */
app.post('/api/prime/request', async (req, res) => {
  try {
    const { did } = req.body
    console.log(`[Prime] POST /request did=${did}`)

    if (!did) {
      return res.status(400).json({ success: false, error: 'did is required' })
    }

    const seller = await prisma.marketSeller.findFirst({
      where: { user: { did } }
    })

    if (!seller) {
      return res.status(404).json({ success: false, error: 'Seller profile not found. Register as seller first.' })
    }

    if (seller.status !== 'APPROVED') {
      return res.status(400).json({ success: false, error: 'Seller must be approved before requesting Prime' })
    }

    if (seller.isPrime) {
      return res.status(400).json({ success: false, error: 'Already a Prime seller' })
    }

    if (seller.primeStatus === 'PENDING') {
      return res.status(400).json({ success: false, error: 'Prime request already pending' })
    }

    // Check if auto-approve is enabled
    const settings = await getMarketSettings()
    
    const updatedSeller = await prisma.marketSeller.update({
      where: { id: seller.id },
      data: {
        primeStatus: settings.primeAutoApprove ? 'APPROVED' : 'PENDING',
        primeRequestedAt: new Date(),
        isPrime: settings.primeAutoApprove,
        primeApprovedAt: settings.primeAutoApprove ? new Date() : null,
        primeRejectionReason: null
      }
    })

    res.json({
      success: true,
      data: {
        isPrime: updatedSeller.isPrime,
        primeStatus: updatedSeller.primeStatus,
        primeRequestedAt: updatedSeller.primeRequestedAt,
        autoApproved: settings.primeAutoApprove
      },
      message: settings.primeAutoApprove 
        ? 'Prime status approved automatically!' 
        : 'Prime request submitted. Awaiting admin approval.'
    })
  } catch (error) {
    console.error('[Prime] Error requesting Prime:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/prime/admin/approve/:sellerId - Admin approve Prime request
 */
app.post('/api/prime/admin/approve/:sellerId', async (req, res) => {
  try {
    const { sellerId } = req.params
    console.log(`[Prime] POST /admin/approve sellerId=${sellerId}`)

    const seller = await prisma.marketSeller.findUnique({ where: { id: sellerId } })

    if (!seller) {
      return res.status(404).json({ success: false, error: 'Seller not found' })
    }

    if (seller.isPrime) {
      return res.status(400).json({ success: false, error: 'Already a Prime seller' })
    }

    const updatedSeller = await prisma.marketSeller.update({
      where: { id: sellerId },
      data: {
        isPrime: true,
        primeStatus: 'APPROVED',
        primeApprovedAt: new Date(),
        primeRejectionReason: null
      },
      include: { user: true }
    })

    res.json({
      success: true,
      data: updatedSeller,
      message: 'Prime status approved'
    })
  } catch (error) {
    console.error('[Prime] Error approving Prime:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/prime/admin/reject/:sellerId - Admin reject Prime request
 */
app.post('/api/prime/admin/reject/:sellerId', async (req, res) => {
  try {
    const { sellerId } = req.params
    const { reason } = req.body
    console.log(`[Prime] POST /admin/reject sellerId=${sellerId}`)

    const seller = await prisma.marketSeller.findUnique({ where: { id: sellerId } })

    if (!seller) {
      return res.status(404).json({ success: false, error: 'Seller not found' })
    }

    const updatedSeller = await prisma.marketSeller.update({
      where: { id: sellerId },
      data: {
        isPrime: false,
        primeStatus: 'REJECTED',
        primeRejectionReason: reason || 'Prime request not approved'
      },
      include: { user: true }
    })

    res.json({
      success: true,
      data: updatedSeller,
      message: 'Prime request rejected'
    })
  } catch (error) {
    console.error('[Prime] Error rejecting Prime:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/prime/admin/suspend/:sellerId - Admin suspend Prime status
 */
app.post('/api/prime/admin/suspend/:sellerId', async (req, res) => {
  try {
    const { sellerId } = req.params
    const { reason } = req.body
    console.log(`[Prime] POST /admin/suspend sellerId=${sellerId}`)

    const seller = await prisma.marketSeller.findUnique({ where: { id: sellerId } })

    if (!seller) {
      return res.status(404).json({ success: false, error: 'Seller not found' })
    }

    if (!seller.isPrime) {
      return res.status(400).json({ success: false, error: 'Seller is not Prime' })
    }

    const updatedSeller = await prisma.marketSeller.update({
      where: { id: sellerId },
      data: {
        isPrime: false,
        primeStatus: 'SUSPENDED',
        primeRejectionReason: reason || 'Prime status suspended'
      },
      include: { user: true }
    })

    res.json({
      success: true,
      data: updatedSeller,
      message: 'Prime status suspended'
    })
  } catch (error) {
    console.error('[Prime] Error suspending Prime:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/prime/admin/pending - Get all pending Prime requests (admin)
 */
app.get('/api/prime/admin/pending', async (req, res) => {
  try {
    const sellers = await prisma.marketSeller.findMany({
      where: { primeStatus: 'PENDING' },
      include: { 
        user: true,
        _count: { select: { posts: true } }
      },
      orderBy: { primeRequestedAt: 'asc' }
    })

    res.json({
      success: true,
      data: sellers,
      meta: { total: sellers.length }
    })
  } catch (error) {
    console.error('[Prime] Error fetching pending requests:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/prime/admin/sellers - Get all Prime sellers (admin)
 */
app.get('/api/prime/admin/sellers', async (req, res) => {
  try {
    const sellers = await prisma.marketSeller.findMany({
      where: { isPrime: true },
      include: { 
        user: true,
        _count: { select: { posts: true } }
      },
      orderBy: { primeApprovedAt: 'desc' }
    })

    res.json({
      success: true,
      data: sellers,
      meta: { total: sellers.length }
    })
  } catch (error) {
    console.error('[Prime] Error fetching Prime sellers:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============================================================================
// Market Settings API
// ============================================================================

/**
 * GET /api/settings - Get market settings (tax, service fee, Prime config)
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
      // Prime settings
      primeCommissionRate,
      primeMonthlyFee,
      primeMinimumPayout,
      primeFreeShipping,
      primeAutoApprove,
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
    
    // Prime settings
    if (primeCommissionRate !== undefined) updateData.primeCommissionRate = parseFloat(primeCommissionRate)
    if (primeMonthlyFee !== undefined) updateData.primeMonthlyFee = parseFloat(primeMonthlyFee)
    if (primeMinimumPayout !== undefined) updateData.primeMinimumPayout = parseFloat(primeMinimumPayout)
    if (primeFreeShipping !== undefined) updateData.primeFreeShipping = Boolean(primeFreeShipping)
    if (primeAutoApprove !== undefined) updateData.primeAutoApprove = Boolean(primeAutoApprove)
    
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
// Admin Dashboard HTML
// ============================================================================

/**
 * GET /admin - Market Admin Dashboard
 */
app.get('/admin', async (req, res) => {
  try {
    const settings = await getMarketSettings()
    
    // Get some stats
    const [sellerCount, productCount, primeSellerCount, pendingPrimeCount] = await Promise.all([
      prisma.marketSeller.count({ where: { status: 'APPROVED' } }),
      prisma.marketPost.count({ where: { status: 'ACTIVE' } }),
      prisma.marketSeller.count({ where: { isPrime: true } }),
      prisma.marketSeller.count({ where: { primeStatus: 'PENDING' } })
    ])

    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Market Admin Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      min-height: 100vh;
      padding: 20px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { color: #f59e0b; margin-bottom: 30px; font-size: 28px; }
    h2 { color: #94a3b8; margin-bottom: 20px; font-size: 18px; border-bottom: 1px solid #334155; padding-bottom: 10px; }
    
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 40px;
    }
    .stat-card {
      background: #1e293b;
      padding: 20px;
      border-radius: 12px;
      border: 1px solid #334155;
    }
    .stat-value { font-size: 32px; font-weight: 700; color: #f59e0b; }
    .stat-label { color: #94a3b8; font-size: 14px; margin-top: 5px; }
    
    .settings-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
      gap: 30px;
    }
    .settings-card {
      background: #1e293b;
      padding: 25px;
      border-radius: 12px;
      border: 1px solid #334155;
    }
    .settings-card h3 {
      color: #f8fafc;
      font-size: 16px;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .settings-card h3 span { font-size: 20px; }
    
    .form-group { margin-bottom: 18px; }
    .form-group label {
      display: block;
      color: #94a3b8;
      font-size: 13px;
      margin-bottom: 6px;
      font-weight: 500;
    }
    .form-group input[type="number"],
    .form-group input[type="text"],
    .form-group select {
      width: 100%;
      padding: 10px 14px;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      color: #e2e8f0;
      font-size: 14px;
    }
    .form-group input:focus, .form-group select:focus {
      outline: none;
      border-color: #f59e0b;
    }
    
    .form-row {
      display: flex;
      gap: 15px;
    }
    .form-row .form-group { flex: 1; }
    
    .toggle-group {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid #334155;
    }
    .toggle-group:last-child { border-bottom: none; }
    .toggle-label { color: #e2e8f0; font-size: 14px; }
    .toggle-desc { color: #64748b; font-size: 12px; margin-top: 2px; }
    
    .toggle {
      position: relative;
      width: 48px;
      height: 26px;
    }
    .toggle input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .toggle-slider {
      position: absolute;
      cursor: pointer;
      top: 0; left: 0; right: 0; bottom: 0;
      background: #334155;
      border-radius: 26px;
      transition: 0.3s;
    }
    .toggle-slider:before {
      position: absolute;
      content: "";
      height: 20px;
      width: 20px;
      left: 3px;
      bottom: 3px;
      background: white;
      border-radius: 50%;
      transition: 0.3s;
    }
    .toggle input:checked + .toggle-slider { background: #f59e0b; }
    .toggle input:checked + .toggle-slider:before { transform: translateX(22px); }
    
    .btn {
      display: inline-block;
      padding: 12px 24px;
      background: #f59e0b;
      color: #0f172a;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn:hover { background: #d97706; }
    .btn:disabled { background: #64748b; cursor: not-allowed; }
    
    .save-section {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #334155;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .message {
      padding: 12px 20px;
      border-radius: 8px;
      margin-bottom: 20px;
      display: none;
    }
    .message.success { background: #166534; color: #bbf7d0; display: block; }
    .message.error { background: #991b1b; color: #fecaca; display: block; }
    
    .hint { color: #64748b; font-size: 12px; margin-top: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🏪 Market Admin Dashboard</h1>
    
    <div id="message" class="message"></div>
    
    <!-- Stats -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${sellerCount}</div>
        <div class="stat-label">Active Sellers</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${productCount}</div>
        <div class="stat-label">Active Products</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: #f59e0b">${primeSellerCount}</div>
        <div class="stat-label">Prime Sellers</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: #3b82f6">${pendingPrimeCount}</div>
        <div class="stat-label">Pending Prime Requests</div>
      </div>
    </div>
    
    <form id="settingsForm">
      <div class="settings-grid">
        <!-- Tax Settings -->
        <div class="settings-card">
          <h3><span>💰</span> Tax Settings (TVA)</h3>
          
          <div class="toggle-group">
            <div>
              <div class="toggle-label">Enable TVA</div>
              <div class="toggle-desc">Apply tax to all purchases</div>
            </div>
            <label class="toggle">
              <input type="checkbox" name="tvaEnabled" ${settings.tvaEnabled ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
          
          <div class="form-group" style="margin-top: 20px">
            <label>TVA Rate (%)</label>
            <input type="number" name="tvaRate" value="${(settings.tvaRate * 100).toFixed(0)}" min="0" max="100" step="1">
            <div class="hint">Enter as percentage (e.g., 20 for 20%)</div>
          </div>
        </div>
        
        <!-- Service Fee Settings -->
        <div class="settings-card">
          <h3><span>🏷️</span> Service Fee (Platform Commission)</h3>
          
          <div class="toggle-group">
            <div>
              <div class="toggle-label">Enable Service Fee</div>
              <div class="toggle-desc">Charge platform commission on sales</div>
            </div>
            <label class="toggle">
              <input type="checkbox" name="serviceFeeEnabled" ${settings.serviceFeeEnabled ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
          
          <div class="form-group" style="margin-top: 20px">
            <label>Service Fee Rate (%)</label>
            <input type="number" name="serviceFeeRate" value="${(settings.serviceFeeRate * 100).toFixed(0)}" min="0" max="50" step="1">
          </div>
          
          <div class="form-row">
            <div class="form-group">
              <label>Min Fee (${settings.defaultCurrency})</label>
              <input type="number" name="serviceFeeMin" value="${settings.serviceFeeMin}" min="0" step="1">
            </div>
            <div class="form-group">
              <label>Max Fee (${settings.defaultCurrency})</label>
              <input type="number" name="serviceFeeMax" value="${settings.serviceFeeMax || ''}" min="0" step="1" placeholder="No limit">
            </div>
          </div>
        </div>
        
        <!-- Prime Settings -->
        <div class="settings-card">
          <h3><span>⭐</span> Prime Seller Settings</h3>
          
          <div class="toggle-group">
            <div>
              <div class="toggle-label">Auto-Approve Prime Requests</div>
              <div class="toggle-desc">Automatically approve all Prime applications</div>
            </div>
            <label class="toggle">
              <input type="checkbox" name="primeAutoApprove" ${settings.primeAutoApprove ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
          
          <div class="toggle-group">
            <div>
              <div class="toggle-label">Free Shipping for Prime</div>
              <div class="toggle-desc">Prime products get free shipping</div>
            </div>
            <label class="toggle">
              <input type="checkbox" name="primeFreeShipping" ${settings.primeFreeShipping ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
          
          <div class="form-group" style="margin-top: 20px">
            <label>Prime Commission Rate (%)</label>
            <input type="number" name="primeCommissionRate" value="${(settings.primeCommissionRate * 100).toFixed(0)}" min="0" max="50" step="1">
            <div class="hint">Platform takes this % from Prime sales</div>
          </div>
          
          <div class="form-row">
            <div class="form-group">
              <label>Monthly Fee (${settings.defaultCurrency})</label>
              <input type="number" name="primeMonthlyFee" value="${settings.primeMonthlyFee}" min="0" step="1">
            </div>
            <div class="form-group">
              <label>Min Payout (${settings.defaultCurrency})</label>
              <input type="number" name="primeMinimumPayout" value="${settings.primeMinimumPayout}" min="0" step="1">
            </div>
          </div>
        </div>
        
        <!-- Currency Settings -->
        <div class="settings-card">
          <h3><span>🌍</span> General Settings</h3>
          
          <div class="form-group">
            <label>Default Currency</label>
            <select name="defaultCurrency">
              <option value="MAD" ${settings.defaultCurrency === 'MAD' ? 'selected' : ''}>MAD - Moroccan Dirham</option>
              <option value="USD" ${settings.defaultCurrency === 'USD' ? 'selected' : ''}>USD - US Dollar</option>
              <option value="EUR" ${settings.defaultCurrency === 'EUR' ? 'selected' : ''}>EUR - Euro</option>
              <option value="GBP" ${settings.defaultCurrency === 'GBP' ? 'selected' : ''}>GBP - British Pound</option>
            </select>
          </div>
        </div>
      </div>
      
      <div class="save-section">
        <div class="hint">Changes will take effect immediately for all new transactions</div>
        <button type="submit" class="btn" id="saveBtn">Save Settings</button>
      </div>
    </form>
  </div>
  
  <script>
    const form = document.getElementById('settingsForm');
    const message = document.getElementById('message');
    const saveBtn = document.getElementById('saveBtn');
    
    function showMessage(text, type) {
      message.textContent = text;
      message.className = 'message ' + type;
      setTimeout(() => { message.className = 'message'; }, 5000);
    }
    
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      
      try {
        const formData = new FormData(form);
        const data = {
          tvaEnabled: formData.get('tvaEnabled') === 'on',
          tvaRate: parseFloat(formData.get('tvaRate')) / 100,
          serviceFeeEnabled: formData.get('serviceFeeEnabled') === 'on',
          serviceFeeRate: parseFloat(formData.get('serviceFeeRate')) / 100,
          serviceFeeMin: parseFloat(formData.get('serviceFeeMin')) || 0,
          serviceFeeMax: formData.get('serviceFeeMax') ? parseFloat(formData.get('serviceFeeMax')) : null,
          primeAutoApprove: formData.get('primeAutoApprove') === 'on',
          primeFreeShipping: formData.get('primeFreeShipping') === 'on',
          primeCommissionRate: parseFloat(formData.get('primeCommissionRate')) / 100,
          primeMonthlyFee: parseFloat(formData.get('primeMonthlyFee')) || 0,
          primeMinimumPayout: parseFloat(formData.get('primeMinimumPayout')) || 0,
          defaultCurrency: formData.get('defaultCurrency')
        };
        
        const response = await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (result.success) {
          showMessage('Settings saved successfully!', 'success');
        } else {
          showMessage('Error: ' + result.error, 'error');
        }
      } catch (error) {
        showMessage('Error saving settings: ' + error.message, 'error');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Settings';
      }
    });
  </script>
</body>
</html>
    `);
  } catch (error) {
    console.error('[Admin] Error rendering dashboard:', error)
    res.status(500).send('Error loading dashboard: ' + error.message)
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
