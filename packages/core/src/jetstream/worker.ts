/**
 * Jetstream Worker
 * Main entry point for the Jetstream post indexing service
 * 
 * Features:
 * - Connects to public Jetstream servers
 * - Indexes posts from admin list members
 * - Syncs list membership periodically
 * - Broadcasts new posts via WebSocket
 */

import { BskyAgent } from '@atproto/api'
import { prisma } from '../db/prisma'
import { logger } from '../utils/logger'
import { getRedisService, RedisService } from '../realtime/redis'
import { JetstreamConsumer } from './consumer'
import { PostIndexer, getPostIndexer } from './indexer'
import type { JetstreamEvent, JetstreamStatus } from './types'

// Redis pub/sub channel for new post notifications
const CHANNEL_NEW_POST = 'jetstream:new_post'

// Singleton worker instance
let worker: JetstreamWorker | null = null
let isRunning = false

class JetstreamWorker {
  private consumer: JetstreamConsumer
  private indexer: PostIndexer
  private redis: RedisService
  private listUri: string | null = null
  private syncInterval: NodeJS.Timeout | null = null
  private postsIndexedTotal = 0

  constructor() {
    this.redis = getRedisService()
    this.indexer = getPostIndexer()
    
    this.consumer = new JetstreamConsumer({
      onEvent: this.handleEvent.bind(this),
      onConnect: this.onConnect.bind(this),
      onDisconnect: this.onDisconnect.bind(this),
      onError: this.onError.bind(this),
      redis: this.redis,
    })
  }

  /**
   * Start the worker
   */
  async start(): Promise<void> {
    logger.info('[JetstreamWorker] Starting...')

    // Get admin list URI from config
    const config = await prisma.appConfig.findUnique({
      where: { id: 1 },
      select: { videoFeedListUri: true },
    })

    if (!config?.videoFeedListUri) {
      logger.warn('[JetstreamWorker] No admin list configured, worker will idle')
      await this.updateState('stopped', 'No admin list configured')
      return
    }

    this.listUri = config.videoFeedListUri
    logger.info('[JetstreamWorker] Using admin list', { listUri: this.listUri })

    // Fetch list members
    const dids = await this.fetchListMembers(this.listUri)
    
    if (dids.length === 0) {
      logger.warn('[JetstreamWorker] Admin list is empty')
      await this.updateState('stopped', 'Admin list is empty')
      return
    }

    logger.info('[JetstreamWorker] Fetched list members', { count: dids.length })

    // Restore cursor from database
    const state = await prisma.jetstreamState.findUnique({
      where: { id: 'singleton' },
    })

    // Initialize consumer
    await this.consumer.initialize(dids, state?.cursor ?? undefined)
    
    // Connect
    this.consumer.connect()
    
    // Start periodic list sync (every 5 minutes)
    this.syncInterval = setInterval(() => {
      this.syncListMembers()
    }, 5 * 60 * 1000)

    isRunning = true
  }

  /**
   * Stop the worker
   */
  async stop(): Promise<void> {
    logger.info('[JetstreamWorker] Stopping...')
    
    if (this.syncInterval) {
      clearInterval(this.syncInterval)
      this.syncInterval = null
    }

    // Flush any pending posts
    await this.indexer.forceFlush()
    
    // Disconnect consumer
    await this.consumer.disconnect()
    
    // Save state
    await this.updateState('stopped')
    
    isRunning = false
    logger.info('[JetstreamWorker] Stopped')
  }

  /**
   * Handle incoming Jetstream event
   */
  private async handleEvent(event: JetstreamEvent): Promise<void> {
    try {
      // Process and index the post
      await this.indexer.processEvent(event)
      
      // Broadcast new posts via pub/sub for real-time updates
      if (event.kind === 'commit' && event.commit?.operation === 'create') {
        const record = event.commit.record
        if (record) {
          await this.redis.publish(CHANNEL_NEW_POST, JSON.stringify({
            type: 'new_post',
            uri: `at://${event.did}/app.bsky.feed.post/${event.commit.rkey}`,
            authorDid: event.did,
            text: record.text?.slice(0, 200), // Preview text
            createdAt: record.createdAt,
          }))
        }
        this.postsIndexedTotal++
      }

      // Update last event timestamp periodically
      if (Math.random() < 0.01) {
        await prisma.jetstreamState.upsert({
          where: { id: 'singleton' },
          create: {
            id: 'singleton',
            cursor: this.consumer.getCursor(),
            listUri: this.listUri,
            status: 'running',
            lastEventAt: new Date(),
          },
          update: {
            cursor: this.consumer.getCursor(),
            lastEventAt: new Date(),
          },
        })
      }
    } catch (error) {
      logger.error('[JetstreamWorker] Event handling failed', { error })
    }
  }

