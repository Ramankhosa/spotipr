const { PrismaClient } = require('@prisma/client');

async function checkPlansAndFix() {
  console.log('🔍 Checking plans and fixing ATI context...');

  const prisma = new PrismaClient();

  try {
    // Check what plans exist
    const plans = await prisma.plan.findMany();
    console.log('📋 Available Plans:', plans.length);
    plans.forEach((plan, i) => {
      console.log(`  ${i+1}. ${plan.name} (${plan.code}) - $${plan.price}/month`);
    });

    // Find the analyst and tenant
    const analyst = await prisma.user.findUnique({
      where: { email: 'analyst@spotipr.com' },
      include: { tenant: true }
    });

    if (!analyst || !analyst.tenant) {
      console.log('❌ Analyst or tenant not found');
      return;
    }

    // Check if tenant has a plan
    const existingTenantPlan = await prisma.tenantPlan.findFirst({
      where: { tenantId: analyst.tenant.id },
      include: { plan: true }
    });

    if (existingTenantPlan) {
      console.log('✅ Tenant already has a plan:', existingTenantPlan.plan.name);
      return;
    }

    console.log('❌ Tenant has no plan - creating one...');

    // Find PRO_PLAN (which should have LLM access)
    const proPlan = await prisma.plan.findUnique({
      where: { code: 'PRO_PLAN' }
    });

    if (!proPlan) {
      console.log('❌ PRO_PLAN not found - creating it...');

      // Create PRO_PLAN if it doesn't exist
      const createdProPlan = await prisma.plan.create({
        data: {
          code: 'PRO_PLAN',
          name: 'Professional Plan',
          cycle: 'MONTHLY',
          status: 'ACTIVE'
        }
      });

      console.log('✅ Created PRO_PLAN');
    }

    // Get the plan (either existing or newly created)
    const planToUse = proPlan || await prisma.plan.findUnique({
      where: { code: 'PRO_PLAN' }
    });

    if (!planToUse) {
      console.log('❌ Could not find or create PRO_PLAN');
      return;
    }

    // Create tenant plan
    const tenantPlan = await prisma.tenantPlan.create({
      data: {
        tenantId: analyst.tenant.id,
        planId: planToUse.id,
        status: 'ACTIVE',
        effectiveFrom: new Date(),
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 year
      },
      include: { plan: true }
    });

    console.log('✅ Created tenant plan:', {
      planName: tenantPlan.plan.name,
      status: tenantPlan.status,
      expiresAt: tenantPlan.expiresAt
    });

    // Add LLM access for novelty assessment tasks if they don't exist
    console.log('🔧 Setting up LLM access for novelty assessment...');

    // First, ensure the novelty assessment tasks exist
    const tasks = await Promise.all([
      prisma.task.upsert({
        where: { code: 'LLM4_NOVELTY_SCREEN' },
        update: {},
        create: {
          code: 'LLM4_NOVELTY_SCREEN',
          name: 'Novelty Screening',
          linkedFeatureId: (await prisma.feature.upsert({
            where: { code: 'PRIOR_ART_SEARCH' },
            update: {},
            create: {
              code: 'PRIOR_ART_SEARCH',
              name: 'Prior Art Search',
              unit: 'calls'
            }
          })).id
        }
      }),
      prisma.task.upsert({
        where: { code: 'LLM5_NOVELTY_ASSESS' },
        update: {},
        create: {
          code: 'LLM5_NOVELTY_ASSESS',
          name: 'Novelty Assessment',
          linkedFeatureId: (await prisma.feature.upsert({
            where: { code: 'PATENT_DRAFTING' },
            update: {},
            create: {
              code: 'PATENT_DRAFTING',
              name: 'Patent Drafting',
              unit: 'tokens'
            }
          })).id
        }
      })
    ]);

    console.log('✅ Ensured novelty assessment tasks exist');

    // Check if model classes exist
    const proMClass = await prisma.lLMModelClass.findUnique({
      where: { code: 'PRO_M' }
    });

    if (!proMClass) {
      console.log('❌ PRO_M model class not found - creating it...');
      const createdProM = await prisma.lLMModelClass.create({
        data: {
          code: 'PRO_M',
          name: 'Professional Medium'
        }
      });
      console.log('✅ Created PRO_M model class');
    }

    const modelClassToUse = proMClass || await prisma.lLMModelClass.findUnique({
      where: { code: 'PRO_M' }
    });

    if (modelClassToUse) {
      // Add LLM access for novelty assessment tasks
      const noveltyAccess = await Promise.all([
        prisma.planLLMAccess.upsert({
          where: {
            planId_taskCode: {
              planId: planToUse.id,
              taskCode: 'LLM4_NOVELTY_SCREEN'
            }
          },
          update: {},
          create: {
            planId: planToUse.id,
            taskCode: 'LLM4_NOVELTY_SCREEN',
            allowedClasses: JSON.stringify(['PRO_M']),
            defaultClassId: modelClassToUse.id
          }
        }),
        prisma.planLLMAccess.upsert({
          where: {
            planId_taskCode: {
              planId: planToUse.id,
              taskCode: 'LLM5_NOVELTY_ASSESS'
            }
          },
          update: {},
          create: {
            planId: planToUse.id,
            taskCode: 'LLM5_NOVELTY_ASSESS',
            allowedClasses: JSON.stringify(['PRO_M']),
            defaultClassId: modelClassToUse.id
          }
        })
      ]);

      console.log('✅ Added LLM access for novelty assessment tasks');
    }

    // Now check if tenant has credits
    const credits = await prisma.tenantCredit.findFirst({
      where: { tenantId: analyst.tenant.id }
    });

    if (!credits) {
      console.log('❌ No credits found - creating tenant credits...');

      await prisma.tenantCredit.create({
        data: {
          tenantId: analyst.tenant.id,
          totalCredits: 10000,
          usedCredits: 0,
          resetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
        }
      });

      console.log('✅ Created tenant credits: 10,000');
    } else {
      console.log('✅ Tenant credits exist:', credits.totalCredits - credits.usedCredits, 'remaining');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkPlansAndFix();
