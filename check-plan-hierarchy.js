const { PrismaClient } = require('@prisma/client');

async function checkPlanHierarchy() {
  console.log('🔍 Checking Plan Hierarchy and Permissions...');

  const prisma = new PrismaClient();

  try {
    // Check all plans
    const plans = await prisma.plan.findMany({
      include: {
        tenantPlans: true,
        planLLMAccess: {
          include: {
            task: true,
            defaultClass: true
          }
        }
      }
    });

    console.log('\n📋 All Plans:');
    plans.forEach((plan, i) => {
      console.log(`${i+1}. ${plan.name} (${plan.code}) - Status: ${plan.status}`);
      console.log(`   Tenant Plans: ${plan.tenantPlans.length}`);
      console.log(`   LLM Access Rules: ${plan.planLLMAccess.length}`);

      plan.planLLMAccess.forEach(access => {
        console.log(`     - ${access.task.name} (${access.taskCode}): ${access.allowedClasses}`);
      });
    });

    // Check tenant plans for our analyst's tenant
    const analyst = await prisma.user.findUnique({
      where: { email: 'analyst@spotipr.com' },
      include: { tenant: true }
    });

    if (analyst?.tenant) {
      console.log(`\n🏢 Tenant "${analyst.tenant.name}" Plans:`);
      const tenantPlans = await prisma.tenantPlan.findMany({
        where: { tenantId: analyst.tenant.id },
        include: {
          plan: {
            include: {
              planLLMAccess: {
                include: { task: true }
              }
            }
          }
        }
      });

      tenantPlans.forEach((tp, i) => {
        console.log(`${i+1}. ${tp.plan.name} (${tp.plan.code}) - Status: ${tp.status}`);
        console.log(`   Effective: ${tp.effectiveFrom}`);
        console.log(`   Expires: ${tp.expiresAt}`);
        console.log(`   LLM Tasks Allowed: ${tp.plan.planLLMAccess.map(p => p.taskCode).join(', ')}`);
      });
    }

    // Check what tasks exist
    const tasks = await prisma.task.findMany({
      include: { linkedFeature: true }
    });

    console.log('\n🎯 Available Tasks:');
    tasks.forEach(task => {
      console.log(`- ${task.name} (${task.code}) -> ${task.linkedFeature?.name || 'No feature'}`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkPlanHierarchy();

