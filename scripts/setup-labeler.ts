/**
 * Setup Labeler Service Declaration
 * 
 * This script publishes the app.bsky.labeler.service record
 * to declare the account as a labeler.
 * 
 * Usage:
 *   npx ts-node scripts/setup-labeler.ts
 * 
 * You will be prompted for the password.
 */

import { BskyAgent } from '@atproto/api'
import * as readline from 'readline'

const LABELER_HANDLE = 'diwinters.bsky.social'
const LABELER_DID = 'did:plc:cakurfpvnvbtgzwazeriujxn'

async function promptPassword(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question('Enter password for ' + LABELER_HANDLE + ': ', (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

async function setupLabeler() {
  console.log('🏷️  Raceef Labeler Setup')
  console.log('========================\n')
  console.log(`Handle: ${LABELER_HANDLE}`)
  console.log(`DID: ${LABELER_DID}\n`)

  const password = await promptPassword()

  console.log('\n🔐 Logging in...')
  const agent = new BskyAgent({ service: 'https://bsky.social' })
  
  try {
    await agent.login({
      identifier: LABELER_HANDLE,
      password,
    })
  } catch (e: any) {
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
      { repo: agent.session!.did, rkey: 'self' },
      record
    )
    console.log('✅ Labeler service created!')
    console.log(`   URI: ${result.uri}`)
  } catch (e: any) {
    if (e.message?.includes('already exists') || e.message?.includes('RecordAlreadyExists')) {
      console.log('ℹ️  Labeler service record already exists (this is OK)')
    } else {
      console.error('❌ Failed to create labeler service:', e.message)
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
