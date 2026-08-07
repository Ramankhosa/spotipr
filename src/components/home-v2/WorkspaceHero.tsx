'use client'

// Hero + stat strip for the homepage. Product-first: headline left, live-looking
// workspace right, two floating result cards, then the proof bar underneath.
//
// Signed out, the primary action is /free-trial — access here is REQUESTED and
// approved by a person, not self-serve, so the copy promises a review rather
// than instant access. Signed in, it jumps straight into a new draft.

import Link from 'next/link'
import { ArrowRight, Clock, CreditCard, Globe, Lock, MessagesSquare } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import Reveal from './Reveal'
import WorkspaceMockup from './WorkspaceMockup'

const TRUST = [
  { label: 'Reviewed within one business day', icon: Clock },
  { label: 'No credit card, no auto-renewal', icon: CreditCard },
  { label: 'Your work stays private', icon: Lock },
]

const STATS = [
  { value: '30M+', label: 'Patent documents' },
  { value: '~15 min', label: 'Novelty assessment' },
  { value: '12', label: 'Patent offices' },
  { value: 'One workspace', label: 'Search to prosecution' },
]

export default function WorkspaceHero() {
  const { user } = useAuth()

  return (
    <section className="relative overflow-hidden">
      {/* soft cobalt wash behind the product shot */}
      <div
        aria-hidden
        className="pointer-events-none absolute right-[-10%] top-[-14%] hidden h-[560px] w-[720px] rounded-full bg-lamp-100/40 blur-3xl lg:block"
      />

      <div className="relative mx-auto max-w-[1240px] px-5 pb-4 pt-14 sm:px-8 lg:pt-20">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)] lg:gap-10">
          {/* copy */}
          <Reveal>
            <p className="mb-5 flex items-center gap-3 text-[11.5px] font-medium uppercase tracking-[0.16em] text-lamp-600">
              <span className="h-px w-7 bg-lamp-600/50" />
              Patent intelligence workspace
            </p>

            <h1 className="text-[clamp(34px,4.6vw,58px)] font-semibold leading-[1.06] tracking-[-0.028em] text-ai-graphite-900">
              From invention
              <br />
              to <span className="text-lamp-600">defensible</span>
              <br />
              application.
            </h1>

            <p className="mt-6 max-w-[46ch] text-[16.5px] leading-[1.62] text-paper-600">
              Search prior art, engineer claims, draft complete specifications, generate
              patent drawings, and respond to office actions — all in one connected
              workspace.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href={user ? '/login' : '/free-trial'}
                className="group inline-flex items-center gap-2 rounded-lg bg-lamp-600 px-6 py-3.5 text-[15px] font-medium text-white transition-all duration-150 hover:bg-lamp-700 hover:shadow-[0_12px_28px_-12px_rgba(29,78,216,0.7)] active:scale-[0.985]"
              >
                {user ? 'Start with my invention' : 'Request a free trial'}
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/contact"
                className="inline-flex items-center gap-2 rounded-lg border border-paper-300 bg-white px-6 py-3.5 text-[15px] font-medium text-ai-graphite-800 transition-all duration-150 hover:border-paper-400 hover:bg-paper-50 active:scale-[0.985]"
              >
                <MessagesSquare className="h-4 w-4 text-lamp-600" />
                Talk to us
              </Link>
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2.5">
              {TRUST.map(({ label, icon: Icon }) => (
                <span key={label} className="flex items-center gap-1.5 text-[13px] text-paper-600">
                  <Icon className="h-3.5 w-3.5 text-lamp-600/80" />
                  {label}
                </span>
              ))}
            </div>
          </Reveal>

          {/* product shot */}
          <Reveal delay={0.12} className="relative">
            <div className="lg:[transform:perspective(1800px)_rotateY(-7deg)_rotateX(2.5deg)]">
              <WorkspaceMockup />
            </div>

            {/* floating result cards */}
            <div className="absolute -bottom-24 -left-6 hidden w-[190px] rounded-xl border border-paper-300 bg-white p-3.5 shadow-[0_20px_44px_-20px_rgba(16,24,40,0.3)] xl:block">
              <p className="text-[12px] font-medium text-ai-graphite-900">Prior art found</p>
              <p className="mt-0.5 text-[10.5px] text-paper-500">30,814 results</p>
              <div className="mt-2.5 space-y-1.5">
                {[
                  { label: 'High relevance', value: '2,145', dot: 'bg-wax-400' },
                  { label: 'Moderate', value: '5,263', dot: 'bg-[#f59e0b]' },
                  { label: 'Low', value: '23,406', dot: 'bg-[#10b981]' },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between text-[10px]">
                    <span className="flex items-center gap-1.5 text-paper-600">
                      <span className={`h-1.5 w-1.5 rounded-full ${row.dot}`} />
                      {row.label}
                    </span>
                    <span className="font-medium text-ai-graphite-800">{row.value}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2.5 text-[10.5px] font-medium text-lamp-600">View full report →</p>
            </div>

            <div className="absolute -bottom-20 right-0 hidden w-[186px] rounded-xl border border-paper-300 bg-white p-3.5 shadow-[0_20px_44px_-20px_rgba(16,24,40,0.3)] xl:block">
              <p className="text-[11px] text-paper-500">Time to novelty report</p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-[22px] font-semibold tracking-tight text-ai-graphite-900">~15 min</span>
                <span className="rounded bg-[#ecfdf5] px-1.5 py-0.5 text-[9.5px] font-medium text-[#047857]">
                  82% faster
                </span>
              </div>
              <p className="mt-1 text-[10.5px] text-paper-500">Compared to manual review</p>
            </div>
          </Reveal>
        </div>

        {/* proof bar */}
        <Reveal delay={0.2}>
          <div className="mt-24 grid grid-cols-2 gap-y-6 rounded-xl border border-paper-300 bg-white px-6 py-6 shadow-[0_2px_10px_rgba(16,24,40,0.04)] sm:grid-cols-3 lg:mt-28 lg:grid-cols-5 lg:divide-x lg:divide-paper-300 xl:mt-36">
            {STATS.map((s) => (
              <div key={s.label} className="px-2 text-center lg:px-4">
                <p className="text-[21px] font-semibold tracking-[-0.02em] text-lamp-600">{s.value}</p>
                <p className="mt-1 text-[12.5px] text-paper-600">{s.label}</p>
              </div>
            ))}
            <div className="col-span-2 flex items-center justify-center gap-2.5 px-2 sm:col-span-1 lg:px-4">
              <Globe className="h-5 w-5 flex-none text-paper-500" />
              <div className="text-left">
                <p className="text-[13.5px] font-medium text-ai-graphite-900">Global coverage</p>
                <p className="text-[12px] text-paper-600">100+ jurisdictions</p>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
