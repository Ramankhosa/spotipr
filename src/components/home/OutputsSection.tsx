'use client'

import { motion } from 'framer-motion'
import { ArrowRight, FileText, ScanSearch, Layers, CheckCircle2 } from 'lucide-react'
import Link from 'next/link'

const deliverables = [
  {
    title: 'Draft + Claims',
    description: 'Structured sections with consistent terminology, numbering, and cross-references.',
    icon: FileText,
  },
  {
    title: 'Novelty Evidence Map',
    description: 'Feature-level present/partial/absent mapping against selected prior art with evidence excerpts.',
    icon: ScanSearch,
  },
  {
    title: 'Figures + Captions',
    description: 'A figure plan that stays aligned with your specification as you iterate.',
    icon: Layers,
  },
  {
    title: 'Validation Report',
    description: 'Post-generation checks for claims, figures, numerals, and section discipline (non-blocking).',
    icon: CheckCircle2,
  },
]

export default function OutputsSection() {
  return (
    <section className="relative py-32 bg-ai-graphite-950 overflow-hidden border-t border-ai-graphite-900/70">
      <div className="absolute inset-0 bg-[url('/grid-pattern.svg')] opacity-[0.03]" />
      <div className="absolute -left-20 top-24 w-96 h-96 bg-ai-blue-900/10 rounded-full blur-[120px]" />
      <div className="absolute -right-28 bottom-16 w-[520px] h-[520px] bg-lamp-900/10 rounded-full blur-[140px]" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
            viewport={{ once: true }}
            className="lg:col-span-6"
          >
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-ai-blue-500/30 bg-ai-blue-900/20 backdrop-blur-md text-xs font-mono tracking-widest uppercase text-ai-blue-200 mb-6">
              Outputs, Not Promises
            </div>

            <h2 className="text-3xl md:text-5xl font-bold text-white tracking-tight mb-6">
              Every run ships a filing-ready pack
            </h2>
            <p className="text-lg md:text-xl text-ai-graphite-300 leading-relaxed mb-10">
              Most tools generate text. PatentNest.ai produces an integrated output set: draft sections, novelty evidence,
              figures planning, and validation feedback that keeps everything consistent as you iterate.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {deliverables.map((d, i) => (
                <motion.div
                  key={d.title}
                  initial={{ opacity: 0, y: 18 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: i * 0.08 }}
                  viewport={{ once: true }}
                  className="group rounded-2xl bg-ai-graphite-900/40 border border-ai-graphite-800/60 p-5 hover:border-ai-blue-500/30 hover:bg-ai-graphite-800/40 transition-colors"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-xl bg-ai-blue-900/20 border border-ai-blue-500/25 flex items-center justify-center shrink-0">
                      <d.icon className="w-5 h-5 text-ai-blue-300" />
                    </div>
                    <div>
                      <div className="text-white font-semibold mb-1">{d.title}</div>
                      <div className="text-sm text-ai-graphite-400 leading-relaxed">{d.description}</div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>

            <div className="mt-10 flex flex-col sm:flex-row gap-4 items-center">
              <Link href="/register" className="group w-full sm:w-auto">
                <span className="flex items-center justify-center gap-2 px-7 py-3 rounded-lg bg-ai-blue-500/20 border border-ai-blue-400/60 text-white text-sm font-medium hover:bg-ai-blue-500/30 transition-colors">
                  See It In Action
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </span>
              </Link>
              <p className="text-xs text-ai-graphite-500 leading-relaxed text-center sm:text-left">
                Not legal advice. Built to support attorney review and fast iteration.
              </p>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            whileInView={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
            className="lg:col-span-6"
          >
            <div className="relative rounded-2xl border border-ai-blue-500/20 bg-ai-graphite-900/30 overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-ai-blue-500/10 to-transparent" />
              <img
                src="/illustrations/output-pack.svg"
                alt="Output pack preview"
                className="relative w-full h-auto"
                loading="lazy"
              />
            </div>
          </motion.div>
        </div>

        <div className="mt-12">
          <div className="relative rounded-2xl border border-ai-graphite-800/60 bg-ai-graphite-900/25 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-ai-blue-500/10 via-transparent to-lamp-500/10" />
            <img
              src="/illustrations/patentnest-pipeline.svg"
              alt="Pipeline overview"
              className="relative w-full h-auto"
              loading="lazy"
            />
          </div>
        </div>
      </div>
    </section>
  )
}

