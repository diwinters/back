/**
 * Post Indexer
 * Handles storing and managing indexed posts in PostgreSQL
 * Supports full-text search with custom ranking
 */

import { prisma } from '../db/prisma'
import { logger } from '../utils/logger'
import type { JetstreamEvent, JetstreamCommit, PostRecord, Facet, FacetFeature } from './types'

// Batch insert queue for performance
const insertQueue: Array<{
  uri: string
  cid: string
  authorDid: string
  text: string
  createdAt: Date
  langs: string[]
  hasImages: boolean
  hasVideo: boolean
  mentions: string[]
  hashtags: string[]
  links: string[]
  rawRecord: string
}> = []

let flushTimeout: NodeJS.Timeout | null = null
const BATCH_SIZE = 50
const FLUSH_INTERVAL_MS = 500

// Stats tracking
let postsIndexed = 0
let postsDeleted = 0
let lastFlushTime = Date.now()

export class PostIndexer {
  /**
   * Process a Jetstream commit event
   */
  async processEvent(event: JetstreamEvent): Promise<void> {
    if (event.kind !== 'commit' || !event.commit) return
    if (event.commit.collection !== 'app.bsky.feed.post') return

    const { did, commit } = event

    switch (commit.operation) {
      case 'create':
        await this.handleCreate(did, commit)
        break
      case 'update':
        await this.handleUpdate(did, commit)
        break
      case 'delete':
        await this.handleDelete(did, commit)
        break
    }
  }

  private async handleCreate(did: string, commit: JetstreamCommit): Promise<void> {
    if (!commit.record) return

    const record = commit.record as PostRecord
    const uri = `at://${did}/app.bsky.feed.post/${commit.rkey}`

    // Extract facets
    const { mentions, hashtags, links } = this.extractFacets(record.facets)

    // Check for media
    const hasImages = !!(record.embed?.images?.length || record.embed?.media?.images)
    const hasVideo = !!(record.embed?.video || record.embed?.media?.video)

    // Add to batch queue
    insertQueue.push({
      uri,
      cid: commit.cid,
      authorDid: did,
      text: record.text || '',
      createdAt: new Date(record.createdAt),
      langs: record.langs || [],
      hasImages,
      hasVideo,
      mentions,
      hashtags,
      links,
      rawRecord: JSON.stringify(record),
    })

    postsIndexed++

    // Schedule flush
    this.scheduleFlush()
  }

  private async handleUpdate(did: string, commit: JetstreamCommit): Promise<void> {
    if (!commit.record) return

    const record = commit.record as PostRecord
    const uri = `at://${did}/app.bsky.feed.post/${commit.rkey}`

    try {
      await prisma.indexedPost.update({
        where: { uri },
        data: {
          cid: commit.cid,
          text: record.text || '',
          rawRecord: JSON.stringify(record),
          indexedAt: new Date(),
        },
      })
    } catch (error: any) {
      // Post might not exist if created before indexing started
      if (error.code !== 'P2025') { // Record not found
        logger.error('[PostIndexer] Update failed', { uri, error })
      }
    }
  }

  private async handleDelete(did: string, commit: JetstreamCommit): Promise<void> {
    const uri = `at://${did}/app.bsky.feed.post/${commit.rkey}`

    try {
      await prisma.indexedPost.delete({ where: { uri } })
      postsDeleted++
    } catch (error: any) {
      // Ignore if not found
      if (error.code !== 'P2025') {
        logger.error('[PostIndexer] Delete failed', { uri, error })
      }
    }
  }

  private extractFacets(facets?: Facet[]): {
    mentions: string[]
    hashtags: string[]
    links: string[]
  } {
    const mentions: string[] = []
    const hashtags: string[] = []
    const links: string[] = []

    if (!facets) return { mentions, hashtags, links }

    for (const facet of facets) {
      for (const feature of facet.features) {
        switch (feature.$type) {
          case 'app.bsky.richtext.facet#mention':
            mentions.push((feature as any).did)
            break
          case 'app.bsky.richtext.facet#tag':
            hashtags.push((feature as any).tag)
            break
          case 'app.bsky.richtext.facet#link':
            links.push((feature as any).uri)
            break
        }
      }
    }

    return { mentions, hashtags, links }
  }

