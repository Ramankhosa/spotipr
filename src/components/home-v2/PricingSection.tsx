// Pricing on the homepage. Resolved on the server through the same service
// /pricing and /api/pricing use, so a super-admin price edit shows here too
// without a deploy, and a database outage falls back to the plan catalog rather
// than taking the marketing homepage down with it.
//
// TRIAL is excluded by listPublicPlans; the trial is offered in the footnote
// under the cards instead, where it belongs next to /free-trial.

import { listPublicPlans } from '@/lib/plan-pricing-service'
import { buildPlanFeatureBullets } from '@/lib/plans/plan-features'
import Reveal from './Reveal'
import PricingPlans, { type HomePlan } from './PricingPlans'

export default async function PricingSection() {
  const [monthlyPlans, yearlyPlans] = await Promise.all([
    listPublicPlans('monthly'),
    listPublicPlans('yearly'),
  ])

  const yearlyByCode = new Map(yearlyPlans.map((p) => [p.dbPlanCode, p]))

  const plans: HomePlan[] = monthlyPlans.map((monthly) => {
    const yearly = yearlyByCode.get(monthly.dbPlanCode) ?? monthly

    return {
      code: monthly.planCode,
      name: monthly.name,
      tagline: monthly.tagline,
      isCustomPriced: monthly.isCustomPriced,
      monthly: monthly.isCustomPriced
        ? null
        : { usd: monthly.priceUSD, inr: monthly.priceINR },
      yearly: monthly.isCustomPriced ? null : { usd: yearly.priceUSD, inr: yearly.priceINR },
      discountMonths: yearly.yearlyDiscountMonths,
      features: buildPlanFeatureBullets(monthly.dbPlanCode),
    }
  })

  return (
    <section id="pricing" className="mx-auto max-w-[1240px] px-5 pt-24 sm:px-8 lg:pt-28">
      <Reveal>
        <p className="mb-5 flex items-center gap-3 text-[11.5px] font-medium uppercase tracking-[0.16em] text-lamp-600">
          <span className="h-px w-7 bg-lamp-600/50" />
          Plans
        </p>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:items-end">
          <h2 className="text-[clamp(26px,3.1vw,38px)] font-semibold leading-[1.14] tracking-[-0.024em] text-ai-graphite-900">
            Priced for one invention,
            <br />
            or for a whole portfolio.
          </h2>
          <p className="max-w-[52ch] text-[15.5px] leading-[1.62] text-paper-600">
            Every plan includes the full workspace — search, ideation, drafting, figures and
            review. What changes is how much you run each month and how many people run it.
          </p>
        </div>
      </Reveal>

      <Reveal delay={0.1}>
        <PricingPlans plans={plans} />
      </Reveal>
    </section>
  )
}
