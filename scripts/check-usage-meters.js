const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const tenantId = process.argv[2] || 'cmkux8i3y0001l6uxlr5vqoe3'
  
  console.log('='.repeat(80))
  console.log('USAGE METER DIAGNOSTIC')
  console.log('='.repeat(80))
  console.log('Tenant ID:', tenantId)
  console.log('')

  // 1. Get all usage meters for this tenant
  console.log('1. ALL USAGE METERS FOR TENANT')
  console.log('-'.repeat(40))
  
  const meters = await prisma.usageMeter.findMany({
    where: { tenantId },
    include: {
      feature: true
    },
    orderBy: { lastUpdated: 'desc' }
  })

  if (meters.length === 0) {
    console.log('  No usage meters found.')
  } else {
    console.log('  Feature | Period | Key | Current Usage | Last Updated')
    console.log('  ' + '-'.repeat(75))
    for (const m of meters) {
      console.log(`  ${(m.feature?.code || 'N/A').padEnd(20)} | ${m.periodType.padEnd(7)} | ${m.periodKey} | ${String(m.currentUsage).padStart(13)} | ${m.lastUpdated?.toISOString().substring(0, 19) || 'N/A'}`)
    }
  }
  console.log('')

  // 2. Get the feature IDs we care about
  console.log('2. FEATURE IDs')
  console.log('-'.repeat(40))
  
  const features = await prisma.feature.findMany({
    where: {
      code: { in: ['PATENT_DRAFTING', 'NOVELTY_SEARCH', 'IDEA_BANK', 'DIAGRAM_GENERATION', 'IDEATION'] }
    }
  })

  for (const f of features) {
    console.log(`  ${f.code}: ${f.id}`)
  }
  console.log('')

  // 3. Get current period info
  const now = new Date()
  const dailyKey = now.toISOString().substring(0, 10) // YYYY-MM-DD
  const monthlyKey = now.toISOString().substring(0, 7) // YYYY-MM
  
  console.log('3. CURRENT PERIOD')
  console.log('-'.repeat(40))
  console.log(`  Daily Key: ${dailyKey}`)
  console.log(`  Monthly Key: ${monthlyKey}`)
  console.log('')

  // 4. Check specific feature usage
  console.log('4. PATENT_DRAFTING USAGE')
  console.log('-'.repeat(40))
  
  const patentFeature = features.find(f => f.code === 'PATENT_DRAFTING')
  if (patentFeature) {
    const dailyMeter = await prisma.usageMeter.findFirst({
      where: { tenantId, featureId: patentFeature.id, periodType: 'DAILY', periodKey: dailyKey }
    })
    const monthlyMeter = await prisma.usageMeter.findFirst({
      where: { tenantId, featureId: patentFeature.id, periodType: 'MONTHLY', periodKey: monthlyKey }
    })
    
    console.log(`  Daily usage (${dailyKey}): ${dailyMeter?.currentUsage || 0}`)
    console.log(`  Monthly usage (${monthlyKey}): ${monthlyMeter?.currentUsage || 0}`)
  } else {
    console.log('  PATENT_DRAFTING feature not found!')
  }
  console.log('')

  // 5. Get tenant's plan limits for comparison
  console.log('5. PLAN LIMITS VS USAGE')
  console.log('-'.repeat(40))
  
  const tenantPlan = await prisma.tenantPlan.findFirst({
    where: { tenantId, status: 'ACTIVE' },
    include: {
      plan: {
        include: {
          planFeatures: {
            include: { feature: true }
          }
        }
      }
    }
  })

  if (tenantPlan?.plan?.planFeatures) {
    const pf = tenantPlan.plan.planFeatures.find(p => p.feature.code === 'PATENT_DRAFTING')
    if (pf) {
      const dailyMeter = await prisma.usageMeter.findFirst({
        where: { tenantId, featureId: pf.featureId, periodType: 'DAILY', periodKey: dailyKey }
      })
      const monthlyMeter = await prisma.usageMeter.findFirst({
        where: { tenantId, featureId: pf.featureId, periodType: 'MONTHLY', periodKey: monthlyKey }
      })

      const dailyUsed = dailyMeter?.currentUsage || 0
      const monthlyUsed = monthlyMeter?.currentUsage || 0
      const dailyLimit = pf.dailyQuota
      const monthlyLimit = pf.monthlyQuota
      
      console.log(`  Daily:   ${dailyUsed} / ${dailyLimit ?? 'unlimited'} ${dailyLimit && dailyUsed >= dailyLimit ? '!! EXCEEDED !!' : ''}`)
      console.log(`  Monthly: ${monthlyUsed} / ${monthlyLimit ?? 'unlimited'} ${monthlyLimit && monthlyUsed >= monthlyLimit ? '!! EXCEEDED !!' : ''}`)
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
