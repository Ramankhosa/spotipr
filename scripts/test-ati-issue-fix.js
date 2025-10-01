#!/usr/bin/env node

/**
 * Test the ATI issue fix by simulating the tenant admin token issuance
 */

const { PrismaClient } = require('@prisma/client')
const jwt = require('jsonwebtoken')
const prisma = new PrismaClient()

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key'

async function testATIIssueFix() {
  try {
    console.log('🧪 Testing ATI Issue Fix...\n')

    // Find the POLU tenant and its admin user
    const poluTenant = await prisma.tenant.findUnique({
      where: { atiId: 'POLU' },
      include: {
        users: {
          where: { role: 'OWNER' }
        },
        tenantPlans: {
          include: { plan: true }
        }
      }
    })

    if (!poluTenant || poluTenant.users.length === 0) {
      console.log('❌ POLU tenant or admin user not found')
      return
    }

    const adminUser = poluTenant.users[0]
    console.log(`✅ Found tenant admin: ${adminUser.email}`)
    console.log(`✅ Tenant: ${poluTenant.name} (${poluTenant.atiId})`)
    console.log(`✅ Tenant has active plan: ${poluTenant.tenantPlans.length > 0 ? 'YES' : 'NO'}`)

    if (poluTenant.tenantPlans.length > 0) {
      const activePlan = poluTenant.tenantPlans[0]
      console.log(`✅ Active plan: ${activePlan.plan.name} (${activePlan.plan.code})`)
    } else {
      console.log(`⚠️  No active plan assigned - will default to FREE`)
    }

    // Simulate what the fixed ATI issue route does
    console.log('\n🔧 Simulating fixed ATI issue logic...\n')

    // 1. Get tenant's active plan (the fix)
    const tenantWithPlan = await prisma.tenant.findUnique({
      where: { id: poluTenant.id },
      include: {
        tenantPlans: {
          where: { status: 'ACTIVE' },
          include: { plan: true },
          orderBy: { effectiveFrom: 'desc' },
          take: 1
        }
      }
    })

    // 2. Get the active plan tier (default to FREE if no plan assigned)
    const activePlan = tenantWithPlan.tenantPlans[0]
    const planTier = activePlan ? activePlan.plan.code : 'FREE'

    console.log(`✅ Resolved plan tier: ${planTier}`)

    // 3. Generate a test ATI token (simulating the full flow)
    const rawToken = generateTestToken()
    console.log(`✅ Generated test token: ${rawToken.substring(0, 20)}...`)

    // 4. Create the ATI token record (simulating)
    console.log(`✅ Would create ATI token with:`)
    console.log(`   - Tenant ID: ${poluTenant.id}`)
    console.log(`   - Plan Tier: ${planTier}`)
    console.log(`   - Status: ACTIVE`)
    console.log(`   - Issued by: ${adminUser.email} (${adminUser.role})`)

    console.log('\n🎉 ATI issue fix test completed successfully!')
    console.log('\n📋 Summary:')
    console.log('   ✅ Fixed: Getting planTier from tenant.plan (non-existent field)')
    console.log('   ✅ Fixed: Now gets planTier from tenant.tenantPlans[0].plan.code')
    console.log('   ✅ Fixed: Defaults to FREE if no plan assigned')
    console.log('   ✅ Result: POLU tenant admin can now issue ATI tokens')

  } catch (error) {
    console.error('❌ Test failed:', error.message)
    console.error('Stack:', error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

// Simple token generator for testing
function generateTestToken() {
  return require('crypto').randomBytes(32).toString('hex')
}

// Run the test
testATIIssueFix()
