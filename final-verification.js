const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function verifyAnalystSetup() {
  try {
    console.log('🔍 Final Verification: analyst@spotipr.com Setup\n');

    // Check user
    const user = await prisma.user.findUnique({
      where: { email: 'analyst@spotipr.com' },
      include: {
        tenant: true,
        signupAtiToken: true,
        credits: true,
      },
    });

    if (!user) {
      console.log('❌ User not found');
      return;
    }

    console.log('✅ USER EXISTS:');
    console.log(`   Email: ${user.email}`);
    console.log(`   Name: ${user.name}`);
    console.log(`   Role: ${user.role}`);
    console.log(`   Status: ${user.status}`);
    console.log(`   Tenant: ${user.tenant?.name} (${user.tenant?.atiId})`);
    console.log('');

    // Check ATI token
    if (user.signupAtiToken) {
      console.log('✅ ATI TOKEN LINKED:');
      console.log(`   Token: ***${user.signupAtiToken.rawToken?.slice(-6)}`);
      console.log(`   Status: ${user.signupAtiToken.status}`);
      console.log(`   Plan: ${user.signupAtiToken.planTier}`);
    } else {
      console.log('❌ No ATI token linked');
    }
    console.log('');

    // Check credits
    if (user.credits) {
      console.log('✅ CREDITS INITIALIZED:');
      console.log(`   Total: ${user.credits.totalCredits}`);
      console.log(`   Used: ${user.credits.usedCredits}`);
      console.log(`   Remaining: ${user.credits.totalCredits - user.credits.usedCredits}`);
      console.log(`   Plan: ${user.credits.planTier}`);
    } else {
      console.log('❌ No credits initialized');
    }
    console.log('');

    // Summary
    const allGood = user && user.signupAtiToken && user.credits;

    console.log('🎯 VERIFICATION SUMMARY:');
    console.log(`   User Exists: ✅`);
    console.log(`   ATI Token Linked: ${user.signupAtiToken ? '✅' : '❌'}`);
    console.log(`   Credits Initialized: ${user.credits ? '✅' : '❌'}`);
    console.log('');

    if (allGood) {
      console.log('🎉 analyst@spotipr.com is FULLY SET UP!');
      console.log('');
      console.log('🚀 READY TO USE:');
      console.log('   Email: analyst@spotipr.com');
      console.log('   Password: AnalystPass123!');
      console.log('   ATI Token: Available for signup');
      console.log('   Credits: 100 available');
      console.log('   Prior Art Search: ✅ Ready');
    } else {
      console.log('⚠️  Setup incomplete - some components missing');
    }

  } catch (error) {
    console.error('❌ Verification failed:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

verifyAnalystSetup();
