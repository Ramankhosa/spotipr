#!/usr/bin/env node

/**
 * Diagnose and fix ATI token setup for analyst user
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function diagnoseAndFixATI() {
  console.log('🔍 Diagnosing ATI token setup for analyst user...\n')

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
    console.log(`   Tenant: ${analyst.tenant?.name} (${analyst.tenant?.atiId})`)
    console.log(`   Tenant ID: ${analyst.tenantId}`)
    console.log()

    // Check ATI tokens for this tenant
    const atiTokens = await prisma.aTIToken.findMany({
      where: { tenantId: analyst.tenantId },
      select: {
        id: true,
        status: true,
        planTier: true,
        fingerprint: true,
        createdAt: true
      }
    })

    console.log('🎫 ATI Tokens for tenant:')
    if (atiTokens.length === 0) {
      console.log('   ❌ No ATI tokens found for this tenant')

      // Create missing ATI token
      console.log('   🔧 Creating missing ATI token...')

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
          notes: 'Analyst ATI Token - Auto-created',
          maxUses: 100
        }
      })

      console.log('   ✅ Created ATI token:')
      console.log(`      ID: ${newToken.id}`)
      console.log(`      Status: ${newToken.status}`)
      console.log(`      Plan: ${newToken.planTier}`)
      console.log(`      Raw Token: ${rawToken}`)

    } else {
      console.log(`   Found ${atiTokens.length} tokens:`)
      atiTokens.forEach((token, i) => {
        console.log(`   ${i + 1}. Status: ${token.status}, Plan: ${token.planTier}, Created: ${token.createdAt.toISOString()}`)
      })

      // Check if any token has ISSUED status
      const issuedTokens = atiTokens.filter(t => t.status === 'ISSUED')
      if (issuedTokens.length === 0) {
        console.log('   ❌ No tokens with ISSUED status found')

        // Update the first token to ISSUED status
        const firstToken = atiTokens[0]
        await prisma.aTIToken.update({
          where: { id: firstToken.id },
          data: { status: 'ISSUED' }
        })

        console.log('   ✅ Updated first token to ISSUED status')
      } else {
        console.log('   ✅ Found ISSUED tokens - policy should work')
      }
    }

    // Check tenant plan assignment
    const tenantPlans = await prisma.tenantPlan.findMany({
      where: { tenantId: analyst.tenantId },
      include: { plan: true }
    })

    console.log('\n📋 Tenant Plan Assignments:')
    if (tenantPlans.length === 0) {
      console.log('   ❌ No plan assignments found')

      // Assign PRO_PLAN
      const proPlan = await prisma.plan.findUnique({ where: { code: 'PRO_PLAN' } })
      if (proPlan) {
        await prisma.tenantPlan.create({
          data: {
            tenantId: analyst.tenantId,
            planId: proPlan.id,
            effectiveFrom: new Date(),
            status: 'ACTIVE'
          }
        })
        console.log('   ✅ Assigned PRO_PLAN to tenant')
      }
    } else {
      tenantPlans.forEach(tp => {
        console.log(`   - ${tp.plan.name} (${tp.plan.code}) - ${tp.status}`)
      })
    }

    console.log('\n🎉 ATI token diagnosis complete!')

  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  diagnoseAndFixATI()
}
