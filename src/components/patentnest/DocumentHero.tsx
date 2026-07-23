'use client'

// Hero — "ABSTRACT". The page opens on FIG. 1 itself: one line, three beats —
// a rough scribble passes through the AI engine ring and exits as the typeset
// rules of a granted application (see idea-to-grant-hero.tsx). The headline
// and CTAs sit BELOW the drawing — the figure is the hero, the words are its
// caption.

import Link from 'next/link'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { CinematicHero } from './hero-variants'
import { IdeaToGrantHeroFig } from './idea-to-grant-hero'
import { BRASS } from '@/lib/patentnest/palette'

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number]

const rise = (delay: number) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, ease: EASE, delay },
})

export default function DocumentHero() {
  const { user } = useAuth()
  const reduce = useReducedMotion()

  return (
    <section className="relative overflow-hidden pb-24 pt-28 sm:pt-32">
      {/* document title block */}
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <motion.div {...rise(0)} className="flex items-center gap-4 sm:gap-6">
          <span className="h-px flex-1 bg-ai-graphite-900/15" />
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-ai-graphite-500 sm:text-[11px]">
            Patent application · No. PN-2026-001 ·{' '}
            <span style={{ color: BRASS }}>Applicant: You</span>
          </p>
          <span className="h-px flex-1 bg-ai-graphite-900/15" />
        </motion.div>

        {/* FIG. 1 — the main event */}
        <motion.div
          initial={{ opacity: 0, y: reduce ? 0 : 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.1 }}
          className="mt-10"
        >
          {/* Simulation finding: a 900-unit SVG on a 375px phone renders its
              captions at ~6px — unreadable. Below `sm` the hero becomes the
              stage-by-stage cinematic (real HTML type, phone-native). */}
          <div className="hidden rounded-xl border border-ai-graphite-900/10 bg-white p-5 sm:block sm:p-10">
            <IdeaToGrantHeroFig />
          </div>
          <div className="sm:hidden">
            <CinematicHero />
          </div>
          <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-[0.3em] text-ai-graphite-400">
            Fig. 1 — from disclosure to grant · one unbroken line
          </p>
        </motion.div>
      </div>

      {/* the words, below the drawing */}
      <div className="mx-auto mt-14 max-w-4xl px-4 text-center sm:px-6">
        <motion.h1
          {...rise(0.25)}
          className="font-serif text-4xl font-medium leading-[1.06] tracking-tight text-ai-graphite-900 sm:text-6xl lg:text-7xl"
        >
          Where ideas become{' '}
          <em className="italic" style={{ color: BRASS }}>
            property
          </em>
          .
        </motion.h1>

        <motion.p
          {...rise(0.35)}
          className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-ai-graphite-600 sm:text-xl"
        >
          One unbroken line from disclosure to grant — prior art searched across 30M+ patents,
          claims drafted and verified, figures numbered once, filings prepared for 12 patent
          offices. Nothing lost between stages. Nothing you can&rsquo;t verify.
        </motion.p>

        <motion.div
          {...rise(0.45)}
          className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row"
        >
          <Link href={user ? '/patents/draft/new' : '/register'} className="group w-full sm:w-auto">
            <span className="flex items-center justify-center gap-2.5 rounded-lg bg-ai-graphite-900 px-7 py-3.5 text-base font-medium text-white transition-all duration-150 group-hover:bg-ai-graphite-800 group-active:scale-[0.98]">
              Start your application
              <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" />
            </span>
          </Link>
          <a
            href="#studio"
            className="w-full rounded-lg border border-ai-graphite-900/15 px-7 py-3.5 text-base font-medium text-ai-graphite-700 transition-colors duration-150 hover:border-ai-graphite-900/30 hover:text-ai-graphite-900 sm:w-auto"
          >
            See the studio
          </a>
        </motion.div>

        <motion.p {...rise(0.55)} className="mt-5 text-sm text-ai-graphite-500">
          Free to start · No credit card required
        </motion.p>

        {/* the three numbers that answer "is this real?" */}
        <motion.div
          {...rise(0.65)}
          className="mx-auto mt-12 flex max-w-2xl flex-col items-center justify-center gap-3 sm:flex-row sm:gap-0"
        >
          {[
            { n: '30M+', l: 'patents · worldwide' },
            { n: '~15 min', l: 'novelty report' },
            { n: '12', l: 'patent offices' },
          ].map((s, i) => (
            <div
              key={s.n}
              className={`flex items-baseline gap-2 px-8 ${i > 0 ? 'sm:border-l sm:border-ai-graphite-900/10' : ''}`}
            >
              <span className="font-serif text-2xl font-semibold tracking-tight text-ai-graphite-900">
                {s.n}
              </span>
              <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-ai-graphite-400">
                {s.l}
              </span>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
