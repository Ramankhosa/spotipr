#!/usr/bin/env tsx
/**
 * Plan seeding v2 - writes `src/lib/plans/catalog.ts` into the database.
 *
 *   npm run seed:plans            # apply the catalog
 *   npm run seed:plans -- --dry   # print the diff without writing
 *
 * Overwrite semantics: plans are updated IN PLACE, keyed on their existing `code`, so
 * every TenantPlan / Subscription row that points at them keeps working. Within a plan
 * the feature set is *replaced*, not merged - a feature the catalog omits has its
 * PlanFeature row deleted, which is what actually turns the feature off (an absent
 * PlanFeature makes `checkServiceAccess` deny the service).
 *
 * Idempotent. Safe to re-run on production.
 */

import { PrismaClient } from '@prisma/client'
import type { FeatureCode, ModelClass, TaskCode } from '@prisma/client'
import {
  ALL_TASK_CODES,
  FEATURE_DEFINITIONS,
  MODEL_CLASS_ORDER,
  PLAN_CATALOG,
  PLAN_CODE_TO_PUBLIC,
  PLAN_PRICING_CATALOG,
  POLICY_KEYS,
  TASK_LABELS,
  TASK_TO_FEATURE,
  tasksForPlan,
} from '../src/lib/plans/catalog'

const prisma = new PrismaClient()
const DRY_RUN = process.argv.includes('--dry')

const changes: string[] = []
function log(message: string) {
  changes.push(message)
  console.log(message)
}

async function seedFeatures(): Promise<Record<string, string>> {
  console.log('\n1. Features')
  const byCode: Record<string, string> = {}

  for (const def of FEATURE_DEFINITIONS) {
    if (DRY_RUN) {
      const existing = await prisma.feature.findUnique({ where: { code: def.code } })
      log(`   ${existing ? 'update' : 'create'} feature ${def.code}`)
      // A real run creates the row before grants are written, so stand in a placeholder
      // id here. Without it, grants for a not-yet-created feature would be silently
      // omitted from the dry-run output and look like they were dropped.
      byCode[def.code] = existing?.id ?? `dry-run:${def.code}`
      continue
    }

    const feature = await prisma.feature.upsert({
      where: { code: def.code },
      update: { name: def.name, unit: def.unit },
      create: { code: def.code, name: def.name, unit: def.unit },
    })
    byCode[def.code] = feature.id
  }

  console.log(`   ${FEATURE_DEFINITIONS.length} features ready`)
  return byCode
}

async function seedTasks(featureIds: Record<string, string>) {
  console.log('\n2. Tasks')

  for (const code of ALL_TASK_CODES) {
    const featureCode = TASK_TO_FEATURE[code]
    const linkedFeatureId = featureIds[featureCode]

    if (!linkedFeatureId) {
      if (DRY_RUN) continue
      throw new Error(`Task ${code} references missing feature ${featureCode}`)
    }

    if (DRY_RUN) continue

    await prisma.task.upsert({
      where: { code },
      update: { name: TASK_LABELS[code], linkedFeatureId },
      create: { code, name: TASK_LABELS[code], linkedFeatureId },
    })
  }

  console.log(`   ${ALL_TASK_CODES.length} tasks ready`)
}

async function seedModelClasses(): Promise<Record<string, string>> {
  console.log('\n3. Model classes')
  const byCode: Record<string, string> = {}

  const names: Record<ModelClass, string> = {
    BASE_S: 'Base Small',
    BASE_M: 'Base Medium',
    PRO_M: 'Professional Medium',
    PRO_L: 'Professional Large',
    ADVANCED: 'Advanced',
  }

  for (const code of MODEL_CLASS_ORDER) {
    if (DRY_RUN) {
      const existing = await prisma.lLMModelClass.findUnique({ where: { code } })
      if (existing) byCode[code] = existing.id
      continue
    }

    const mc = await prisma.lLMModelClass.upsert({
      where: { code },
      update: { name: names[code] },
      create: { code, name: names[code] },
    })
    byCode[code] = mc.id
  }

  console.log(`   ${MODEL_CLASS_ORDER.length} model classes ready`)
  return byCode
}

