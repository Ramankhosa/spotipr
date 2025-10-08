#!/usr/bin/env node

/**
 * Fix analyst user's signup ATI token association
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function fixAnalystSignupToken() {
  console.log('🔧 Fixing analyst signup ATI token association...\n')

  try {
    // Find the analyst user
    const analyst = await prisma.user.findUnique({
      where: { email: 'analyst@spotipr.com' },
      include: { tenant: true }
    })

    if (!analyst) {
      console.log('❌ Analyst user not found')
      return
    }

    console.log('👤 Analyst user found:')
    console.log(`   Email: ${analyst.email}`)
    console.log(`   Tenant: ${analyst.tenant?.name}`)
    console.log(`   Current signupAtiTokenId: ${analyst.signupAtiTokenId}`)
    console.log()

    if (analyst.signupAtiTokenId) {
      // Check if the signup token exists
      const existingToken = await prisma.aTIToken.findUnique({
        where: { id: analyst.signupAtiTokenId }
      })

      if (existingToken) {
        console.log('✅ Signup ATI token exists and is valid')
        console.log(`   Token ID: ${existingToken.id}`)
        console.log(`   Status: ${existingToken.status}`)
        console.log(`   Plan: ${existingToken.planTier}`)
        return
      } else {
        console.log('❌ Signup ATI token referenced by user does not exist')
      }
    }

    // Find a valid ISSUED token for this tenant
    const validToken = await prisma.aTIToken.findFirst({
      where: {
        tenantId: analyst.tenantId,
        status: 'ISSUED'
      },
      orderBy: { createdAt: 'desc' }
    })

    if (!validToken) {
      console.log('❌ No valid ISSUED ATI tokens found for analyst tenant')

      // Create a new signup token
      console.log('🔧 Creating new signup ATI token...')

      const crypto = require('crypto')
      const bcrypt = require('bcryptjs')

      const rawToken = crypto.randomBytes(32).toString('hex').toUpperCase()
      const tokenHash = bcrypt.hashSync(rawToken, 12)
      const fingerprint = tokenHash.substring(tokenHash.length - 6).toUpperCase()

      const newToken = await prisma.aTIToken.create({
        data: {
          tenantId: analyst.tenantId,
          tokenHash,
          rawToken,
          rawTokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000),
          fingerprint,
          status: 'ISSUED',
          planTier: 'PRO_PLAN',
          notes: 'Analyst Signup Token',
          maxUses: 1
        }
      })

      console.log('✅ Created new signup token for analyst')

      // Update user with the new token
      await prisma.user.update({
        where: { id: analyst.id },
        data: { signupAtiTokenId: newToken.id }
      })

      console.log('✅ Updated analyst user with new signup token')
      console.log(`   New signup token: ${rawToken}`)

    } else {
      console.log('✅ Found existing valid ISSUED token')
      console.log(`   Token ID: ${validToken.id}`)
      console.log(`   Status: ${validToken.status}`)
      console.log(`   Plan: ${validToken.planTier}`)

      // Update user to use this token
      await prisma.user.update({
        where: { id: analyst.id },
        data: { signupAtiTokenId: validToken.id }
      })

      console.log('✅ Updated analyst user to use existing valid token')
    }

    console.log('\n🎉 Analyst signup token association fixed!')

  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  fixAnalystSignupToken()
}
