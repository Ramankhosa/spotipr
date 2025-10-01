#!/usr/bin/env node

/**
 * Investigate why ATI user is showing as tenant admin instead of analyst
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function checkATIUserIssue() {
  try {
    const targetToken = '1wfC_BVD-Gv4RgMYI8z-b-HHPeGckrlju1lctjndLNk'

    console.log(`🔍 Investigating ATI token: ${targetToken}\n`)

    // First, check if this token exists in the database
    const tokenByRaw = await prisma.aTIToken.findFirst({
      where: { rawToken: targetToken },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            atiId: true
          }
        },
        signupUsers: {
          select: {
            id: true,
            email: true,
            role: true,
            status: true,
            createdAt: true
          }
        }
      }
    })

    if (!tokenByRaw) {
      console.log('❌ ATI token not found in database')
      console.log('   This could mean:')
      console.log('   1. Token was already used and rawToken cleared for security')
      console.log('   2. Token expired and was cleaned up')
      console.log('   3. Token was never issued')
      console.log('   4. There\'s a typo in the token')

      // Try to find tokens that might be similar or recent
      console.log('\n🔍 Checking for similar or recent tokens...')
      const recentTokens = await prisma.aTIToken.findMany({
        where: {
          status: { in: ['ACTIVE', 'ISSUED'] },
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
          }
        },
        select: {
          id: true,
          status: true,
          planTier: true,
          createdAt: true,
          tenant: {
            select: { name: true, atiId: true }
          },
          signupUsers: {
            select: { email: true, role: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 10
      })

      console.log(`Found ${recentTokens.length} recent tokens:`)
      recentTokens.forEach((token, index) => {
        const hasSignup = token.signupUsers.length > 0
        console.log(`${index + 1}. ${token.id} - ${token.status} - ${token.planTier} - ${token.tenant?.name || 'No tenant'} - ${hasSignup ? 'Used' : 'Unused'}`)
        if (hasSignup) {
          token.signupUsers.forEach(user => {
            console.log(`    User: ${user.email} (${user.role})`)
          })
        }
      })

      return
    }

    console.log('✅ Found ATI token in database:')
    console.log(`   Token ID: ${tokenByRaw.id}`)
    console.log(`   Status: ${tokenByRaw.status}`)
    console.log(`   Plan Tier: ${tokenByRaw.planTier}`)
    console.log(`   Expires: ${tokenByRaw.expiresAt || 'Never'}`)
    console.log(`   Issued by Tenant: ${tokenByRaw.tenant?.name} (${tokenByRaw.tenant?.atiId})`)

    // Check if token was used for signup
    if (tokenByRaw.signupUsers.length === 0) {
      console.log('\n❌ Token has not been used for signup yet')
      console.log('   Status should be ACTIVE or ISSUED for unused tokens')
      return
    }

    console.log(`\n👥 Token was used by ${tokenByRaw.signupUsers.length} user(s):`)
    tokenByRaw.signupUsers.forEach((user, index) => {
      console.log(`${index + 1}. User: ${user.email}`)
      console.log(`    Role: ${user.role} ❌ (Should be ANALYST)`)
      console.log(`    Status: ${user.status}`)
      console.log(`    Created: ${user.createdAt}`)
      console.log('')
    })

    // Check the tenant admin who issued this token
    console.log('🔍 Checking token issuer (tenant admin)...')

    const issuerUsers = await prisma.user.findMany({
      where: { tenantId: tokenByRaw.tenantId },
      select: {
        id: true,
        email: true,
        role: true,
        signupAtiTokenId: true
      }
    })

    console.log(`Tenant ${tokenByRaw.tenant?.name} has ${issuerUsers.length} users:`)
    issuerUsers.forEach(user => {
      console.log(`   - ${user.email} (${user.role}) - Signup Token: ${user.signupAtiTokenId || 'None'}`)
    })

    // Check what role the signup process assigned
    console.log('\n🔍 Analyzing signup logic issue...')

    const analystUser = tokenByRaw.signupUsers[0] // Assuming first user

    if (analystUser.role !== 'ANALYST') {
      console.log('❌ ISSUE FOUND: User was assigned wrong role')
      console.log(`   Expected: ANALYST`)
      console.log(`   Actual: ${analystUser.role}`)
      console.log('')
      console.log('🔧 Possible causes:')
      console.log('   1. Signup route logic assigns OWNER/ADMIN for first user in tenant')
      console.log('   2. ATI token type should determine role (employee tokens = ANALYST)')
      console.log('   3. Token was issued by super admin instead of tenant admin')
      console.log('   4. Signup flow doesn\'t distinguish between tenant creation vs employee joining')
    }

    // Check if this token was issued by super admin vs tenant admin
    const tokenIssuer = issuerUsers.find(user => user.signupAtiTokenId !== tokenByRaw.id)
    if (tokenIssuer) {
      console.log(`\n📋 Token issuer analysis:`)
      console.log(`   Token issued by: ${tokenIssuer.email} (${tokenIssuer.role})`)

      if (tokenIssuer.role === 'OWNER' || tokenIssuer.role === 'ADMIN') {
        console.log(`   ✅ Correctly issued by tenant admin`)
      } else if (tokenIssuer.role === 'SUPER_ADMIN') {
        console.log(`   ⚠️  Issued by super admin - this creates tenant admin accounts, not analysts`)
      }
    }

  } catch (error) {
    console.error('❌ Error investigating ATI user issue:', error.message)
    console.error('Stack:', error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the investigation
checkATIUserIssue()

