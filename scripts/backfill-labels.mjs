/**
 * Backfill Existing Posts with Raceef Label
 * 
 * Labels all existing posts from users in the videofeed list
 * so they appear in search results.
 * 
 * Usage:
 *   node scripts/backfill-labels.mjs
 * 
 * Environment variables required (from .env):
 *   - DATABASE_URL
 *   - LABELER_IDENTIFIER
 *   - LABELER_PASSWORD
 */

import { BskyAgent } from '@atproto/api'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🏷️  Raceef Label Backfill Script')
  console.log('================================\n')

  // 1. Get app config
  const config = await prisma.appConfig.findUnique({
    where: { id: 1 },
    select: { videoFeedListUri: true, labelerDid: true, labelerLabelValue: true }
  })

  if (!config?.videoFeedListUri) {
    console.error('❌ No videoFeedListUri configured in AppConfig')
    process.exit(1)
  }

  if (!config?.labelerDid) {
    console.error('❌ No labelerDid configured in AppConfig')
    console.log('   Please set up the labeler first.')
    process.exit(1)
  }

  const labelValue = config.labelerLabelValue || 'raceef-post'
  console.log(`📋 Video Feed List: ${config.videoFeedListUri}`)
  console.log(`🏷️  Labeler DID: ${config.labelerDid}`)
  console.log(`📝 Label Value: ${labelValue}\n`)

  // 2. Initialize labeler agent
  const identifier = process.env.LABELER_IDENTIFIER
  const password = process.env.LABELER_PASSWORD

  if (!identifier || !password) {
    console.error('❌ LABELER_IDENTIFIER and LABELER_PASSWORD must be set in environment')
    process.exit(1)
  }

  console.log('🔐 Logging in as labeler...')
  const labelerAgent = new BskyAgent({ service: 'https://bsky.social' })
  await labelerAgent.login({ identifier, password })
  console.log(`✅ Logged in as ${labelerAgent.session?.did}\n`)

  // Verify the logged-in DID matches the configured labelerDid
  if (labelerAgent.session?.did !== config.labelerDid) {
    console.error(`❌ Logged-in DID (${labelerAgent.session?.did}) does not match configured labelerDid (${config.labelerDid})`)
    process.exit(1)
  }

  // 3. Fetch list members
  console.log('📥 Fetching list members...')
  const listMembers = []
  let cursor

  do {
    const res = await labelerAgent.app.bsky.graph.getList({
      list: config.videoFeedListUri,
      limit: 100,
      cursor,
    })
    
    for (const item of res.data.items) {
      listMembers.push(item.subject.did)
    }
    cursor = res.data.cursor
  } while (cursor)

  console.log(`✅ Found ${listMembers.length} list members\n`)

  // 4. For each member, fetch their posts and label them
  let totalPostsLabeled = 0
  let totalPostsSkipped = 0
  let totalErrors = 0

  for (let i = 0; i < listMembers.length; i++) {
    const memberDid = listMembers[i]
    console.log(`\n👤 Processing member ${i + 1}/${listMembers.length}: ${memberDid}`)

    try {
      // Fetch the member's posts
      let postCursor
      let memberPostsLabeled = 0

      do {
        const feed = await labelerAgent.getAuthorFeed({
          actor: memberDid,
          limit: 50,
          cursor: postCursor,
        })

        for (const item of feed.data.feed) {
          const post = item.post

          // Skip reposts
          if (item.reason) continue

          // Check if already labeled
          const existingLabel = await prisma.postLabel.findUnique({
            where: {
              postUri_labelValue: {
                postUri: post.uri,
                labelValue,
              }
            }
          })

          if (existingLabel) {
            totalPostsSkipped++
            continue
          }

          // Create label record in our database
          try {
            await prisma.postLabel.create({
              data: {
                postUri: post.uri,
                postCid: post.cid,
                labelValue,
                labelerDid: config.labelerDid,
                authorDid: memberDid,
              }
            })
            memberPostsLabeled++
            totalPostsLabeled++
          } catch (e) {
            // Likely duplicate, skip
            totalPostsSkipped++
          }
        }

        postCursor = feed.data.cursor
      } while (postCursor)

      console.log(`   ✅ Labeled ${memberPostsLabeled} posts`)
    } catch (e) {
      console.error(`   ❌ Error processing member: ${e.message}`)
      totalErrors++
    }

    // Rate limiting - be nice to Bluesky's servers
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  console.log('\n================================')
  console.log('📊 Backfill Complete!')
  console.log(`   ✅ Posts labeled: ${totalPostsLabeled}`)
  console.log(`   ⏭️  Posts skipped (already labeled): ${totalPostsSkipped}`)
  console.log(`   ❌ Errors: ${totalErrors}`)
}

main()
  .catch(e => {
    console.error('Fatal error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
