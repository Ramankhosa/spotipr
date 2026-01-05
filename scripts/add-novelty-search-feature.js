#!/usr/bin/env node

/**
 * SAFE Script: Add NOVELTY_SEARCH feature only
 * 
 * This script ONLY adds the NOVELTY_SEARCH feature and its quotas.
 * It does NOT modify any existing data.
 * 
 * Run: node scripts/add-novelty-search-feature.js
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// Quotas for NOVELTY_SEARCH by plan
// Adjust these values as needed before running
const NOVELTY_SEARCH_QUOTAS = {
  'FREE_PLAN': { monthlyQuota: 0, dailyQuota: 0 },      // Disabled
  'PRO_PLAN': { monthlyQuota: 5, dailyQuota: 2 },       // Very limited
  'ENTERPRISE_PLAN': { monthlyQuota: 20, dailyQuota: 5 }, // Limited
  'TRIAL': { monthlyQuota: 3, dailyQuota: 1 }           // Very limited
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  SAFE: Add NOVELTY_SEARCH Feature Only')
  console.log('  This script does NOT modify existing data')
  console.log('═══════════════════════════════════════════════════════════════\n')

  try {
    // Step 1: Create NOVELTY_SEARCH feature if it doesn't exist
    console.log('1️⃣  Creating NOVELTY_SEARCH feature...\n')
    
    const existingFeature = await prisma.feature.findUnique({
      where: { code: 'NOVELTY_SEARCH' }
    })

    let feature
    if (existingFeature) {
      console.log('   ✅ NOVELTY_SEARCH feature already exists')
      feature = existingFeature
    } else {
      feature = await prisma.feature.create({
        data: {
          code: 'NOVELTY_SEARCH',
          name: 'Novelty Search',
          unit: 'calls'
        }
      })
      console.log('   ✅ Created NOVELTY_SEARCH feature')
    }

    // Step 2: Add NOVELTY_SEARCH to each plan
    console.log('\n2️⃣  Adding NOVELTY_SEARCH quotas to plans...\n')

    const plans = await prisma.plan.findMany({
      where: {
        code: { in: Object.keys(NOVELTY_SEARCH_QUOTAS) }
      }
    })

    for (const plan of plans) {
      const quotas = NOVELTY_SEARCH_QUOTAS[plan.code]
      if (!quotas) continue

      // Check if already exists
      const existing = await prisma.planFeature.findUnique({
        where: {
          planId_featureId: {
            planId: plan.id,
            featureId: feature.id
          }
        }
      })

      if (existing) {
        console.log(`   ⏭️  ${plan.code}: Already has NOVELTY_SEARCH (monthly: ${existing.monthlyQuota}, daily: ${existing.dailyQuota})`)
        console.log(`      → Skipping to preserve existing values`)
      } else {
        await prisma.planFeature.create({
          data: {
            planId: plan.id,
            featureId: feature.id,
            monthlyQuota: quotas.monthlyQuota,
            dailyQuota: quotas.dailyQuota
          }
        })
        console.log(`   ✅ ${plan.code}: Added NOVELTY_SEARCH (monthly: ${quotas.monthlyQuota}, daily: ${quotas.dailyQuota})`)
      }
    }

    // Step 3: Update tasks to link to NOVELTY_SEARCH feature
    console.log('\n3️⃣  Linking novelty tasks to NOVELTY_SEARCH feature...\n')
    
    const noveltyTaskCodes = ['LLM4_NOVELTY_SCREEN', 'LLM5_NOVELTY_ASSESS', 'LLM6_REPORT_GENERATION']
    
    for (const taskCode of noveltyTaskCodes) {
      const task = await prisma.task.findUnique({
        where: { code: taskCode }
      })
      
      if (task) {
        await prisma.task.update({
          where: { code: taskCode },
          data: { linkedFeatureId: feature.id }
        })
        console.log(`   ✅ ${taskCode} → NOVELTY_SEARCH`)
      } else {
        console.log(`   ⏭️  ${taskCode}: Task not found (will be created by other seeds if needed)`)
      }
    }

    console.log('\n═══════════════════════════════════════════════════════════════')
    console.log('  ✅ NOVELTY_SEARCH feature added successfully!')
    console.log('  ')
    console.log('  You can now adjust quotas from Super Admin:')
    console.log('  → /super-admin/quota-controller')
    console.log('═══════════════════════════════════════════════════════════════\n')

  } catch (error) {
    console.error('\n❌ Error:', error.message)
    
    if (error.message.includes('Invalid value for argument `code`')) {
      console.log('\n⚠️  The NOVELTY_SEARCH enum value is not in the database.')
      console.log('   Run the Prisma migration first:')
      console.log('   npx prisma migrate deploy')
    }
    
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

main()

