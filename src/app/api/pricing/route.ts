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
import { listPublicPlans } from '@/lib/plan-pricing-service'
import { FEATURE_DEFINITIONS, PLAN_BY_CODE } from '@/lib/plans/catalog'
import { buildPlanFeatureBullets } from '@/lib/plans/plan-features'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

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
          features: buildPlanFeatureBullets(monthly.dbPlanCode),
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
        features: buildPlanFeatureBullets(monthly.dbPlanCode),
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
