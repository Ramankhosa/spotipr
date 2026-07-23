/**
 * Super Admin - Plan Management API
 *
 * GET  /api/v1/admin/plans        Full plan catalog with live DB values
 * PUT  /api/v1/admin/plans        Apply edits (features, quotas, pricing, model tiers)
 * POST /api/v1/admin/plans        { action: 'reset', planCode } - restore catalog defaults
 *
 * Read is open to SUPER_ADMIN and SUPER_ADMIN_VIEWER; writes are SUPER_ADMIN only.
 *
 * Turning a feature off DELETES its PlanFeature row. That is deliberate: `checkServiceAccess`
 * denies any service whose feature has no PlanFeature row, so removal is what actually
 * revokes access. Setting quotas to 0 would also block, but leaves the feature listed as
 * "included" everywhere else in the product.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/middleware'
import type { FeatureCode, ModelClass, TaskCode } from '@prisma/client'
import {
  FEATURE_DEFINITIONS,
  MODEL_CLASS_ORDER,
  PLAN_BY_CODE,
  PLAN_CATALOG,
  PLAN_CODES,
  PLAN_CODE_TO_PUBLIC,
  PLAN_PRICING_CATALOG,
  POLICY_KEYS,
  TASK_LABELS,
  TASK_TO_FEATURE,
  ALL_TASK_CODES,
  tasksForPlan,
  type PlanCatalogCode,
} from '@/lib/plans/catalog'

export const dynamic = 'force-dynamic'

// ============================================================================
// Validation helpers
// ============================================================================

const FEATURE_CODE_SET = new Set<string>(FEATURE_DEFINITIONS.map((f) => f.code))
const MODEL_CLASS_SET = new Set<string>(MODEL_CLASS_ORDER)

/** Coerce to a non-negative integer, or null when the caller means "no limit". */
function toQuota(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.floor(n)
}

/** Coerce to a non-negative integer with a floor of 0 (prices, seats). */
function toAmount(value: unknown, fallback = 0): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.floor(n)
}

// ============================================================================
// GET
// ============================================================================

