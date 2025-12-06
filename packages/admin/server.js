/**
 * Admin Panel API Server
 */

const express = require('express')
const cors = require('cors')
const path = require('path')
const { PrismaClient } = require('@prisma/client')

const app = express()
const prisma = new PrismaClient()

const PORT = process.env.ADMIN_PORT || 8080

// Middleware
app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

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

    const where = isOnline !== undefined ? { isOnline: isOnline === 'true' } : {}

    const [drivers, total] = await Promise.all([
      prisma.driver.findMany({
        where,
        include: { user: true },
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
    const { did, handle, displayName, vehicleType, licensePlate, vehicleMake, vehicleModel, vehicleColor, vehicleYear, availabilityType } = req.body

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
        availabilityType: availabilityType || 'BOTH'
      },
      include: { user: true }
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
    const { isOnline, vehicleType, licensePlate, vehicleMake, vehicleModel, vehicleColor } = req.body

    const driver = await prisma.driver.update({
      where: { id: req.params.id },
      data: {
        ...(isOnline !== undefined && { isOnline }),
        ...(vehicleType && { vehicleType }),
        ...(licensePlate && { licensePlate }),
        ...(vehicleMake && { vehicleMake }),
        ...(vehicleModel && { vehicleModel }),
        ...(vehicleColor && { vehicleColor })
      },
      include: { user: true }
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

    // Find user by ID or DID
    let user
    if (userId) {
      user = await prisma.user.findUnique({ where: { id: userId } })
    } else if (userDid) {
      user = await prisma.user.findUnique({ where: { did: userDid } })
    }

    if (!user) {
      return res.status(400).json({
        success: false,
        error: 'User not found. Provide valid userId or userDid.'
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
        type: 'ORDER_CREATED',
        description: 'Order created by admin'
      }
    })

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
