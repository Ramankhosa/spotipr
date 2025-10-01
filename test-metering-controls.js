// Comprehensive Metering Control Logic Test
// Tests all possible scenarios for access control, quota limits, reservations, and usage tracking

require('dotenv').config()

const { createMeteringSystem, llmGateway } = require('./src/lib/metering/index')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function setupTestData() {
  console.log('🔧 Setting up test data...')

  // Create test tenant
  const tenant = await prisma.tenant.upsert({
    where: { atiId: 'test-tenant-123' },
    update: { name: 'Test Tenant', status: 'ACTIVE' },
    create: {
      id: 'test-tenant-123',
      atiId: 'test-tenant-123',
      name: 'Test Tenant',
      status: 'ACTIVE'
    }
  })

  // Create test user
  const user = await prisma.user.upsert({
    where: { email: 'test@example.com' },
    update: { tenantId: tenant.id },
    create: {
      id: 'test-user-123',
      tenantId: tenant.id,
      email: 'test@example.com',
      passwordHash: 'hashed-password',
      name: 'Test User',
      role: 'ANALYST',
      status: 'ACTIVE'
    }
  })

  // Create ATI token with FREE plan
  await prisma.aTIToken.upsert({
    where: { id: 'test-ati-token-123' },
    update: { tenantId: tenant.id, planTier: 'FREE' },
    create: {
      id: 'test-ati-token-123',
      tenantId: tenant.id,
      tokenHash: 'hash123',
      rawToken: 'test-ati-token-123',
      fingerprint: 'fp123',
      status: 'ISSUED',
      planTier: 'FREE'
    }
  })

  // Create FREE plan
  const plan = await prisma.plan.upsert({
    where: { code: 'FREE' },
    update: { name: 'Free Plan', status: 'ACTIVE' },
    create: {
      id: 'free-plan-123',
      code: 'FREE',
      name: 'Free Plan',
      cycle: 'MONTHLY',
      status: 'ACTIVE'
    }
  })

  // Create features
  const patentDrafting = await prisma.feature.upsert({
    where: { code: 'PATENT_DRAFTING' },
    update: { name: 'Patent Drafting', unit: 'tokens' },
    create: {
      id: 'patent-drafting-feature',
      code: 'PATENT_DRAFTING',
      name: 'Patent Drafting',
      unit: 'tokens'
    }
  })

  const priorArt = await prisma.feature.upsert({
    where: { code: 'PRIOR_ART_SEARCH' },
    update: { name: 'Prior Art Search', unit: 'calls' },
    create: {
      id: 'prior-art-feature',
      code: 'PRIOR_ART_SEARCH',
      name: 'Prior Art Search',
      unit: 'calls'
    }
  })

  // Create plan features with low limits for testing
  await prisma.planFeature.upsert({
    where: { planId_featureId: { planId: plan.id, featureId: patentDrafting.id } },
    update: { monthlyQuota: 100, dailyQuota: 10 },
    create: {
      planId: plan.id,
      featureId: patentDrafting.id,
      monthlyQuota: 100,
      dailyQuota: 10
    }
  })

  await prisma.planFeature.upsert({
    where: { planId_featureId: { planId: plan.id, featureId: priorArt.id } },
    update: { monthlyQuota: 20, dailyQuota: 2 },
    create: {
      planId: plan.id,
      featureId: priorArt.id,
      monthlyQuota: 20,
      dailyQuota: 2
    }
  })

  // Create tasks
  const draftTask = await prisma.task.upsert({
    where: { code: 'LLM2_DRAFT' },
    update: { name: 'Patent Drafting', linkedFeatureId: patentDrafting.id },
    create: {
      id: 'draft-task-123',
      code: 'LLM2_DRAFT',
      name: 'Patent Drafting',
      linkedFeatureId: patentDrafting.id
    }
  })

  const priorArtTask = await prisma.task.upsert({
    where: { code: 'LLM1_PRIOR_ART' },
    update: { name: 'Prior Art Search', linkedFeatureId: priorArt.id },
    create: {
      id: 'prior-art-task-123',
      code: 'LLM1_PRIOR_ART',
      name: 'Prior Art Search',
      linkedFeatureId: priorArt.id
    }
  })

  // Create model classes
  const baseS = await prisma.lLMModelClass.upsert({
    where: { code: 'BASE_S' },
    update: { name: 'Base Small' },
    create: {
      id: 'base-s-model',
      code: 'BASE_S',
      name: 'Base Small'
    }
  })

  // Create plan LLM access
  await prisma.planLLMAccess.upsert({
    where: { planId_taskCode: { planId: plan.id, taskCode: 'LLM2_DRAFT' } },
    update: { allowedClasses: '["BASE_S"]', defaultClassId: baseS.id },
    create: {
      planId: plan.id,
      taskCode: 'LLM2_DRAFT',
      allowedClasses: '["BASE_S"]',
      defaultClassId: baseS.id
    }
  })

  await prisma.planLLMAccess.upsert({
    where: { planId_taskCode: { planId: plan.id, taskCode: 'LLM1_PRIOR_ART' } },
    update: { allowedClasses: '["BASE_S"]', defaultClassId: baseS.id },
    create: {
      planId: plan.id,
      taskCode: 'LLM1_PRIOR_ART',
      allowedClasses: '["BASE_S"]',
      defaultClassId: baseS.id
    }
  })

  // Create policy rules
  await prisma.policyRule.upsert({
    where: { scope_scopeId_taskCode_key: { scope: 'plan', scopeId: plan.code, taskCode: 'LLM2_DRAFT', key: 'max_tokens_out' } },
    update: { value: 100 },
    create: {
      scope: 'plan',
      scopeId: plan.code,
      taskCode: 'LLM2_DRAFT',
      key: 'max_tokens_out',
      value: 100
    }
  })

  console.log('✅ Test data setup complete')

  return { tenant, user, plan, patentDrafting, priorArt }
}

