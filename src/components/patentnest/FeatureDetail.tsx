'use client'

// Detail-page body for one embodiment (feature). Document-voiced: a labeled
// header, the feature's full-size animated figure as a numbered plate, the
// "Method" (real user-facing flow), "Wherein" specifics, and prev/next
// navigation through the embodiments. Rendered by
// /patentnest/features/[slug]/page.tsx from the features.ts registry.

import Link from 'next/link'
import { motion } from 'framer-motion'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import type { Feature } from '@/lib/patentnest/features'
import { Reveal, staggerContainer, staggerItem } from './Reveal'
import SectionLabel from './SectionLabel'
import FeatureFigure from './FeatureFigure'
import { BRASS } from '@/lib/patentnest/palette'

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number]

const pad = (n: number) => String(n).padStart(2, '0')

export default function FeatureDetail({
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
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE }}
          >
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

          {/* proof numbers */}
          {feature.stats && (
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, margin: '-40px' }}
              className="mt-8 grid gap-4 sm:grid-cols-3"
            >
              {feature.stats.map((s) => (
                <motion.div
                  key={s.l}
                  variants={staggerItem}
                  className="rounded-xl border border-ai-graphite-900/10 bg-white px-4 py-5 text-center"
                >
                  <p className="font-serif text-2xl font-semibold tracking-tight text-ai-graphite-900 sm:text-3xl">
                    {s.n}
                  </p>
                  <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.15em] text-ai-graphite-400 sm:text-[10px]">
                    {s.l}
                  </p>
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>
      </section>

      {/* method */}
      <section className="bg-white py-20 sm:py-24">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <SectionLabel>The method</SectionLabel>
          <motion.ol
            variants={staggerContainer}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: '-60px' }}
            className="mt-10"
          >
            {feature.how.map((step, i) => (
              <motion.li
                key={step.title}
                variants={staggerItem}
                className="flex gap-6 border-t border-ai-graphite-900/10 py-7 first:border-t-0 sm:gap-10"
              >
                <span className="w-10 shrink-0 pt-1 font-mono text-sm text-ai-graphite-400">
                  {pad(i + 1)}
                </span>
                <div>
                  <h3 className="font-serif text-xl font-semibold tracking-tight text-ai-graphite-900 sm:text-2xl">
                    {step.title}
                  </h3>
                  <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ai-graphite-600">
                    {step.body}
                  </p>
                </div>
              </motion.li>
            ))}
          </motion.ol>
        </div>
      </section>

      {/* the sharpest claim, set large */}
      {feature.pull && (
        <section className="py-16 sm:py-20">
          <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
            <Reveal>
              <div className="flex items-center gap-6">
                <span className="h-px flex-1" style={{ backgroundColor: `${BRASS}55` }} />
                <span className="font-mono text-[10px] uppercase tracking-[0.3em]" style={{ color: BRASS }}>
                  Wherein, notably
                </span>
                <span className="h-px flex-1" style={{ backgroundColor: `${BRASS}55` }} />
              </div>
            </Reveal>
            <Reveal delay={0.1}>
              <p className="mt-8 font-serif text-2xl font-medium italic leading-snug tracking-tight text-ai-graphite-900 sm:text-3xl">
                {feature.pull}
              </p>
            </Reveal>
          </div>
        </section>
      )}

      {/* wherein — the specifics */}
      <section className="py-20 sm:py-24">
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
              <motion.div
                key={d.title}
                variants={staggerItem}
                className="rounded-xl border border-ai-graphite-900/10 bg-white p-7"
              >
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
            <Link
              href={`/patentnest/features/${prev.slug}`}
              className="group flex flex-col gap-1.5 border-r border-ai-graphite-900/10 py-8 pr-6"
            >
              <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ai-graphite-400">
                <ArrowLeft className="h-3 w-3 transition-transform group-hover:-translate-x-0.5" />
                Embodiment {pad(prev.embodiment)}
              </span>
              <span className="font-serif text-lg font-medium text-ai-graphite-900 group-hover:underline">
                {prev.name}
              </span>
            </Link>
          ) : (
            <span className="border-r border-ai-graphite-900/10" />
          )}
          {next ? (
            <Link
              href={`/patentnest/features/${next.slug}`}
              className="group flex flex-col items-end gap-1.5 py-8 pl-6 text-right"
            >
              <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ai-graphite-400">
                Embodiment {pad(next.embodiment)}
                <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
              </span>
              <span className="font-serif text-lg font-medium text-ai-graphite-900 group-hover:underline">
                {next.name}
              </span>
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
              See it on your own invention.
            </h2>
          </Reveal>
          {feature.cta && (
            <Reveal delay={0.06}>
              <p className="mx-auto mt-4 max-w-xl font-mono text-[11px] uppercase tracking-[0.2em] text-ai-graphite-500">
                {feature.cta.line}
              </p>
            </Reveal>
          )}
          <Reveal delay={0.08}>
            <div className="mt-8 flex flex-col items-center gap-4">
              <Link href={user ? feature.cta?.href ?? '/patents/draft/new' : '/register'} className="group w-full sm:w-auto">
                <span className="flex items-center justify-center gap-2.5 rounded-lg bg-ai-graphite-900 px-8 py-4 text-base font-medium text-white transition-all duration-150 group-hover:bg-ai-graphite-800 group-active:scale-[0.98]">
                  Start your application
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
