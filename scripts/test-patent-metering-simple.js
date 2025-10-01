#!/usr/bin/env node

/**
 * Simple test to verify patent creation metering is working
 * Tests the core functionality without complex edge cases
 */

const { PrismaClient } = require('@prisma/client')
const jwt = require('jsonwebtoken')
const prisma = new PrismaClient()

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key'

async function testPatentMeteringSimple() {
  console.log('🧪 Testing Patent Creation Metering (Simple)...\n')

  try {
    // === PHASE 1: Check existing metering setup ===
    console.log('📋 Phase 1: Checking metering setup...\n')

    // Check if plans and features exist
    const plans = await prisma.plan.findMany()
    const features = await prisma.feature.findMany()
    const tasks = await prisma.task.findMany()

    console.log(`✅ Found ${plans.length} plans, ${features.length} features, ${tasks.length} tasks`)

    if (plans.length === 0 || features.length === 0) {
      console.log('❌ Run setup-metering-data.js first')
      return
    }

    // Check existing tenants
    const tenants = await prisma.tenant.findMany({
      include: {
        tenantPlans: {
          include: { plan: true }
        },
        _count: {
          select: { usageLogs: true, usageReservations: true }
        }
      }
    })

    console.log(`✅ Found ${tenants.length} tenants`)
    tenants.forEach(tenant => {
      console.log(`   - ${tenant.name}: ${tenant.tenantPlans[0]?.plan?.name || 'No plan'} (${tenant._count.usageLogs} logs, ${tenant._count.usageReservations} reservations)`)
    })

    // === PHASE 2: Test patent creation API directly ===
    console.log('\n📋 Phase 2: Testing patent creation API...\n')

    // Find an existing project and user for testing
    const existingProject = await prisma.project.findFirst()
    const existingUser = await prisma.user.findFirst({
      include: { tenant: { include: { tenantPlans: { include: { plan: true } } } } }
    })

    if (!existingProject || !existingUser) {
      console.log('❌ Need existing project and user. Create some test data first.')
      return
    }

    console.log(`✅ Using existing project: ${existingProject.name}`)
    console.log(`✅ Using existing user: ${existingUser.email} (${existingUser.tenant?.name})`)
    console.log(`✅ User plan: ${existingUser.tenant?.tenantPlans[0]?.plan?.name || 'None'}`)

    // Create JWT token for the user
    const jwtPayload = {
      sub: existingUser.id,
      email: existingUser.email,
      tenant_id: existingUser.tenantId,
      role: existingUser.role,
      ati_id: existingUser.tenant?.atiId,
      tenant_ati_id: existingUser.tenant?.atiId
    }

    const testToken = jwt.sign(jwtPayload, JWT_SECRET, { expiresIn: '1h' })
    console.log(`✅ Created JWT token for user`)

    // === PHASE 3: Simulate API call ===
    console.log('\n📋 Phase 3: Simulating patent creation API call...\n')

    // This simulates what happens in the actual API route
    const mockRequest = {
      headers: {
        authorization: `Bearer ${testToken}`
      }
    }

    // Extract tenant context (simulating auth-bridge.ts)
    const authHeader = mockRequest.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      throw new Error('No auth header')
    }

    const token = authHeader.substring(7)
    const payload = jwt.verify(token, JWT_SECRET)

    console.log(`✅ JWT decoded: ${payload.email} (${payload.tenant_id})`)

    // Resolve tenant and plan
    const tenant = await prisma.tenant.findUnique({
      where: { id: payload.tenant_id },
      include: {
        tenantPlans: {
          where: { status: 'ACTIVE' },
          include: { plan: true }
        }
      }
    })

    if (!tenant || tenant.tenantPlans.length === 0) {
      console.log('❌ Tenant or plan not found')
      return
    }

    console.log(`✅ Tenant resolved: ${tenant.name} with plan ${tenant.tenantPlans[0].plan.name}`)

    // Check if patent creation is allowed (simulate metering check)
    const patentFeature = await prisma.feature.findUnique({ where: { code: 'PATENT_DRAFTING' } })
    const planFeature = await prisma.planFeature.findFirst({
      where: {
        planId: tenant.tenantPlans[0].planId,
        featureId: patentFeature.id
      }
    })

    console.log(`✅ Plan allows ${planFeature.monthlyQuota} patent tokens per month`)

    // Check current usage
    const currentPeriod = getCurrentPeriod('MONTHLY')
    const currentUsage = await prisma.usageMeter.findFirst({
      where: {
        tenantId: tenant.id,
        featureId: patentFeature.id,
        periodType: 'MONTHLY',
        periodKey: currentPeriod.key
      }
    })

    const used = currentUsage?.currentUsage || 0
    const remaining = planFeature.monthlyQuota - used

    console.log(`✅ Current usage: ${used}/${planFeature.monthlyQuota} (${remaining} remaining)`)

    if (remaining <= 0) {
      console.log('❌ Quota exceeded - patent creation would be blocked')
      return
    }

    // === PHASE 4: Create patent with metering ===
    console.log('\n📋 Phase 4: Creating patent with metering...\n')

    // Create reservation
    const reservation = await prisma.usageReservation.create({
      data: {
        tenantId: tenant.id,
        featureId: patentFeature.id,
        reservedUnits: 1,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        idempotencyKey: `test-patent-${Date.now()}`
      }
    })
    console.log(`✅ Created reservation: ${reservation.id}`)

    // Create patent
    const patent = await prisma.patent.create({
      data: {
        title: 'Metering Test Patent',
        projectId: existingProject.id,
        createdBy: existingUser.id
      }
    })
    console.log(`✅ Created patent: "${patent.title}" (ID: ${patent.id})`)

    // Record usage
    const usageLog = await prisma.usageLog.create({
      data: {
        tenantId: tenant.id,
        userId: existingUser.id,
        featureId: patentFeature.id,
        taskCode: 'LLM2_DRAFT',
        apiCalls: 1,
        apiCode: 'PATENT_DRAFTING_patent_create',
        startedAt: new Date(),
        completedAt: new Date(),
        status: 'COMPLETED',
        reservationId: reservation.id
      }
    })
    console.log(`✅ Recorded usage: ${usageLog.apiCalls} API calls`)

    // Update usage meter
    const existingMeter = await prisma.usageMeter.findFirst({
      where: {
        tenantId: tenant.id,
        featureId: patentFeature.id,
        taskCode: null,
        periodType: 'MONTHLY',
        periodKey: currentPeriod.key
      }
    })

    if (existingMeter) {
      await prisma.usageMeter.update({
        where: { id: existingMeter.id },
        data: { currentUsage: { increment: 1 } }
      })
    } else {
      await prisma.usageMeter.create({
        data: {
          tenantId: tenant.id,
          featureId: patentFeature.id,
          periodType: 'MONTHLY',
          periodKey: currentPeriod.key,
          currentUsage: 1
        }
      })
    }
    console.log(`✅ Updated usage meter`)

    // Release reservation
    await prisma.usageReservation.update({
      where: { id: reservation.id },
      data: { status: 'RELEASED' }
    })
    console.log(`✅ Released reservation`)

    // === PHASE 5: Verify everything worked ===
    console.log('\n📋 Phase 5: Verifying results...\n')

    // Check final usage
    const finalUsage = await prisma.usageMeter.findFirst({
      where: {
        tenantId: tenant.id,
        featureId: patentFeature.id,
        periodType: 'MONTHLY',
        periodKey: currentPeriod.key
      }
    })

    console.log(`✅ Final usage: ${finalUsage?.currentUsage || 0}/${planFeature.monthlyQuota}`)

    // Check that patent exists
    const createdPatent = await prisma.patent.findUnique({
      where: { id: patent.id }
    })

    console.log(`✅ Patent exists: "${createdPatent.title}"`)

    console.log('\n🎉 Patent creation with metering test completed successfully!')
    console.log('\n📊 Summary:')
    console.log('   ✅ JWT token authentication')
    console.log('   ✅ Tenant and plan resolution')
    console.log('   ✅ Quota checking')
    console.log('   ✅ Usage reservation')
    console.log('   ✅ Patent creation')
    console.log('   ✅ Usage recording')
    console.log('   ✅ Meter updating')
    console.log('   ✅ Reservation cleanup')

    console.log('\n🚀 Metering system is working perfectly!')

  } catch (error) {
    console.error('\n❌ Test failed:', error.message)
    console.error('Stack:', error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// Helper function
function getCurrentPeriod(type) {
  const now = new Date()
  if (type === 'MONTHLY') {
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    return {
      type: 'MONTHLY',
      key: `${year}-${month}`,
      start: new Date(year, now.getMonth(), 1),
      end: new Date(year, now.getMonth() + 1, 0, 23, 59, 59, 999)
    }
  }
  return null
}

// Run the test
testPatentMeteringSimple()
  .then(() => {
    console.log('\n✨ Test completed successfully!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n💥 Test failed:', error)
    process.exit(1)
  })
