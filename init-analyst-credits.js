const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function initAnalystCredits() {
  try {
    console.log('💰 Initializing credits for analyst@spotipr.com...\n');

    // Find the analyst user
    const analyst = await prisma.user.findUnique({
      where: { email: 'analyst@spotipr.com' }
    });

    if (!analyst) {
      console.log('❌ Analyst user not found');
      return;
    }

    console.log('✅ Found analyst user:', analyst.email);

    // Create credits record
    const credits = await prisma.userCredit.upsert({
      where: { userId: analyst.id },
      update: {
        totalCredits: 100,
        usedCredits: 0,
        planTier: 'free',
        monthlyReset: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      },
      create: {
        userId: analyst.id,
        totalCredits: 100,
        usedCredits: 0,
        planTier: 'free',
        monthlyReset: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      },
    });

    console.log('✅ Credits initialized successfully!');
    console.log(`   Total Credits: ${credits.totalCredits}`);
    console.log(`   Used Credits: ${credits.usedCredits}`);
    console.log(`   Plan Tier: ${credits.planTier}`);
    console.log(`   Monthly Reset: ${credits.monthlyReset}`);

  } catch (error) {
    console.error('❌ Error initializing credits:', error);
  } finally {
    await prisma.$disconnect();
  }
}

initAnalystCredits();
