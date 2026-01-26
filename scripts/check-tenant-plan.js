const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  console.log('='.repeat(80))
  console.log('TENANT PLAN CONFIGURATION')
  console.log('='.repeat(80))
  console.log('')

  const tenants = await prisma.tenant.findMany({
    include: {
      tenantPlans: {
        where: { status: 'ACTIVE' },
        include: {
          plan: {
            include: {
              planFeatures: {
                include: { feature: true }
              }
            }
          }
        }
      }
    }
  })

  for (const t of tenants) {
    console.log(`Tenant: ${t.name} (${t.id})`)
    
    if (t.tenantPlans.length === 0) {
      console.log('  !! NO ACTIVE PLAN !!')
    }
    
    for (const tp of t.tenantPlans) {
      console.log(`  Plan: ${tp.plan.name} (${tp.plan.code})`)
      console.log(`  Effective: ${tp.effectiveFrom} to ${tp.expiresAt || 'never'}`)
      
      const pf = tp.plan.planFeatures?.find(f => f.feature.code === 'PATENT_DRAFTING')
      if (pf) {
        console.log(`  PATENT_DRAFTING: Daily=${pf.dailyQuota ?? 'unlimited'}, Monthly=${pf.monthlyQuota ?? 'unlimited'}`)
      } else {
        console.log('  PATENT_DRAFTING: !! FEATURE NOT CONFIGURED !!')
      }
    }
    console.log('')
  }

  // Also show the Plan table directly
  console.log('-'.repeat(40))
  console.log('ALL PLANS WITH PATENT_DRAFTING FEATURE:')
  console.log('-'.repeat(40))
  
  const plans = await prisma.plan.findMany({
    include: {
      planFeatures: {
        include: { feature: true }
      }
    }
  })

  for (const p of plans) {
    const pf = p.planFeatures?.find(f => f.feature.code === 'PATENT_DRAFTING')
    if (pf) {
      console.log(`${p.name} (${p.code}): Daily=${pf.dailyQuota ?? 'unlimited'}, Monthly=${pf.monthlyQuota ?? 'unlimited'}`)
    } else {
      console.log(`${p.name} (${p.code}): PATENT_DRAFTING NOT CONFIGURED`)
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
