const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkTokens() {
  try {
    const tokens = await prisma.aTIToken.findMany({
      where: { tenant: { atiId: 'TESTTENANT' } },
      include: { tenant: true }
    });

    console.log('ATI Tokens for TESTTENANT:');
    tokens.forEach(token => {
      console.log(`  ID: ${token.id}`);
      console.log(`  PlanTier: '${token.planTier}'`);
      console.log(`  Status: ${token.status}`);
      console.log(`  Tenant: ${token.tenant.name}`);
      console.log('---');
    });

    const plans = await prisma.plan.findMany();
    console.log('Available Plans:');
    plans.forEach(plan => {
      console.log(`  Code: '${plan.code}'`);
      console.log(`  Name: ${plan.name}`);
      console.log('---');
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkTokens();
