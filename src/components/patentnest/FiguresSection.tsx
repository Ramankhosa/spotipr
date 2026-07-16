'use client'

// "§ 03 · BRIEF DESCRIPTION OF THE DRAWINGS" — real figure output from the
// product, presented as numbered patent plates. Black-ink line art on white
// paper: the most honest product proof on the page.

import { motion } from 'framer-motion'
import SectionLabel from './SectionLabel'
import { Reveal, staggerContainer, staggerItem } from './Reveal'

const PLATES = [
  { src: '/images/BlockDiagram.svg', fig: 'Fig. 2', caption: 'System block diagram' },
  { src: '/images/Activity.svg', fig: 'Fig. 3', caption: 'Control sequence' },
  { src: '/images/Sketch.svg', fig: 'Fig. 4', caption: 'Preferred embodiment' },
]

export default function FiguresSection() {
  return (
    <section id="figures" className="scroll-mt-24 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <SectionLabel>§ 03 · Brief description of the drawings</SectionLabel>

        <Reveal delay={0.1}>
          <h2 className="mt-8 max-w-3xl font-serif text-3xl font-medium leading-tight tracking-tight text-ai-graphite-900 sm:text-5xl">
            Drawings the examiner takes seriously.
          </h2>
        </Reveal>
        <Reveal delay={0.15}>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ai-graphite-600">
            Generated from your specification and mapped to your claims — every element
            numbered, every figure captioned. These are actual studio outputs.
          </p>
        </Reveal>

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          className="mt-16 grid gap-8 sm:grid-cols-3"
        >
          {PLATES.map((p) => (
            <motion.figure
              key={p.fig}
              variants={staggerItem}
              className="rounded-xl border border-ai-graphite-900/10 bg-white p-6 transition-shadow duration-200 hover:shadow-[0_20px_50px_-30px_rgba(15,23,42,0.3)]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.src}
                alt={`${p.fig} — ${p.caption}`}
                className="h-52 w-full object-contain"
              />
              <figcaption className="mt-5 border-t border-ai-graphite-900/5 pt-4 text-center font-mono text-[10px] uppercase tracking-[0.25em] text-ai-graphite-500">
                {p.fig} — {p.caption}
              </figcaption>
            </motion.figure>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
