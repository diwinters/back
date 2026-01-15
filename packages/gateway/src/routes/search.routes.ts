/**
 * Search Routes
 * API endpoints for searching indexed posts
 * 
 * Uses PostgreSQL full-text search on posts indexed by Jetstream
 * Falls back to Bluesky API when Jetstream is unavailable
 */

import { Router } from 'express'
import { z } from 'zod'
import { BskyAgent } from '@atproto/api'
import { 
  prisma, 
  logger, 
  getPostIndexer, 
  isJetstreamRunning,
  getJetstreamStatus 
} from '@gominiapp/core'

const router = Router()

// Search query validation
const searchSchema = z.object({
  q: z.string().min(1).max(500),
  limit: z.coerce.number().min(1).max(100).default(25),
  cursor: z.string().optional(),
  sort: z.enum(['top', 'latest']).default('latest'),
})

/**
 * GET /api/search/posts
 * Search posts from indexed content (Jetstream) or fallback to Bluesky
 * 
 * Query params:
 * - q: Search query (required)
 * - limit: Results per page (default: 25, max: 100)
 * - cursor: Pagination cursor
 * - sort: 'top' (relevance) or 'latest' (chronological)
 * 
 * Response includes:
 * - posts: Array of post objects
 * - cursor: Next page cursor (null if no more results)
 * - source: 'indexed' or 'bluesky' (for debugging/UI feedback)
 * - jetstreamStatus: Current indexer status
 */
router.get('/posts', async (req, res, next) => {
  try {
    const params = searchSchema.parse(req.query)
    
    logger.info('[Search] Query received', { 
      query: params.q, 
      limit: params.limit, 
      sort: params.sort 
    })

    // Check if Jetstream indexer is running
    const jetstreamRunning = isJetstreamRunning()
    const jetstreamStatus = getJetstreamStatus()

    // Get admin list members for filtering
    const config = await prisma.appConfig.findUnique({
      where: { id: 1 },
      select: { videoFeedListUri: true },
    })

    // Try indexed search first
    if (jetstreamRunning && jetstreamStatus?.watchedDidsCount && jetstreamStatus.watchedDidsCount > 0) {
      try {
        const indexer = getPostIndexer()
        
        // Get list member DIDs for filtering
        const state = await prisma.jetstreamState.findUnique({
          where: { id: 'singleton' },
          select: { watchedDids: true },
        })
        
        const authorDids = state?.watchedDids || []
        
        const result = await indexer.search({
          query: params.q,
          authorDids: authorDids.length > 0 ? authorDids : undefined,
          limit: params.limit,
          cursor: params.cursor,
          sort: params.sort,
        })

        logger.info('[Search] Indexed search completed', {
          query: params.q,
          resultsCount: result.posts.length,
          totalCount: result.totalCount,
          source: 'indexed',
        })

        return res.json({
          success: true,
          data: {
            posts: result.posts.map(p => ({
              uri: p.uri,
              cid: p.cid,
              authorDid: p.authorDid,
              authorHandle: p.authorHandle,
              text: p.text,
              createdAt: p.createdAt.toISOString(),
              indexedAt: p.indexedAt.toISOString(),
              likeCount: p.likeCount,
              repostCount: p.repostCount,
              replyCount: p.replyCount,
              hasImages: p.hasImages,
              hasVideo: p.hasVideo,
              rawRecord: p.rawRecord ? JSON.parse(p.rawRecord) : null,
              relevanceScore: p.relevanceScore,
            })),
            cursor: result.cursor,
            totalCount: result.totalCount,
            source: 'indexed',
            jetstreamStatus: {
              running: true,
              watchedDidsCount: jetstreamStatus?.watchedDidsCount || 0,
              postsIndexed: jetstreamStatus?.postsIndexedTotal || 0,
            },
          },
        })
      } catch (indexError) {
        logger.error('[Search] Indexed search failed, falling back to Bluesky', { 
          error: indexError 
        })
        // Fall through to Bluesky fallback
      }
    }

    // Fallback: Use Bluesky API
    logger.info('[Search] Using Bluesky API fallback', {
      reason: !jetstreamRunning ? 'jetstream_not_running' : 'no_indexed_posts',
    })

    const agent = new BskyAgent({ service: 'https://public.api.bsky.app' })

    // Fetch list members for filtering (if list is configured)
    let allowedDids: Set<string> | null = null
    
    if (config?.videoFeedListUri) {
      try {
        const listMembers = await fetchListMembers(agent, config.videoFeedListUri)
        allowedDids = new Set(listMembers.map(m => m.did))
        logger.info('[Search] Fetched list members for filtering', { 
          count: allowedDids.size 
        })
      } catch (listError) {
        logger.error('[Search] Failed to fetch list members', { error: listError })
      }
    }

    // Search Bluesky
    const searchResult = await agent.app.bsky.feed.searchPosts({
      q: params.q,
      limit: Math.min(params.limit * 4, 100), // Fetch more since we'll filter
      cursor: params.cursor,
      sort: params.sort,
    })

    // Filter to list members if configured
    let filteredPosts = searchResult.data.posts
    if (allowedDids && allowedDids.size > 0) {
      filteredPosts = searchResult.data.posts.filter(post => 
        allowedDids!.has(post.author.did)
      )
    }

    // Limit results
    filteredPosts = filteredPosts.slice(0, params.limit)

    logger.info('[Search] Bluesky search completed', {
      query: params.q,
      totalFromBluesky: searchResult.data.posts.length,
      afterFilter: filteredPosts.length,
      source: 'bluesky',
    })

    return res.json({
      success: true,
      data: {
        posts: filteredPosts.map(post => ({
          uri: post.uri,
          cid: post.cid,
          authorDid: post.author.did,
          authorHandle: post.author.handle,
          text: (post.record as any)?.text || '',
          createdAt: post.indexedAt,
          indexedAt: post.indexedAt,
          likeCount: post.likeCount || 0,
          repostCount: post.repostCount || 0,
          replyCount: post.replyCount || 0,
          hasImages: !!(post.embed as any)?.images,
          hasVideo: !!(post.embed as any)?.video,
          rawRecord: post.record,
          relevanceScore: 0,
          // Include full Bluesky post view for rich rendering
          blueskyPost: post,
        })),
        cursor: searchResult.data.cursor,
        totalCount: filteredPosts.length,
        source: 'bluesky',
        jetstreamStatus: {
          running: false,
          watchedDidsCount: 0,
          postsIndexed: 0,
          fallbackReason: !jetstreamRunning 
            ? 'Jetstream indexer is not running' 
            : 'No posts indexed yet',
        },
      },
    })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid search parameters',
          details: error.errors,
        },
      })
    }
    
    logger.error('[Search] Search failed', { error })
    next(error)
  }
})

