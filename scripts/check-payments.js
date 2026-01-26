const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  console.log('='.repeat(80))
  console.log('RECENT PAYMENTS AND SUBSCRIPTIONS')
  console.log('='.repeat(80))
  console.log('')

  // Check payments
  const payments = await prisma.payment.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: {
      user: { select: { email: true } },
      tenant: { select: { name: true } },
      plan: { select: { name: true, code: true } }
    }
  })

  console.log('RECENT PAYMENTS:')
  console.log('-'.repeat(40))
  
  if (payments.length === 0) {
    console.log('  No payments found.')
  } else {
    for (const p of payments) {
      console.log(`  ${p.createdAt.toISOString().substring(0, 19)} | ${p.user?.email || 'N/A'} | ${p.plan?.name || 'N/A'} | ${p.status} | ${p.amount}`)
    }
  }
  console.log('')

  // Check tenant plans created recently
  console.log('RECENT TENANT PLAN ASSIGNMENTS:')
  console.log('-'.repeat(40))
  
  const tenantPlans = await prisma.tenantPlan.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: {
      tenant: { select: { name: true } },
      plan: { select: { name: true, code: true } }
    }
  })

  for (const tp of tenantPlans) {
    console.log(`  ${tp.createdAt.toISOString().substring(0, 19)} | ${tp.tenant?.name || 'N/A'} | ${tp.plan?.name} (${tp.plan?.code}) | ${tp.status}`)
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
