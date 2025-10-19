const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkPlanIds() {
  try {
    const plans = await prisma.plan.findMany();
    console.log('Plan IDs:');
    plans.forEach(plan => {
      console.log(`  ${plan.code}: ${plan.id}`);
    });
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkPlanIds();