export async function GET(request: NextRequest) {
  const roleCheck = await requireRole(['SUPER_ADMIN', 'SUPER_ADMIN_VIEWER'])(request)
  if (roleCheck) return roleCheck

  try {
    const plans = await prisma.plan.findMany({
      where: { status: { not: 'DEPRECATED' } },
      include: {
        planFeatures: { include: { feature: true } },
        planLLMAccess: { include: { defaultClass: true } },
        planPricing: true,
        _count: { select: { tenantPlans: true } },
      },
    })

    // Active tenant + seat counts, so an admin can see the blast radius of an edit.
    const tenantPlans = await prisma.tenantPlan.findMany({
      where: { status: 'ACTIVE' },
      select: {
        plan: { select: { code: true } },
        tenant: { select: { _count: { select: { users: true } } } },
      },
    })

    const usage: Record<string, { tenantCount: number; userCount: number }> = {}
    for (const tp of tenantPlans) {
      const code = tp.plan.code
      usage[code] ??= { tenantCount: 0, userCount: 0 }
      usage[code].tenantCount += 1
      usage[code].userCount += tp.tenant._count.users
    }

    const policyRules = await prisma.policyRule.findMany({
      where: { scope: 'plan', key: { in: [POLICY_KEYS.MAX_SEATS, POLICY_KEYS.MAX_JURISDICTIONS] } },
    })

    const data = plans
      .map((plan) => {
        const def = PLAN_BY_CODE[plan.code as PlanCatalogCode]
        const isCatalogPlan = Boolean(def)

        const monthlyPrice = plan.planPricing.find((p) => p.billingCycle === 'MONTHLY')
        const yearlyPrice = plan.planPricing.find((p) => p.billingCycle === 'YEARLY')

        // Model classes are written uniformly across a plan's tasks by the seed, so the
        // first access row is representative. Per-task overrides made in /super-admin/
        // llm-config are surfaced separately as `perTaskOverrides`.
        const firstAccess = plan.planLLMAccess[0]
        let allowedClasses: ModelClass[] = def?.modelClasses.allowed ?? []
        if (firstAccess) {
          try {
            const parsed = JSON.parse(firstAccess.allowedClasses)
            if (Array.isArray(parsed)) {
              allowedClasses = parsed.filter((c: string) => MODEL_CLASS_SET.has(c)) as ModelClass[]
            }
          } catch {
            // Malformed JSON in the DB - fall back to the catalog rather than crashing.
          }
        }

        const distinctAccessShapes = new Set(plan.planLLMAccess.map((a) => a.allowedClasses))

        const seatsRule = policyRules.find(
          (r) => r.scopeId === plan.id && r.key === POLICY_KEYS.MAX_SEATS
        )
        const jurisdictionRule = policyRules.find(
          (r) => r.scopeId === plan.id && r.key === POLICY_KEYS.MAX_JURISDICTIONS
        )

        return {
          id: plan.id,
          code: plan.code,
          publicCode: PLAN_CODE_TO_PUBLIC[plan.code as PlanCatalogCode] ?? plan.code,
          name: plan.name,
          cycle: plan.cycle,
          status: plan.status,
          tier: def?.tier ?? 99,
          tagline: def?.tagline ?? '',
          isCatalogPlan,
          isCustomPriced: def?.isCustomPriced ?? false,
          trialDays: def?.trialDays ?? null,
          tenantCount: usage[plan.code]?.tenantCount ?? 0,
          userCount: usage[plan.code]?.userCount ?? 0,
          totalAssignments: plan._count.tenantPlans,

          features: FEATURE_DEFINITIONS.map((fd) => {
            const grant = plan.planFeatures.find((pf) => pf.feature.code === fd.code)
            return {
              featureCode: fd.code,
              name: fd.name,
              unit: fd.unit,
              description: fd.description,
              enabled: Boolean(grant),
              monthlyQuota: grant?.monthlyQuota ?? null,
              dailyQuota: grant?.dailyQuota ?? null,
              monthlyTokenLimit: grant?.monthlyTokenLimit ?? null,
              dailyTokenLimit: grant?.dailyTokenLimit ?? null,
              catalogDefault: def?.features[fd.code] ?? null,
            }
          }),

          pricing: {
            monthly: {
              priceUSD: monthlyPrice?.priceUSD ?? 0,
              priceINR: monthlyPrice?.priceINR ?? 0,
            },
            yearly: {
              priceUSD: yearlyPrice?.priceUSD ?? 0,
              priceINR: yearlyPrice?.priceINR ?? 0,
            },
            yearlyDiscountMonths:
              monthlyPrice?.yearlyDiscountMonths ??
              PLAN_PRICING_CATALOG[plan.code as PlanCatalogCode]?.yearlyDiscountMonths ??
              2,
            isActive: monthlyPrice?.isActive ?? true,
          },

          modelClasses: {
            allowed: allowedClasses,
            default: firstAccess?.defaultClass?.code ?? def?.modelClasses.default ?? 'BASE_M',
            taskCount: plan.planLLMAccess.length,
            perTaskOverrides: distinctAccessShapes.size > 1,
          },

          policy: {
            maxSeats: seatsRule?.value ?? def?.seats ?? 1,
            maxJurisdictionsPerPatent: jurisdictionRule?.value ?? def?.maxJurisdictionsPerPatent ?? 1,
          },
        }
      })
      .sort((a, b) => a.tier - b.tier || a.code.localeCompare(b.code))

    return NextResponse.json({
      plans: data,
      catalog: {
        features: FEATURE_DEFINITIONS,
        modelClasses: MODEL_CLASS_ORDER,
        planCodes: PLAN_CODES,
        taskLabels: TASK_LABELS,
      },
    })
  } catch (error) {
    console.error('[admin/plans] GET error:', error)
    return NextResponse.json({ error: 'Failed to load plans' }, { status: 500 })
  }
}

// ============================================================================
// PUT - apply edits
// ============================================================================

interface FeatureUpdate {
  featureCode: FeatureCode
  enabled: boolean
  monthlyQuota?: unknown
  dailyQuota?: unknown
  monthlyTokenLimit?: unknown
  dailyTokenLimit?: unknown
}

interface PlanUpdate {
  code: string
  name?: string
  status?: 'ACTIVE' | 'INACTIVE' | 'DEPRECATED'
  features?: FeatureUpdate[]
  pricing?: {
    monthly?: { priceUSD?: unknown; priceINR?: unknown }
    yearly?: { priceUSD?: unknown; priceINR?: unknown }
    yearlyDiscountMonths?: unknown
    isActive?: boolean
  }
  modelClasses?: { allowed?: string[]; default?: string }
  policy?: { maxSeats?: unknown; maxJurisdictionsPerPatent?: unknown }
}

