'use client'

// The interactive half of the homepage pricing section: the monthly/yearly and
// USD/INR toggles, and the plan cards themselves.
//
// Both currencies and both cycles are resolved on the server and passed in, so
// switching either is instant and the section never renders a loading state or
// depends on IP geolocation the way /pricing does.
//
// There is deliberately no checkout button here. Until the payment gateway is
// connected (see lib/billing-mode), every plan's call to action sends the buyer
// to the admin office.

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Check, Globe } from 'lucide-react'
import { CONTACT_FOR_PAYMENT, SELF_SERVE_CHECKOUT_ENABLED } from '@/lib/billing-mode'
import type { PlanFeatureBullet } from '@/lib/plans/plan-features'

type Currency = 'USD' | 'INR'
type Cycle = 'monthly' | 'yearly'

/** Amounts are in minor units (cents / paise), matching the pricing service. */
export interface HomePlanPrice {
  usd: number
  inr: number
}

export interface HomePlan {
  code: string
  name: string
  tagline: string
  isCustomPriced: boolean
  monthly: HomePlanPrice | null
  yearly: HomePlanPrice | null
  discountMonths: number
  features: PlanFeatureBullet[]
}

function money(minorUnits: number, currency: Currency): string {
  return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(minorUnits / 100)
}

function amountFor(price: HomePlanPrice, currency: Currency): number {
  return currency === 'INR' ? price.inr : price.usd
}

export default function PricingPlans({ plans }: { plans: HomePlan[] }) {
  const [cycle, setCycle] = useState<Cycle>('monthly')
  const [currency, setCurrency] = useState<Currency>('USD')

  // Taken from the plans themselves so the badge can never promise a discount
  // different from the one the yearly prices actually carry.
  const discountMonths = plans.find((p) => p.discountMonths)?.discountMonths ?? 2

  return (
    <>
      <div className="mt-8 flex flex-wrap items-center gap-4">
        <div
          className="flex items-center gap-1 border border-vellum-400 bg-vellum-100 p-1"
          role="group"
          aria-label="Billing cycle"
        >
          {(['monthly', 'yearly'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setCycle(option)}
              aria-pressed={cycle === option}
              className={`rounded-md px-4 py-2 text-[13.5px] font-medium transition-colors duration-150 ${
                cycle === option
                  ? 'bg-lamp-600 text-white'
                  : 'text-vellum-700 hover:text-vellum-900'
              }`}
            >
              {option === 'monthly' ? 'Monthly' : 'Yearly'}
            </button>
          ))}
        </div>

        <span className="rounded-md bg-[#ecfdf5] px-2.5 py-1.5 text-[12px] font-medium text-[#047857]">
          {discountMonths} month{discountMonths === 1 ? '' : 's'} free on yearly
        </span>

        <button
          type="button"
          onClick={() => setCurrency((c) => (c === 'USD' ? 'INR' : 'USD'))}
          className="ml-auto flex items-center gap-2 border border-vellum-400 bg-vellum-100 px-3.5 py-2 text-[13.5px] text-vellum-700 transition-colors duration-150 hover:border-vellum-500 hover:text-vellum-900"
        >
          <Globe className="h-4 w-4 text-lamp-600" />
          Showing {currency}
          <span className="text-vellum-500">· switch to {currency === 'USD' ? 'INR' : 'USD'}</span>
        </button>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        {plans.map((plan) => {
          const featured = plan.code === 'PRO'
          const price = cycle === 'monthly' ? plan.monthly : plan.yearly
          const showPrice = !plan.isCustomPriced && price !== null

          const yearlyTotal = plan.yearly ? amountFor(plan.yearly, currency) : 0
          const perMonth = showPrice
            ? cycle === 'yearly'
              ? Math.round(yearlyTotal / 12)
              : amountFor(price, currency)
            : 0

          return (
            <div
              key={plan.code}
              className={`flex flex-col border bg-vellum-100 p-6 transition-all duration-200 ${
                featured
                  ? 'border-lamp-600'
                  : 'border-vellum-400 hover:border-vellum-500'
              }`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-[17px] font-medium tracking-[-0.012em] text-vellum-900">
                  {plan.name}
                </h3>
                {featured && (
                  <span className="rounded bg-lamp-50 px-2 py-1 text-[10.5px] font-medium uppercase tracking-[0.08em] text-lamp-700">
                    Most chosen
                  </span>
                )}
              </div>

              <p className="mt-1.5 min-h-[38px] text-[13px] leading-[1.5] text-vellum-600">
                {plan.tagline}
              </p>

              <div className="mt-5 border-t border-vellum-400 pt-5">
                {showPrice ? (
                  <>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[34px] font-semibold tracking-[-0.028em] text-vellum-900">
                        {money(perMonth, currency)}
                      </span>
                      <span className="text-[13.5px] text-vellum-600">/ month</span>
                    </div>
                    <p className="mt-1 text-[12.5px] text-vellum-600">
                      {cycle === 'yearly'
                        ? `Billed ${money(yearlyTotal, currency)} yearly`
                        : 'Billed monthly'}
                    </p>
                  </>
                ) : (
                  <>
                    <div className="text-[34px] font-semibold tracking-[-0.028em] text-vellum-900">
                      Custom
                    </div>
                    <p className="mt-1 text-[12.5px] text-vellum-600">
                      Priced per organisation — seats, quotas and jurisdictions set with you.
                    </p>
                  </>
                )}
              </div>

              <ul className="mt-5 flex-1 space-y-2.5">
                {plan.features.map((feature) => (
                  <li key={feature.label} className="flex items-start gap-2.5">
                    <Check className="mt-0.5 h-4 w-4 flex-none text-lamp-600" strokeWidth={2} />
                    <span className="text-[13px] leading-[1.5] text-vellum-700">
                      {feature.value && (
                        <span className="font-medium text-vellum-900">{feature.value} </span>
                      )}
                      {feature.label}
                    </span>
                  </li>
                ))}
              </ul>

              <Link
                href={SELF_SERVE_CHECKOUT_ENABLED ? '/pricing' : CONTACT_FOR_PAYMENT.href}
                className={`group mt-6 inline-flex items-center justify-center gap-2 rounded-lg px-5 py-3 text-[14.5px] font-medium transition-all duration-150 active:scale-[0.985] ${
                  featured
                    ? 'bg-lamp-600 text-white hover:bg-lamp-700'
                    : 'border border-vellum-900 bg-transparent text-vellum-900 hover:bg-vellum-900 hover:text-vellum-100'
                }`}
              >
                {SELF_SERVE_CHECKOUT_ENABLED ? `Start ${plan.name}` : CONTACT_FOR_PAYMENT.label}
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
            </div>
          )
        })}
      </div>

      <div className="mt-6 flex flex-col gap-2 text-[13px] text-vellum-600">
        {!SELF_SERVE_CHECKOUT_ENABLED && <p>{CONTACT_FOR_PAYMENT.note}</p>}
        {currency === 'INR' && <p>Prices exclusive of 18% GST.</p>}
        <p>
          Want to try it on a live matter first?{' '}
          <Link href="/free-trial" className="font-medium text-lamp-600 hover:text-lamp-700">
            Request a free trial
          </Link>{' '}
          — 14 days, one invention end to end, no card.
        </p>
      </div>
    </>
  )
}
