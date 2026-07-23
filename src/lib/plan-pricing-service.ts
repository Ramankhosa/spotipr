/**
 * Plan Pricing Service
 *
 * Resolves the price of a plan from the database (`PlanPricing`), so that a super admin
 * editing a price in /super-admin/plans takes effect immediately, without a deploy.
 *
 * Falls back to `PLAN_PRICING_CATALOG` when a row is missing, which keeps checkout
 * working on a database that has not been seeded yet.
 *
 * Enterprise is sold one-to-one: it publishes no price and must not be purchasable
 * through self-serve checkout. `isCustomPriced` is the single flag callers check.
 */

import { prisma } from './prisma'
import {
  PLAN_PRICING_CATALOG,
  PLAN_BY_CODE,
  PUBLIC_TO_PLAN_CODE,
  type PlanCatalogCode,
} from './plans/catalog'

export type BillingCycle = 'monthly' | 'yearly'
export type Currency = 'USD' | 'INR'

export interface ResolvedPlanPrice {
  /** Public SKU code (BASIC / PRO / ENTERPRISE / TRIAL). */
  planCode: string
  /** Internal DB plan code (FREE_PLAN / PRO_PLAN / ...). */
  dbPlanCode: PlanCatalogCode
  name: string
  tagline: string
  /** Price in minor units (cents / paise). Zero when custom-priced. */
  priceUSD: number
  priceINR: number
  yearlyDiscountMonths: number
  /** True when the plan is sold one-to-one - render "Contact sales", block checkout. */
  isCustomPriced: boolean
  /** Where the number came from, for debugging and admin display. */
  source: 'database' | 'catalog'
}

function fromCatalog(dbPlanCode: PlanCatalogCode, cycle: BillingCycle): ResolvedPlanPrice {
  const def = PLAN_BY_CODE[dbPlanCode]
  const pricing = PLAN_PRICING_CATALOG[dbPlanCode]
  const price = cycle === 'monthly' ? pricing.monthly : pricing.yearly

  return {
    planCode: def.code === 'FREE_PLAN' ? 'BASIC' : def.code.replace('_PLAN', ''),
    dbPlanCode,
    name: def.name,
    tagline: def.tagline,
    priceUSD: price.priceUSD ?? 0,
    priceINR: price.priceINR ?? 0,
    yearlyDiscountMonths: pricing.yearlyDiscountMonths,
    isCustomPriced: def.isCustomPriced,
    source: 'catalog',
  }
}

/**
 * Resolve one plan's price. Accepts either the public SKU code (BASIC/PRO/ENTERPRISE)
 * or the internal DB code (FREE_PLAN/PRO_PLAN/ENTERPRISE_PLAN).
 */
export async function resolvePlanPrice(
  planCode: string,
  cycle: BillingCycle
): Promise<ResolvedPlanPrice | null> {
  const dbPlanCode = (PUBLIC_TO_PLAN_CODE[planCode.toUpperCase()] ??
    (planCode as PlanCatalogCode)) as PlanCatalogCode

  const def = PLAN_BY_CODE[dbPlanCode]
  if (!def) return null

  try {
    const row = await prisma.planPricing.findFirst({
      where: {
        billingCycle: cycle === 'monthly' ? 'MONTHLY' : 'YEARLY',
        plan: { code: dbPlanCode },
      },
      include: { plan: true },
    })

    if (!row) return fromCatalog(dbPlanCode, cycle)

    return {
      planCode: row.planCode,
      dbPlanCode,
      name: row.plan.name,
      tagline: def.tagline,
      priceUSD: row.priceUSD,
      priceINR: row.priceINR,
      yearlyDiscountMonths: row.yearlyDiscountMonths,
      // A price row that is inactive, or priced at zero on a paid tier, means the plan
      // is negotiated rather than published.
      isCustomPriced: def.isCustomPriced || !row.isActive,
      source: 'database',
    }
  } catch (error) {
    console.error('[PlanPricingService] DB lookup failed, using catalog:', error)
    return fromCatalog(dbPlanCode, cycle)
  }
}

/** Resolve the amount to charge, in minor units. Throws for custom-priced plans. */
export async function getPlanAmount(
  planCode: string,
  cycle: BillingCycle,
  currency: Currency
): Promise<number> {
  const resolved = await resolvePlanPrice(planCode, cycle)
  if (!resolved) throw new Error(`Invalid plan code: ${planCode}`)

  if (resolved.isCustomPriced) {
    throw new Error(
      `${resolved.name} is sold one-to-one and cannot be purchased through self-serve checkout.`
    )
  }

  return currency === 'INR' ? resolved.priceINR : resolved.priceUSD
}

/** Resolve every publicly listed plan, ordered by tier. Excludes TRIAL. */
export async function listPublicPlans(cycle: BillingCycle): Promise<ResolvedPlanPrice[]> {
  const codes: PlanCatalogCode[] = ['FREE_PLAN', 'PRO_PLAN', 'ENTERPRISE_PLAN']
  const resolved = await Promise.all(codes.map((code) => resolvePlanPrice(code, cycle)))
  return resolved.filter((p): p is ResolvedPlanPrice => p !== null)
}
