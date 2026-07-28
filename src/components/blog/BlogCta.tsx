// The conversion block at the foot of every article, plus the legal disclaimer
// that has to travel with patent guidance.
//
// One offer, matched to the article's own subject via `variant` — a reader who
// came for "how much does a patent cost" is not in the market for the same next
// step as one who came for claim drafting. No newsletter box: we don't have a
// list to send to, and a form that goes nowhere is worse than no form.

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

const OFFERS = {
  search: {
    kicker: 'Before you file',
    title: 'Search 30M+ patents before you spend a rupee on drafting',
    body: 'PatentNest runs a structured novelty search across global patent literature and tells you what the prior art actually looks like — with the citations, not just a score.',
    href: '/novelty-search',
    label: 'Run a novelty search',
  },
  draft: {
    kicker: 'From disclosure to filing',
    title: 'Draft the specification and claims in the same place you searched',
    body: 'Claims, description, abstract and figures generated from your disclosure, in your jurisdiction’s format — every paragraph traceable to what you told it.',
    href: '/patents/draft/new',
    label: 'Open the drafting studio',
  },
  office: {
    kicker: 'After the office writes back',
    title: 'Turn an office action into a response outline in minutes',
    body: 'The Office Action Studio reads the examiner’s rejections, maps each one to your claims and the cited art, and drafts arguments you can edit.',
    href: '/office-actions',
    label: 'See the Office Action Studio',
  },
  general: {
    kicker: 'The patent studio',
    title: 'One unbroken line from disclosure to grant',
    body: 'Prior-art search, drafting, figures and office-action response in a single workspace covering 12 patent offices — validated before you pay a single official fee.',
    href: '/pricing',
    label: 'See what it costs',
  },
} as const

export type CtaVariant = keyof typeof OFFERS

export default function BlogCta({ variant = 'general' }: { variant?: CtaVariant }) {
  const offer = OFFERS[variant] ?? OFFERS.general

  return (
    <section className="mt-16 overflow-hidden rounded-xl border border-ai-graphite-900/10 bg-ai-graphite-900 p-8 sm:p-10">
      <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-paper-400">
        {offer.kicker}
      </p>
      <h2 className="mt-4 max-w-2xl text-2xl font-semibold leading-tight tracking-tight text-white sm:text-3xl">
        {offer.title}
      </h2>
      <p className="mt-4 max-w-xl text-[0.9375rem] leading-relaxed text-paper-300">{offer.body}</p>
      <div className="mt-7 flex flex-wrap items-center gap-3">
        <Link
          href={offer.href}
          className="group inline-flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-medium text-ai-graphite-900 transition-all duration-150 hover:bg-paper-200 active:scale-[0.98]"
        >
          {offer.label}
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </Link>
        <Link
          href="/free-trial"
          className="inline-flex items-center rounded-lg border border-white/20 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:border-white/40"
        >
          Start a free trial
        </Link>
      </div>
    </section>
  )
}

export function LegalNote() {
  return (
    <p className="mt-10 border-t border-ai-graphite-900/10 pt-6 text-xs leading-relaxed text-ai-graphite-400">
      <strong className="font-medium text-ai-graphite-500">A note on this article.</strong> It is
      general information about patent practice, not legal advice, and it does not create an
      attorney–client relationship. Official fees, deadlines and examination practice change —
      verify anything you are about to rely on against the relevant patent office and take advice
      from a qualified practitioner in your jurisdiction before you file.
    </p>
  )
}
