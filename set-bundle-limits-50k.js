const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function setBundleLimitsTo50k() {
  try {
    // Set LLM1_PRIOR_ART (bundle generation) to 50k tokens
    const bundleLimit = 50000;

    await prisma.policyRule.upsert({
      where: {
        scope_scopeId_taskCode_key: {
          scope: 'plan',
          scopeId: 'cmgsxqrvo0008ga9ht3wd56lt', // FREE_PLAN ID
          taskCode: 'LLM1_PRIOR_ART',
          key: 'max_tokens_out'
        }
      },
      update: { value: bundleLimit },
      create: {
        scope: 'plan',
        scopeId: 'cmgsxqrvo0008ga9ht3wd56lt',
        taskCode: 'LLM1_PRIOR_ART',
        key: 'max_tokens_out',
        value: bundleLimit
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
      update: { value: bundleLimit },
      create: {
        scope: 'plan',
        scopeId: 'cmgqh9rd10000xjnkvgb2w8xp',
        taskCode: 'LLM1_PRIOR_ART',
        key: 'max_tokens_out',
        value: bundleLimit
      }
    });

    console.log(`✅ Updated LLM1_PRIOR_ART (bundle generation) to max_tokens_out = ${bundleLimit.toLocaleString()}`);
    console.log('LLM2_DRAFT (patent drafting) remains at 100k tokens');

  } catch (error) {
    console.error('Error updating policy rules:', error);
  } finally {
    await prisma.$disconnect();
  }
}

setBundleLimitsTo50k();
