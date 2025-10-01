// Simple Metering Control Test - Database Direct
// Tests metering logic without complex TypeScript imports

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function setupTestTenant() {
  console.log('🔧 Setting up test tenant...')

  // Create test tenant
  const tenant = await prisma.tenant.upsert({
    where: { atiId: 'test-tenant-456' },
    update: { name: 'Test Tenant', status: 'ACTIVE' },
    create: {
      id: 'test-tenant-456',
      atiId: 'test-tenant-456',
      name: 'Test Tenant',
      status: 'ACTIVE'
    }
  })

  // Create ATI token
  await prisma.aTIToken.upsert({
    where: { id: 'test-ati-token-456' },
    update: { tenantId: tenant.id, planTier: 'FREE' },
    create: {
      id: 'test-ati-token-456',
      tenantId: tenant.id,
      tokenHash: 'hash456',
      rawToken: 'test-ati-token-456',
      fingerprint: 'fp456',
      status: 'ISSUED',
      planTier: 'FREE'
    }
  })

  // Create FREE plan if it doesn't exist
  const plan = await prisma.plan.upsert({
    where: { code: 'FREE' },
    update: { name: 'Free Plan', status: 'ACTIVE' },
    create: {
      id: 'free-plan-456',
      code: 'FREE',
      name: 'Free Plan',
      cycle: 'MONTHLY',
      status: 'ACTIVE'
    }
  })

  // Create feature
  const feature = await prisma.feature.upsert({
    where: { code: 'PATENT_DRAFTING' },
    update: { name: 'Patent Drafting', unit: 'tokens' },
    create: {
      id: 'patent-drafting-feature-456',
      code: 'PATENT_DRAFTING',
      name: 'Patent Drafting',
      unit: 'tokens'
    }
  })

  // Create plan feature with low limits for testing
  await prisma.planFeature.upsert({
    where: { planId_featureId: { planId: plan.id, featureId: feature.id } },
    update: { monthlyQuota: 50, dailyQuota: 5 },
    create: {
      planId: plan.id,
      featureId: feature.id,
      monthlyQuota: 50,
      dailyQuota: 5
    }
  })

  console.log('✅ Test tenant setup complete')
  return { tenant, plan, feature }
}

async function testIdentityResolution() {
  console.log('\n1️⃣ Testing Identity Resolution...')

  // Test valid ATI token
  const atiToken = await prisma.aTIToken.findFirst({
    where: { rawToken: 'test-ati-token-456' },
    include: { tenant: true }
  })

  if (atiToken?.planTier === 'FREE' && atiToken.tenant.status === 'ACTIVE') {
    console.log('✅ Valid ATI token resolution')
  } else {
    console.log('❌ ATI token resolution failed')
  }

  // Test invalid ATI token
  const invalidToken = await prisma.aTIToken.findFirst({
    where: { rawToken: 'invalid-token' }
  })

  if (!invalidToken) {
    console.log('✅ Invalid ATI token correctly rejected')
  } else {
    console.log('❌ Invalid ATI token incorrectly accepted')
  }
}

