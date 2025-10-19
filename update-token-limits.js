const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function updatePolicyRules() {
  try {
    // Update to much higher token limits
    const newLimit = 8000;

    await prisma.policyRule.upsert({
      where: {
        scope_scopeId_taskCode_key: {
          scope: 'plan',
          scopeId: 'cmgsxqrvo0008ga9ht3wd56lt', // FREE_PLAN ID
          taskCode: 'LLM1_PRIOR_ART',
          key: 'max_tokens_out'
        }
      },
      update: { value: newLimit },
      create: {
        scope: 'plan',
        scopeId: 'cmgsxqrvo0008ga9ht3wd56lt',
        taskCode: 'LLM1_PRIOR_ART',
        key: 'max_tokens_out',
        value: newLimit
      }
    });

    await prisma.policyRule.upsert({
      where: {
        scope_scopeId_taskCode_key: {
          scope: 'plan',
          scopeId: 'cmgqh9rd10000xjnkvgb2w8xp', // PRO_PLAN ID
          taskCode: 'LLM1_PRIOR_ART',
          key: 'max_tokens_out'
        }
      },
      update: { value: newLimit },
      create: {
        scope: 'plan',
        scopeId: 'cmgqh9rd10000xjnkvgb2w8xp',
        taskCode: 'LLM1_PRIOR_ART',
        key: 'max_tokens_out',
        value: newLimit
      }
    });

    console.log(`✅ Updated policy rules to max_tokens_out = ${newLimit}`);

  } catch (error) {
    console.error('Error updating policy rules:', error);
  } finally {
    await prisma.$disconnect();
  }
}

updatePolicyRules();
