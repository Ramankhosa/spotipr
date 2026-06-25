'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Lightbulb, Database, Sparkles, ArrowRight, Home, ChevronLeft, Search } from 'lucide-react'
import IdeaBankDashboard from './IdeaBankDashboard'
import IdeationWorkspace from './ideation/IdeationWorkspace'
import NoveltySearchSubmission from '@/components/novelty-search/NoveltySearchSubmission'

type TabType = 'ideation' | 'novelty' | 'repository'

type NoveltyPrefill = {
  title: string
  description: string
  sourceMetadata?: {
    source: string
    sessionId?: string
    ideaFrameId?: string
    ideaId?: string
    [key: string]: unknown
  }
}

export default function IdeaHubPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<TabType>('ideation')
  const [noveltyPrefill, setNoveltyPrefill] = useState<NoveltyPrefill | null>(null)

  const tabs = [
    {
      id: 'ideation' as const,
      label: 'Ideation',
      icon: Sparkles,
      description: 'Generate patent ideas with AI-powered mind mapping',
      gradient: 'from-violet-500 to-purple-600',
      bgGradient: 'from-violet-500/10 to-purple-600/10',
    },
    {
      id: 'novelty' as const,
      label: 'Novelty',
      icon: Search,
      description: 'Review search terms and run the novelty pipeline',
      gradient: 'from-cyan-500 to-blue-600',
      bgGradient: 'from-cyan-500/10 to-blue-600/10',
    },
  ]

  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-br from-slate-50 via-white to-slate-100 overflow-hidden">
      {/* Header with Tab Navigation */}
      <div className="sticky top-0 z-40 backdrop-blur-xl bg-white/90 border-b border-slate-200/50 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-3">
          <div className="flex items-center justify-between">
            {/* Back to Home + Logo/Title */}
            <div className="flex items-center gap-4">
              {/* Back to Home Button */}
              <button
                onClick={() => router.push('/')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-all group"
                title="Back to Home"
              >
                <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
                <Home className="w-4 h-4" />
                <span className="text-sm font-medium hidden sm:inline">Home</span>
              </button>
              
              <div className="h-6 w-px bg-slate-200" />
              
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="absolute inset-0 bg-gradient-to-r from-violet-500 to-cyan-500 rounded-xl blur-lg opacity-40" />
                  <div className="relative bg-gradient-to-r from-violet-500 to-cyan-500 p-2 rounded-xl">
                    <Lightbulb className="w-5 h-5 text-white" />
                  </div>
                </div>
                <div>
                  <h1 className="text-lg font-bold text-slate-900 tracking-tight">
                    Idea Hub
                  </h1>
                  <p className="text-[10px] text-slate-500 font-medium -mt-0.5">
                    PatentNest Intelligence
                  </p>
                </div>
              </div>
            </div>

            {/* Tab Navigation */}
            <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl">
              {tabs.map((tab) => {
                const Icon = tab.icon
                const isActive = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`
                      relative flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm
                      transition-all duration-200 ease-out
                      ${isActive 
                        ? 'text-white shadow-lg' 
                        : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                      }
                    `}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="activeTab"
                        className={`absolute inset-0 bg-gradient-to-r ${tab.gradient} rounded-lg`}
                        transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
                      />
                    )}
                    <Icon className={`w-4 h-4 relative z-10 ${isActive ? 'text-white' : ''}`} />
                    <span className="relative z-10 hidden sm:inline">{tab.label}</span>
                  </button>
                )
              })}
            </div>

            {/* Quick Actions */}
            <div className="flex items-center gap-3">
              {activeTab === 'ideation' && (
                <button
                  onClick={() => setActiveTab('repository')}
                  className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 transition-colors"
                >
                  <Database className="w-4 h-4" />
                  <span className="hidden sm:inline">Repository</span>
                </button>
              )}
              {activeTab === 'repository' && (
                <button
                  onClick={() => setActiveTab('ideation')}
                  className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 transition-colors"
                >
                  <span className="hidden sm:inline">Back to Ideation</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tab Content - Full height with scroll */}
      <div className="h-[calc(100vh-65px)] overflow-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="min-h-full"
          >
            {activeTab === 'ideation' ? (
              <IdeationWorkspace
                onExportToBank={() => setActiveTab('repository')}
                onRunNoveltySearch={(input) => {
                  setNoveltyPrefill(input)
                  setActiveTab('novelty')
                }}
              />
            ) : activeTab === 'novelty' ? (
              <NoveltySearchSubmission
                key={`${noveltyPrefill?.sourceMetadata?.source || 'manual'}-${noveltyPrefill?.sourceMetadata?.ideaFrameId || noveltyPrefill?.sourceMetadata?.ideaId || 'new'}`}
                initialTitle={noveltyPrefill?.title}
                initialDescription={noveltyPrefill?.description}
                sourceMetadata={noveltyPrefill?.sourceMetadata}
              />
            ) : (
              <div className="p-8">
                <IdeaBankDashboard />
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
