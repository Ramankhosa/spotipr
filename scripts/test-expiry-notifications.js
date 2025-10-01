#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client')
const crypto = require('crypto')
const bcrypt = require('bcryptjs')
const prisma = new PrismaClient()

// Replicate auth functions locally
function generateATIToken() {
  return crypto.randomBytes(32).toString('base64url')
}

function hashATIToken(token) {
  return bcrypt.hashSync(token, 12)
}

function createATIFingerprint(tokenHash) {
  return tokenHash.substring(tokenHash.length - 6).toUpperCase()
}

async function createTestExpiringTokens() {
  console.log('🧪 Creating test tokens with different expiry dates...\n')

  try {
    // Get existing tenants
    const tenants = await prisma.tenant.findMany({
      where: { atiId: { not: 'PLATFORM' } },
      take: 2
    })

    if (tenants.length === 0) {
      console.log('❌ No tenants found. Please create some tenants first.')
      return
    }

    const now = new Date()
    const testTokens = [
      {
        daysFromNow: 1, // Expires tomorrow
        description: 'Expires in 1 day'
      },
      {
        daysFromNow: 3, // Expires in 3 days
        description: 'Expires in 3 days'
      },
      {
        daysFromNow: 7, // Expires in 7 days
        description: 'Expires in 7 days'
      },
      {
        daysFromNow: 10, // Expires in 10 days (should not be notified)
        description: 'Expires in 10 days (outside notification window)'
      },
      {
        daysFromNow: -1, // Already expired
        description: 'Already expired'
      }
    ]

    for (let i = 0; i < testTokens.length; i++) {
      const testCase = testTokens[i]
      const tenant = tenants[i % tenants.length]
      const expiryDate = new Date(now)
      expiryDate.setDate(now.getDate() + testCase.daysFromNow)

      const rawToken = generateATIToken()
      const tokenHash = hashATIToken(rawToken)
      const fingerprint = createATIFingerprint(tokenHash)

      const token = await prisma.aTIToken.create({
        data: {
          tenantId: tenant.id,
          tokenHash,
          fingerprint,
          expiresAt: expiryDate,
          maxUses: 10,
          planTier: 'BASIC',
          status: testCase.daysFromNow > 0 ? 'ACTIVE' : 'EXPIRED',
          notes: `[TEST] ${testCase.description}`
        }
      })

      console.log(`✅ Created: ${token.fingerprint} - ${testCase.description}`)
      console.log(`   Tenant: ${tenant.name} (${tenant.atiId})`)
      console.log(`   Expiry: ${expiryDate.toISOString()}\n`)
    }

    console.log('🎉 Test tokens created successfully!')
    console.log('\n💡 You can now test the expiry notification system:')
    console.log('1. Check status: Visit Super Admin Dashboard → Expiry Notifications → Check Status')
    console.log('2. Send notifications: Click "Send Notifications" to trigger emails')
    console.log('3. Monitor logs: Check console for notification details')

  } catch (error) {
    console.error('❌ Error creating test tokens:', error)
  } finally {
    await prisma.$disconnect()
  }
}

async function checkNotificationStatus() {
  console.log('🔍 Checking current expiry notification status...\n')

  try {
    const service = require('../src/lib/notification-service').ExpiryNotificationService
    const notificationService = new service()

    const expiringTokens = await notificationService.findTokensExpiringSoon()

    console.log(`📊 Found ${expiringTokens.length} tokens expiring within 7 days:\n`)

    expiringTokens.forEach((token, index) => {
      const daysUntilExpiry = token.expiresAt ? Math.ceil(
        (token.expiresAt.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
      ) : 0

      console.log(`${index + 1}. ${token.fingerprint}`)
      console.log(`   Tenant: ${token.tenant?.name} (${token.tenant?.atiId})`)
      console.log(`   Expires: ${token.expiresAt ? token.expiresAt.toISOString() : 'No expiry'}`)
      console.log(`   Days left: ${daysUntilExpiry}`)
      console.log(`   Status: ${token.status}\n`)
    })

    if (expiringTokens.length === 0) {
      console.log('✅ No tokens expiring within 7 days.')
      console.log('💡 Run `node scripts/test-expiry-notifications.js create-test-tokens` to create test data.')
    }

  } catch (error) {
    console.error('❌ Error checking notification status:', error)
  } finally {
    await prisma.$disconnect()
  }
}

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  if (!command) {
    console.log('Usage:')
    console.log('  node scripts/test-expiry-notifications.js create-test-tokens')
    console.log('  node scripts/test-expiry-notifications.js check-status')
    return
  }

  switch (command) {
    case 'create-test-tokens':
      await createTestExpiringTokens()
      break
    case 'check-status':
      await checkNotificationStatus()
      break
    default:
      console.log('Unknown command. Use "create-test-tokens" or "check-status"')
  }
}

if (require.main === module) {
  main().catch(console.error)
}
