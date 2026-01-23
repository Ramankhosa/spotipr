'use client'

import { motion } from 'framer-motion'
import { Check, Minus, X } from 'lucide-react'

type Cell = 'yes' | 'partial' | 'no'

const rows: Array<{
  label: string
  detail: string
  patentnest: Cell
  typical: Cell
  templates: Cell
}> = [
  {
    label: 'Feature-level novelty evidence',
    detail: 'Present/partial/absent mapping with evidence excerpts (not just a summary).',
    patentnest: 'yes',
    typical: 'partial',
    templates: 'no',
  },
  {
    label: 'Integrated output pack',
    detail: 'Draft + claims + validation feedback + export-ready assets in one workflow.',
    patentnest: 'yes',
    typical: 'partial',
    templates: 'no',
  },
  {
    label: 'Jurisdiction-aware drafting',
    detail: 'Prompts/rules aligned to jurisdiction needs and section discipline.',
    patentnest: 'yes',
    typical: 'partial',
    templates: 'partial',
  },
  {
    label: 'Non-blocking validation',
    detail: 'Flags issues after generation without stopping iteration.',
    patentnest: 'yes',
    typical: 'no',
    templates: 'no',
  },
  {
    label: 'Figures pipeline built-in',
    detail: 'Figure planning + generation workflow designed to stay aligned with the draft.',
    patentnest: 'yes',
    typical: 'partial',
    templates: 'no',
  },
  {
    label: 'Ideation + Idea Bank pipeline',
    detail: 'Structured ideation and a bank of validated directions, connected to drafting/search.',
    patentnest: 'yes',
    typical: 'no',
    templates: 'no',
  },
]

function Icon({ v }: { v: Cell }) {
  if (v === 'yes') return <Check className="w-4 h-4 text-emerald-300" />
  if (v === 'partial') return <Minus className="w-4 h-4 text-amber-300" />
  return <X className="w-4 h-4 text-rose-300" />
}

export default function ComparisonSection() {
  return (
    <section className="relative py-32 bg-ai-graphite-950 overflow-hidden border-t border-ai-graphite-900/70">
      <div className="absolute inset-0 opacity-30">
        <div className="absolute top-1/2 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-ai-blue-500/25 to-transparent transform -translate-y-1/2 hidden md:block" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl md:text-5xl font-bold text-white mb-5 tracking-tight">
            What PatentNest.ai does that simple tools do not
          </h2>
          <p className="text-lg text-ai-graphite-400 max-w-3xl mx-auto">
            This is a practical comparison of common tool categories. Capabilities vary by vendor, but these gaps are the
            reason teams switch.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true }}
            className="lg:col-span-7"
          >
            <div className="rounded-2xl border border-ai-graphite-800/60 bg-ai-graphite-900/30 overflow-hidden">
              <div className="overflow-x-auto">
                <div className="min-w-[860px]">
                  <div className="grid grid-cols-12 border-b border-ai-graphite-800/60">
                    <div className="col-span-6 p-5 text-xs uppercase tracking-widest text-ai-graphite-500 font-mono">
                      Capability
                    </div>
                    <div className="col-span-2 p-5 text-xs uppercase tracking-widest text-ai-blue-300 font-mono text-center">
                      PatentNest.ai
                    </div>
                    <div className="col-span-2 p-5 text-xs uppercase tracking-widest text-ai-graphite-400 font-mono text-center">
                      Typical AI Drafting Tool
                    </div>
                    <div className="col-span-2 p-5 text-xs uppercase tracking-widest text-ai-graphite-400 font-mono text-center">
                      Templates + Manual
                    </div>
                  </div>

                  {rows.map((r, idx) => (
                    <div
                      key={r.label}
                      className={`grid grid-cols-12 ${
                        idx !== rows.length - 1 ? 'border-b border-ai-graphite-800/60' : ''
                      }`}
                    >
                      <div className="col-span-6 p-5">
                        <div className="text-white font-semibold">{r.label}</div>
                        <div className="text-sm text-ai-graphite-400 leading-relaxed mt-1">{r.detail}</div>
                      </div>
                      <div className="col-span-2 p-5 flex items-center justify-center">
                        <Icon v={r.patentnest} />
                      </div>
                      <div className="col-span-2 p-5 flex items-center justify-center">
                        <Icon v={r.typical} />
                      </div>
                      <div className="col-span-2 p-5 flex items-center justify-center">
                        <Icon v={r.templates} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 text-xs text-ai-graphite-500">
              Legend: <span className="text-emerald-300">Yes</span> / <span className="text-amber-300">Partial</span> /{' '}
              <span className="text-rose-300">No</span>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            whileInView={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
            className="lg:col-span-5"
          >
            <div className="rounded-2xl border border-ai-blue-500/20 bg-ai-graphite-900/25 overflow-hidden">
              <div className="p-6 border-b border-ai-graphite-800/60">
                <div className="text-white font-semibold text-lg">Evidence, visualized</div>
                <div className="text-sm text-ai-graphite-400 mt-1">
                  Instead of vague summaries, you get a map that shows what each reference actually contains.
                </div>
              </div>
              <img
                src="/illustrations/feature-map.svg"
                alt="Feature mapping preview"
                className="w-full h-auto"
                loading="lazy"
              />
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