async function runMeteringControlTests() {
  console.log('\n🧪 Running Metering Control Logic Tests\n')

  const testData = await setupTestData()
  const system = createMeteringSystem({ enabled: true })

  const tests = [
    {
      name: '✅ Valid Tenant Access',
      test: async () => {
        const context = await system.identity.resolveTenantContext('test-ati-token-123')
        return context && context.tenantId === 'test-tenant-123' && context.planId === 'free-plan-123'
      }
    },
    {
      name: '❌ Invalid Tenant Access',
      test: async () => {
        const context = await system.identity.resolveTenantContext('invalid-token')
        return context === null
      }
    },
    {
      name: '✅ Valid Feature Access (Under Quota)',
      test: async () => {
        const request = {
          tenantId: 'test-tenant-123',
          featureCode: 'PATENT_DRAFTING',
          taskCode: 'LLM2_DRAFT',
          userId: 'test-user-123'
        }
        const decision = await system.policy.evaluateAccess(request)
        return decision.allowed === true
      }
    },
    {
      name: '❌ Feature Not In Plan',
      test: async () => {
        const request = {
          tenantId: 'test-tenant-123',
          featureCode: 'DIAGRAM_GENERATION', // Not in FREE plan
          userId: 'test-user-123'
        }
        const decision = await system.policy.evaluateAccess(request)
        return decision.allowed === false && decision.reason.includes('not available')
      }
    },
    {
      name: '✅ Quota Check (Under Limit)',
      test: async () => {
        const quotaResult = await system.metering.checkQuota({
          tenantId: 'test-tenant-123',
          featureCode: 'PATENT_DRAFTING'
        })
        return quotaResult.allowed === true && quotaResult.remaining.monthly === 100
      }
    },
    {
      name: '✅ Reservation Creation',
      test: async () => {
        const reservationId = await system.reservation.createReservation({
          tenantId: 'test-tenant-123',
          featureCode: 'PATENT_DRAFTING',
          taskCode: 'LLM2_DRAFT',
          userId: 'test-user-123',
          idempotencyKey: 'test-reservation-1'
        }, 50)

        return reservationId && typeof reservationId === 'string'
      }
    },
    {
      name: '✅ Idempotent Reservations',
      test: async () => {
        const res1 = await system.reservation.createReservation({
          tenantId: 'test-tenant-123',
          featureCode: 'PATENT_DRAFTING',
          taskCode: 'LLM2_DRAFT',
          userId: 'test-user-123',
          idempotencyKey: 'test-idempotent-1'
        }, 50)

        const res2 = await system.reservation.createReservation({
          tenantId: 'test-tenant-123',
          featureCode: 'PATENT_DRAFTING',
          taskCode: 'LLM2_DRAFT',
          userId: 'test-user-123',
          idempotencyKey: 'test-idempotent-1' // Same key
        }, 50)

        return res1 === res2 // Should return same reservation ID
      }
    },
    {
      name: '✅ Usage Recording',
      test: async () => {
        // Create a reservation first
        const reservationId = await system.reservation.createReservation({
          tenantId: 'test-tenant-123',
          featureCode: 'PATENT_DRAFTING',
          taskCode: 'LLM2_DRAFT',
          userId: 'test-user-123',
          idempotencyKey: 'test-usage-1'
        }, 50)

        // Record usage
        const result = await system.metering.recordUsage(reservationId, {
          outputTokens: 25,
          modelClass: 'BASE_S',
          apiCode: 'GEMINI'
        })

        return result.success === true
      }
    },
    {
      name: '✅ Usage Tracking',
      test: async () => {
        const usage = await system.metering.getUsage('test-tenant-123', 'PATENT_DRAFTING', 'monthly')
        return usage.current >= 0 && usage.limit === 100
      }
    },
    {
      name: '✅ Policy Limits Retrieval',
      test: async () => {
        const limits = await system.policy.getPolicyLimits('test-tenant-123', 'LLM2_DRAFT')
        return limits.maxTokensOut === 100
      }
    },
    {
      name: '✅ Concurrency Control',
      test: async () => {
        // Get concurrency limit
        const limit = await system.reservation.getConcurrencyLimit('test-tenant-123', 'LLM2_DRAFT')
        return limit >= 1 // Should have some concurrency limit
      }
    }
  ]

  const results = []

  for (const testCase of tests) {
    try {
      console.log(`Running: ${testCase.name}`)
      const result = await testCase.test()
      const status = result ? '✅ PASS' : '❌ FAIL'
      console.log(`   Result: ${status}`)
      results.push({ name: testCase.name, passed: result })
    } catch (error) {
      console.log(`   Result: ❌ ERROR - ${error.message}`)
      results.push({ name: testCase.name, passed: false, error: error.message })
    }
    console.log('')
  }

  // Summary
  const passed = results.filter(r => r.passed).length
  const total = results.length

  console.log(`📊 Test Results Summary:`)
  console.log(`   Passed: ${passed}/${total} (${Math.round((passed/total)*100)}%)`)

  if (passed < total) {
    console.log('\n❌ Failed Tests:')
    results.filter(r => !r.passed).forEach(r => {
      console.log(`   - ${r.name}${r.error ? ` (${r.error})` : ''}`)
    })
  }

  return results
}

