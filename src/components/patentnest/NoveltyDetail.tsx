'use client'

// Bespoke detail page for the novelty-assessment embodiment — the flagship
// treatment. Extends the shared document template with a staged walkthrough
// (each stage gets its own figure or product mock), an evidence-grounding
// section, a deeper feature-mapping section, and a "Comparative example"
// (the patent-document term for contrast against prior approaches).
// All claims here mirror the real pipeline in novelty-search-service.ts.

import Link from 'next/link'
import { motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import type { Feature } from '@/lib/patentnest/features'
import { Reveal, staggerContainer, staggerItem } from './Reveal'
import SectionLabel from './SectionLabel'
import FeatureFigure from './FeatureFigure'
import { TwoLaneFig, GateFig, EvidenceFig } from './novelty-figures'
import { BRASS, LAMP } from '@/lib/patentnest/palette'

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number]
const pad = (n: number) => String(n).padStart(2, '0')

/* ------------------------------------------------------- product mocks --- */

function QueryPlanMock() {
  return (
    <div className="rounded-xl border border-ai-graphite-900/10 bg-white p-5 text-left shadow-[0_20px_45px_-30px_rgba(15,23,42,0.3)]">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-ai-graphite-400">
          Search plan — awaiting your approval
        </p>
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: BRASS }} />
      </div>
      <div className="mt-3 space-y-1.5">
        {[
          { t: 'per-zone soil-moisture sensing', k: 'core' },
          { t: 'forecast-driven rescheduling', k: 'novelty' },
          { t: 'independent valve actuation', k: 'impl' },
        ].map((ft) => (
          <div key={ft.t} className="flex items-center justify-between rounded-md bg-paper-100 px-2.5 py-1.5">
            <span className="text-[11px] text-ai-graphite-800">{ft.t}</span>
            <span className="font-mono text-[8px] uppercase tracking-wider text-ai-graphite-400">{ft.k}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {['A01G 25/16', 'G05B 15/02', '+ 14 synonyms'].map((c) => (
          <span key={c} className="rounded-full border border-ai-graphite-900/10 px-2 py-0.5 font-mono text-[8.5px] text-ai-graphite-500">
            {c}
          </span>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <span className="rounded-md px-3 py-1.5 text-[11px] font-medium text-white" style={{ backgroundColor: LAMP }}>
          Approve &amp; run
        </span>
        <span className="rounded-md border border-ai-graphite-900/15 px-3 py-1.5 text-[11px] text-ai-graphite-600">
          Edit terms
        </span>
      </div>
    </div>
  )
}

function ReportMock() {
  const toc = [
    ['1.7', 'Key feature analysis matrix'],
    ['2.1', 'Relevant patent citations'],
    ['3', 'Applicant landscape'],
    ['5', 'Claim-positioning analysis'],
    ['7', 'Limitations & next steps'],
  ]
  return (
    <div className="rounded-xl border border-ai-graphite-900/10 bg-white p-5 text-left shadow-[0_20px_45px_-30px_rgba(15,23,42,0.3)]">
      <p className="font-mono text-[9px] uppercase tracking-[0.2em]" style={{ color: BRASS }}>
        Prior-art search report · PDF
      </p>
      <p className="mt-1.5 font-serif text-[15px] font-semibold text-ai-graphite-900">
        Adaptive irrigation controller
      </p>
      <div className="mt-3 space-y-1">
        {toc.map(([n, t]) => (
          <div key={n} className="flex items-baseline gap-2 border-b border-ai-graphite-900/5 pb-1">
            <span className="w-7 font-mono text-[9px] text-ai-graphite-400">{n}</span>
            <span className="text-[11px] text-ai-graphite-700">{t}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="rounded-full bg-[#f6ecd7] px-2 py-0.5 text-[9px] font-medium text-[#7a5308]">
          Novelty risk · Medium
        </span>
        <span className="rounded-full bg-[#ece9e0] px-2 py-0.5 text-[9px] font-medium text-[#57554d]">
          Combination risk · flagged
        </span>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- content --- */

const STAGES = [
  {
    n: 'Stage 0',
    title: 'The plan — approved by you',
    body: 'In about half a minute the AI converts your disclosure into an editable search plan: inventive features typed as core, implementation, or novelty candidates; classification codes; synonyms and exclusions. Nothing retrieves until you approve it — those terms control everything downstream, so they are yours to correct first.',
    meta: '~30–40 seconds · fully editable · nothing runs without approval',
    visual: 'plan' as const,
  },
  {
    n: 'Stage 1',
    title: 'Two-lane retrieval',
    body: 'The keyword lane sweeps a corpus of more than 30 million patents from the offices that matter — USPTO, EPO, WIPO, Japan, China, Korea, India, Australia, and beyond — while a semantic lane searches by embedding, finding art that shares your mechanism without sharing your vocabulary. A neural reranker re-scores every candidate against your disclosure, so results from different corpora land on one honest ranking. Scholarly literature is swept in parallel.',
    meta: '30M+ patents worldwide · keyword + semantic · one ranking',
    visual: 'lanes' as const,
  },
  {
    n: 'Stage 1.5',
    title: 'The relevance gate',
    body: 'Every candidate is classified — accept, component, borderline, or reject — with an evidence-quality grade of high, medium, or low. Only references that earn it proceed to expensive per-feature analysis; a small borderline quota keeps honest maybes in play. Rejection costs nothing, which is exactly the point: analysis budget is spent where evidence quality warrants it.',
    meta: 'up to 120 candidates gated · the strongest ~60 mapped in depth',
    visual: 'gate' as const,
  },
  {
    n: 'Stage 3',
    title: 'Feature mapping',
    body: 'Each surviving reference is examined against each of your inventive features — one verdict per cell: Present, Partial, Absent, or Unknown. Disclosure claims must be proven with verbatim quotes from the reference itself, and coverage scores are then computed deterministically from the verdicts. The model finds the evidence; arithmetic draws the conclusions.',
    meta: 'every feature × every reference · quotes as proof · math, not vibes',
    visual: 'matrix' as const,
  },
  {
    n: 'Stage 4',
    title: 'The attorney report',
    body: 'A numbered PDF a professional can act on: scope and methodology, the key-feature analysis matrix, citation analysis with per-reference remarks, applicant and inventor landscapes, claim-positioning observations, graded risk levels — and a limitations section, because a search that cannot state its limits should not be trusted. Emailed to you — typically within 15 minutes of approval.',
    meta: 'attorney-style structure · risk graded · delivered in ~15 minutes',
    visual: 'report' as const,
  },
]

const VERDICTS = [
  {
    mark: '●',
    color: LAMP,
    name: 'Present',
    rule: 'The reference discloses the feature — proven by a verbatim quote of at most 18 words, copied character-for-character, with a confidence score.',
  },
  {
    mark: '◐',
    color: BRASS,
    name: 'Partial',
    rule: 'Part of the mechanism is disclosed. Also quote-backed — and scored lower, so it weighs half in coverage math.',
  },
  {
    mark: '—',
    color: '#57554d',
    name: 'Absent',
    rule: 'Not disclosed — and the model must state a short reason why, not merely fail to find it.',
  },
  {
    mark: '?',
    color: '#94a3b8',
    name: 'Unknown',
    rule: 'Evidence is too thin to judge — a missing abstract cannot be spun into fake novelty. Mandated, not optional.',
  },
]

// Capability matrix: true = full ✓, 'partial' = ◐, false = absent.
// Columns kept generic on purpose — no competitor is named.
const MATRIX: { cap: string; kw: boolean | 'partial'; ai: boolean | 'partial'; us: boolean }[] = [
  { cap: 'Human-approved, editable search plan', kw: false, ai: false, us: true },
  { cap: 'Multi-office patent coverage (US · EP · WO · JP · CN · IN +)', kw: true, ai: 'partial', us: true },
  { cap: 'Semantic retrieval — by mechanism, not vocabulary', kw: false, ai: 'partial', us: true },
  { cap: 'Scholarly literature swept in the same run', kw: 'partial', ai: false, us: true },
  { cap: 'Neural reranking across corpora', kw: false, ai: false, us: true },
  { cap: 'Evidence-quality gate before deep analysis', kw: false, ai: false, us: true },
  { cap: 'Feature × reference disclosure matrix', kw: false, ai: false, us: true },
  { cap: 'Verbatim-quote proof for every disclosure verdict', kw: false, ai: false, us: true },
  { cap: '“Unknown” verdict when evidence is thin', kw: false, ai: false, us: true },
  { cap: 'Deterministic coverage scoring', kw: false, ai: false, us: true },
  { cap: 'Combination (distributed-component) risk flagged', kw: false, ai: false, us: true },
  { cap: 'Claim-positioning analysis', kw: false, ai: 'partial', us: true },
  { cap: 'Attorney-style PDF report, graded risks + limitations', kw: 'partial', ai: false, us: true },
  { cap: 'Durable background runs · report emailed on completion', kw: false, ai: false, us: true },
]

function MatrixMark({ v, strong = false }: { v: boolean | 'partial'; strong?: boolean }) {
  if (v === true) {
    return strong ? (
      <Check className="mx-auto h-4.5 w-4.5" style={{ color: LAMP, height: 18, width: 18 }} aria-label="Included" />
    ) : (
      <Check className="mx-auto" style={{ color: '#94a3b8', height: 16, width: 16 }} aria-label="Included" />
    )
  }
  if (v === 'partial') {
    return <span className="font-mono text-sm" style={{ color: BRASS }} aria-label="Partial">◐</span>
  }
  return <span className="font-mono text-sm text-ai-graphite-300" aria-label="Not offered">—</span>
}

const COMPARISON = [
  {
    dim: 'The search terms',
    them: 'A black box — you discover what was searched after the results arrive.',
    us: 'An editable plan you approve before anything runs.',
  },
  {
    dim: 'Retrieval',
    them: 'Keyword matching in one index; art with different vocabulary is invisible.',
    us: 'Keyword and semantic lanes across patent offices and scholarly indexes, unified by a neural reranker.',
  },
  {
    dim: 'Relevance',
    them: 'A single opaque score sorts everything; every result gets equal, shallow treatment.',
    us: 'An evidence-quality gate routes deep analysis only to references that earn it.',
  },
  {
    dim: 'Evidence',
    them: 'AI-written summaries you cannot verify without reading each patent yourself.',
    us: 'Verbatim quotes, character-for-character, for every disclosure claim — checkable in seconds.',
  },
  {
    dim: 'Uncertainty',
    them: 'Forced verdicts — thin evidence quietly becomes a confident answer.',
    us: 'Unknown is a first-class verdict. The pipeline shows its uncertainty instead of hiding it.',
  },
  {
    dim: 'The deliverable',
    them: 'A list of links and percentage scores.',
    us: 'An attorney-style PDF: feature matrix, claim positioning, graded risks, stated limitations.',
  },
]

export default function NoveltyDetail({
  feature,
  prev,
  next,
}: {
  feature: Feature
  prev?: Feature
  next?: Feature
}) {
  const { user } = useAuth()

  return (
    <main>
      {/* header */}
      <section className="pb-16 pt-32 sm:pt-36">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}>
            <Link
              href="/patentnest#embodiments"
              className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-ai-graphite-500 transition-colors hover:text-ai-graphite-900"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> The full application
            </Link>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE, delay: 0.08 }}
            className="mt-10 flex items-center gap-4"
          >
            <p className="font-mono text-[11px] uppercase tracking-[0.3em]" style={{ color: BRASS }}>
              Embodiment {pad(feature.embodiment)} · {feature.name}
            </p>
            <span className="h-px flex-1 bg-ai-graphite-900/15" />
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: EASE, delay: 0.16 }}
            className="mt-6 font-serif text-4xl font-medium leading-[1.08] tracking-tight text-ai-graphite-900 sm:text-5xl lg:text-6xl"
          >
            {feature.hero.headline}
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: EASE, delay: 0.24 }}
            className="mt-6 max-w-2xl text-lg leading-relaxed text-ai-graphite-600 sm:text-xl"
          >
            {feature.hero.lede}
          </motion.p>
        </div>
      </section>

      {/* the figure plate */}
      <section className="pb-20">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <Reveal>
            <figure className="rounded-xl border border-ai-graphite-900/10 bg-white p-8 sm:p-12">
              <FeatureFigure spec={feature.fig} />
              <figcaption className="mt-6 border-t border-ai-graphite-900/5 pt-5 text-center font-mono text-[10px] uppercase tracking-[0.3em] text-ai-graphite-400">
                Fig. E{feature.embodiment} — {feature.name}
              </figcaption>
            </figure>
          </Reveal>

          {/* the numbers that matter */}
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: '-40px' }}
            className="mt-8 grid grid-cols-3 gap-4"
          >
            {[
              { n: '30M+', l: 'patents searched · worldwide' },
              { n: '~15 min', l: 'report delivered to your inbox' },
              { n: '100%', l: 'verdicts backed by verbatim quotes' },
            ].map((s) => (
              <motion.div key={s.n} variants={staggerItem} className="rounded-xl border border-ai-graphite-900/10 bg-white px-4 py-5 text-center">
                <p className="font-serif text-2xl font-semibold tracking-tight text-ai-graphite-900 sm:text-3xl">
                  {s.n}
                </p>
                <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.15em] text-ai-graphite-400 sm:text-[10px]">
                  {s.l}
                </p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* the method, staged */}
      <section className="bg-white py-20 sm:py-24">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <SectionLabel>The method — five stages, one audit trail</SectionLabel>
          <Reveal delay={0.1}>
            <p className="mt-8 max-w-2xl text-lg leading-relaxed text-ai-graphite-600">
              Every stage below exists in the running pipeline — with its own progress, its own
              record, and its own reason to be trusted.
            </p>
          </Reveal>

          <div className="mt-16 space-y-20">
            {STAGES.map((s, i) => (
              <Reveal key={s.n}>
                <div className={`grid items-center gap-10 lg:grid-cols-2 ${i % 2 === 1 ? 'lg:[&>*:first-child]:order-2' : ''}`}>
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.25em]" style={{ color: BRASS }}>
                      {s.n}
                    </p>
                    <h3 className="mt-3 font-serif text-2xl font-semibold tracking-tight text-ai-graphite-900 sm:text-3xl">
                      {s.title}
                    </h3>
                    <p className="mt-4 text-[15px] leading-relaxed text-ai-graphite-600">{s.body}</p>
                    <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-ai-graphite-400">
                      {s.meta}
                    </p>
                  </div>
                  <div>
                    {s.visual === 'plan' && <QueryPlanMock />}
                    {s.visual === 'lanes' && (
                      <div className="rounded-xl border border-ai-graphite-900/10 bg-paper-50 p-6">
                        <TwoLaneFig />
                        <div className="mt-2 border-t border-ai-graphite-900/5 pt-3">
                          <p className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-ai-graphite-400">
                            Coverage · 30M+ patents · publications from
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {['USPTO', 'EPO', 'WIPO · PCT', 'Japan', 'China', 'Korea', 'India', 'Australia', 'UK', 'Germany', 'Canada', '+ more'].map((c) => (
                              <span key={c} className="rounded-full border border-ai-graphite-900/10 bg-white px-2 py-0.5 font-mono text-[8.5px] text-ai-graphite-600">
                                {c}
                              </span>
                            ))}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {['Google Scholar', 'Semantic Scholar', 'Crossref', 'arXiv'].map((c) => (
                              <span key={c} className="rounded-full border border-lamp-200 bg-lamp-50 px-2 py-0.5 font-mono text-[8.5px] text-lamp-700">
                                {c}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                    {s.visual === 'gate' && (
                      <div className="rounded-xl border border-ai-graphite-900/10 bg-paper-50 p-6">
                        <GateFig />
                      </div>
                    )}
                    {s.visual === 'matrix' && (
                      <div className="rounded-xl border border-ai-graphite-900/10 bg-paper-50 p-6">
                        <FeatureFigure spec={{ kind: 'matrix' }} />
                      </div>
                    )}
                    {s.visual === 'report' && <ReportMock />}
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* evidence grounding */}
      <section className="py-20 sm:py-24">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <SectionLabel>Evidence grounding</SectionLabel>
          <Reveal delay={0.1}>
            <h2 className="mt-8 font-serif text-3xl font-medium leading-tight tracking-tight text-ai-graphite-900 sm:text-4xl">
              Every claim of disclosure carries its proof.
            </h2>
          </Reveal>
          <Reveal delay={0.15}>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ai-graphite-600">
              AI search tools fail in one predictable way: confident summaries nobody can check.
              This pipeline is built against that failure — a disclosure verdict is only as good
              as the quote behind it.
            </p>
          </Reveal>

          <Reveal delay={0.2}>
            <figure className="mt-12 rounded-xl border border-ai-graphite-900/10 bg-white p-8 sm:p-10">
              <EvidenceFig />
              <figcaption className="mt-5 border-t border-ai-graphite-900/5 pt-4 text-center font-mono text-[10px] uppercase tracking-[0.3em] text-ai-graphite-400">
                Fig. E2.1 — Verbatim evidence extraction
              </figcaption>
            </figure>
          </Reveal>

          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: '-60px' }}
            className="mt-8 grid gap-6 sm:grid-cols-3"
          >
            {[
              {
                t: 'Verbatim or nothing',
                b: 'Present and Partial require a quote of at most 18 words, copied character-for-character from the reference’s title, abstract, or claims — never paraphrased into existence.',
              },
              {
                t: 'Confidence is a number',
                b: 'Each quote is scored on a fixed rubric: 0.9–1.0 for an explicit match, 0.6–0.8 for a paraphrase of the same mechanism, 0.3–0.5 for weak or indirect support.',
              },
              {
                t: 'Unknown is an answer',
                b: 'When evidence is thin, the verdict is forced to Unknown. Most tools guess; this one shows its uncertainty — which is exactly what makes its certainty worth something.',
              },
            ].map((c) => (
              <motion.div key={c.t} variants={staggerItem} className="rounded-xl border border-ai-graphite-900/10 bg-white p-6">
                <h3 className="font-serif text-lg font-semibold text-ai-graphite-900">{c.t}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-ai-graphite-600">{c.b}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* feature mapping, precisely */}
      <section className="bg-white py-20 sm:py-24">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <SectionLabel>Feature mapping, precisely</SectionLabel>
          <Reveal delay={0.1}>
            <h2 className="mt-8 font-serif text-3xl font-medium leading-tight tracking-tight text-ai-graphite-900 sm:text-4xl">
              Four verdicts. One rule each.
            </h2>
          </Reveal>

          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: '-60px' }}
            className="mt-12 grid gap-6 sm:grid-cols-2"
          >
            {VERDICTS.map((v) => (
              <motion.div key={v.name} variants={staggerItem} className="flex gap-5 rounded-xl border border-ai-graphite-900/10 bg-paper-50 p-6">
                <span className="mt-0.5 font-mono text-2xl leading-none" style={{ color: v.color }}>
                  {v.mark}
                </span>
                <div>
                  <h3 className="font-serif text-lg font-semibold text-ai-graphite-900">{v.name}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ai-graphite-600">{v.rule}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>

          <Reveal delay={0.1}>
            <div className="mt-8 rounded-xl border border-ai-graphite-900/10 bg-paper-50 p-7">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: BRASS }}>
                Then the arithmetic takes over
              </p>
              <p className="mt-3 text-[15px] leading-relaxed text-ai-graphite-700">
                Coverage per reference is computed, not felt: Present counts 1.0, Partial 0.5,
                Absent 0. Those scores aggregate into the key-feature matrix, per-reference
                overlap-risk levels, and one finding most tools never surface —{' '}
                <em className="font-serif not-italic font-semibold">distributed-component risk</em>,
                when no single reference anticipates you but a combination of several might. Generic
                parts (a processor, a sensor) are excluded from standing alone, and synonyms only
                count when they implement the same mechanism — with domain-aware handling for
                chemical, pharma, and bio inventions.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* comparative example */}
      <section className="py-20 sm:py-24">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <SectionLabel>Comparative example</SectionLabel>
          <Reveal delay={0.1}>
            <h2 className="mt-8 max-w-3xl font-serif text-3xl font-medium leading-tight tracking-tight text-ai-graphite-900 sm:text-4xl">
              What the field does. What this pipeline does.
            </h2>
          </Reveal>
          <Reveal delay={0.15}>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ai-graphite-600">
              In patent practice, a comparative example shows the invention against the prior
              approach. In that spirit — first the capabilities, then the quality of what comes
              out.
            </p>
          </Reveal>

          {/* capability matrix */}
          <Reveal delay={0.2}>
            <div className="mt-12 overflow-x-auto rounded-xl border border-ai-graphite-900/10 bg-white">
              <table className="w-full min-w-[640px] text-left">
                <thead>
                  <tr className="border-b border-ai-graphite-900/10">
                    <th className="px-6 py-4 font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-ai-graphite-400">
                      Capability
                    </th>
                    <th className="w-32 px-3 py-4 text-center font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-ai-graphite-400">
                      Keyword databases
                    </th>
                    <th className="w-32 px-3 py-4 text-center font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-ai-graphite-400">
                      Generic AI search
                    </th>
                    <th className="w-32 bg-lamp-50 px-3 py-4 text-center font-mono text-[10px] font-medium uppercase tracking-[0.15em]" style={{ color: LAMP }}>
                      PatentNest
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {MATRIX.map((row) => (
                    <tr key={row.cap} className="border-b border-ai-graphite-900/5 last:border-b-0">
                      <td className="px-6 py-3.5 text-sm text-ai-graphite-800">{row.cap}</td>
                      <td className="px-3 py-3.5 text-center">
                        <MatrixMark v={row.kw} />
                      </td>
                      <td className="px-3 py-3.5 text-center">
                        <MatrixMark v={row.ai} />
                      </td>
                      <td className="bg-lamp-50 px-3 py-3.5 text-center">
                        <MatrixMark v={row.us} strong />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="border-t border-ai-graphite-900/5 px-6 py-3 font-mono text-[9px] uppercase tracking-[0.18em] text-ai-graphite-400">
                ✓ full capability · ◐ partial · — absent
              </p>
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <p className="mt-14 font-mono text-[11px] uppercase tracking-[0.25em]" style={{ color: BRASS }}>
              Output quality, side by side
            </p>
          </Reveal>

          <Reveal delay={0.15}>
            <div className="mt-6 overflow-x-auto rounded-xl border border-ai-graphite-900/10 bg-white">
              <table className="w-full min-w-[640px] text-left">
                <thead>
                  <tr className="border-b border-ai-graphite-900/10">
                    <th className="px-6 py-4 font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-ai-graphite-400">
                      Dimension
                    </th>
                    <th className="px-6 py-4 font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-ai-graphite-400">
                      A typical search tool
                    </th>
                    <th className="px-6 py-4 font-mono text-[10px] font-medium uppercase tracking-[0.2em]" style={{ color: BRASS }}>
                      PatentNest
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON.map((row) => (
                    <tr key={row.dim} className="border-b border-ai-graphite-900/5 last:border-b-0 align-top">
                      <td className="px-6 py-5 font-serif text-[15px] font-semibold text-ai-graphite-900">
                        {row.dim}
                      </td>
                      <td className="px-6 py-5 text-sm leading-relaxed text-ai-graphite-500">{row.them}</td>
                      <td className="px-6 py-5">
                        <div className="flex gap-2.5">
                          <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: LAMP }} />
                          <span className="text-sm leading-relaxed text-ai-graphite-800">{row.us}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Reveal>
        </div>
      </section>

      {/* wherein */}
      <section className="bg-white py-20 sm:py-24">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <SectionLabel>Wherein</SectionLabel>
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: '-60px' }}
            className="mt-10 grid gap-6 sm:grid-cols-2"
          >
            {feature.details.map((d) => (
              <motion.div key={d.title} variants={staggerItem} className="rounded-xl border border-ai-graphite-900/10 bg-paper-50 p-7">
                <h3 className="font-serif text-lg font-semibold text-ai-graphite-900">{d.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-ai-graphite-600">{d.body}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* prev / next embodiment */}
      <nav className="border-t border-ai-graphite-900/10" aria-label="Embodiments">
        <div className="mx-auto grid max-w-4xl grid-cols-2 px-4 sm:px-6">
          {prev ? (
            <Link href={`/patentnest/features/${prev.slug}`} className="group flex flex-col gap-1.5 border-r border-ai-graphite-900/10 py-8 pr-6">
              <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ai-graphite-400">
                <ArrowLeft className="h-3 w-3 transition-transform group-hover:-translate-x-0.5" />
                Embodiment {pad(prev.embodiment)}
              </span>
              <span className="font-serif text-lg font-medium text-ai-graphite-900 group-hover:underline">{prev.name}</span>
            </Link>
          ) : (
            <span className="border-r border-ai-graphite-900/10" />
          )}
          {next ? (
            <Link href={`/patentnest/features/${next.slug}`} className="group flex flex-col items-end gap-1.5 py-8 pl-6 text-right">
              <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ai-graphite-400">
                Embodiment {pad(next.embodiment)}
                <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
              </span>
              <span className="font-serif text-lg font-medium text-ai-graphite-900 group-hover:underline">{next.name}</span>
            </Link>
          ) : (
            <span />
          )}
        </div>
      </nav>

      {/* CTA */}
      <section className="border-t border-ai-graphite-900/10 py-20 sm:py-24">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <Reveal>
            <h2 className="font-serif text-3xl font-medium leading-tight tracking-tight text-ai-graphite-900 sm:text-4xl">
              Run it on your own invention.
            </h2>
          </Reveal>
          <Reveal delay={0.08}>
            <p className="mx-auto mt-4 max-w-xl text-ai-graphite-600">
              Thirty seconds to a search plan. One approval. An attorney-style report in your
              inbox — typically within 15 minutes.
            </p>
          </Reveal>
          <Reveal delay={0.14}>
            <div className="mt-8 flex flex-col items-center gap-4">
              <Link href={user ? '/novelty-search' : '/register'} className="group w-full sm:w-auto">
                <span className="flex items-center justify-center gap-2.5 rounded-lg bg-ai-graphite-900 px-8 py-4 text-base font-medium text-white transition-all duration-150 group-hover:bg-ai-graphite-800 group-active:scale-[0.98]">
                  Start a novelty search
                  <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" />
                </span>
              </Link>
              <p className="text-sm text-ai-graphite-500">Free to start · No credit card required</p>
            </div>
          </Reveal>
        </div>
      </section>
    </main>
  )
}
