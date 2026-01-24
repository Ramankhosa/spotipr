/**
 * Seed Payment Plans Script
 * 
 * Creates/updates the BASIC, PRO, and ENTERPRISE plans in the database
 * with proper pricing configuration for Razorpay payments.
 * 
 * Run with: npx tsx scripts/seed-payment-plans.ts
 */

import { PrismaClient, PlanStatus } from '@prisma/client'

const prisma = new PrismaClient()

// Plan definitions
const PLANS = [
  {
    code: 'BASIC_PLAN',
    name: 'Basic',
    cycle: 'MONTHLY',
    status: 'ACTIVE' as PlanStatus,
    features: {
      PATENT_DRAFTING: { monthlyQuota: 1, dailyQuota: null },
      NOVELTY_SEARCH: { monthlyQuota: 3, dailyQuota: null },
      IDEATION: { monthlyQuota: 1, dailyQuota: null },
      DIAGRAM_GENERATION: { monthlyQuota: 5, dailyQuota: null },
    },
    pricing: {
      monthly: { USD: 5900, INR: 499900 },      // $59 / ₹4,999
      yearly: { USD: 64900, INR: 5498900 },     // $649 / ₹54,989 (1 month free)
    },
  },
  {
    code: 'PRO_PLAN',
    name: 'Pro',
    cycle: 'MONTHLY',
    status: 'ACTIVE' as PlanStatus,
    features: {
      PATENT_DRAFTING: { monthlyQuota: 4, dailyQuota: null },
      NOVELTY_SEARCH: { monthlyQuota: 20, dailyQuota: null },
      IDEATION: { monthlyQuota: 10, dailyQuota: null },
      DIAGRAM_GENERATION: { monthlyQuota: 30, dailyQuota: null },
    },
    pricing: {
      monthly: { USD: 19900, INR: 1699900 },    // $199 / ₹16,999
      yearly: { USD: 218900, INR: 18698900 },   // $2,189 / ₹1,86,989 (1 month free)
    },
  },
  {
    code: 'ENTERPRISE_PLAN',
    name: 'Enterprise',
    cycle: 'MONTHLY',
    status: 'ACTIVE' as PlanStatus,
    features: {
      PATENT_DRAFTING: { monthlyQuota: 15, dailyQuota: null },
      NOVELTY_SEARCH: { monthlyQuota: 100, dailyQuota: null },
      IDEATION: { monthlyQuota: 30, dailyQuota: null },
      DIAGRAM_GENERATION: { monthlyQuota: 150, dailyQuota: null },
    },
    pricing: {
      monthly: { USD: 59900, INR: 4999900 },    // $599 / ₹49,999
      yearly: { USD: 658900, INR: 54998900 },   // $6,589 / ₹5,49,989 (1 month free)
    },
  },
]

async function seedPlans() {
  console.log('🚀 Seeding payment plans...\n')

  for (const planDef of PLANS) {
    console.log(`📦 Processing ${planDef.name} plan...`)

    // Upsert the plan
    const plan = await prisma.plan.upsert({
      where: { code: planDef.code },
      create: {
        code: planDef.code,
        name: planDef.name,
        cycle: planDef.cycle,
        status: planDef.status,
      },
      update: {
        name: planDef.name,
        cycle: planDef.cycle,
        status: planDef.status,
      },
    })

    console.log(`   ✅ Plan created/updated: ${plan.id}`)

    // Create plan features
    for (const [featureCode, limits] of Object.entries(planDef.features)) {
      // Find the feature
      const feature = await prisma.feature.findUnique({
        where: { code: featureCode as any },
      })

      if (feature) {
        await prisma.planFeature.upsert({
          where: {
            planId_featureId: {
              planId: plan.id,
              featureId: feature.id,
            },
          },
          create: {
            planId: plan.id,
            featureId: feature.id,
            monthlyQuota: limits.monthlyQuota,
            dailyQuota: limits.dailyQuota,
          },
          update: {
            monthlyQuota: limits.monthlyQuota,
            dailyQuota: limits.dailyQuota,
          },
        })
        console.log(`   ✅ Feature quota set: ${featureCode}`)
      } else {
        console.log(`   ⚠️ Feature not found: ${featureCode}`)
      }
    }

    // Create plan pricing (both monthly and yearly)
    for (const [cycle, prices] of Object.entries(planDef.pricing)) {
      await prisma.planPricing.upsert({
        where: {
          planId_billingCycle: {
            planId: plan.id,
            billingCycle: cycle.toUpperCase(),
          },
        },
        create: {
          planId: plan.id,
          planCode: planDef.code.replace('_PLAN', ''), // BASIC, PRO, ENTERPRISE
          priceUSD: prices.USD,
          priceINR: prices.INR,
          billingCycle: cycle.toUpperCase(),
          yearlyDiscountMonths: cycle === 'yearly' ? 1 : 0,
          isActive: true,
        },
        update: {
          priceUSD: prices.USD,
          priceINR: prices.INR,
          yearlyDiscountMonths: cycle === 'yearly' ? 1 : 0,
          isActive: true,
        },
      })
      console.log(`   ✅ Pricing set: ${cycle} - $${prices.USD / 100} / ₹${prices.INR / 100}`)
    }

    console.log('')
  }

  console.log('✅ All plans seeded successfully!\n')

  // Summary
  const planCount = await prisma.plan.count()
  const pricingCount = await prisma.planPricing.count()
  console.log(`📊 Summary:`)
  console.log(`   - Total plans: ${planCount}`)
  console.log(`   - Total pricing entries: ${pricingCount}`)
}

async function main() {
  try {
    await seedPlans()
  } catch (error) {
    console.error('❌ Error seeding plans:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()

