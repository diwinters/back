/**
 * Jetstream Worker Entry Point
 * Standalone process for indexing posts from Bluesky Jetstream
 * 
 * Run with: node dist/jetstream-worker.js
 * Or via PM2: pm2 start ecosystem.config.js --only gominiapp-jetstream
 */

import { startJetstreamWorker, stopJetstreamWorker, logger } from '@gominiapp/core'

const STARTUP_DELAY_MS = 5000 // Wait for other services to be ready

async function main() {
  logger.info('[JetstreamWorkerProcess] Starting...')
  
  // Wait a bit for database/redis to be ready
  await new Promise(resolve => setTimeout(resolve, STARTUP_DELAY_MS))
  
  try {
    await startJetstreamWorker()
    logger.info('[JetstreamWorkerProcess] Worker started successfully')
    
    // Send PM2 ready signal
    if (process.send) {
      process.send('ready')
    }
  } catch (error) {
    logger.error('[JetstreamWorkerProcess] Failed to start worker', { error })
    process.exit(1)
  }
}

// Graceful shutdown
async function shutdown(signal: string) {
  logger.info(`[JetstreamWorkerProcess] Received ${signal}, shutting down...`)
  
  try {
    await stopJetstreamWorker()
    logger.info('[JetstreamWorkerProcess] Worker stopped gracefully')
    process.exit(0)
  } catch (error) {
    logger.error('[JetstreamWorkerProcess] Error during shutdown', { error })
    process.exit(1)
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

// Unhandled errors
process.on('unhandledRejection', (reason, promise) => {
  logger.error('[JetstreamWorkerProcess] Unhandled rejection', { reason })
})

process.on('uncaughtException', (error) => {
  logger.error('[JetstreamWorkerProcess] Uncaught exception', { error })
  process.exit(1)
})

// Start
main().catch(error => {
  logger.error('[JetstreamWorkerProcess] Fatal error', { error })
  process.exit(1)
})
