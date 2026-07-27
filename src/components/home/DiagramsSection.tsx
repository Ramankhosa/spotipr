'use client'

import Link from 'next/link'
import Image from 'next/image'
import { motion } from 'framer-motion'
import { ArrowRight, PenTool, Hash, Layers } from 'lucide-react'

const sampleOutputs = [
  { src: '/images/BlockDiagram.svg', alt: 'Block diagram output example', label: 'Block Diagram' },
  { src: '/images/Activity.svg', alt: 'Activity diagram output example', label: 'Activity Diagram' },
  { src: '/images/Sketch.svg', alt: 'Sketch output example', label: 'Sketch' },
]

const highlights = [
  {
    title: 'Automatic, specification-linked sketches',
    description: 'Generated automatically from rough drafts or CAD/CAM inputs, then kept aligned with your spec as it evolves.',
    icon: PenTool,
  },
  {
    title: 'Component-aware numbering',
    description: 'Figure callouts follow the same component numerals referenced across the specification.',
    icon: Hash,
  },
  {
    title: 'Invention-adaptive diagram selection',
    description: 'The system suggests the best figure set, then adapts diagram and sketch styles as invention context changes.',
    icon: Layers,
  },
]

export default function DiagramsSection() {
  return (
    <section className="relative py-32 bg-ai-graphite-950 overflow-hidden border-t border-ai-graphite-900/70">
      <div className="absolute inset-0 bg-[url('/grid-pattern.svg')] opacity-[0.03]" />
      <div className="absolute top-20 right-0 w-[520px] h-[520px] bg-ai-blue-900/12 rounded-full blur-[140px]" />
      <div className="absolute -left-32 bottom-0 w-[520px] h-[520px] bg-lamp-900/10 rounded-full blur-[160px]" />

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
              Diagrams + Sketches
            </div>

            <h2 className="text-3xl md:text-5xl font-bold text-white tracking-tight mb-6">
              <span className="text-amber-200 bg-amber-500/10 border border-amber-400/20 rounded px-2 py-0.5">
                Automatic
              </span>{' '}
              sketches and diagrams, built for patents
            </h2>

            <p className="text-lg md:text-xl text-ai-graphite-300 leading-relaxed mb-10">
              PatentNest.ai turns rough drafts into clean, numbered figures. Upload a hand sketch or existing{' '}
              <span className="text-amber-200 bg-amber-500/10 border border-amber-400/20 rounded px-2 py-0.5">
                CAD/CAM diagram
              </span>{' '}
              and generate patent-ready visuals that stay aligned with your specification and component references.
            </p>

            <div className="space-y-4">
              {highlights.map((h, i) => (
                <motion.div
                  key={h.title}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: i * 0.08 }}
                  viewport={{ once: true }}
                  className="flex gap-4 rounded-2xl bg-ai-graphite-900/35 border border-ai-graphite-800/60 p-5 hover:border-ai-blue-500/30 hover:bg-ai-graphite-800/40 transition-colors"
                >
                  <div className="w-10 h-10 rounded-xl bg-ai-blue-900/20 border border-ai-blue-500/25 flex items-center justify-center shrink-0">
                    <h.icon className="w-5 h-5 text-ai-blue-300" />
                  </div>
                  <div>
                    <div className="text-white font-semibold">{h.title}</div>
                    <div className="text-sm text-ai-graphite-400 leading-relaxed mt-1">{h.description}</div>
                  </div>
                </motion.div>
              ))}
            </div>

            <div className="mt-6 rounded-2xl border border-amber-400/20 bg-amber-500/5 px-5 py-4">
              <div className="text-sm text-amber-200 font-semibold">Guided figure planning</div>
              <div className="text-sm text-ai-graphite-300 mt-1 leading-relaxed">
                First, the system suggests the most appropriate diagram types for your invention (block diagrams,
                flowcharts, activity diagrams, and sketches). Then it generates and adapts the figure style automatically
                as you refine the invention.
              </div>
            </div>

            <div className="mt-10">
              <Link href="/register" className="group inline-flex">
                <span className="flex items-center justify-center gap-2 px-7 py-3 rounded-lg bg-ai-blue-500/20 border border-ai-blue-400/60 text-white text-sm font-medium hover:bg-ai-blue-500/30 transition-colors">
                  Generate Figures
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </span>
              </Link>
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
              <div className="relative w-full aspect-[16/9] bg-white">
                <Image
                  src="/images/Sketch.svg"
                  alt="Hand sketch converted into a patent-ready figure"
                  fill
                  sizes="(min-width: 1024px) 50vw, 100vw"
                  quality={100}
                  className="object-contain"
                />
              </div>
              <div className="px-5 py-4 border-t border-ai-graphite-800/60">
                <div className="text-white font-semibold">
                  <span className="text-amber-200 bg-amber-500/10 border border-amber-400/20 rounded px-2 py-0.5">
                    Rough input
                  </span>{' '}
                  -&gt;{' '}
                  <span className="text-amber-200 bg-amber-500/10 border border-amber-400/20 rounded px-2 py-0.5">
                    patent-ready figure
                  </span>
                </div>
                <div className="text-sm text-ai-graphite-400 mt-1">
                  Automatic cleanup, numbering, and callouts that match your spec.
                </div>
              </div>
            </div>

            <div className="mt-6">
              <div className="text-sm text-ai-graphite-300 mb-3">
                <span className="text-amber-200 bg-amber-500/10 border border-amber-400/20 rounded px-2 py-0.5">
                  Example outputs
                </span>{' '}
                (scroll)
              </div>

              <div className="overflow-x-auto pb-3 -mx-2 px-2">
                <div className="flex gap-4 snap-x snap-mandatory">
                  {sampleOutputs.map((s) => (
                    <div
                      key={s.label}
                      className="snap-start shrink-0 w-[85%] sm:w-[360px] rounded-2xl overflow-hidden border border-ai-graphite-800/60 bg-ai-graphite-900/30"
                    >
                      <div className="relative w-full aspect-[4/3] bg-white">
                        <Image
                          src={s.src}
                          alt={s.alt}
                          fill
                          sizes="(min-width: 1024px) 360px, 85vw"
                          quality={100}
                          className="object-contain"
                        />
                      </div>
                      <div className="px-4 py-3 border-t border-ai-graphite-800/60">
                        <div className="text-white font-semibold">{s.label}</div>
                        <div className="text-xs text-ai-graphite-500 mt-0.5">Patent-ready diagram outputs</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 text-xs text-ai-graphite-500 leading-relaxed">
                Tip: add figures early. Keeping numerals and figure references consistent is one of the fastest ways to
                make a draft feel attorney-grade.
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
