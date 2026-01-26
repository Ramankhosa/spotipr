const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  console.log('='.repeat(80))
  console.log('FIXING BASIC PLAN LLM COMPLETION LIMITS')
  console.log('='.repeat(80))
  console.log('')

  // Find the BASIC_PLAN
  const plan = await prisma.plan.findFirst({
    where: { code: 'BASIC_PLAN' }
  })

  if (!plan) {
    console.log('ERROR: BASIC_PLAN not found')
    return
  }

  console.log('Plan found:', plan.name, '(' + plan.code + ')')
  console.log('')

  // Get the PATENT_DRAFTING feature
  const feature = await prisma.feature.findUnique({
    where: { code: 'PATENT_DRAFTING' }
  })

  if (!feature) {
    console.log('ERROR: PATENT_DRAFTING feature not found')
    return
  }

  // Find the current plan feature
  const planFeature = await prisma.planFeature.findFirst({
    where: {
      planId: plan.id,
      featureId: feature.id
    }
  })

  if (!planFeature) {
    console.log('ERROR: PlanFeature not found')
    return
  }

  console.log('Current PATENT_DRAFTING limits:')
  console.log('  Daily Completions:', planFeature.dailyQuota)
  console.log('  Monthly Completions:', planFeature.monthlyQuota)
  console.log('')

  // Update to more reasonable limits
  // 1 patent draft = ~50-100 LLM calls, so for 1 patent/month we need ~100 completions
  const newDailyQuota = 100  // Allow 100 LLM calls per day
  const newMonthlyQuota = 500 // Allow 500 LLM calls per month (enough for ~5 patents)

  const updated = await prisma.planFeature.update({
    where: { id: planFeature.id },
    data: {
      dailyQuota: newDailyQuota,
      monthlyQuota: newMonthlyQuota
    }
  })

  console.log('Updated PATENT_DRAFTING limits:')
  console.log('  Daily Completions:', updated.dailyQuota)
  console.log('  Monthly Completions:', updated.monthlyQuota)
  console.log('')

  // Also reset the usage meters for this tenant so they can test immediately
  const tenantId = 'cmkux8i3y0001l6uxlr5vqoe3'
  
  console.log('Resetting usage meters for tenant:', tenantId)
  
  await prisma.usageMeter.updateMany({
    where: {
      tenantId,
      featureId: feature.id
    },
    data: {
      currentUsage: 0
    }
  })

  console.log('Usage meters reset to 0')
  console.log('')
  console.log('DONE! The user should now be able to draft patents.')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