  private scheduleFlush(): void {
    if (flushTimeout) return

    // Flush when batch is full or after interval
    if (insertQueue.length >= BATCH_SIZE) {
      this.flush()
    } else {
      flushTimeout = setTimeout(() => {
        this.flush()
      }, FLUSH_INTERVAL_MS)
    }
  }

  private async flush(): Promise<void> {
    if (flushTimeout) {
      clearTimeout(flushTimeout)
      flushTimeout = null
    }

    if (insertQueue.length === 0) return

    const batch = insertQueue.splice(0, insertQueue.length)
    const startTime = Date.now()

    try {
      // Use createMany for batch insert
      await prisma.indexedPost.createMany({
        data: batch,
        skipDuplicates: true,
      })

      const duration = Date.now() - startTime
      logger.debug('[PostIndexer] Batch inserted', {
        count: batch.length,
        duration,
        totalIndexed: postsIndexed,
      })
    } catch (error) {
      logger.error('[PostIndexer] Batch insert failed', { error, count: batch.length })
      
      // Fall back to individual inserts
      for (const post of batch) {
        try {
          await prisma.indexedPost.upsert({
            where: { uri: post.uri },
            create: post,
            update: {
              cid: post.cid,
              text: post.text,
              rawRecord: post.rawRecord,
              indexedAt: new Date(),
            },
          })
        } catch (e) {
          logger.error('[PostIndexer] Individual insert failed', { uri: post.uri, error: e })
        }
      }
    }

    lastFlushTime = Date.now()
  }

  /**
   * Force flush any pending posts
   */
  async forceFlush(): Promise<void> {
    await this.flush()
  }

  /**
   * Get indexer statistics
   */
  getStats(): { postsIndexed: number; postsDeleted: number; queueSize: number } {
    return {
      postsIndexed,
      postsDeleted,
      queueSize: insertQueue.length,
    }
  }

  /**
   * Search indexed posts with ranking
   * 
   * Ranking factors:
   * - Text relevance (PostgreSQL full-text)
   * - Recency boost
   * - Engagement (likes, reposts)
   */
  async search(params: {
    query: string
    authorDids?: string[]
    limit?: number
    cursor?: string
    sort?: 'top' | 'latest'
  }): Promise<{
    posts: Array<{
      uri: string
      cid: string
      authorDid: string
      authorHandle: string | null
      text: string
      createdAt: Date
      indexedAt: Date
      likeCount: number
      repostCount: number
      replyCount: number
      hasImages: boolean
      hasVideo: boolean
      rawRecord: string | null
      relevanceScore: number
    }>
    cursor: string | null
    totalCount: number
  }> {
    const limit = Math.min(params.limit || 25, 100)
    const sort = params.sort || 'latest'

    // Build where clause
    const whereConditions: string[] = []
    const queryParams: any[] = []
    let paramIndex = 1

    // Full-text search using PostgreSQL
    if (params.query) {
      // Convert query to tsquery format - handle simple queries
      const searchTerms = params.query
        .split(/\s+/)
        .filter(t => t.length > 0)
        .map(t => t.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '')) // Keep alphanumeric and Arabic
        .filter(t => t.length > 0)
        .join(' & ')

      if (searchTerms) {
        whereConditions.push(`to_tsvector('simple', text) @@ to_tsquery('simple', $${paramIndex})`)
        queryParams.push(searchTerms)
        paramIndex++
      }
    }

    // Filter by author DIDs
    if (params.authorDids && params.authorDids.length > 0) {
      whereConditions.push(`"authorDid" = ANY($${paramIndex})`)
      queryParams.push(params.authorDids)
      paramIndex++
    }

    // Cursor-based pagination
    if (params.cursor) {
      const [cursorScore, cursorDate] = params.cursor.split('|')
      if (sort === 'top') {
        whereConditions.push(`("likeCount" + "repostCount", "createdAt") < ($${paramIndex}, $${paramIndex + 1})`)
        queryParams.push(parseFloat(cursorScore), new Date(cursorDate))
        paramIndex += 2
      } else {
        whereConditions.push(`"createdAt" < $${paramIndex}`)
        queryParams.push(new Date(cursorDate))
        paramIndex++
      }
    }