async function testQuotaEnforcement(feature) {
  console.log('\n2️⃣ Testing Quota Enforcement...')

  const tenantId = 'test-tenant-456'
  const featureId = feature.id

  // Get plan limits
  const atiToken = await prisma.aTIToken.findFirst({
    where: { tenantId, status: 'ISSUED' },
    select: { planTier: true }
  })

  const planFeature = await prisma.planFeature.findFirst({
    where: {
      plan: { code: atiToken.planTier },
      feature: { id: featureId }
    }
  })

  console.log(`📊 Plan limits - Monthly: ${planFeature.monthlyQuota}, Daily: ${planFeature.dailyQuota}`)

  // Simulate usage by creating usage meters
  const today = new Date().toISOString().split('T')[0]

  // Create some usage
  await prisma.usageMeter.upsert({
    where: {
      tenantId_featureId_taskCode_periodType_periodKey: {
        tenantId,
        featureId: featureId,
        taskCode: 'LLM2_DRAFT',
        periodType: 'DAILY',
        periodKey: today
      }
    },
    update: { currentUsage: 3 }, // Used 3 out of 5 daily limit
    create: {
      tenantId,
      featureId: featureId,
      taskCode: 'LLM2_DRAFT',
      periodType: 'DAILY',
      periodKey: today,
      currentUsage: 3
    }
  })

  // Check current usage
  const meter = await prisma.usageMeter.findFirst({
    where: {
      tenantId,
      featureId: featureId,
      periodType: 'DAILY',
      periodKey: today
    }
  })

  const remaining = planFeature.dailyQuota - meter.currentUsage
  const allowed = remaining > 0

  console.log(`📊 Current usage: ${meter.currentUsage}/${planFeature.dailyQuota}`)
  console.log(`📊 Remaining: ${remaining} (${allowed ? '✅ Allowed' : '❌ Blocked'})`)

  return allowed
}

async function testReservationSystem() {
  console.log('\n3️⃣ Testing Reservation System...')

  const tenantId = 'test-tenant-456'

  // Create reservation
  const reservation = await prisma.usageReservation.create({
    data: {
      tenantId,
      featureId: 'PATENT_DRAFTING',
      taskCode: 'LLM2_DRAFT',
      reservedUnits: 10,
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 300000), // 5 minutes
      idempotencyKey: 'test-reservation-456'
    }
  })

  console.log(`✅ Reservation created: ${reservation.id}`)

  // Test idempotency - should fail with unique constraint
  try {
    await prisma.usageReservation.create({
      data: {
        tenantId,
        featureId: 'patent-drafting-feature-456',
        taskCode: 'LLM2_DRAFT',
        reservedUnits: 10,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 300000),
        idempotencyKey: 'test-reservation-456' // Same key - should fail
      }
    })
    console.log('❌ Idempotency failed - duplicate creation allowed')
  } catch (error) {
    if (error.code === 'P2002') {
      console.log('✅ Idempotency works - duplicate creation prevented')
    } else {
      console.log('❌ Unexpected error during idempotency test:', error.message)
    }
  }

  // Test concurrency limits
  const activeReservations = await prisma.usageReservation.count({
    where: {
      tenantId,
      taskCode: 'LLM2_DRAFT',
      status: 'ACTIVE',
      expiresAt: { gt: new Date() }
    }
  })

  console.log(`📊 Active reservations: ${activeReservations}`)

  return reservation.id
}

async function testUsageRecording(reservationId, feature) {
  console.log('\n4️⃣ Testing Usage Recording...')

  const featureId = feature.id

  // Record usage
  await prisma.usageLog.create({
    data: {
      tenantId: 'test-tenant-456',
      userId: 'test-user-456',
      featureId: featureId,
      taskCode: 'LLM2_DRAFT',
      modelClass: 'BASE_S',
      apiCode: 'GEMINI',
      inputTokens: 50,
      outputTokens: 25,
      startedAt: new Date(Date.now() - 5000), // 5 seconds ago
      completedAt: new Date(),
      status: 'COMPLETED',
      idempotencyKey: reservationId,
      reservationId
    }
  })

  // Update usage meter
  const today = new Date().toISOString().split('T')[0]
  await prisma.usageMeter.upsert({
    where: {
      tenantId_featureId_taskCode_periodType_periodKey: {
        tenantId: 'test-tenant-456',
        featureId: featureId,
        taskCode: 'LLM2_DRAFT',
        periodType: 'DAILY',
        periodKey: today
      }
    },
    update: { currentUsage: { increment: 25 } },
    create: {
      tenantId: 'test-tenant-456',
      featureId: featureId,
      taskCode: 'LLM2_DRAFT',
      periodType: 'DAILY',
      periodKey: today,
      currentUsage: 25
    }
  })

  // Mark reservation as completed
  await prisma.usageReservation.update({
    where: { id: reservationId },
    data: { status: 'COMPLETED' }
  })

  console.log('✅ Usage recorded successfully')

  // Check updated usage
  const meter = await prisma.usageMeter.findFirst({
    where: {
      tenantId: 'test-tenant-456',
      featureId: featureId,
      periodType: 'DAILY',
      periodKey: today
    }
  })

  console.log(`📊 Updated usage: ${meter.currentUsage}`)
}

