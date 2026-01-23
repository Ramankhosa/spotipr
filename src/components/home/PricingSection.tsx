'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { Check, Star, ArrowRight } from 'lucide-react'

const plans = [
  {
    name: 'Basic',
    description: 'For inventors filing a single patent',
    price: '$59',
    period: '/ month',
    cta: 'Start Basic',
    href: '/register',
    highlight: false,
    features: [
      { value: '1', label: 'Patent Draft / month' },
      { label: 'Single-jurisdiction filing pack (1 country)' },
      { value: '3', label: 'Novelty Searches' },
      { value: '1', label: 'Ideation Refinement Run' },
      { value: '5', label: 'Diagrams & Sketches' },
      { label: 'Export-ready (Doc + Figures)' },
    ],
  },
  {
    name: 'Pro',
    description: 'For startups and frequent patent drafting',
    price: '$199',
    period: '/ month',
    cta: 'Start Pro',
    href: '/register',
    highlight: true,
    badge: 'Most Popular',
    features: [
      { value: '4', label: 'Patent Drafts / month' },
      { label: 'Multi-jurisdiction filing (up to 2 countries per patent)' },
      { value: '20', label: 'Novelty Searches' },
      { value: '10', label: 'Ideation Refinement Runs' },
      { value: '30', label: 'Diagrams & Sketches' },
      { label: 'Priority generation + faster turnaround' },
    ],
  },
  {
    name: 'Enterprise',
    description: 'For teams, law firms & university IP cells',
    price: '$599',
    period: '/ month',
    cta: 'Talk to Sales',
    href: '/contact',
    highlight: false,
    secondaryCta: 'Start Enterprise',
    secondaryHref: '/register',
    note: 'Need a tailored rollout or extra seats? Talk to sales.',
    features: [
      { value: '15', label: 'Patent Drafts / month' },
      { label: 'Full jurisdiction access (all supported countries)' },
      { label: 'Team workspace (up to 5 seats included)' },
      { label: 'Parallel multi-jurisdiction drafts enabled up to six countries' },
      { value: '100', label: 'Novelty Searches' },
      { value: '30', label: 'Ideation Refinement Runs' },
      { value: '150', label: 'Diagrams & Sketches' },
      { label: 'Admin controls + usage reporting' },
    ],
  },
]

export default function PricingSection() {
  return (
    <section className="relative py-32 bg-ai-graphite-950 border-t border-ai-graphite-900/70 overflow-hidden">
      <div className="absolute inset-0 bg-[url('/grid-pattern.svg')] opacity-[0.03]" />
      <div className="absolute -top-40 right-0 w-[420px] h-[420px] bg-ai-blue-900/20 blur-[140px]" />
      <div className="absolute bottom-0 left-0 w-[380px] h-[380px] bg-cyan-900/20 blur-[140px]" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          viewport={{ once: true }}
          className="text-center mb-20"
        >
          <h2 className="text-3xl md:text-5xl font-bold text-white mb-6 tracking-tight">
            Pricing that scales with invention speed
          </h2>
          <p className="text-lg md:text-xl text-ai-graphite-400 max-w-3xl mx-auto">
            Choose the output level that matches your roadmap. Every tier delivers high-volume drafting, searches, and
            visuals so you feel the value from day one.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {plans.map((plan, index) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: index * 0.15 }}
              viewport={{ once: true }}
              className="h-full"
            >
              <div
                className={`relative h-full rounded-2xl border p-8 backdrop-blur-sm ${
                  plan.highlight
                    ? 'bg-ai-graphite-900/70 border-ai-blue-500/50 shadow-[0_0_50px_rgba(14,165,233,0.2)]'
                    : 'bg-ai-graphite-900/40 border-ai-graphite-800/60'
                }`}
              >
                {plan.badge && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-ai-blue-500/20 border border-ai-blue-500/50 text-xs uppercase tracking-[0.2em] text-ai-blue-200 flex items-center gap-2">
                    <Star className="w-3.5 h-3.5 text-ai-blue-300" />
                    {plan.badge}
                  </div>
                )}

                <div className="flex items-start justify-between gap-6 mb-6">
                  <div>
                    <h3 className="text-2xl font-semibold text-white mb-2">{plan.name}</h3>
                    <p className="text-sm text-ai-graphite-400">{plan.description}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-4xl font-bold text-white">{plan.price}</div>
                    <div className="text-xs tracking-widest text-ai-graphite-500">{plan.period}</div>
                  </div>
                </div>

                <div className="space-y-3">
                  {plan.features.map((feature, featureIndex) => (
                    <div key={`${plan.name}-${featureIndex}`} className="flex items-start gap-3 text-ai-graphite-300">
                      <span className="mt-0.5 text-ai-blue-400">
                        <Check className="w-4 h-4" />
                      </span>
                      <div className="text-sm leading-relaxed">
                        {feature.value && (
                          <span className="font-semibold text-white">{feature.value} </span>
                        )}
                        {feature.label}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-8 space-y-3">
                  <Link href={plan.href} className="group block">
                    <span
                      className={`flex items-center justify-center gap-2 px-5 py-3 rounded-lg border text-sm font-medium transition-all duration-200 ${
                        plan.highlight
                          ? 'bg-ai-blue-500/20 border-ai-blue-400/60 text-white hover:bg-ai-blue-500/30'
                          : 'bg-ai-graphite-900/60 border-ai-graphite-800 text-ai-graphite-200 hover:text-white hover:border-ai-blue-500/40'
                      }`}
                    >
                      {plan.cta}
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </span>
                  </Link>
                  {plan.secondaryCta && plan.secondaryHref && (
                    <Link
                      href={plan.secondaryHref}
                      className="block text-center text-xs uppercase tracking-[0.2em] text-ai-graphite-500 hover:text-ai-blue-300 transition-colors"
                    >
                      {plan.secondaryCta}
                    </Link>
                  )}
                  {plan.note && (
                    <p className="text-xs text-ai-graphite-500 text-center">{plan.note}</p>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="mt-12 text-center">
          <p className="text-sm text-ai-graphite-400">
            Have something else in mind or need a customized plan?{' '}
            <Link href="/contact" className="text-ai-blue-300 hover:text-ai-blue-200 transition-colors">
              Talk to sales
            </Link>
            .
          </p>
        </div>
      </div>
    </section>
  )
}
