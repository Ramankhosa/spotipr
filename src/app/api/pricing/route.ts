/**
 * Pricing API
 * GET /api/pricing?country=IN
 *
 * Returns pricing for the publicly listed plans. Prices come from the database
 * (PlanPricing) so super-admin edits apply without a deploy; the plan catalog is the
 * fallback and the source of the feature bullets.
 *
 * Enterprise is sold one-to-one - it returns `isCustomPriced: true` and no amount.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getCurrencyForCountry, formatAmount, type Currency } from '@/lib/razorpay-service'
import { listPublicPlans, type ResolvedPlanPrice } from '@/lib/plan-pricing-service'
import { FEATURE_DEFINITIONS, PLAN_BY_CODE } from '@/lib/plans/catalog'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

/**
 * Build the feature bullets for a plan straight from the catalog, so the marketing page
 * can never drift from the quotas the database actually enforces.
 */
function getPlanFeatures(plan: ResolvedPlanPrice) {
  const def = PLAN_BY_CODE[plan.dbPlanCode]
  if (!def) return []

  const bullets: { value?: string; label: string }[] = []

  // Headline metered features, in the order buyers care about.
  const ordered: Array<[keyof typeof def.features, string]> = [
    ['PATENT_DRAFTING', 'Patent drafts / month'],
    ['NOVELTY_SEARCH', 'Novelty searches / month'],
    ['IDEATION', 'Ideation runs / month'],
    ['DIAGRAM_GENERATION', 'Diagrams & sketches / month'],
    ['PATENT_REVIEW', 'AI patent reviews / month'],
    ['OFFICE_ACTION_RESPONSE', 'Office Action responses / month'],
    ['IDEA_BANK', 'Idea Bank reservations / month'],
    ['PERSONA_SYNC', 'PersonaSync style trainings / month'],
  ]

  for (const [code, label] of ordered) {
    const grant = def.features[code]
    if (!grant) continue
    bullets.push({ value: String(grant.monthlyQuota), label })
  }

  bullets.push({
    label:
      def.maxJurisdictionsPerPatent === 1
        ? 'Single-jurisdiction filing pack'
        : `Multi-jurisdiction filing (up to ${def.maxJurisdictionsPerPatent} countries per patent)`,
  })

  bullets.push({
    value: String(def.seats),
    label: def.seats === 1 ? 'Seat included' : 'Seats included',
  })

  if (def.modelClasses.allowed.includes('ADVANCED')) {
    bullets.push({ label: 'Frontier AI models (Advanced tier)' })
  } else if (def.modelClasses.allowed.includes('PRO_M')) {
    bullets.push({ label: 'Professional AI models' })
  }

  return bullets
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const countryCode = searchParams.get('country') || undefined

    const currency: Currency = getCurrencyForCountry(countryCode)
    const currencySymbol = currency === 'INR' ? '₹' : '$'

    const [monthlyPlans, yearlyPlans] = await Promise.all([
      listPublicPlans('monthly'),
      listPublicPlans('yearly'),
    ])

    const yearlyByCode = new Map(yearlyPlans.map((p) => [p.dbPlanCode, p]))

    const plans = monthlyPlans.map((monthly) => {
      const yearly = yearlyByCode.get(monthly.dbPlanCode) ?? monthly
      const def = PLAN_BY_CODE[monthly.dbPlanCode]

      if (monthly.isCustomPriced) {
        return {
          code: monthly.planCode,
          name: monthly.name,
          tagline: monthly.tagline,
          currency,
          currencySymbol,
          isCustomPriced: true,
          pricing: null,
          features: getPlanFeatures(monthly),
        }
      }

      const monthlyAmount = currency === 'INR' ? monthly.priceINR : monthly.priceUSD
      const yearlyAmount = currency === 'INR' ? yearly.priceINR : yearly.priceUSD
      const yearlyMonthlyEquivalent = Math.round(yearlyAmount / 12)
      const yearlySavings = monthlyAmount * 12 - yearlyAmount

      return {
        code: monthly.planCode,
        name: monthly.name,
        tagline: monthly.tagline,
        currency,
        currencySymbol,
        isCustomPriced: false,
        pricing: {
          monthly: {
            amount: monthlyAmount,
            formatted: formatAmount(monthlyAmount, currency),
            perMonth: formatAmount(monthlyAmount, currency),
          },
          yearly: {
            amount: yearlyAmount,
            formatted: formatAmount(yearlyAmount, currency),
            perMonth: formatAmount(yearlyMonthlyEquivalent, currency),
            savings: formatAmount(yearlySavings, currency),
            savingsMonths: yearly.yearlyDiscountMonths,
          },
        },
        features: getPlanFeatures(monthly),
        trialDays: def?.trialDays,
      }
    })

    return NextResponse.json({
      currency,
      currencySymbol,
      countryDetected: countryCode || 'unknown',
      plans,
      // Surfaced so the pricing page can render the GST line for Indian buyers.
      taxNote: currency === 'INR' ? 'Prices exclusive of 18% GST' : null,
      featureCatalog: FEATURE_DEFINITIONS.map((f) => ({
        code: f.code,
        name: f.name,
        description: f.description,
      })),
    })
  } catch (error) {
    console.error('[Pricing API] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
