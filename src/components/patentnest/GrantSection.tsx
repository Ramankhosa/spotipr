'use client'

// Final CTA — the grant. A certificate frame (double hairline border) and the
// page's one theatrical moment: a brass GRANTED seal that stamps in on scroll.
// Restated transformation, one dominant action.

import Link from 'next/link'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { Reveal } from './Reveal'
import { BRASS } from '@/lib/patentnest/palette'


function Seal() {
  const reduce = useReducedMotion()
  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.6, rotate: -16 }}
      whileInView={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, rotate: -8 }}
      viewport={{ once: true, margin: '-100px' }}
      transition={reduce ? { duration: 0.4 } : { type: 'spring', stiffness: 260, damping: 20 }}
      className="mx-auto grid h-28 w-28 place-items-center rounded-full border-2"
      style={{ borderColor: BRASS, color: BRASS }}
      aria-hidden
    >
      <div className="grid h-[88px] w-[88px] place-items-center rounded-full border" style={{ borderColor: BRASS }}>
        <div className="text-center">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em]">Granted</p>
          <p className="mt-0.5 font-mono text-[8px] tracking-[0.15em] opacity-70">PN · 2026</p>
        </div>
      </div>
    </motion.div>
  )
}

export default function GrantSection() {
  const { user } = useAuth()

  return (
    <section className="py-24 sm:py-32">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        {/* certificate frame */}
        <div className="rounded-2xl border border-ai-graphite-900/15 p-2">
          <div className="rounded-xl border border-ai-graphite-900/10 px-6 py-16 text-center sm:px-16 sm:py-20">
            <Seal />

            <Reveal delay={0.1}>
              <h2 className="mt-10 font-serif text-4xl font-medium leading-[1.08] tracking-tight text-ai-graphite-900 sm:text-5xl">
                Your invention is waiting.
              </h2>
            </Reveal>
            <Reveal delay={0.15}>
              <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-ai-graphite-600">
                The distance between an idea and a granted claim has never been shorter.
                Begin the application today.
              </p>
            </Reveal>

            <Reveal delay={0.2}>
              <div className="mt-9 flex flex-col items-center gap-4">
                <Link href={user ? '/patents/draft/new' : '/register'} className="group w-full sm:w-auto">
                  <span className="flex items-center justify-center gap-2.5 rounded-lg bg-ai-graphite-900 px-8 py-4 text-base font-medium text-white transition-all duration-150 group-hover:bg-ai-graphite-800 group-active:scale-[0.98]">
                    Start your application
                    <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" />
                  </span>
                </Link>
                <p className="text-sm text-ai-graphite-500">
                  Free to start · No credit card required
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  )
}
