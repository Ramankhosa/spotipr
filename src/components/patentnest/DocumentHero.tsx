'use client'

// Hero — "ABSTRACT". The page opens like the title block of a beautifully
// typeset patent application filed on the visitor's behalf ("Applicant: You").
// Serif display carries the dignity; the sub-line explains the product plainly;
// FIG. 1 below is the real thing — the drafting studio.

import Link from 'next/link'
import { useRef } from 'react'
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { DraftingMock } from './mockups'

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number]
const BRASS = '#8a6a1f'

const rise = (delay: number) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, ease: EASE, delay },
})

export default function DocumentHero() {
  const { user } = useAuth()
  const reduce = useReducedMotion()
  const figRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: figRef, offset: ['start end', 'start center'] })
  const figY = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [40, 0])

  return (
    <section className="relative overflow-hidden pb-24 pt-36 sm:pt-44">
      <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
        {/* document title block */}
        <motion.div {...rise(0)} className="flex items-center gap-4 sm:gap-6">
          <span className="h-px flex-1 bg-ai-graphite-900/15" />
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-ai-graphite-500 sm:text-[11px]">
            Patent application · No. PN-2026-001 ·{' '}
            <span style={{ color: BRASS }}>Applicant: You</span>
          </p>
          <span className="h-px flex-1 bg-ai-graphite-900/15" />
        </motion.div>

        <motion.h1
          {...rise(0.08)}
          className="mt-10 font-serif text-5xl font-medium leading-[1.04] tracking-tight text-ai-graphite-900 sm:text-6xl lg:text-7xl"
        >
          Where ideas become{' '}
          <em className="italic" style={{ color: BRASS }}>
            property
          </em>
          .
        </motion.h1>

        <motion.p
          {...rise(0.16)}
          className="mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-ai-graphite-600 sm:text-xl"
        >
          PatentNest is the patent studio that searches prior art across millions of patents,
          drafts your specification and claims, and prepares filing-ready figures — from first
          disclosure to submission.
        </motion.p>

        <motion.div
          {...rise(0.24)}
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

        <motion.p {...rise(0.32)} className="mt-5 text-sm text-ai-graphite-500">
          Free to start · No credit card required
        </motion.p>
      </div>

      {/* FIG. 1 — the product */}
      <div ref={figRef} className="mx-auto mt-20 max-w-4xl px-4 sm:px-6">
        <motion.div
          style={{ y: figY }}
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.7, ease: EASE }}
        >
          <DraftingMock />
          <p className="mt-5 text-center font-mono text-[10px] uppercase tracking-[0.3em] text-ai-graphite-400">
            Fig. 1 — the drafting studio, claims view
          </p>
        </motion.div>
      </div>
    </section>
  )
}
