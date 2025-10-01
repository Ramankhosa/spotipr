#!/usr/bin/env node

/**
 * Check ATI token details
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function checkATIToken() {
  try {
    const tokenToCheck = process.argv[2] || 'mQbR9dkJJ8jVDKh8XIsI-kh7wGrtkyE2choZRAfNcTs'

    console.log(`🔍 Checking ATI token: ${tokenToCheck}\n`)

    // Find the token by raw token (if it exists)
    const tokenByRaw = await prisma.aTIToken.findFirst({
      where: { rawToken: tokenToCheck },
      include: {
        tenant: {
          include: {
            tenantPlans: {
              include: { plan: true }
            },
            users: {
              where: { role: 'ADMIN' },
              select: { id: true, email: true, role: true }
            }
          }
        },
        signupUsers: {
          select: { id: true, email: true, role: true }
        }
      }
    })

    if (tokenByRaw) {
      console.log('✅ Found ATI token by raw token:')
      console.log(`   Token ID: ${tokenByRaw.id}`)
      console.log(`   Status: ${tokenByRaw.status}`)
      console.log(`   Plan Tier: ${tokenByRaw.planTier}`)
      console.log(`   Expires: ${tokenByRaw.expiresAt || 'Never'}`)
      console.log(`   Max Uses: ${tokenByRaw.maxUses || 'Unlimited'}`)
      console.log(`   Current Uses: ${tokenByRaw.usageCount}`)

      if (tokenByRaw.tenant) {
        console.log(`   Tenant: ${tokenByRaw.tenant.name} (${tokenByRaw.tenant.atiId})`)
        console.log(`   Tenant Status: ${tokenByRaw.tenant.status}`)

        if (tokenByRaw.tenant.tenantPlans.length > 0) {
          const activePlan = tokenByRaw.tenant.tenantPlans[0]
          console.log(`   Tenant Plan: ${activePlan.plan.name} (${activePlan.plan.code})`)
        }

        if (tokenByRaw.tenant.users.length > 0) {
          console.log(`   Tenant Admins: ${tokenByRaw.tenant.users.length}`)
          tokenByRaw.tenant.users.forEach(user => {
            console.log(`     - ${user.email} (${user.role})`)
          })
        }
      }

      if (tokenByRaw.signupUsers.length > 0) {
        console.log(`   Signup Users: ${tokenByRaw.signupUsers.length}`)
        tokenByRaw.signupUsers.forEach(user => {
          console.log(`     - ${user.email} (${user.role})`)
        })
      }

      return
    }

    // If not found by raw token, try to find by fingerprint or hash
    console.log('❌ Token not found by raw token')

    // Check recent tokens
    console.log('\n🔍 Checking recent ATI tokens...')
    const recentTokens = await prisma.aTIToken.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        tenant: {
          select: { name: true, atiId: true }
        }
      }
    })

    if (recentTokens.length > 0) {
      console.log('Recent ATI tokens:')
      recentTokens.forEach((token, index) => {
        console.log(`${index + 1}. ${token.id} - ${token.status} - ${token.planTier} - ${token.tenant?.name || 'No tenant'}`)
      })
    }

  } catch (error) {
    console.error('❌ Error checking ATI token:', error.message)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the script
const tokenArg = process.argv[2]
if (!tokenArg) {
  console.log('Usage: node scripts/check-ati-token.js <token>')
  console.log('Example: node scripts/check-ati-token.js mQbR9dkJJ8jVDKh8XIsI-kh7wGrtkyE2choZRAfNcTs')
  process.exit(1)
}

checkATIToken()
