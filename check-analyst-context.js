const { PrismaClient } = require('@prisma/client');

async function checkAnalystContext() {
  console.log('🔍 Checking analyst context...');

  const prisma = new PrismaClient();

  try {
    // Find the analyst user
    const analyst = await prisma.user.findUnique({
      where: { email: 'analyst@spotipr.com' },
      include: {
        tenant: true,
        signupAtiToken: true
      }
    });

    if (!analyst) {
      console.log('❌ Analyst user not found');
      return;
    }

    console.log('👤 Analyst User:', {
      id: analyst.id,
      email: analyst.email,
      role: analyst.role,
      tenantId: analyst.tenantId,
      tenantName: analyst.tenant?.name
    });

    // Check tenant
    if (analyst.tenant) {
      console.log('🏢 Tenant:', {
        id: analyst.tenant.id,
        name: analyst.tenant.name,
        status: analyst.tenant.status
      });

      // Check tenant plan
      const tenantPlan = await prisma.tenantPlan.findFirst({
        where: { tenantId: analyst.tenant.id },
        include: { plan: true }
      });

      if (tenantPlan) {
        console.log('📋 Tenant Plan:', {
          planName: tenantPlan.plan.name,
          status: tenantPlan.status,
          validUntil: tenantPlan.validUntil
        });
      } else {
        console.log('❌ No tenant plan found');
      }
    }

    // Check ATI token
    if (analyst.signupAtiToken) {
      console.log('🎫 ATI Token:', {
        token: analyst.signupAtiToken.token.substring(0, 20) + '...',
        status: analyst.signupAtiToken.status
      });
    } else {
      console.log('❌ No ATI token found');
    }

    // Check tenant-admin relationship
    if (analyst.tenant) {
      const tenantAdmin = await prisma.user.findFirst({
        where: {
          tenantId: analyst.tenant.id,
          role: 'ADMIN'
        }
      });

      if (tenantAdmin) {
        console.log('👑 Tenant Admin:', {
          email: tenantAdmin.email,
          id: tenantAdmin.id
        });
      } else {
        console.log('❌ No tenant admin found');
      }
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkAnalystContext();