async function simulateQuotaExceedance() {
  console.log('\n🎯 Testing Quota Exceedance Scenario\n')

  const system = createMeteringSystem({ enabled: true })

  // Create multiple reservations and record usage to exceed quota
  console.log('Creating multiple usage records to exceed daily quota (10)...')

  for (let i = 0; i < 12; i++) {
    try {
      // Create reservation
      const reservationId = await system.reservation.createReservation({
        tenantId: 'test-tenant-123',
        featureCode: 'PATENT_DRAFTING',
        taskCode: 'LLM2_DRAFT',
        userId: 'test-user-123',
        idempotencyKey: `quota-test-${i}`
      }, 10)

      // Record usage
      await system.metering.recordUsage(reservationId, {
        outputTokens: 1,
        modelClass: 'BASE_S',
        apiCode: 'GEMINI'
      })

      console.log(`   Usage ${i + 1}: ✅ Recorded`)
    } catch (error) {
      console.log(`   Usage ${i + 1}: ❌ Failed - ${error.message}`)
    }
  }

  // Check quota after usage
  const quotaCheck = await system.metering.checkQuota({
    tenantId: 'test-tenant-123',
    featureCode: 'PATENT_DRAFTING'
  })

  console.log(`\n📊 Final Quota Status:`)
  console.log(`   Daily Remaining: ${quotaCheck.remaining.daily}`)
  console.log(`   Monthly Remaining: ${quotaCheck.remaining.monthly}`)
  console.log(`   Access Allowed: ${quotaCheck.allowed}`)

  // Try to create new reservation after quota exceeded
  try {
    const newReservation = await system.reservation.createReservation({
      tenantId: 'test-tenant-123',
      featureCode: 'PATENT_DRAFTING',
      taskCode: 'LLM2_DRAFT',
      userId: 'test-user-123',
      idempotencyKey: 'post-quota-test'
    }, 10)

    console.log(`   Post-Quota Reservation: ✅ Created (${newReservation})`)
  } catch (error) {
    console.log(`   Post-Quota Reservation: ❌ Blocked - ${error.message}`)
  }

  // Test policy evaluation after quota exceeded
  const policyDecision = await system.policy.evaluateAccess({
    tenantId: 'test-tenant-123',
    featureCode: 'PATENT_DRAFTING',
    taskCode: 'LLM2_DRAFT',
    userId: 'test-user-123'
  })

  console.log(`   Policy Decision: ${policyDecision.allowed ? '✅ Allowed' : '❌ Denied'}`)
  if (!policyDecision.allowed) {
    console.log(`   Reason: ${policyDecision.reason}`)
  }
}

async function cleanupTestData() {
  console.log('\n🧹 Cleaning up test data...')

  try {
    // Delete in reverse order to avoid foreign key constraints
    await prisma.quotaAlert.deleteMany({ where: { tenantId: 'test-tenant-123' } })
    await prisma.usageLog.deleteMany({ where: { tenantId: 'test-tenant-123' } })
    await prisma.usageMeter.deleteMany({ where: { tenantId: 'test-tenant-123' } })
    await prisma.usageReservation.deleteMany({ where: { tenantId: 'test-tenant-123' } })
    await prisma.planLLMAccess.deleteMany({ where: { planId: 'free-plan-123' } })
    await prisma.policyRule.deleteMany({ where: { scopeId: 'FREE' } })
    await prisma.planFeature.deleteMany({ where: { planId: 'free-plan-123' } })
    await prisma.aTIToken.deleteMany({ where: { tenantId: 'test-tenant-123' } })
    await prisma.user.deleteMany({ where: { tenantId: 'test-tenant-123' } })
    await prisma.tenant.deleteMany({ where: { id: 'test-tenant-123' } })

    console.log('✅ Test data cleaned up')
  } catch (error) {
    console.warn('⚠️  Cleanup failed:', error.message)
  }
}

async function runAllTests() {
  try {
    await runMeteringControlTests()
    await simulateQuotaExceedance()
  } finally {
    await cleanupTestData()
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  runAllTests().catch(console.error)
}

module.exports = { runMeteringControlTests, simulateQuotaExceedance, setupTestData, cleanupTestData }
