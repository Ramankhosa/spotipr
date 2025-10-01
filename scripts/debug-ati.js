#!/usr/bin/env node

/**
 * ATI Token Debugging Script
 *
 * Debug ATI token validation issues
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// Import auth functions (replicated locally to avoid import issues)
function generateATIToken() {
  return require('crypto').randomBytes(32).toString('hex').toUpperCase()
}

function hashATIToken(token) {
  return require('bcryptjs').hashSync(token, 12)
}

async function debugToken(tokenValue) {
  console.log(`\n🔍 Debugging ATI Token: ${tokenValue.substring(0, 20)}...`)

  try {
    // Hash the token
    const tokenHash = hashATIToken(tokenValue)
    console.log(`Token Hash: ${tokenHash.substring(0, 20)}...`)

    // Find token in database
    const token = await prisma.aTIToken.findFirst({
      where: {
        tokenHash,
        status: { in: ['ACTIVE', 'ISSUED'] }
      },
      include: { tenant: true }
    })

    if (!token) {
      console.log('❌ Token not found in database')
      return
    }

    console.log('✅ Token found:')
    console.log(`  ID: ${token.id}`)
    console.log(`  Fingerprint: ${token.fingerprint}`)
    console.log(`  Status: ${token.status}`)
    console.log(`  Max Uses: ${token.maxUses}`)
    console.log(`  Usage Count: ${token.usageCount}`)
    console.log(`  Expires At: ${token.expiresAt}`)
    console.log(`  Tenant ID: ${token.tenantId}`)
    console.log(`  Tenant Name: ${token.tenant?.name}`)
    console.log(`  Tenant ATI ID: ${token.tenant?.atiId}`)

    // Check validation conditions
    const now = new Date()
    const isExpired = token.expiresAt && now > token.expiresAt
    const isUsedUp = token.maxUses && token.usageCount >= token.maxUses
    const isPlatformToken = token.tenant?.atiId === 'PLATFORM'

    console.log('\n🔍 Validation Checks:')
    console.log(`  Is Expired: ${isExpired}`)
    console.log(`  Is Used Up: ${isUsedUp}`)
    console.log(`  Is Platform Token: ${isPlatformToken}`)

    if (isExpired) {
      console.log('❌ Token is expired')
    } else if (token.status === 'REVOKED') {
      console.log('❌ Token is revoked')
    } else if (isUsedUp) {
      console.log('❌ Token usage limit reached')
    } else if (isPlatformToken) {
      console.log('❌ Token is a platform token (cannot be used for signup)')
    } else {
      console.log('✅ Token should be valid for signup')
    }

  } catch (error) {
    console.log(`❌ Error debugging token: ${error.message}`)
  }
}

async function listRecentTokens() {
  console.log('\n📋 Recent ATI Tokens:')

  try {
    const tokens = await prisma.aTIToken.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        tenant: {
          select: {
            name: true,
            atiId: true
          }
        }
      }
    })

    tokens.forEach(token => {
      console.log(`  ${token.fingerprint} | ${token.status} | ${token.usageCount}/${token.maxUses || '∞'} | ${token.tenant?.name} (${token.tenant?.atiId}) | ${token.createdAt.toISOString()}`)
    })

  } catch (error) {
    console.log(`❌ Error listing tokens: ${error.message}`)
  }
}

async function main() {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    console.log('Usage:')
    console.log('  node scripts/debug-ati.js list                    # List recent tokens')
    console.log('  node scripts/debug-ati.js debug <token_value>    # Debug specific token')
    console.log('')
    await listRecentTokens()
    return
  }

  const command = args[0]

  if (command === 'list') {
    await listRecentTokens()
  } else if (command === 'debug' && args[1]) {
    await debugToken(args[1])
  } else {
    console.log('Invalid command. Use "list" or "debug <token>"')
  }

  await prisma.$disconnect()
}

if (require.main === module) {
  main().catch(console.error)
}
