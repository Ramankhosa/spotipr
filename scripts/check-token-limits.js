const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  console.log('='.repeat(80))
  console.log('PATENT DRAFTING TOKEN LIMITS')
  console.log('='.repeat(80))
  console.log('')
  console.log('These are SEPARATE from completion quotas (dailyQuota/monthlyQuota)')
  console.log('Token limits are enforced via org-access-service.ts')
  console.log('')

  const planFeatures = await prisma.planFeature.findMany({
    include: { feature: true, plan: true },
    where: { feature: { code: 'PATENT_DRAFTING' } }
  })

  console.log('Plan | Completion Quota (Patent Count) | Token Limits')
  console.log('-'.repeat(80))
  
  for (const pf of planFeatures) {
    const completionQuota = `daily=${pf.dailyQuota ?? '∞'}, monthly=${pf.monthlyQuota ?? '∞'}`
    const tokenLimits = `daily=${pf.dailyTokenLimit ?? '∞'}, monthly=${pf.monthlyTokenLimit ?? '∞'}`
    console.log(`${pf.plan.code.padEnd(20)} | ${completionQuota.padEnd(30)} | ${tokenLimits}`)
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