    const whereClause = whereConditions.length > 0
      ? `WHERE ${whereConditions.join(' AND ')}`
      : ''

    // Build order clause with custom ranking
    let orderClause: string
    let selectScore: string

    if (sort === 'top') {
      // Custom ranking: engagement + recency boost
      // Score = (likes + reposts*2 + replies*0.5) * recency_decay
      // Recency decay: posts lose 50% score after 7 days
      selectScore = `
        (
          COALESCE("likeCount", 0) + 
          COALESCE("repostCount", 0) * 2 + 
          COALESCE("replyCount", 0) * 0.5
        ) * 
        GREATEST(0.1, 1.0 - (EXTRACT(EPOCH FROM (NOW() - "createdAt")) / (7 * 24 * 3600)) * 0.5)
        AS relevance_score
      `
      orderClause = 'ORDER BY relevance_score DESC, "createdAt" DESC'
    } else {
      // Latest: just order by date
      selectScore = '1.0 AS relevance_score'
      orderClause = 'ORDER BY "createdAt" DESC'
    }

    // Execute query
    const query = `
      SELECT 
        uri,
        cid,
        "authorDid",
        "authorHandle",
        text,
        "createdAt",
        "indexedAt",
        "likeCount",
        "repostCount",
        "replyCount",
        "hasImages",
        "hasVideo",
        "rawRecord",
        ${selectScore}
      FROM "IndexedPost"
      ${whereClause}
      ${orderClause}
      LIMIT ${limit + 1}
    `

    const results = await prisma.$queryRawUnsafe<any[]>(query, ...queryParams)

    // Check if there are more results
    const hasMore = results.length > limit
    const posts = results.slice(0, limit)

    // Build cursor for next page
    let nextCursor: string | null = null
    if (hasMore && posts.length > 0) {
      const lastPost = posts[posts.length - 1]
      if (sort === 'top') {
        nextCursor = `${lastPost.relevance_score}|${lastPost.createdAt.toISOString()}`
      } else {
        nextCursor = `0|${lastPost.createdAt.toISOString()}`
      }
    }

    // Get total count (for UI)
    let totalCount = 0
    if (params.query) {
      const countQuery = `
        SELECT COUNT(*) as count
        FROM "IndexedPost"
        ${whereClause}
      `
      const countResult = await prisma.$queryRawUnsafe<[{ count: bigint }]>(countQuery, ...queryParams)
      totalCount = Number(countResult[0]?.count || 0)
    }

    return {
      posts: posts.map(p => ({
        ...p,
        relevanceScore: p.relevance_score,
        createdAt: new Date(p.createdAt),
        indexedAt: new Date(p.indexedAt),
      })),
      cursor: nextCursor,
      totalCount,
    }
  }

  /**
   * Update engagement counts for a post (called from webhook or periodic sync)
   */
  async updateEngagement(uri: string, counts: {
    likeCount?: number
    repostCount?: number
    replyCount?: number
  }): Promise<void> {
    try {
      await prisma.indexedPost.update({
        where: { uri },
        data: counts,
      })
    } catch (error: any) {
      if (error.code !== 'P2025') {
        logger.error('[PostIndexer] Update engagement failed', { uri, error })
      }
    }
  }

  /**
   * Clean up old posts (optional TTL)
   */
  async cleanup(olderThanDays: number = 90): Promise<number> {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - olderThanDays)

    const result = await prisma.indexedPost.deleteMany({
      where: {
        createdAt: { lt: cutoff },
      },
    })

    logger.info('[PostIndexer] Cleanup completed', { deleted: result.count, olderThanDays })
    return result.count
  }
}

// Singleton instance
let indexerInstance: PostIndexer | null = null

export function getPostIndexer(): PostIndexer {
  if (!indexerInstance) {
    indexerInstance = new PostIndexer()
  }
  return indexerInstance
}
