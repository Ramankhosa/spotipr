'use client'

import { motion } from 'framer-motion'
import { Users, CheckCircle, Globe, Shield, Activity } from 'lucide-react'

const stats = [
  { label: "Novelty Evidence", value: "Mapped", icon: Activity, suffix: "By Feature" },
  { label: "Draft Quality", value: "Validated", icon: CheckCircle, suffix: "Post-Gen" },
  { label: "Figures", value: "Planned", icon: Shield, suffix: "Aligned" },
  { label: "Jurisdictions", value: "Ready", icon: Globe, suffix: "Export Pack" },
]

const testimonials = [
  {
    user: "Inventors",
    role: "Solo & first-time filers",
    quote: "Get a structured draft and evidence map without stitching together five different tools."
  },
  {
    user: "Startups",
    role: "Fast iteration, frequent filings",
    quote: "Move from idea to a consistent output pack quickly, then refine with validation feedback."
  },
  {
    user: "Teams & Firms",
    role: "Review workflows and scale",
    quote: "Keep drafting, novelty evidence, and figures aligned across jurisdictions and reviewers."
  }
]

export default function TrustSection() {
  return (
    <section className="relative py-32 bg-ai-graphite-950 border-t border-ai-graphite-800/50 overflow-hidden">
      
      {/* Background Elements */}
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-ai-blue-900/50 to-transparent" />
      <div className="absolute -left-20 top-40 w-96 h-96 bg-ai-blue-900/10 rounded-full blur-[120px]" />
      <div className="absolute -right-20 bottom-40 w-96 h-96 bg-lamp-900/10 rounded-full blur-[120px]" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        
        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-32 border-b border-ai-graphite-800/50 pb-12">
          {stats.map((stat, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1, duration: 0.5 }}
              viewport={{ once: true }}
              className="text-center"
            >
              <div className="flex justify-center mb-4">
                <stat.icon className="w-6 h-6 text-ai-blue-500/60" />
              </div>
              <div className="text-3xl md:text-4xl font-bold text-white mb-2 font-mono tracking-tighter">
                {stat.value}
              </div>
              <div className="text-xs uppercase tracking-widest text-ai-graphite-500">
                {stat.label} {stat.suffix && <span className="text-ai-blue-500/80 ml-1">{stat.suffix}</span>}
              </div>
            </motion.div>
          ))}
        </div>

        {/* Testimonials */}
        <div className="mb-20">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-white mb-4">Confidence, Built In</h2>
            <p className="text-ai-graphite-400">Designed to produce outputs that are easier to review, defend, and ship.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {testimonials.map((t, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.2, duration: 0.5 }}
                viewport={{ once: true }}
                className="bg-ai-graphite-900/30 border border-ai-graphite-800/50 p-8 rounded-2xl backdrop-blur-sm hover:bg-ai-graphite-800/50 transition-colors"
              >
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-ai-blue-500 to-lamp-600 opacity-80" />
                  <div>
                    <div className="text-white font-medium">{t.user}</div>
                    <div className="text-xs text-ai-blue-400 uppercase tracking-wide">{t.role}</div>
                  </div>
                </div>
                <p className="text-ai-graphite-300 leading-relaxed italic">
                  "{t.quote}"
                </p>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="mt-10 text-center text-xs text-ai-graphite-500 font-mono uppercase tracking-widest">
          Output pack: Draft + Claims + Evidence Map + Figures + Validation
        </div>

      </div>
    </section>
  )
}