  private onConnect(): void {
    logger.info('[JetstreamWorker] Connected to Jetstream')
    this.updateState('running')
  }

  private onDisconnect(code: number, reason: string): void {
    logger.warn('[JetstreamWorker] Disconnected from Jetstream', { code, reason })
  }

  private onError(error: Error): void {
    logger.error('[JetstreamWorker] Jetstream error', { error })
  }

  /**
   * Fetch list members from Bluesky
   */
  private async fetchListMembers(listUri: string): Promise<string[]> {
    const agent = new BskyAgent({ service: 'https://public.api.bsky.app' })
    const dids: string[] = []
    let cursor: string | undefined

    try {
      // Paginate through list members (max 6 pages = 300 members)
      for (let i = 0; i < 6; i++) {
        const res = await agent.app.bsky.graph.getList({
          list: listUri,
          limit: 50,
          cursor,
        })

        for (const item of res.data.items) {
          dids.push(item.subject.did)
        }

        if (!res.data.cursor) break
        cursor = res.data.cursor
      }

      logger.info('[JetstreamWorker] Fetched list members', {
        listUri,
        count: dids.length,
      })

      return dids
    } catch (error) {
      logger.error('[JetstreamWorker] Failed to fetch list members', { error, listUri })
      return []
    }
  }

  /**
   * Sync list members (called periodically)
   */
  private async syncListMembers(): Promise<void> {
    if (!this.listUri) return

    try {
      // Check if list URI changed
      const config = await prisma.appConfig.findUnique({
        where: { id: 1 },
        select: { videoFeedListUri: true },
      })

      if (config?.videoFeedListUri !== this.listUri) {
        logger.info('[JetstreamWorker] List URI changed, restarting...', {
          oldUri: this.listUri,
          newUri: config?.videoFeedListUri,
        })
        
        // Restart with new list
        await this.stop()
        await this.start()
        return
      }

      // Fetch current members
      const dids = await this.fetchListMembers(this.listUri)
      
      if (dids.length > 0) {
        await this.consumer.updateWatchedDids(dids)
        
        // Update state
        await prisma.jetstreamState.upsert({
          where: { id: 'singleton' },
          create: {
            id: 'singleton',
            watchedDids: dids,
            listUri: this.listUri,
            status: 'running',
          },
          update: {
            watchedDids: dids,
          },
        })
      }
    } catch (error) {
      logger.error('[JetstreamWorker] List sync failed', { error })
    }
  }

  /**
   * Update state in database
   */
  private async updateState(status: string, errorMessage?: string): Promise<void> {
    try {
      await prisma.jetstreamState.upsert({
        where: { id: 'singleton' },
        create: {
          id: 'singleton',
          cursor: this.consumer.getCursor(),
          watchedDids: [],
          listUri: this.listUri,
          status,
          errorMessage,
        },
        update: {
          cursor: this.consumer.getCursor(),
          status,
          errorMessage: errorMessage ?? null,
        },
      })
    } catch (error) {
      logger.error('[JetstreamWorker] Failed to update state', { error })
    }
  }

  /**
   * Get current status
   */
  getStatus(): JetstreamStatus {
    const indexerStats = this.indexer.getStats()
    
    return {
      status: this.consumer.isConnected() ? 'running' : 'stopped',
      cursor: this.consumer.getCursor(),
      watchedDidsCount: this.consumer.getWatchedDidsCount(),
      listUri: this.listUri,
      lastEventAt: null, // Would need to track this
      errorMessage: null,
      postsIndexedTotal: this.postsIndexedTotal,
    }
  }
}

/**
 * Start the Jetstream worker (singleton)
 */
export async function startJetstreamWorker(): Promise<void> {
  if (worker) {
    logger.warn('[JetstreamWorker] Already running')
    return
  }

  worker = new JetstreamWorker()
  await worker.start()
}

/**
 * Stop the Jetstream worker
 */
export async function stopJetstreamWorker(): Promise<void> {
  if (!worker) {
    logger.warn('[JetstreamWorker] Not running')
    return
  }

  await worker.stop()
  worker = null
}

/**
 * Get Jetstream worker status
 */
export function getJetstreamStatus(): JetstreamStatus | null {
  if (!worker) {
    return null
  }
  return worker.getStatus()
}

/**
 * Check if worker is running
 */
export function isJetstreamRunning(): boolean {
  return isRunning
}
