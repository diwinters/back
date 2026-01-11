/**
 * Setup Labeler Service Declaration (JavaScript version)
 * 
 * Usage:
 *   node scripts/setup-labeler.mjs YOUR_PASSWORD
 */

import { BskyAgent } from '@atproto/api'

const LABELER_HANDLE = 'diwinters.bsky.social'
const LABELER_DID = 'did:plc:cakurfpvnvbtgzwazeriujxn'

async function setupLabeler() {
  const password = process.argv[2]
  
  if (!password) {
    console.log('Usage: node scripts/setup-labeler.mjs YOUR_PASSWORD')
    process.exit(1)
  }

  console.log('🏷️  Raceef Labeler Setup')
  console.log('========================\n')
  console.log(`Handle: ${LABELER_HANDLE}`)
  console.log(`DID: ${LABELER_DID}\n`)

  console.log('🔐 Logging in...')
  const agent = new BskyAgent({ service: 'https://bsky.social' })
  
  try {
    await agent.login({
      identifier: LABELER_HANDLE,
      password,
    })
  } catch (e) {
    console.error('❌ Login failed:', e.message)
    process.exit(1)
  }

  console.log(`✅ Logged in as ${agent.session?.did}`)

  // Verify DID matches
  if (agent.session?.did !== LABELER_DID) {
    console.error(`❌ DID mismatch! Expected ${LABELER_DID}, got ${agent.session?.did}`)
    process.exit(1)
  }

  // Create the labeler service declaration
  const record = {
    $type: 'app.bsky.labeler.service',
    policies: {
      labelValues: ['raceef-post'],
      labelValueDefinitions: [
        {
          identifier: 'raceef-post',
          severity: 'none',
          blurs: 'none',
          defaultSetting: 'ignore',
          locales: [
            {
              lang: 'en',
              name: 'Raceef App Post',
              description: 'This post was created through the Raceef app',
            },
          ],
        },
      ],
    },
    createdAt: new Date().toISOString(),
  }

  console.log('\n📝 Creating labeler service declaration...')

  try {
    const result = await agent.api.app.bsky.labeler.service.create(
      { repo: agent.session.did, rkey: 'self' },
      record
    )
    console.log('✅ Labeler service created!')
    console.log(`   URI: ${result.uri}`)
  } catch (e) {
    if (e.message?.includes('already exists') || e.message?.includes('RecordAlreadyExists')) {
      console.log('ℹ️  Labeler service record already exists (this is OK)')
    } else {
      console.error('❌ Failed to create labeler service:', e.message)
      console.error('   Full error:', e)
      process.exit(1)
    }
  }

  console.log('\n✅ Labeler setup complete!')
  console.log('\nNext steps:')
  console.log('1. Add LABELER_IDENTIFIER and LABELER_PASSWORD to your .env file')
  console.log('2. Run: npx prisma migrate dev --name add-labeler-config')
  console.log('3. Update AppConfig in database with labelerDid')
}

setupLabeler().catch((e) => {
  console.error('Fatal error:', e)
  process.exit(1)
})
