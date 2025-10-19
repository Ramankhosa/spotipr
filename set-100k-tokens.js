const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function updateTo100kTokens() {
  try {
    // Set to 100k tokens for patent drafting
    const newLimit = 100000; // 100,000 tokens

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

    console.log(`✅ Updated LLM1_PRIOR_ART to max_tokens_out = ${newLimit.toLocaleString()}`);

    // Also update LLM2_DRAFT (patent drafting) task
    await prisma.policyRule.upsert({
      where: {
        scope_scopeId_taskCode_key: {
          scope: 'plan',
          scopeId: 'cmgsxqrvo0008ga9ht3wd56lt', // FREE_PLAN ID
          taskCode: 'LLM2_DRAFT',
          key: 'max_tokens_out'
        }
      },
      update: { value: newLimit },
      create: {
        scope: 'plan',
        scopeId: 'cmgsxqrvo0008ga9ht3wd56lt',
        taskCode: 'LLM2_DRAFT',
        key: 'max_tokens_out',
        value: newLimit
      }
    });

    await prisma.policyRule.upsert({
      where: {
        scope_scopeId_taskCode_key: {
          scope: 'plan',
          scopeId: 'cmgqh9rd10000xjnkvgb2w8xp', // PRO_PLAN ID
          taskCode: 'LLM2_DRAFT',
          key: 'max_tokens_out'
        }
      },
      update: { value: newLimit },
      create: {
        scope: 'plan',
        scopeId: 'cmgqh9rd10000xjnkvgb2w8xp',
        taskCode: 'LLM2_DRAFT',
        key: 'max_tokens_out',
        value: newLimit
      }
    });

    console.log(`✅ Updated LLM2_DRAFT to max_tokens_out = ${newLimit.toLocaleString()}`);

  } catch (error) {
    console.error('Error updating policy rules:', error);
  } finally {
    await prisma.$disconnect();
  }
}

updateTo100kTokens();
