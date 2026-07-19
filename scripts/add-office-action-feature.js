#!/usr/bin/env node

/**
 * SAFE Script: Add OFFICE_ACTION_RESPONSE feature + quotas
 *
 * Creates the Feature row for the Office Action Studio (FER/OA response),
 * attaches per-plan quotas, and links the LLM8_OA_RESPONSE task to it so the
 * metering gateway can resolve the feature for every OA pipeline stage.
 *
 * Idempotent: existing rows are preserved, never overwritten.
 *
 * Run: node scripts/add-office-action-feature.js
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// A "call" here is one OA pipeline stage invocation (parse, classify, chart,
// strategy, argument, draft section, compliance). A full 6-objection reply is
// roughly 20–30 calls, so quotas are sized per matter, not per stage.
const OFFICE_ACTION_QUOTAS = {
  'FREE_PLAN':       { monthlyQuota: 0,    dailyQuota: 0 },    // disabled — paid module
  'PRO_PLAN':        { monthlyQuota: 300,  dailyQuota: 100 },  // ~10 matters/month
  'ENTERPRISE_PLAN': { monthlyQuota: 3000, dailyQuota: 600 },  // ~100 matters/month
  'TRIAL':           { monthlyQuota: 60,   dailyQuota: 30 }    // ~2 matters, to evaluate
}

const OA_TASK_CODES = ['LLM8_OA_RESPONSE']

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('  SAFE: Add OFFICE_ACTION_RESPONSE Feature + Quotas')
  console.log('═══════════════════════════════════════════════════════════════\n')

  try {
    // 1. Feature row
    console.log('1️⃣  Creating OFFICE_ACTION_RESPONSE feature...\n')
    let feature = await prisma.feature.findUnique({ where: { code: 'OFFICE_ACTION_RESPONSE' } })
    if (feature) {
      console.log('   ✅ OFFICE_ACTION_RESPONSE feature already exists')
    } else {
      feature = await prisma.feature.create({
        data: { code: 'OFFICE_ACTION_RESPONSE', name: 'Office Action Studio (FER Response)', unit: 'calls' }
      })
      console.log('   ✅ Created OFFICE_ACTION_RESPONSE feature')
    }

    // 2. Per-plan quotas
    console.log('\n2️⃣  Adding quotas to plans...\n')
    const plans = await prisma.plan.findMany({ where: { code: { in: Object.keys(OFFICE_ACTION_QUOTAS) } } })
    if (!plans.length) console.log('   ⚠️  No matching plans found — run the plan seed first.')

    for (const plan of plans) {
      const quotas = OFFICE_ACTION_QUOTAS[plan.code]
      if (!quotas) continue
      const existing = await prisma.planFeature.findUnique({
        where: { planId_featureId: { planId: plan.id, featureId: feature.id } }
      })
      if (existing) {
        console.log(`   ⏭️  ${plan.code}: already configured (monthly: ${existing.monthlyQuota}, daily: ${existing.dailyQuota}) — preserved`)
      } else {
        await prisma.planFeature.create({
          data: {
            planId: plan.id, featureId: feature.id,
            monthlyQuota: quotas.monthlyQuota, dailyQuota: quotas.dailyQuota
          }
        })
        console.log(`   ✅ ${plan.code}: added (monthly: ${quotas.monthlyQuota}, daily: ${quotas.dailyQuota})`)
      }
    }

    // 3. Task row(s) linked to the feature (metering resolves feature by task).
    console.log('\n3️⃣  Ensuring OA tasks are linked to the feature...\n')
    for (const code of OA_TASK_CODES) {
      const task = await prisma.task.findUnique({ where: { code } })
      if (task) {
        await prisma.task.update({ where: { code }, data: { linkedFeatureId: feature.id } })
        console.log(`   ✅ ${code} → OFFICE_ACTION_RESPONSE (linked)`)
      } else {
        await prisma.task.create({
          data: { code, name: 'Office Action response pipeline', linkedFeatureId: feature.id }
        })
        console.log(`   ✅ ${code} → OFFICE_ACTION_RESPONSE (created + linked)`)
      }
    }

    console.log('\n═══════════════════════════════════════════════════════════════')
    console.log('  ✅ OFFICE_ACTION_RESPONSE ready.')
    console.log('  Adjust quotas at /super-admin/quota-controller')
    console.log('═══════════════════════════════════════════════════════════════\n')
  } catch (error) {
    console.error('\n❌ Failed:', error)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

main()