export async function PUT(request: NextRequest) {
  const roleCheck = await requireRole(['SUPER_ADMIN'])(request)
  if (roleCheck) return roleCheck

  try {
    const body = await request.json().catch(() => null)
    if (!body || !Array.isArray(body.plans)) {
      return NextResponse.json(
        { error: 'Invalid payload: expected { plans: [...] }' },
        { status: 400 }
      )
    }

    const applied: string[] = []
    const warnings: string[] = []

    for (const update of body.plans as PlanUpdate[]) {
      const plan = await prisma.plan.findUnique({ where: { code: update.code } })
      if (!plan) {
        warnings.push(`Plan ${update.code} not found - skipped`)
        continue
      }

      // ---- Plan-level fields --------------------------------------------
      if (update.name || update.status) {
        await prisma.plan.update({
          where: { id: plan.id },
          data: {
            ...(update.name ? { name: update.name.slice(0, 120) } : {}),
            ...(update.status ? { status: update.status } : {}),
          },
        })
      }

      // ---- Features ------------------------------------------------------
      if (Array.isArray(update.features)) {
        for (const fu of update.features) {
          if (!FEATURE_CODE_SET.has(fu.featureCode)) {
            warnings.push(`Unknown feature ${fu.featureCode} on ${update.code} - skipped`)
            continue
          }

          const definition = FEATURE_DEFINITIONS.find((f) => f.code === fu.featureCode)!
          const feature = await prisma.feature.upsert({
            where: { code: fu.featureCode },
            update: {},
            create: {
              code: fu.featureCode,
              name: definition.name,
              unit: definition.unit,
            },
          })

          const existing = await prisma.planFeature.findUnique({
            where: { planId_featureId: { planId: plan.id, featureId: feature.id } },
          })

          if (!fu.enabled) {
            if (existing) {
              await prisma.planFeature.delete({ where: { id: existing.id } })
            }
            continue
          }

          const monthlyQuota = toQuota(fu.monthlyQuota)
          const dailyQuota = toQuota(fu.dailyQuota)
          const monthlyTokenLimit = toQuota(fu.monthlyTokenLimit)
          const dailyTokenLimit = toQuota(fu.dailyTokenLimit)

          // A grant with every limit null is denied at runtime by checkServiceQuota's
          // `hasAnyLimit` guard, which would silently contradict "enabled" in this UI.
          if (
            monthlyQuota === null &&
            dailyQuota === null &&
            monthlyTokenLimit === null &&
            dailyTokenLimit === null
          ) {
            warnings.push(
              `${update.code}/${fu.featureCode}: enabled with no limits set - this is denied at runtime. Set at least one quota.`
            )
          }

          const data = { monthlyQuota, dailyQuota, monthlyTokenLimit, dailyTokenLimit }

          await prisma.planFeature.upsert({
            where: { planId_featureId: { planId: plan.id, featureId: feature.id } },
            update: data,
            create: { planId: plan.id, featureId: feature.id, ...data },
          })
        }
      }

      // ---- Pricing -------------------------------------------------------
      if (update.pricing) {
        const publicCode = PLAN_CODE_TO_PUBLIC[plan.code as PlanCatalogCode] ?? plan.code
        const discountMonths = toAmount(update.pricing.yearlyDiscountMonths, 2)

        for (const cycle of ['MONTHLY', 'YEARLY'] as const) {
          const input = cycle === 'MONTHLY' ? update.pricing.monthly : update.pricing.yearly
          if (!input) continue

          const existing = plan
            ? await prisma.planPricing.findUnique({
                where: { planId_billingCycle: { planId: plan.id, billingCycle: cycle } },
              })
            : null

          const priceUSD = toAmount(input.priceUSD, existing?.priceUSD ?? 0)
          const priceINR = toAmount(input.priceINR, existing?.priceINR ?? 0)

          await prisma.planPricing.upsert({
            where: { planId_billingCycle: { planId: plan.id, billingCycle: cycle } },
            update: {
              planCode: publicCode,
              priceUSD,
              priceINR,
              yearlyDiscountMonths: discountMonths,
              ...(update.pricing.isActive !== undefined ? { isActive: update.pricing.isActive } : {}),
            },
            create: {
              planId: plan.id,
              planCode: publicCode,
              priceUSD,
              priceINR,
              billingCycle: cycle,
              yearlyDiscountMonths: discountMonths,
              isActive: update.pricing.isActive ?? true,
            },
          })
        }
      }

      // ---- Model classes -------------------------------------------------
      if (update.modelClasses?.allowed || update.modelClasses?.default) {
        const allowed = (update.modelClasses.allowed ?? []).filter((c) => MODEL_CLASS_SET.has(c))
        const defaultClassCode = update.modelClasses.default

        if (allowed.length === 0) {
          warnings.push(`${update.code}: no valid model classes supplied - model tiers unchanged`)
        } else if (defaultClassCode && !allowed.includes(defaultClassCode)) {
          warnings.push(
            `${update.code}: default model class ${defaultClassCode} is not in the allowed list - model tiers unchanged`
          )
        } else {
          const resolvedDefault = defaultClassCode ?? allowed[allowed.length - 1]
          const modelClass = await prisma.lLMModelClass.findUnique({
            where: { code: resolvedDefault as ModelClass },
          })

          if (!modelClass) {
            warnings.push(`${update.code}: model class ${resolvedDefault} not found in DB`)
          } else {
            // Only grant tasks whose feature is actually enabled on this plan, so an
            // Office Action task rule cannot outlive the feature being switched off.
            const enabledFeatures = new Set(
              (
                await prisma.planFeature.findMany({
                  where: { planId: plan.id },
                  include: { feature: true },
                })
              ).map((pf) => pf.feature.code as FeatureCode)
            )

            const wantedTasks = ALL_TASK_CODES.filter((t) => enabledFeatures.has(TASK_TO_FEATURE[t]))
            const wantedSet = new Set<TaskCode>(wantedTasks)

            const current = await prisma.planLLMAccess.findMany({ where: { planId: plan.id } })
            for (const access of current) {
              if (!wantedSet.has(access.taskCode)) {
                await prisma.planLLMAccess.delete({ where: { id: access.id } })
              }
            }

            for (const taskCode of wantedTasks) {
              await prisma.planLLMAccess.upsert({
                where: { planId_taskCode: { planId: plan.id, taskCode } },
                update: {
                  allowedClasses: JSON.stringify(allowed),
                  defaultClassId: modelClass.id,
                },
                create: {
                  planId: plan.id,
                  taskCode,
                  allowedClasses: JSON.stringify(allowed),
                  defaultClassId: modelClass.id,
                },
              })
            }
          }
        }
      }

      // ---- Policy limits -------------------------------------------------
      if (update.policy) {
        const entries: Array<[string, number | undefined]> = [
          [POLICY_KEYS.MAX_SEATS, update.policy.maxSeats !== undefined ? toAmount(update.policy.maxSeats, 1) : undefined],
          [
            POLICY_KEYS.MAX_JURISDICTIONS,
            update.policy.maxJurisdictionsPerPatent !== undefined
              ? toAmount(update.policy.maxJurisdictionsPerPatent, 1)
              : undefined,
          ],
        ]

        for (const [key, value] of entries) {
          if (value === undefined) continue

          const existing = await prisma.policyRule.findFirst({
            where: { scope: 'plan', scopeId: plan.id, taskCode: null, key },
          })

          if (existing) {
            await prisma.policyRule.update({ where: { id: existing.id }, data: { value } })
          } else {
            await prisma.policyRule.create({
              data: { scope: 'plan', scopeId: plan.id, taskCode: null, key, value },
            })
          }
        }
      }

      applied.push(update.code)
    }

    return NextResponse.json({ success: true, applied, warnings })
  } catch (error) {
    console.error('[admin/plans] PUT error:', error)
    return NextResponse.json({ error: 'Failed to update plans' }, { status: 500 })
  }
}

