// Populate test data for analytics testing
// Creates mock usage logs for testing dashboards

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function populateAnalyticsData() {
  console.log('🔧 Populating analytics test data...')

  try {
    // Create test tenant and user for analytics
    const tenant = await prisma.tenant.upsert({
      where: { atiId: 'analytics-tenant-123' },
      update: { name: 'Analytics Test Tenant', status: 'ACTIVE' },
      create: {
        id: 'analytics-tenant-123',
        atiId: 'analytics-tenant-123',
        name: 'Analytics Test Tenant',
        status: 'ACTIVE'
      }
    })

    const user = await prisma.user.upsert({
      where: { email: 'analytics@example.com' },
      update: { tenantId: tenant.id },
      create: {
        id: 'analytics-user-123',
        tenantId: tenant.id,
        email: 'analytics@example.com',
        passwordHash: 'hashed-password',
        name: 'Analytics User',
        role: 'ANALYST',
        status: 'ACTIVE'
      }
    })

    // Create ATI token and plan
    await prisma.aTIToken.upsert({
      where: { id: 'analytics-ati-token-123' },
      update: { tenantId: tenant.id, planTier: 'PRO' },
      create: {
        id: 'analytics-ati-token-123',
        tenantId: tenant.id,
        tokenHash: 'hash123',
        rawToken: 'analytics-ati-token-123',
        fingerprint: 'fp123',
        status: 'ISSUED',
        planTier: 'PRO'
      }
    })

    // Create PRO plan
    await prisma.plan.upsert({
      where: { code: 'PRO' },
      update: { name: 'Pro Plan', status: 'ACTIVE' },
      create: {
        id: 'pro-plan-123',
        code: 'PRO',
        name: 'Pro Plan',
        cycle: 'MONTHLY',
        status: 'ACTIVE'
      }
    })

    // Create feature (use existing enum value)
    const feature = await prisma.feature.upsert({
      where: { code: 'PATENT_DRAFTING' },
      update: { name: 'Patent Drafting', unit: 'tokens' },
      create: {
        id: 'analytics-patent-drafting',
        code: 'PATENT_DRAFTING',
        name: 'Patent Drafting',
        unit: 'tokens'
      }
    })

    // Create plan feature
    await prisma.planFeature.upsert({
      where: { planId_featureId: { planId: 'pro-plan-123', featureId: feature.id } },
      update: { monthlyQuota: 10000, dailyQuota: 500 },
      create: {
        planId: 'pro-plan-123',
        featureId: feature.id,
        monthlyQuota: 10000,
        dailyQuota: 500
      }
    })

    console.log(`📊 Generating usage data for tenant: ${tenant.name}`)

    // Generate usage logs for the last 30 days
    const now = new Date()
    const logs = []

    for (let i = 0; i < 30; i++) {
      const date = new Date(now)
      date.setDate(date.getDate() - i)

      // Create 5-15 random usage logs per day
      const logsPerDay = Math.floor(Math.random() * 10) + 5

      for (let j = 0; j < logsPerDay; j++) {
        const hour = Math.floor(Math.random() * 24)
        const minute = Math.floor(Math.random() * 60)
        const startedAt = new Date(date)
        startedAt.setHours(hour, minute, 0, 0)

        const inputTokens = Math.floor(Math.random() * 1000) + 100
        const outputTokens = Math.floor(Math.random() * 500) + 50

        logs.push({
          tenantId: tenant.id,
          userId: user.id,
          featureId: feature.id,
          taskCode: Math.random() > 0.5 ? 'LLM2_DRAFT' : 'LLM1_PRIOR_ART',
          modelClass: Math.random() > 0.5 ? 'BASE_S' : 'BASE_M',
          apiCode: Math.random() > 0.5 ? 'GEMINI' : 'OPENAI',
          inputTokens,
          outputTokens,
          apiCalls: 1,
          startedAt,
          completedAt: new Date(startedAt.getTime() + Math.floor(Math.random() * 5000) + 1000),
          status: 'COMPLETED',
          idempotencyKey: `analytics-log-${i}-${j}`,
          reservationId: `analytics-res-${i}-${j}`
        })
      }
    }

    // Insert logs in batches to avoid memory issues
    const batchSize = 50
    for (let i = 0; i < logs.length; i += batchSize) {
      const batch = logs.slice(i, i + batchSize)
      await prisma.usageLog.createMany({
        data: batch,
        skipDuplicates: true
      })
      console.log(`✅ Inserted batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(logs.length/batchSize)}`)
    }

    // Update usage meters
    console.log('📊 Updating usage meters...')
    await updateUsageMeters(tenant.id)

    console.log(`🎉 Successfully populated ${logs.length} usage logs for analytics testing!`)

  } catch (error) {
    console.error('❌ Failed to populate analytics data:', error)
  } finally {
    await prisma.$disconnect()
  }
}

async function updateUsageMeters(tenantId) {
  // Get all usage logs and aggregate them
  const logs = await prisma.usageLog.findMany({
    where: { tenantId },
    select: {
      featureId: true,
      taskCode: true,
      inputTokens: true,
      outputTokens: true,
      startedAt: true
    }
  })

  // Group by date and update meters
  const meters = new Map()

  for (const log of logs) {
    const date = log.startedAt.toISOString().split('T')[0]
    const month = log.startedAt.toISOString().substring(0, 7)
    const key = `${log.featureId}-${log.taskCode}`

    // Daily meter
    const dailyKey = `${key}-DAILY-${date}`
    if (!meters.has(dailyKey)) {
      meters.set(dailyKey, {
        tenantId,
        featureId: log.featureId,
        taskCode: log.taskCode,
        periodType: 'DAILY',
        periodKey: date,
        currentUsage: 0
      })
    }
    meters.get(dailyKey).currentUsage += (log.inputTokens || 0) + (log.outputTokens || 0)

    // Monthly meter
    const monthlyKey = `${key}-MONTHLY-${month}`
    if (!meters.has(monthlyKey)) {
      meters.set(monthlyKey, {
        tenantId,
        featureId: log.featureId,
        taskCode: log.taskCode,
        periodType: 'MONTHLY',
        periodKey: month,
        currentUsage: 0
      })
    }
    meters.get(monthlyKey).currentUsage += (log.inputTokens || 0) + (log.outputTokens || 0)
  }

  // Upsert meters
  for (const [key, meter] of meters) {
    await prisma.usageMeter.upsert({
      where: {
        tenantId_featureId_taskCode_periodType_periodKey: {
          tenantId: meter.tenantId,
          featureId: meter.featureId,
          taskCode: meter.taskCode,
          periodType: meter.periodType,
          periodKey: meter.periodKey
        }
      },
      update: { currentUsage: meter.currentUsage },
      create: meter
    })
  }

  console.log(`✅ Updated ${meters.size} usage meters`)
}

if (require.main === module) {
  populateAnalyticsData().catch(console.error)
}

module.exports = { populateAnalyticsData }
