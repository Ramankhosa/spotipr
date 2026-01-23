'use client'

import { motion, useScroll, useTransform } from 'framer-motion'
import { 
  Search, 
  PenTool, 
  Lightbulb, 
  Workflow, 
  Globe, 
  ShieldCheck 
} from 'lucide-react'

const features = [
  {
    title: "Evidence-Backed Novelty Mapping",
    description: "Feature-level coverage (present/partial/absent) with evidence excerpts, so novelty decisions are explainable.",
    icon: Search,
    color: "from-blue-400 to-cyan-400"
  },
  {
    title: "Jurisdiction-Aware Drafting",
    description: "Generate structured sections and claims with prompts, rules, and formatting aligned to how filings are actually reviewed.",
    icon: PenTool,
    color: "from-emerald-400 to-teal-400"
  },
  {
    title: "Idea Bank Funnel",
    description: "Turn prior-art analysis into vetted invention directions, then route the best ideas straight into drafting or search.",
    icon: Lightbulb,
    color: "from-yellow-400 to-amber-400"
  },
  {
    title: "Integrated Figures Workflow",
    description: "Figure planning and generation stays aligned with the draft, keeping descriptions, numerals, and figures in sync.",
    icon: Workflow,
    color: "from-purple-400 to-pink-400"
  },
  {
    title: "Multi-Jurisdiction Ready",
    description: "Create a reference draft and translate sections for target jurisdictions with figure compatibility in mind.",
    icon: Globe,
    color: "from-indigo-400 to-blue-400"
  },
  {
    title: "Post-Generation Validation",
    description: "Non-blocking checks flag claim, figure, numeral, and section issues so iteration gets safer as it gets faster.",
    icon: ShieldCheck,
    color: "from-rose-400 to-red-400"
  }
]

const Card = ({ feature, index }: { feature: typeof features[0], index: number }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }}
      whileInView={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      viewport={{ once: true, margin: "-50px" }}
      className="group relative p-8 rounded-2xl bg-ai-graphite-900/40 border border-ai-graphite-800/50 hover:border-ai-blue-500/30 hover:bg-ai-graphite-800/40 transition-all duration-500 overflow-hidden"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      
      <div className={`inline-flex p-3 rounded-xl bg-gradient-to-br ${feature.color} bg-opacity-10 mb-6`}>
        <feature.icon className="w-6 h-6 text-white" />
      </div>

      <h3 className="text-xl font-semibold text-white mb-3 group-hover:text-ai-blue-200 transition-colors">
        {feature.title}
      </h3>
      
      <p className="text-ai-graphite-300 leading-relaxed">
        {feature.description}
      </p>

      {/* Hover Glow Effect */}
      <div className="absolute -right-12 -bottom-12 w-32 h-32 bg-ai-blue-500/10 rounded-full blur-3xl group-hover:bg-ai-blue-500/20 transition-all duration-500" />
    </motion.div>
  )
}

export default function FeaturesSection() {
  return (
    <section className="relative py-32 bg-ai-graphite-950 overflow-hidden">
      {/* Section Background Elements */}
      <div className="absolute inset-0 bg-[url('/grid-pattern.svg')] opacity-[0.03]" />
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-ai-blue-500/20 to-transparent" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          viewport={{ once: true }}
          className="text-center mb-20"
        >
          <h2 className="text-3xl md:text-5xl font-bold text-white mb-6 tracking-tight">
            Intelligence Unlocked
          </h2>
          <p className="text-lg md:text-xl text-ai-graphite-400 max-w-2xl mx-auto">
            Advanced tools designed for the speed of thought. Engineered to amplify your inventive potential.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
          {features.map((feature, index) => (
            <Card key={index} feature={feature} index={index} />
          ))}
        </div>
      </div>
    </section>
  )
}
