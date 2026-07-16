'use client'

// "§ 04 · DETAILED DESCRIPTION" — the embodiments grid. In a real patent this
// is where the invention's embodiments are enumerated; here each embodiment is
// a product capability with its own animated figure, and links to a dedicated
// page that explores it in depth. Homepage = glimpse; detail page = the method.

import Link from 'next/link'
import { motion } from 'framer-motion'
import { ArrowUpRight } from 'lucide-react'
import SectionLabel from './SectionLabel'
import { Reveal, staggerContainer, staggerItem } from './Reveal'
import FeatureFigure from './FeatureFigure'
import { FEATURES } from '@/lib/patentnest/features'
import { BRASS } from '@/lib/patentnest/palette'


export default function EmbodimentsSection() {
  const features = [...FEATURES].sort((a, b) => a.embodiment - b.embodiment)

  return (
    <section id="embodiments" className="scroll-mt-24 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <SectionLabel>§ 04 · Detailed description of the embodiments</SectionLabel>

        <Reveal delay={0.1}>
          <h2 className="mt-8 max-w-3xl font-serif text-3xl font-medium leading-tight tracking-tight text-ai-graphite-900 sm:text-5xl">
            Eleven embodiments. One studio.
          </h2>
        </Reveal>
        <Reveal delay={0.15}>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ai-graphite-600">
            Every capability below is drawn from the working platform — and each opens into a
            full description of the method behind it.
          </p>
        </Reveal>

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-40px' }}
          className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
        >
          {features.map((f) => (
            <motion.div
              key={f.slug}
              variants={staggerItem}
              className={f.card.size === 'lg' ? 'sm:col-span-2 lg:col-span-2' : undefined}
            >
              <Link
                href={`/patentnest/features/${f.slug}`}
                className="group flex h-full flex-col rounded-xl border border-ai-graphite-900/10 bg-white p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-ai-graphite-900/25 hover:shadow-[0_24px_50px_-32px_rgba(15,23,42,0.35)]"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ai-graphite-400">
                    Embodiment {String(f.embodiment).padStart(2, '0')}
                  </p>
                  <ArrowUpRight
                    className="h-4 w-4 shrink-0 text-ai-graphite-300 transition-all duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                    style={{ color: undefined }}
                  />
                </div>

                {/* the animated glyph */}
                <div className="pointer-events-none my-4 flex-1">
                  <FeatureFigure spec={f.fig} compact />
                </div>

                <h3 className="font-serif text-xl font-semibold tracking-tight text-ai-graphite-900">
                  {f.name}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-ai-graphite-600">{f.card.tagline}</p>
                <p
                  className="mt-4 font-mono text-[10px] uppercase tracking-[0.2em] opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                  style={{ color: BRASS }}
                >
                  Read the method →
                </p>
              </Link>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
