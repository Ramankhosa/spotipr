const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function updateTenantPlans() {
  try {
    console.log('🔄 Updating tenant plan assignments...');

    // Get PRO_PLAN
    const proPlan = await prisma.plan.findUnique({ where: { code: 'PRO_PLAN' } });
    if (!proPlan) {
      console.error('❌ PRO_PLAN not found');
      return;
    }

    // Get Test Company Inc. tenant
    const testTenant = await prisma.tenant.findUnique({ where: { atiId: 'TESTTENANT' } });
    if (!testTenant) {
      console.error('❌ Test tenant not found');
      return;
    }

    // Delete existing tenant plan
    await prisma.tenantPlan.deleteMany({
      where: { tenantId: testTenant.id }
    });

    // Create new tenant plan with PRO_PLAN
    await prisma.tenantPlan.create({
      data: {
        tenantId: testTenant.id,
        planId: proPlan.id,
        effectiveFrom: new Date(),
        status: 'ACTIVE'
      }
    });

    console.log('✅ Updated Test Company Inc. to PRO_PLAN');

    // Verify final assignments
    const tenantPlans = await prisma.tenantPlan.findMany({
      include: { tenant: true, plan: true }
    });

    console.log('\n📋 Final tenant-plan assignments:');
    tenantPlans.forEach(tp => {
      console.log(`   ${tp.tenant.name} -> ${tp.plan.code}`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

updateTenantPlans();