// ============================================================================
// POST - reset a plan to its catalog defaults
// ============================================================================

export async function POST(request: NextRequest) {
  const roleCheck = await requireRole(['SUPER_ADMIN'])(request)
  if (roleCheck) return roleCheck

  try {
    const body = await request.json().catch(() => null)
    if (!body || body.action !== 'reset' || typeof body.planCode !== 'string') {
      return NextResponse.json(
        { error: "Invalid payload: expected { action: 'reset', planCode }" },
        { status: 400 }
      )
    }

    const def = PLAN_CATALOG.find((p) => p.code === body.planCode)
    if (!def) {
      return NextResponse.json(
        { error: `${body.planCode} is not a catalog plan and has no defaults to restore` },
        { status: 400 }
      )
    }

    const plan = await prisma.plan.findUnique({ where: { code: def.code } })
    if (!plan) {
      return NextResponse.json(
        { error: `Plan ${def.code} does not exist yet. Run "npm run seed:plans" first.` },
        { status: 404 }
      )
    }

    // Feature grants: replace wholesale.
    const wanted = Object.keys(def.features) as FeatureCode[]
    const featureRows = await prisma.feature.findMany({ where: { code: { in: wanted } } })
    const featureIdByCode = Object.fromEntries(featureRows.map((f) => [f.code, f.id]))
    const wantedIds = new Set(Object.values(featureIdByCode))

    const currentGrants = await prisma.planFeature.findMany({ where: { planId: plan.id } })
    for (const grant of currentGrants) {
      if (!wantedIds.has(grant.featureId)) {
        await prisma.planFeature.delete({ where: { id: grant.id } })
      }
    }

    for (const code of wanted) {
      const featureId = featureIdByCode[code]
      if (!featureId) continue
      const grant = def.features[code]!
      const data = {
        monthlyQuota: grant.monthlyQuota,
        dailyQuota: grant.dailyQuota,
        monthlyTokenLimit: grant.monthlyTokenLimit ?? null,
        dailyTokenLimit: grant.dailyTokenLimit ?? null,
      }
      await prisma.planFeature.upsert({
        where: { planId_featureId: { planId: plan.id, featureId } },
        update: data,
        create: { planId: plan.id, featureId, ...data },
      })
    }

    // Model classes.
    const defaultClass = await prisma.lLMModelClass.findUnique({
      where: { code: def.modelClasses.default },
    })
    if (defaultClass) {
      const wantedTasks = tasksForPlan(def)
      const wantedTaskSet = new Set<TaskCode>(wantedTasks)
      const current = await prisma.planLLMAccess.findMany({ where: { planId: plan.id } })
      for (const access of current) {
        if (!wantedTaskSet.has(access.taskCode)) {
          await prisma.planLLMAccess.delete({ where: { id: access.id } })
        }
      }
      for (const taskCode of wantedTasks) {
        await prisma.planLLMAccess.upsert({
          where: { planId_taskCode: { planId: plan.id, taskCode } },
          update: {
            allowedClasses: JSON.stringify(def.modelClasses.allowed),
            defaultClassId: defaultClass.id,
          },
          create: {
            planId: plan.id,
            taskCode,
            allowedClasses: JSON.stringify(def.modelClasses.allowed),
            defaultClassId: defaultClass.id,
          },
        })
      }
    }

    // Pricing.
    const pricing = PLAN_PRICING_CATALOG[def.code]
    const publicCode = PLAN_CODE_TO_PUBLIC[def.code]
    for (const cycle of ['MONTHLY', 'YEARLY'] as const) {
      const price = cycle === 'MONTHLY' ? pricing.monthly : pricing.yearly
      await prisma.planPricing.upsert({
        where: { planId_billingCycle: { planId: plan.id, billingCycle: cycle } },
        update: {
          planCode: publicCode,
          priceUSD: price.priceUSD ?? 0,
          priceINR: price.priceINR ?? 0,
          yearlyDiscountMonths: pricing.yearlyDiscountMonths,
          isActive: !def.isCustomPriced,
        },
        create: {
          planId: plan.id,
          planCode: publicCode,
          priceUSD: price.priceUSD ?? 0,
          priceINR: price.priceINR ?? 0,
          billingCycle: cycle,
          yearlyDiscountMonths: pricing.yearlyDiscountMonths,
          isActive: !def.isCustomPriced,
        },
      })
    }

    // Policy limits.
    for (const [key, value] of [
      [POLICY_KEYS.MAX_SEATS, def.seats],
      [POLICY_KEYS.MAX_JURISDICTIONS, def.maxJurisdictionsPerPatent],
    ] as Array<[string, number]>) {
      const existing = await prisma.policyRule.findFirst({
        where: { scope: 'plan', scopeId: plan.id, taskCode: null, key },
      })
      if (existing) {
        await prisma.policyRule.update({ where: { id: existing.id }, data: { value } })
      } else {
        await prisma.policyRule.create({
          data: { scope: 'plan', scopeId: plan.id, taskCode: null, key, value },
        })
      }
    }

    await prisma.plan.update({
      where: { id: plan.id },
      data: { name: def.name, cycle: def.cycle, status: 'ACTIVE' },
    })

    return NextResponse.json({ success: true, reset: def.code })
  } catch (error) {
    console.error('[admin/plans] POST error:', error)
    return NextResponse.json({ error: 'Failed to reset plan' }, { status: 500 })
  }
}
