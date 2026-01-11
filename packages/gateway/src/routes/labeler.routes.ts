/**
 * Labeler Routes
 * Backend endpoints for the Raceef Labeler service
 * 
 * The labeler automatically labels posts created through the Raceef app
 * so they can be filtered in search results.
 */

import { Router } from 'express'
import { prisma, logger } from '@gominiapp/core'
import { BskyAgent } from '@atproto/api'

const router = Router()

// Labeler agent instance (initialized on first use)
let labelerAgent: BskyAgent | null = null

/**
 * Initialize the labeler agent with credentials from environment
 */
async function getLabelerAgent(): Promise<BskyAgent> {
  if (labelerAgent) {
    return labelerAgent
  }

  const identifier = process.env.LABELER_IDENTIFIER
  const password = process.env.LABELER_PASSWORD

  if (!identifier || !password) {
    throw new Error('LABELER_IDENTIFIER and LABELER_PASSWORD must be set in environment')
  }

  const agent = new BskyAgent({ service: 'https://bsky.social' })
  await agent.login({ identifier, password })
  
  labelerAgent = agent
  logger.info('[Labeler] Agent initialized', { did: agent.session?.did })
  
  return agent
}

/**
 * POST /api/labeler/label
 * Label a post with the Raceef app label
 * 
 * Body:
 * - uri: AT-URI of the post (required)
 * - cid: CID of the post (optional, for versioning)
 * 
 * This endpoint is called after a post is created in the app.
 * Only authenticated users can label posts (the user creating the post).
 */
router.post('/label', async (req, res, next) => {
  try {
    const userDid = req.headers['x-user-did'] as string
    if (!userDid) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'User DID required' }
      })
    }

    const { uri, cid } = req.body

    if (!uri) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_URI', message: 'Post URI is required' }
      })
    }

    // Verify the post belongs to the authenticated user
    if (!uri.startsWith(`at://${userDid}/`)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Can only label your own posts' }
      })
    }

    // Get app config for label value
    const config = await prisma.appConfig.findUnique({
      where: { id: 1 },
      select: { labelerDid: true, labelerLabelValue: true }
    })

    if (!config?.labelerDid) {
      logger.warn('[Labeler] No labeler DID configured')
      return res.status(503).json({
        success: false,
        error: { code: 'LABELER_NOT_CONFIGURED', message: 'Labeler service not configured' }
      })
    }

    const labelValue = config.labelerLabelValue || 'raceef-post'

    // Get the labeler agent
    const agent = await getLabelerAgent()

    // Create the label using the labeler's signing key
    // Note: This uses com.atproto.label.publishLabel which is the labeler-specific endpoint
    const label = {
      src: agent.session!.did, // Labeler's DID
      uri: uri,
      cid: cid || undefined,
      val: labelValue,
      neg: false,
      cts: new Date().toISOString(),
    }

    // For a real labeler service, you'd sign and publish the label
    // Using the labeler's repo. For now, we'll store it in our DB
    // and the client will filter by it.
    
    // Store the label in our database for tracking
    await prisma.postLabel.create({
      data: {
        postUri: uri,
        postCid: cid || null,
        labelValue: labelValue,
        labelerDid: agent.session!.did,
        authorDid: userDid,
      }
    })

    logger.info('[Labeler] Post labeled', { uri, labelValue, userDid })

    res.json({
      success: true,
      data: { label }
    })
  } catch (error) {
    logger.error('[Labeler] Failed to label post', { error })
    next(error)
  }
})

/**
 * GET /api/labeler/status
 * Check if the labeler service is configured and operational
 */
router.get('/status', async (req, res, next) => {
  try {
    const config = await prisma.appConfig.findUnique({
      where: { id: 1 },
      select: { labelerDid: true, labelerLabelValue: true }
    })

    const isConfigured = Boolean(config?.labelerDid)
    let isAuthenticated = false

    if (isConfigured && process.env.LABELER_IDENTIFIER && process.env.LABELER_PASSWORD) {
      try {
        await getLabelerAgent()
        isAuthenticated = true
      } catch (e) {
        logger.warn('[Labeler] Agent authentication failed', { error: e })
      }
    }

    res.json({
      success: true,
      data: {
        configured: isConfigured,
        authenticated: isAuthenticated,
        labelerDid: config?.labelerDid || null,
        labelValue: config?.labelerLabelValue || 'raceef-post',
      }
    })
  } catch (error) {
    logger.error('[Labeler] Failed to get status', { error })
    next(error)
  }
})

/**
 * GET /api/labeler/labels
 * Get all labels for a given post or author
 * 
 * Query params:
 * - uri: Filter by post URI
 * - authorDid: Filter by author DID
 */
router.get('/labels', async (req, res, next) => {
  try {
    const { uri, authorDid } = req.query

    const where: any = {}
    if (uri) where.postUri = uri as string
    if (authorDid) where.authorDid = authorDid as string

    const labels = await prisma.postLabel.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    res.json({
      success: true,
      data: { labels }
    })
  } catch (error) {
    logger.error('[Labeler] Failed to get labels', { error })
    next(error)
  }
})

export { router as labelerRouter }
