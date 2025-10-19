const { PrismaClient } = require('@prisma/client');

async function fixPlanLLMAccess() {
  console.log('🔧 Fixing Plan LLM Access Configuration...');

  const prisma = new PrismaClient();

  try {
    // First, ensure all required features exist
    const features = await Promise.all([
      prisma.feature.upsert({
        where: { code: 'PRIOR_ART_SEARCH' },
        update: {},
        create: {
          code: 'PRIOR_ART_SEARCH',
          name: 'Prior Art Search',
          unit: 'calls'
        }
      }),
      prisma.feature.upsert({
        where: { code: 'PATENT_DRAFTING' },
        update: {},
        create: {
          code: 'PATENT_DRAFTING',
          name: 'Patent Drafting',
          unit: 'tokens'
        }
      })
    ]);

    console.log('✅ Features ready:', features.map(f => f.code));

    // Ensure all required tasks exist
    const tasks = await Promise.all([
      prisma.task.upsert({
        where: { code: 'LLM1_PRIOR_ART' },
        update: {},
        create: {
          code: 'LLM1_PRIOR_ART',
          name: 'Prior Art Analysis',
          linkedFeatureId: features[0].id
        }
      }),
      prisma.task.upsert({
        where: { code: 'LLM2_DRAFT' },
        update: {},
        create: {
          code: 'LLM2_DRAFT',
          name: 'Patent Drafting',
          linkedFeatureId: features[1].id
        }
      }),
      prisma.task.upsert({
        where: { code: 'LLM4_NOVELTY_SCREEN' },
        update: {},
        create: {
          code: 'LLM4_NOVELTY_SCREEN',
          name: 'Novelty Screening',
          linkedFeatureId: features[0].id
        }
      }),
      prisma.task.upsert({
        where: { code: 'LLM5_NOVELTY_ASSESS' },
        update: {},
        create: {
          code: 'LLM5_NOVELTY_ASSESS',
          name: 'Novelty Assessment',
          linkedFeatureId: features[1].id
        }
      })
    ]);

    console.log('✅ Tasks ready:', tasks.map(t => t.code));

    // Ensure model classes exist
    const modelClasses = await Promise.all([
      prisma.lLMModelClass.upsert({
        where: { code: 'BASE_S' },
        update: {},
        create: {
          code: 'BASE_S',
          name: 'Base Small'
        }
      }),
      prisma.lLMModelClass.upsert({
        where: { code: 'PRO_M' },
        update: {},
        create: {
          code: 'PRO_M',
          name: 'Professional Medium'
        }
      })
    ]);

    console.log('✅ Model classes ready:', modelClasses.map(m => m.code));

    // Get the PRO_PLAN
    const proPlan = await prisma.plan.findUnique({
      where: { code: 'PRO_PLAN' }
    });

    if (!proPlan) {
      console.log('❌ PRO_PLAN not found');
      return;
    }

    console.log('📋 Setting up LLM access for PRO_PLAN...');

    // Create PlanLLMAccess for all tasks in PRO_PLAN
    const planAccess = await Promise.all([
      // LLM1_PRIOR_ART
      prisma.planLLMAccess.upsert({
        where: {
          planId_taskCode: {
            planId: proPlan.id,
            taskCode: 'LLM1_PRIOR_ART'
          }
        },
        update: {},
        create: {
          planId: proPlan.id,
          taskCode: 'LLM1_PRIOR_ART',
          allowedClasses: JSON.stringify(['BASE_S', 'PRO_M']),
          defaultClassId: modelClasses[1].id // PRO_M
        }
      }),
      // LLM2_DRAFT
      prisma.planLLMAccess.upsert({
        where: {
          planId_taskCode: {
            planId: proPlan.id,
            taskCode: 'LLM2_DRAFT'
          }
        },
        update: {},
        create: {
          planId: proPlan.id,
          taskCode: 'LLM2_DRAFT',
          allowedClasses: JSON.stringify(['BASE_S', 'PRO_M']),
          defaultClassId: modelClasses[1].id // PRO_M
        }
      }),
      // LLM4_NOVELTY_SCREEN
      prisma.planLLMAccess.upsert({
        where: {
          planId_taskCode: {
            planId: proPlan.id,
            taskCode: 'LLM4_NOVELTY_SCREEN'
          }
        },
        update: {},
        create: {
          planId: proPlan.id,
          taskCode: 'LLM4_NOVELTY_SCREEN',
          allowedClasses: JSON.stringify(['BASE_S', 'PRO_M']),
          defaultClassId: modelClasses[1].id // PRO_M
        }
      }),
      // LLM5_NOVELTY_ASSESS
      prisma.planLLMAccess.upsert({
        where: {
          planId_taskCode: {
            planId: proPlan.id,
            taskCode: 'LLM5_NOVELTY_ASSESS'
          }
        },
        update: {},
        create: {
          planId: proPlan.id,
          taskCode: 'LLM5_NOVELTY_ASSESS',
          allowedClasses: JSON.stringify(['BASE_S', 'PRO_M']),
          defaultClassId: modelClasses[1].id // PRO_M
        }
      })
    ]);

    console.log('✅ Plan LLM access configured:', planAccess.length, 'rules');

    // Verify the setup
    const verifiedPlan = await prisma.plan.findUnique({
      where: { code: 'PRO_PLAN' },
      include: {
        planLLMAccess: {
          include: { task: true, defaultClass: true }
        },
        tenantPlans: true
      }
    });

    console.log('\n🎯 Verification - PRO_PLAN Configuration:');
    console.log(`Plan: ${verifiedPlan.name} (${verifiedPlan.code})`);
    console.log(`LLM Access Rules: ${verifiedPlan.planLLMAccess.length}`);
    console.log(`Tenant Assignments: ${verifiedPlan.tenantPlans.length}`);

    verifiedPlan.planLLMAccess.forEach(access => {
      console.log(`  - ${access.task.name} (${access.taskCode}): ${access.allowedClasses} -> ${access.defaultClass.name}`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixPlanLLMAccess();
