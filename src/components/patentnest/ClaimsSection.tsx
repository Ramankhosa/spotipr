'use client'

// "§ 04 · CLAIMS" — the value proposition written as numbered patent claims in
// proper dependent form. The page's signature copy device: it explains exactly
// what the product does, in the exact language of the document it produces.

import Image from 'next/image'
import { motion } from 'framer-motion'
import SectionLabel from './SectionLabel'
import { Reveal, staggerContainer, staggerItem } from './Reveal'

const BRASS = '#8a6a1f'

const CLAIMS = [
  'A patent studio that turns a plain-language disclosure into a complete, filing-ready application.',
  'The studio of claim 1, wherein prior art is searched across millions of patents and papers in minutes, not weeks.',
  'The studio of claims 1–2, wherein specifications and claims are drafted in proper dependent form, ready for attorney review.',
  'The studio of claims 1–3, wherein figures are generated and mapped to every claim element.',
  'The studio of claims 1–4, wherein novelty and completeness are validated before a single filing fee is paid.',
]

export default function ClaimsSection() {
  return (
    <section id="claims" className="scroll-mt-24 bg-white py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <SectionLabel>§ 05 · Claims</SectionLabel>

        <Reveal delay={0.1}>
          <h2 className="mt-8 font-serif text-3xl font-medium leading-tight tracking-tight text-ai-graphite-900 sm:text-5xl">
            What we claim.
          </h2>
        </Reveal>

        <motion.ol
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-60px' }}
          className="mx-auto mt-14 max-w-3xl"
        >
          {CLAIMS.map((c, i) => (
            <motion.li
              key={i}
              variants={staggerItem}
              className="flex gap-6 border-t border-ai-graphite-900/10 py-7 first:border-t-0 sm:gap-8"
            >
              <span
                className="w-8 shrink-0 pt-0.5 text-right font-serif text-2xl font-semibold sm:text-3xl"
                style={{ color: BRASS }}
              >
                {i + 1}.
              </span>
              <p className="font-serif text-lg leading-relaxed text-ai-graphite-800 sm:text-xl">
                {c}
              </p>
            </motion.li>
          ))}
        </motion.ol>

        <Reveal delay={0.1}>
          <p className="mx-auto mt-10 max-w-2xl text-center font-serif text-lg italic leading-relaxed text-ai-graphite-500">
            Claimed on behalf of independent inventors, research labs, and the attorneys who
            file for them.
          </p>
        </Reveal>

        {/* institutional backing */}
        <Reveal delay={0.15}>
          <div className="mt-16 flex flex-col items-center gap-4 border-t border-ai-graphite-900/10 pt-10 sm:flex-row sm:justify-center">
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-ai-graphite-400">
              Backed by
            </span>
            <Image
              src="/images/lpu-logo.png"
              alt="Lovely Professional University"
              width={140}
              height={42}
              className="h-9 w-auto object-contain opacity-80 grayscale"
            />
          </div>
        </Reveal>
      </div>
    </section>
  )
}