async function testQuotaAlerts(feature) {
  console.log('\n5️⃣ Testing Quota Alerts...')

  // Get current usage percentage
  const tenantId = 'test-tenant-456'
  const featureId = feature.id

  const atiToken = await prisma.aTIToken.findFirst({
    where: { tenantId, status: 'ISSUED' },
    select: { planTier: true }
  })

  const planFeature = await prisma.planFeature.findFirst({
    where: {
      plan: { code: atiToken.planTier },
      feature: { id: featureId }
    }
  })

  const today = new Date().toISOString().split('T')[0]
  const meter = await prisma.usageMeter.findFirst({
    where: {
      tenantId,
      featureId: featureId,
      periodType: 'DAILY',
      periodKey: today
    }
  })

  const usagePercentage = (meter.currentUsage / planFeature.dailyQuota) * 100
  console.log(`📊 Usage percentage: ${usagePercentage.toFixed(1)}%`)

  // Create alert if over 80%
  if (usagePercentage >= 80) {
    // Check if alert already exists
    const existingAlert = await prisma.quotaAlert.findFirst({
      where: {
        tenantId,
        featureId: featureId,
        taskCode: 'LLM2_DRAFT'
      }
    })

    if (existingAlert) {
      // Update existing alert
      await prisma.quotaAlert.update({
        where: { id: existingAlert.id },
        data: {
          alertType: usagePercentage >= 100 ? 'QUOTA_EXCEEDED' : 'QUOTA_WARNING',
          threshold: Math.floor(usagePercentage),
          notifiedAt: new Date()
        }
      })
    } else {
      // Create new alert
      await prisma.quotaAlert.create({
        data: {
          tenantId,
          featureId: featureId,
          taskCode: 'LLM2_DRAFT',
          alertType: usagePercentage >= 100 ? 'QUOTA_EXCEEDED' : 'QUOTA_WARNING',
          threshold: Math.floor(usagePercentage)
        }
      })
    }

    console.log('🚨 Quota alert created')
  } else {
    console.log('✅ No quota alert needed')
  }
}

async function cleanupTestData() {
  console.log('\n🧹 Cleaning up test data...')

  try {
    await prisma.quotaAlert.deleteMany({ where: { tenantId: 'test-tenant-456' } })
    await prisma.usageLog.deleteMany({ where: { tenantId: 'test-tenant-456' } })
    await prisma.usageMeter.deleteMany({ where: { tenantId: 'test-tenant-456' } })
    await prisma.usageReservation.deleteMany({ where: { tenantId: 'test-tenant-456' } })
    await prisma.aTIToken.deleteMany({ where: { tenantId: 'test-tenant-456' } })
    await prisma.tenant.deleteMany({ where: { id: 'test-tenant-456' } })

    console.log('✅ Test data cleaned up')
  } catch (error) {
    console.warn('⚠️  Cleanup failed:', error.message)
  }
}

async function runMeteringTests() {
  try {
    const testData = await setupTestTenant()

    await testIdentityResolution()
    const quotaAllowed = await testQuotaEnforcement(testData.feature)
    const reservationId = await testReservationSystem()

    if (reservationId && quotaAllowed) {
      await testUsageRecording(reservationId, testData.feature)
      await testQuotaAlerts(testData.feature)
    }

    console.log('\n🎉 All metering control tests completed!')

  } finally {
    await cleanupTestData()
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  runMeteringTests().catch(console.error)
}

module.exports = { runMeteringTests }
