const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  console.log('='.repeat(80))
  console.log('DIAGRAM_GENERATION QUOTA SETTINGS')
  console.log('='.repeat(80))
  console.log('')

  const planFeatures = await prisma.planFeature.findMany({
    include: { feature: true, plan: true },
    where: { feature: { code: 'DIAGRAM_GENERATION' } }
  })

  if (planFeatures.length === 0) {
    console.log('No DIAGRAM_GENERATION feature found in any plan!')
    return
  }

  console.log('Plan | Completion Quota | Token Limits')
  console.log('-'.repeat(80))
  
  for (const pf of planFeatures) {
    const completionQuota = `daily=${pf.dailyQuota ?? '∞'}, monthly=${pf.monthlyQuota ?? '∞'}`
    const tokenLimits = `daily=${pf.dailyTokenLimit ?? '∞'}, monthly=${pf.monthlyTokenLimit ?? '∞'}`
    console.log(`${pf.plan.code.padEnd(20)} | ${completionQuota.padEnd(30)} | ${tokenLimits}`)
  }

  // Also check current usage for the test tenant
  const tenantId = 'cmkux8i3y0001l6uxlr5vqoe3'
  const currentMonth = new Date().toISOString().substring(0, 7)
  
  const feature = planFeatures[0]?.feature
  if (feature) {
    const monthlyUsage = await prisma.usageMeter.findFirst({
      where: {
        tenantId,
        featureId: feature.id,
        periodType: 'MONTHLY',
        periodKey: currentMonth
      }
    })
    
    console.log('')
    console.log('Current Usage for tenant', tenantId + ':')
    console.log('  Monthly completions:', monthlyUsage?.currentUsage ?? 0)
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
