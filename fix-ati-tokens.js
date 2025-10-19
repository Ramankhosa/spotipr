const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fixTokens() {
  try {
    // Update ATI tokens with planTier 'FREE' to 'FREE_PLAN'
    const result = await prisma.aTIToken.updateMany({
      where: { planTier: 'FREE' },
      data: { planTier: 'FREE_PLAN' }
    });

    console.log(`Updated ${result.count} ATI tokens from 'FREE' to 'FREE_PLAN'`);

    // Also update any tokens that might have 'PRO' to 'PRO_PLAN'
    const proResult = await prisma.aTIToken.updateMany({
      where: { planTier: 'PRO' },
      data: { planTier: 'PRO_PLAN' }
    });

    console.log(`Updated ${proResult.count} ATI tokens from 'PRO' to 'PRO_PLAN'`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixTokens();
