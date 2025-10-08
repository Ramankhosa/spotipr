const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkPlans() {
  try {
    console.log('🔍 Checking existing plans...');
    const plans = await prisma.plan.findMany();
    console.log('📋 Available plans:');
    plans.forEach(plan => {
      console.log(`   ${plan.code}: ${plan.name} (${plan.status})`);
    });

    console.log('\n🏢 Checking tenant plans...');
    const tenantPlans = await prisma.tenantPlan.findMany({
      include: { tenant: true, plan: true }
    });
    console.log('📋 Tenant-Plan assignments:');
    tenantPlans.forEach(tp => {
      console.log(`   ${tp.tenant.name} (${tp.tenant.atiId}) -> ${tp.plan.code} (${tp.status})`);
    });

    console.log('\n👤 Checking user tenants...');
    const users = await prisma.user.findMany({
      include: { tenant: true }
    });
    users.forEach(user => {
      console.log(`   ${user.email} (${user.role}) -> ${user.tenant?.name || 'No tenant'} (${user.tenant?.atiId || 'N/A'})`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkPlans();
