const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const email = process.argv[2] || 'ramandeep.singh@lpu.co.in'
  
  const user = await prisma.user.findFirst({
    where: { email },
    include: {
      tenant: {
        include: {
          tenantPlans: {
            where: { status: 'ACTIVE' },
            include: { plan: true }
          }
        }
      }
    }
  })

  if (!user) {
    console.log('User not found:', email)
    return
  }

  console.log('='.repeat(60))
  console.log('USER DETAILS')
  console.log('='.repeat(60))
  console.log('Email:', user.email)
  console.log('User ID:', user.id)
  console.log('Tenant ID:', user.tenantId)
  console.log('Tenant Name:', user.tenant?.name)
  console.log('')
  
  if (!user.tenant?.tenantPlans || user.tenant.tenantPlans.length === 0) {
    console.log('!! WARNING: NO ACTIVE PLAN FOR THIS TENANT !!')
    console.log('This is why you are getting quota errors.')
    console.log('')
    console.log('To fix: Assign a plan to this tenant.')
  } else {
    for (const tp of user.tenant.tenantPlans) {
      console.log('Active Plan:', tp.plan.name, '(' + tp.plan.code + ')')
      console.log('Effective:', tp.effectiveFrom, 'to', tp.expiresAt || 'never')
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
