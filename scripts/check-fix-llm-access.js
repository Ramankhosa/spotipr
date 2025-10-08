#!/usr/bin/env node

/**
 * Check and fix LLM access for analyst user
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function checkAndFixLLMAccess() {
  console.log('🔧 Checking LLM access configuration...\n')

  try {
    // 1. Check if PRO_PLAN exists and has LLM access
    const proPlan = await prisma.plan.findUnique({
      where: { code: 'PRO_PLAN' },
      include: {
        planLLMAccess: { include: { defaultClass: true } }
      }
    })

    if (!proPlan) {
      console.log('❌ PRO_PLAN not found')
      return
    }

    console.log('📋 PRO_PLAN found')

    // Check LLM access for PRIOR_ART
    const priorArtAccess = proPlan.planLLMAccess.find(access => access.taskCode === 'LLM1_PRIOR_ART')
    if (!priorArtAccess) {
      console.log('❌ LLM1_PRIOR_ART access not configured for PRO_PLAN')

      // Get required entities
      const priorArtFeature = await prisma.feature.findUnique({ where: { code: 'PRIOR_ART_SEARCH' } })
      const proModelClass = await prisma.lLMModelClass.findUnique({ where: { code: 'PRO_M' } })

      if (!priorArtFeature || !proModelClass) {
        console.log('❌ Missing required entities')
        return
      }

      // Create LLM access
      await prisma.planLLMAccess.create({
        data: {
          planId: proPlan.id,
          taskCode: 'LLM1_PRIOR_ART',
          allowedClasses: JSON.stringify(['BASE_S', 'PRO_M']),
          defaultClassId: proModelClass.id
        }
      })

      console.log('✅ Created LLM1_PRIOR_ART access for PRO_PLAN')
    } else {
      console.log('✅ LLM1_PRIOR_ART access already configured')
    }

    // 2. Check tenant assignment
    const testTenant = await prisma.tenant.findUnique({ where: { atiId: 'TESTTENANT' } })
    if (!testTenant) {
      console.log('❌ TESTTENANT not found')
      return
    }

    const tenantPlan = await prisma.tenantPlan.findFirst({
      where: { tenantId: testTenant.id, planId: proPlan.id }
    })

    if (!tenantPlan) {
      await prisma.tenantPlan.create({
        data: {
          tenantId: testTenant.id,
          planId: proPlan.id,
          effectiveFrom: new Date(),
          status: 'ACTIVE'
        }
      })
      console.log('✅ Assigned PRO_PLAN to TESTTENANT')
    } else {
      console.log('✅ TESTTENANT already assigned to PRO_PLAN')
    }

    // 3. Check ATI tokens with ISSUED status
    const issuedTokens = await prisma.aTIToken.findMany({
      where: { tenantId: testTenant.id, status: 'ISSUED' }
    })

    if (issuedTokens.length === 0) {
      console.log('❌ No ISSUED ATI tokens found for TESTTENANT')

      // Clean up old tokens
      await prisma.aTIToken.deleteMany({
        where: { tenantId: testTenant.id }
      })

      // Create new ISSUED token
      const crypto = require('crypto')
      const bcrypt = require('bcryptjs')

      const rawToken = crypto.randomBytes(32).toString('hex').toUpperCase()
      const tokenHash = bcrypt.hashSync(rawToken, 12)
      const fingerprint = tokenHash.substring(tokenHash.length - 6).toUpperCase()

      await prisma.aTIToken.create({
        data: {
          tenantId: testTenant.id,
          tokenHash,
          rawToken,
          rawTokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000),
          fingerprint,
          status: 'ISSUED',
          planTier: 'PRO_PLAN',
          notes: 'Analyst LLM Access Token',
          maxUses: 100
        }
      })

      console.log('✅ Created ISSUED ATI token for TESTTENANT')
      console.log('🔑 Token:', rawToken)
    } else {
      console.log('✅ ISSUED ATI tokens found:', issuedTokens.length)
    }

    // 4. Check analyst user
    const analyst = await prisma.user.findUnique({
      where: { email: 'analyst@spotipr.com' },
      include: { tenant: true }
    })

    if (!analyst) {
      console.log('❌ Analyst user not found')
      return
    }

    console.log('👤 Analyst user found:', analyst.email)
    console.log('🏢 Tenant:', analyst.tenant?.name, '(', analyst.tenant?.atiId, ')')

    console.log('\n🎉 LLM access configuration complete!')

  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  checkAndFixLLMAccess()
}
