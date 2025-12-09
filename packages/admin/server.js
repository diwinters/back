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

// Serve LAREP home page (public)
app.get('/larep', (req, res) => {
  res.sendFile(path.join(__dirname, 'larep', 'home.html'))
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
