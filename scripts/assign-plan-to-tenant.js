const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const tenantId = process.argv[2] || 'cmkuqle7c00013i6n0m4p1kdx'
  const planCode = process.argv[3] || 'BASIC_PLAN'
  
  console.log('Assigning plan to tenant...')
  console.log('Tenant ID:', tenantId)
  console.log('Plan Code:', planCode)
  console.log('')
  
  // Find the plan
  const plan = await prisma.plan.findFirst({ where: { code: planCode } })
  if (!plan) {
    console.log('ERROR: Plan not found:', planCode)
    return
  }
  
  // Check if tenant exists
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
  if (!tenant) {
    console.log('ERROR: Tenant not found:', tenantId)
    return
  }
  
  // Create tenant plan
  const now = new Date()
  const expires = new Date(now)
  expires.setMonth(expires.getMonth() + 1)
  
  const tenantPlan = await prisma.tenantPlan.create({
    data: {
      tenantId,
      planId: plan.id,
      status: 'ACTIVE',
      effectiveFrom: now,
      expiresAt: expires
    }
  })
  
  console.log('SUCCESS! Plan assigned.')
  console.log('Plan:', plan.name)
  console.log('Effective From:', tenantPlan.effectiveFrom)
  console.log('Expires At:', tenantPlan.expiresAt)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
