'use client'

// "§ 01 · BACKGROUND OF THE INVENTION" — the problem, stated the way a patent
// states prior art: three deficiencies of the existing method, set in calm
// editorial columns. Quiet empathy, no product pitch yet.

import { motion } from 'framer-motion'
import SectionLabel from './SectionLabel'
import { staggerContainer, staggerItem } from './Reveal'
import { Reveal } from './Reveal'

const DEFICIENCIES = [
  {
    ref: '(a)',
    title: 'Novelty is a guess',
    body: 'Most inventors learn about blocking prior art after they have paid for drafting — the most expensive possible moment to find out.',
  },
  {
    ref: '(b)',
    title: 'The blank page is legal',
    body: 'A specification demands precise, defensible language. Few inventors have ever written one, and every mistake narrows the protection.',
  },
  {
    ref: '(c)',
    title: 'Months of back-and-forth',
    body: 'Each revision cycle with counsel adds weeks and fees. The idea ages while the paperwork crawls toward the filing date.',
  },
]

export default function PriorArtSection() {
  return (
    <section id="background" className="scroll-mt-24 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <SectionLabel>§ 01 · Background of the invention</SectionLabel>

        <Reveal delay={0.1}>
          <h2 className="mt-8 max-w-3xl font-serif text-3xl font-medium leading-tight tracking-tight text-ai-graphite-900 sm:text-5xl">
            Getting a patent shouldn&rsquo;t be the hardest part of inventing.
          </h2>
        </Reveal>

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          className="mt-16 grid gap-10 sm:grid-cols-3"
        >
          {DEFICIENCIES.map((d) => (
            <motion.div key={d.ref} variants={staggerItem} className="border-t border-ai-graphite-900/10 pt-6">
              <p className="font-mono text-xs text-ai-graphite-400">{d.ref}</p>
              <h3 className="mt-3 font-serif text-xl font-semibold text-ai-graphite-900">
                {d.title}
              </h3>
              <p className="mt-3 text-[15px] leading-relaxed text-ai-graphite-600">{d.body}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
