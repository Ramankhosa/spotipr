const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: { atiId: 'RUNJHUN' },
    include: {
      tenantPlans: {
        include: { plan: true }
      }
    }
  });
  
  console.log('Tenant:', tenant?.name);
  console.log('Plans:');
  tenant?.tenantPlans.forEach(p => console.log('  -', p.plan.code, '| Status:', p.status));
  
  const atiToken = await prisma.aTIToken.findFirst({
    where: { token: 'RUNJHUN' }
  });
  
  if (atiToken) {
    console.log('\nATI Token planTier:', atiToken.planTier);
  }
  
  await prisma.$disconnect();
}

main();

