/**
 * Pricing API
 * GET /api/pricing
 * 
 * Returns pricing information for all plans
 * Optionally accepts countryCode to return prices in the appropriate currency
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  PLAN_PRICING,
  getCurrencyForCountry,
  formatAmount,
  getPlanPrice,
  type PlanCode,
  type Currency,
} from '@/lib/razorpay-service'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // Get country code from query params
    const { searchParams } = new URL(request.url)
    const countryCode = searchParams.get('country') || undefined
    
    // Determine currency based on country
    const currency: Currency = getCurrencyForCountry(countryCode)
    const currencySymbol = currency === 'INR' ? '₹' : '$'

    // Build pricing response for all plans
    const plans = (['BASIC', 'PRO', 'ENTERPRISE'] as PlanCode[]).map(planCode => {
      const plan = PLAN_PRICING[planCode]
      const monthlyPrice = getPlanPrice(planCode, 'monthly', currency)
      const yearlyPrice = getPlanPrice(planCode, 'yearly', currency)
      const yearlyMonthlyEquivalent = Math.round(yearlyPrice / 12)
      const yearlySavings = (monthlyPrice * 12) - yearlyPrice

      return {
        code: planCode,
        name: plan.name,
        currency,
        currencySymbol,
        pricing: {
          monthly: {
            amount: monthlyPrice,
            formatted: formatAmount(monthlyPrice, currency),
            perMonth: formatAmount(monthlyPrice, currency),
          },
          yearly: {
            amount: yearlyPrice,
            formatted: formatAmount(yearlyPrice, currency),
            perMonth: formatAmount(yearlyMonthlyEquivalent, currency),
            savings: formatAmount(yearlySavings, currency),
            savingsMonths: plan.yearlyDiscountMonths,
          },
        },
        features: getPlanFeatures(planCode),
      }
    })

    return NextResponse.json({
      currency,
      currencySymbol,
      countryDetected: countryCode || 'unknown',
      plans,
    })
  } catch (error) {
    console.error('[Pricing API] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Get features for each plan
 */
function getPlanFeatures(planCode: PlanCode) {
  switch (planCode) {
    case 'BASIC':
      return [
        { value: '1', label: 'Patent Draft / month' },
        { label: 'Single-jurisdiction filing pack (1 country)' },
        { value: '3', label: 'Novelty Searches' },
        { value: '1', label: 'Ideation Refinement Run' },
        { value: '5', label: 'Diagrams & Sketches' },
        { label: 'Export-ready (Doc + Figures)' },
      ]
    case 'PRO':
      return [
        { value: '4', label: 'Patent Drafts / month' },
        { label: 'Multi-jurisdiction filing (up to 2 countries per patent)' },
        { value: '20', label: 'Novelty Searches' },
        { value: '10', label: 'Ideation Refinement Runs' },
        { value: '30', label: 'Diagrams & Sketches' },
        { label: 'Priority generation + faster turnaround' },
      ]
    case 'ENTERPRISE':
      return [
        { value: '15', label: 'Patent Drafts / month' },
        { label: 'Full jurisdiction access (all supported countries)' },
        { label: 'Team workspace (up to 5 seats included)' },
        { label: 'Parallel multi-jurisdiction drafts enabled up to six countries' },
        { value: '100', label: 'Novelty Searches' },
        { value: '30', label: 'Ideation Refinement Runs' },
        { value: '150', label: 'Diagrams & Sketches' },
        { label: 'Admin controls + usage reporting' },
      ]
    default:
      return []
  }
}