/**
 * GET /api/search/status
 * Get Jetstream indexer status
 */
router.get('/status', async (req, res) => {
  const status = getJetstreamStatus()
  const state = await prisma.jetstreamState.findUnique({
    where: { id: 'singleton' },
  })

  // Get indexed post count
  const postCount = await prisma.indexedPost.count()

  res.json({
    success: true,
    data: {
      running: isJetstreamRunning(),
      status: status?.status || state?.status || 'unknown',
      cursor: status?.cursor?.toString() || state?.cursor?.toString() || null,
      watchedDidsCount: status?.watchedDidsCount || state?.watchedDids?.length || 0,
      listUri: status?.listUri || state?.listUri || null,
      lastEventAt: state?.lastEventAt?.toISOString() || null,
      errorMessage: status?.errorMessage || state?.errorMessage || null,
      postsIndexedTotal: status?.postsIndexedTotal || 0,
      postsInDatabase: postCount,
    },
  })
})

/**
 * Helper: Fetch list members from Bluesky
 */
async function fetchListMembers(
  agent: BskyAgent, 
  listUri: string
): Promise<Array<{ did: string; handle: string }>> {
  const members: Array<{ did: string; handle: string }> = []
  let cursor: string | undefined

  for (let i = 0; i < 6; i++) {
    const res = await agent.app.bsky.graph.getList({
      list: listUri,
      limit: 50,
      cursor,
    })

    for (const item of res.data.items) {
      members.push({
        did: item.subject.did,
        handle: item.subject.handle,
      })
    }

    if (!res.data.cursor) break
    cursor = res.data.cursor
  }

  return members
}

export { router as searchRouter }
