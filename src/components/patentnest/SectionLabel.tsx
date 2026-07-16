'use client'

// The document motif that threads the page: a brass section marker in patent-
// document voice ("§ 02 · SUMMARY OF THE INVENTION") over a hairline rule that
// draws itself in as the section enters view.

import { motion, useReducedMotion } from 'framer-motion'

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number]
const BRASS = '#8a6a1f'

export default function SectionLabel({ children }: { children: string }) {
  const reduce = useReducedMotion()
  return (
    <div>
      <motion.span
        className="block h-px w-full origin-left bg-ai-graphite-900/15"
        initial={{ scaleX: reduce ? 1 : 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.8, ease: EASE }}
        aria-hidden
      />
      <motion.p
        className="mt-5 font-mono text-[10px] uppercase tracking-[0.3em] sm:text-[11px]"
        style={{ color: BRASS }}
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.5, ease: EASE, delay: 0.2 }}
      >
        {children}
      </motion.p>
    </div>
  )
}
