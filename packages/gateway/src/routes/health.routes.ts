/**
 * Health Check Routes
 */

import { Router } from 'express'
import { prisma, getRedis } from '@gominiapp/core'

const router = Router()

router.get('/', async (req, res) => {
  const checks = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      database: 'unknown',
      redis: 'unknown',
    },
  }

  try {
    // Check database
    await prisma.$queryRaw`SELECT 1`
    checks.services.database = 'healthy'
  } catch {
    checks.services.database = 'unhealthy'
    checks.status = 'degraded'
  }

  try {
    // Check Redis
    const redis = getRedis()
    await redis.ping()
    checks.services.redis = 'healthy'
  } catch {
    checks.services.redis = 'unhealthy'
    checks.status = 'degraded'
  }

  const statusCode = checks.status === 'ok' ? 200 : 503
  res.status(statusCode).json(checks)
})

router.get('/ready', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ ready: true })
  } catch {
    res.status(503).json({ ready: false })
  }
})

router.get('/live', (req, res) => {
  res.json({ live: true })
})

export { router as healthRouter }