async function seedPlans(featureIds: Record<string, string>, modelClassIds: Record<string, string>) {
  console.log('\n4. Plans, feature grants, LLM access, pricing, policy limits')

  for (const def of PLAN_CATALOG) {
    const existing = await prisma.plan.findUnique({ where: { code: def.code } })

    if (DRY_RUN) {
      log(`   ${existing ? 'update' : 'create'} plan ${def.code} -> "${def.name}"`)
    }

    const plan = DRY_RUN
      ? existing
      : await prisma.plan.upsert({
          where: { code: def.code },
          update: { name: def.name, cycle: def.cycle, status: 'ACTIVE' },
          create: { code: def.code, name: def.name, cycle: def.cycle, status: 'ACTIVE' },
        })

    if (!plan) {
      log(`   [dry] plan ${def.code} does not exist yet - skipping child rows`)
      continue
    }

    // ---- Feature grants: replace, don't merge -----------------------------
    const wantedFeatureCodes = Object.keys(def.features) as FeatureCode[]
    const wantedFeatureIds = new Set(wantedFeatureCodes.map((c) => featureIds[c]).filter(Boolean))

    const currentGrants = await prisma.planFeature.findMany({
      where: { planId: plan.id },
      include: { feature: true },
    })

    for (const grant of currentGrants) {
      if (!wantedFeatureIds.has(grant.featureId)) {
        log(`   - ${def.code}: revoking ${grant.feature.code}`)
        if (!DRY_RUN) {
          await prisma.planFeature.delete({ where: { id: grant.id } })
        }
      }
    }

    for (const featureCode of wantedFeatureCodes) {
      const grant = def.features[featureCode]!
      const featureId = featureIds[featureCode]
      if (!featureId) continue

      const data = {
        monthlyQuota: grant.monthlyQuota,
        dailyQuota: grant.dailyQuota,
        monthlyTokenLimit: grant.monthlyTokenLimit ?? null,
        dailyTokenLimit: grant.dailyTokenLimit ?? null,
      }

      if (DRY_RUN) {
        log(`   - ${def.code}: ${featureCode} = ${grant.monthlyQuota}/mo, ${grant.dailyQuota}/day`)
        continue
      }

      await prisma.planFeature.upsert({
        where: { planId_featureId: { planId: plan.id, featureId } },
        update: data,
        create: { planId: plan.id, featureId, ...data },
      })
    }

    // ---- LLM access: only for tasks whose feature is in the plan ----------
    const wantedTasks = tasksForPlan(def)
    const wantedTaskSet = new Set<TaskCode>(wantedTasks)
    const defaultClassId = modelClassIds[def.modelClasses.default]

    const currentAccess = await prisma.planLLMAccess.findMany({ where: { planId: plan.id } })
    for (const access of currentAccess) {
      if (!wantedTaskSet.has(access.taskCode)) {
        log(`   - ${def.code}: revoking LLM access for ${access.taskCode}`)
        if (!DRY_RUN) {
          await prisma.planLLMAccess.delete({ where: { id: access.id } })
        }
      }
    }

    if (!defaultClassId && !DRY_RUN) {
      throw new Error(`Missing model class ${def.modelClasses.default} for plan ${def.code}`)
    }

    for (const taskCode of wantedTasks) {
      if (DRY_RUN) continue

      await prisma.planLLMAccess.upsert({
        where: { planId_taskCode: { planId: plan.id, taskCode } },
        update: {
          allowedClasses: JSON.stringify(def.modelClasses.allowed),
          defaultClassId,
        },
        create: {
          planId: plan.id,
          taskCode,
          allowedClasses: JSON.stringify(def.modelClasses.allowed),
          defaultClassId,
        },
      })
    }

    // ---- Pricing ---------------------------------------------------------
    // priceUSD/priceINR are non-nullable Ints, so a custom-priced plan is stored as 0.
    // The catalog's `isCustomPriced` flag is what makes the pricing page say
    // "Contact sales" rather than "$0".
    const pricing = PLAN_PRICING_CATALOG[def.code]
    for (const cycle of ['MONTHLY', 'YEARLY'] as const) {
      const price = cycle === 'MONTHLY' ? pricing.monthly : pricing.yearly

      if (DRY_RUN) {
        log(
          `   - ${def.code}: ${cycle} = ${
            def.isCustomPriced ? 'custom (contact sales)' : `$${(price.priceUSD ?? 0) / 100} / ₹${(price.priceINR ?? 0) / 100}`
          }`
        )
        continue
      }

      await prisma.planPricing.upsert({
        where: { planId_billingCycle: { planId: plan.id, billingCycle: cycle } },
        update: {
          planCode: PLAN_CODE_TO_PUBLIC[def.code],
          priceUSD: price.priceUSD ?? 0,
          priceINR: price.priceINR ?? 0,
          yearlyDiscountMonths: pricing.yearlyDiscountMonths,
          isActive: !def.isCustomPriced,
        },
        create: {
          planId: plan.id,
          planCode: PLAN_CODE_TO_PUBLIC[def.code],
          priceUSD: price.priceUSD ?? 0,
          priceINR: price.priceINR ?? 0,
          billingCycle: cycle,
          yearlyDiscountMonths: pricing.yearlyDiscountMonths,
          isActive: !def.isCustomPriced,
        },
      })
    }

    // ---- Policy limits (seats, jurisdictions) ----------------------------
    // PolicyRule's unique index includes the nullable taskCode, and Postgres does not
    // dedupe NULLs, so upsert-by-compound-key is unreliable here. Find then write.
    const policyValues: Array<{ key: string; value: number }> = [
      { key: POLICY_KEYS.MAX_SEATS, value: def.seats },
      { key: POLICY_KEYS.MAX_JURISDICTIONS, value: def.maxJurisdictionsPerPatent },
    ]

    for (const { key, value } of policyValues) {
      if (DRY_RUN) {
        log(`   - ${def.code}: policy ${key} = ${value}`)
        continue
      }

      const existingRule = await prisma.policyRule.findFirst({
        where: { scope: 'plan', scopeId: plan.id, taskCode: null, key },
      })

      if (existingRule) {
        await prisma.policyRule.update({ where: { id: existingRule.id }, data: { value } })
      } else {
        await prisma.policyRule.create({
          data: { scope: 'plan', scopeId: plan.id, taskCode: null, key, value },
        })
      }
    }

    console.log(
      `   ✓ ${def.code} (${def.name}): ${wantedFeatureCodes.length} features, ${wantedTasks.length} tasks, ` +
        `models ${def.modelClasses.allowed.join('/')}`
    )
  }
}

async function reportOrphanedPlans() {
  const known = PLAN_CATALOG.map((p) => p.code)
  const others = await prisma.plan.findMany({
    where: { code: { notIn: known }, status: 'ACTIVE' },
    select: { code: true, name: true, _count: { select: { tenantPlans: true } } },
  })

  if (others.length === 0) return

  console.log('\n5. Plans outside the catalog (left untouched)')
  for (const p of others) {
    console.log(`   • ${p.code} "${p.name}" - ${p._count.tenantPlans} tenant assignment(s)`)
  }
  console.log('   These are custom/legacy plans. Manage them from /super-admin/plans.')
}

async function main() {
  console.log(DRY_RUN ? '🔍 Plan catalog DRY RUN - no writes' : '🌱 Seeding plan catalog')

  const featureIds = await seedFeatures()
  await seedTasks(featureIds)
  const modelClassIds = await seedModelClasses()
  await seedPlans(featureIds, modelClassIds)
  await reportOrphanedPlans()

  console.log(
    DRY_RUN
      ? `\n🔍 Dry run complete - ${changes.length} change(s) would be applied.`
      : '\n✅ Plan catalog applied.'
  )
}

main()
  .catch((error) => {
    console.error('\n❌ Plan seeding failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
