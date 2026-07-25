/**
 * Ensure every plan allows Stage 0 idea normalization to run its calls in parallel.
 *
 * Stage 0 (DraftingService.normalizeIdea) issues STAGE0_NORMALIZATION_FANOUT
 * concurrent LLM2_DRAFT calls (core / search / support). The reservation gate in
 * src/lib/metering/reservation.ts rejects calls beyond the per-plan
 * `concurrency_limit` PolicyRule for that task code, and the caller then retries
 * them serially — correct, but roughly 3x slower. This script raises the limit so
 * the three calls actually run at once.
 *
 * Idempotent and safe to re-run. Existing rules are updated in place regardless of
 * whether they were scoped by plan id or plan code (both forms are resolved by
 * reservation.getConcurrencyLimit), so this never creates ambiguous duplicates.
 *
 * Usage:
 *   node scripts/set-stage0-concurrency.js          # apply
 *   node scripts/set-stage0-concurrency.js --dry    # show what would change
 */
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()
const DRY_RUN = process.argv.includes('--dry')

const STAGE0_NORMALIZATION_FANOUT = 3
const TASK_CODE = 'LLM2_DRAFT'

// Floor is the fan-out; higher tiers get headroom for other concurrent drafting work.
const LIMIT_BY_PLAN_CODE = {
  TRIAL: STAGE0_NORMALIZATION_FANOUT,
  FREE_PLAN: STAGE0_NORMALIZATION_FANOUT,
  BASIC_PLAN: STAGE0_NORMALIZATION_FANOUT + 1,
  PRO_PLAN: STAGE0_NORMALIZATION_FANOUT + 3,
  ENTERPRISE_PLAN: STAGE0_NORMALIZATION_FANOUT + 5,
}

const DEFAULT_LIMIT = STAGE0_NORMALIZATION_FANOUT

async function main() {
  console.log(`Stage 0 normalization fan-out: ${STAGE0_NORMALIZATION_FANOUT} concurrent ${TASK_CODE} calls`)
  if (DRY_RUN) console.log('DRY RUN - no writes\n')

  const plans = await prisma.plan.findMany({ select: { id: true, code: true } })
  if (plans.length === 0) {
    console.log('No plans found.')
    return
  }

  for (const plan of plans) {
    const target = LIMIT_BY_PLAN_CODE[plan.code] ?? DEFAULT_LIMIT

    // reservation.getConcurrencyLimit matches on plan.code OR plan.id, so reconcile both.
    const existing = await prisma.policyRule.findMany({
      where: {
        key: 'concurrency_limit',
        taskCode: TASK_CODE,
        scope: 'plan',
        scopeId: { in: [plan.id, plan.code] },
      },
    })

    if (existing.length === 0) {
      console.log(`  ${plan.code.padEnd(16)} (none) -> ${target}  [create]`)
      if (!DRY_RUN) {
        await prisma.policyRule.create({
          data: { scope: 'plan', scopeId: plan.id, taskCode: TASK_CODE, key: 'concurrency_limit', value: target },
        })
      }
      continue
    }

    for (const rule of existing) {
      if (rule.value >= target) {
        console.log(`  ${plan.code.padEnd(16)} ${rule.value} -> ${rule.value}  [ok, already >= ${target}]`)
        continue
      }
      console.log(`  ${plan.code.padEnd(16)} ${rule.value} -> ${target}  [update]`)
      if (!DRY_RUN) {
        await prisma.policyRule.update({ where: { id: rule.id }, data: { value: target } })
      }
    }
  }

  console.log('\nDone.')
}

main()
  .catch((error) => {
    console.error('Failed:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
