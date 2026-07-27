'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Lightbulb,
  Search,
  Download,
  Star,
  CheckCircle2,
  XCircle,
  ArrowRight,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Loader2,
  Maximize2,
  Minimize2,
  Copy,
  Check,
  FileText,
  Scale,
  AlertTriangle,
  Trash2,
  CheckSquare,
  Square,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

// Preliminary Novelty Assessment (LLM-only, NO prior art per SRS)
interface NoveltyAssessment {
  originalityStrength: 'HIGH' | 'MEDIUM' | 'LOW'
  noveltyRiskLevel: 'LOW' | 'MODERATE' | 'HIGH'
  likelyExaminerObjection: string
  redundancyRisk: string
  strongestNovelAspect: string
  weakestNovelAspect: string
  improvementDirections: string[]
}

// IdeaFrame per SRS Section 5 - mechanism-pure ideas
interface IdeaFrame {
  id: string
  status: string
  userRating?: number
  // Core mechanism-pure fields (SRS Section 3.6)
  coreMechanism: string
  inventiveLeap: string
  eliminatedAssumption: string
  contradictionResolved: string
  whyNotObvious: string
  mechanismBoundaryTest?: {
    whatItDoesNotSolve: string
    outOfScope?: string  // Legacy field for backward compatibility
    failureByDesign?: string  // New field: scenario where invention intentionally fails
  }
  // Preliminary novelty assessment (LLM-only, NO prior art search)
  noveltyAssessment?: NoveltyAssessment
  // Legacy compatibility
  title?: string
  data?: any
}

interface FeedbackLoopResult {
  ideaId: string
  iteration: number
  originalNovelty: number
  finalNovelty: number
  improved: boolean
  mutationApplied?: string
}

interface FeedbackLoopResults {
  enabled: boolean
  iterations: FeedbackLoopResult[]
  lowNoveltyCount: number
  totalChecked: number
}

interface QualityMetrics {
  ideasWithInventiveLeap: number
  ideasWithAnalogy: number
  inventiveLeapRatio: number
  analogyRatio: number
}

interface IdeaFramePanelProps {
  ideas: IdeaFrame[]
  onSelectIdea: (idea: IdeaFrame) => void
  onRunNoveltySearch: (ideaId: string) => void
  onExport: (ideaIds: string[], selectedSuggestions?: Record<string, string[]>) => void
  onClose: () => void
  onDeleteIdea?: (ideaId: string) => void
  feedbackLoopResults?: FeedbackLoopResults | null
  qualityMetrics?: QualityMetrics | null
}

// Professional subtle color helpers
const getOriginalityIndicator = (strength?: string) => {
  if (!strength) return { bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-400' }
  if (strength === 'HIGH') return { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' }
  if (strength === 'MEDIUM') return { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' }
  return { bg: 'bg-rose-50', text: 'text-rose-700', dot: 'bg-rose-500' }
}

const getRiskIndicator = (risk?: string) => {
  if (!risk) return { bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-400' }
  if (risk === 'LOW') return { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' }
  if (risk === 'MODERATE') return { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' }
  return { bg: 'bg-rose-50', text: 'text-rose-700', dot: 'bg-rose-500' }
}

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'SHORTLISTED':
      return <CheckCircle2 className="w-4 h-4 text-emerald-500" />
    case 'REJECTED':
      return <XCircle className="w-4 h-4 text-rose-500" />
    case 'EXPORTED':
      return <ExternalLink className="w-4 h-4 text-lamp-500" />
    default:
      return <Lightbulb className="w-4 h-4 text-slate-400" />
  }
}

// Fullscreen Modal Component
interface FullscreenIdeaModalProps {
  idea: IdeaFrame
  onClose: () => void
  onCopy: (idea: IdeaFrame) => void
  copied: boolean
  onRunNoveltySearch: (ideaId: string) => void
  runningNoveltySearch: string | null
  onToggleExport: (ideaId: string) => void
  isSelectedForExport: boolean
  selectedSuggestions: Set<string>
  onToggleSuggestion: (suggestion: string) => void
}

function FullscreenIdeaModal({
  idea,
  onClose,
  onCopy,
  copied,
  onRunNoveltySearch,
  runningNoveltySearch,
  onToggleExport,
  isSelectedForExport,
  selectedSuggestions,
  onToggleSuggestion,
}: FullscreenIdeaModalProps) {
  const originalityStyle = getOriginalityIndicator(idea.noveltyAssessment?.originalityStrength)
  const riskStyle = getRiskIndicator(idea.noveltyAssessment?.noveltyRiskLevel)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 md:p-8"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header - Professional subtle design */}
        <div className="p-5 md:p-6 border-b border-slate-200 bg-slate-50 flex-shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                {getStatusIcon(idea.status)}
                <h2 className="text-lg md:text-xl font-semibold text-slate-900 line-clamp-2">
                  {idea.coreMechanism || idea.title || 'Mechanism-based Idea'}
                </h2>
              </div>
              {idea.noveltyAssessment && (
                <div className="flex flex-wrap items-center gap-3 mt-2">
                  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md ${originalityStyle.bg}`}>
                    <div className={`w-2 h-2 rounded-full ${originalityStyle.dot}`} />
                    <span className={`text-xs font-medium ${originalityStyle.text}`}>
                      {idea.noveltyAssessment.originalityStrength} Originality
                    </span>
                  </div>
                  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md ${riskStyle.bg}`}>
                    <div className={`w-2 h-2 rounded-full ${riskStyle.dot}`} />
                    <span className={`text-xs font-medium ${riskStyle.text}`}>
                      {idea.noveltyAssessment.noveltyRiskLevel} Risk
                    </span>
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  onCopy(idea)
                }}
                className="hidden md:flex text-slate-600 border-slate-300 hover:bg-slate-100"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 mr-1 text-emerald-500" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 mr-1" />
                    Copy
                  </>
                )}
              </Button>
              <button
                onClick={onClose}
                className="p-2 hover:bg-slate-200 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
          </div>
        </div>

        {/* Modal Content - Clean, professional layout */}
        <div className="flex-1 overflow-auto p-5 md:p-6">
          <div className="grid gap-5">
            {/* Core Mechanism */}
            <section>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Core Mechanism
              </h3>
              <p className="text-sm md:text-base text-slate-800 leading-relaxed bg-slate-50 p-4 rounded-lg border border-slate-200">
                {idea.coreMechanism}
              </p>
            </section>

            {/* Inventive Leap */}
            <section>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Inventive Leap
              </h3>
              <p className="text-sm md:text-base text-slate-800 leading-relaxed bg-slate-50 p-4 rounded-lg border border-slate-200">
                {idea.inventiveLeap}
              </p>
            </section>

            {/* Two Column Layout for Secondary Fields */}
            <div className="grid md:grid-cols-2 gap-4">
              {/* Eliminated Assumption */}
              <section>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  Eliminated Assumption
                </h3>
                <p className="text-sm text-slate-700 leading-relaxed p-3 bg-slate-50 rounded-lg border border-slate-200">
                  {idea.eliminatedAssumption || 'Not specified'}
                </p>
              </section>

              {/* Contradiction Resolved */}
              {idea.contradictionResolved && (
                <section>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    Contradiction Resolved
                  </h3>
                  <p className="text-sm text-slate-700 leading-relaxed p-3 bg-slate-50 rounded-lg border border-slate-200">
                    {idea.contradictionResolved}
                  </p>
                </section>
              )}
            </div>

            {/* Why Not Obvious */}
            <section>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Why This Is Non-Obvious
              </h3>
              <p className="text-sm md:text-base text-slate-800 leading-relaxed bg-emerald-50/50 p-4 rounded-lg border border-emerald-100">
                {idea.whyNotObvious}
              </p>
            </section>

            {/* Mechanism Boundaries */}
            {idea.mechanismBoundaryTest && (
              <section className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                  Mechanism Boundaries
                </h3>
                <div className="grid md:grid-cols-2 gap-3">
                  <div>
                    <span className="text-xs font-medium text-slate-600 block mb-1">Does NOT Solve:</span>
                    <p className="text-sm text-slate-700">{idea.mechanismBoundaryTest.whatItDoesNotSolve}</p>
                  </div>
                  {/* Support both legacy (outOfScope) and new (failureByDesign) fields */}
                  {(idea.mechanismBoundaryTest.failureByDesign || idea.mechanismBoundaryTest.outOfScope) && (
                    <div>
                      <span className="text-xs font-medium text-slate-600 block mb-1">
                        {idea.mechanismBoundaryTest.failureByDesign ? 'Failure by Design:' : 'Out of Scope:'}
                      </span>
                      <p className="text-sm text-slate-700">
                        {idea.mechanismBoundaryTest.failureByDesign || idea.mechanismBoundaryTest.outOfScope}
                      </p>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Novelty Assessment Section */}
            {idea.noveltyAssessment && (
              <section className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
                  <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <Scale className="w-4 h-4 text-slate-500" />
                    Preliminary Novelty Assessment
                  </h3>
                </div>
                
                <div className="p-4 space-y-4">
                  {/* Assessment Summary */}
                  <div className="grid md:grid-cols-2 gap-3">
                    {idea.noveltyAssessment.strongestNovelAspect && (
                      <div className="p-3 bg-emerald-50/50 rounded-lg border border-emerald-100">
                        <span className="text-xs font-semibold text-emerald-700 block mb-1">Strongest Aspect</span>
                        <p className="text-sm text-slate-700">{idea.noveltyAssessment.strongestNovelAspect}</p>
                      </div>
                    )}
                    {idea.noveltyAssessment.weakestNovelAspect && (
                      <div className="p-3 bg-amber-50/50 rounded-lg border border-amber-100">
                        <span className="text-xs font-semibold text-amber-700 block mb-1">Area for Improvement</span>
                        <p className="text-sm text-slate-700">{idea.noveltyAssessment.weakestNovelAspect}</p>
                      </div>
                    )}
                  </div>

                  {/* Examiner Objection */}
                  {idea.noveltyAssessment.likelyExaminerObjection && (
                    <div className="p-3 bg-rose-50/50 rounded-lg border border-rose-100">
                      <span className="text-xs font-semibold text-rose-700 block mb-1">Likely Examiner Objection</span>
                      <p className="text-sm text-slate-700">{idea.noveltyAssessment.likelyExaminerObjection}</p>
                    </div>
                  )}

                  {/* Redundancy Risk */}
                  {idea.noveltyAssessment.redundancyRisk && (
                    <div className="text-sm text-slate-600">
                      <span className="font-medium">Redundancy Risk:</span> {idea.noveltyAssessment.redundancyRisk}
                    </div>
                  )}

                  {/* Improvement Directions - Selectable */}
                  {idea.noveltyAssessment.improvementDirections && idea.noveltyAssessment.improvementDirections.length > 0 && (
                    <div className="border-t border-slate-200 pt-4 mt-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-lamp-500" />
                          Holistic Improvement Directions
                        </h4>
                        <span className="text-xs text-slate-500">
                          {selectedSuggestions.size} selected
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mb-3">
                        Select suggestions to include when exporting to Idea Bank
                      </p>
                      <div className="space-y-2">
                        {idea.noveltyAssessment.improvementDirections.map((direction, i) => (
                          <button
                            key={i}
                            onClick={() => onToggleSuggestion(direction)}
                            className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-all ${
                              selectedSuggestions.has(direction)
                                ? 'bg-lamp-50 border-lamp-200'
                                : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                            }`}
                          >
                            <div className={`flex-shrink-0 w-5 h-5 rounded border flex items-center justify-center mt-0.5 ${
                              selectedSuggestions.has(direction)
                                ? 'bg-lamp-500 border-lamp-500'
                                : 'border-slate-300'
                            }`}>
                              {selectedSuggestions.has(direction) && (
                                <Check className="w-3 h-3 text-white" />
                              )}
                            </div>
                            <span className="text-sm text-slate-700 leading-relaxed">{direction}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Disclaimer */}
                  <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 mt-4">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-800">
                        This is a preliminary novelty assessment. Perform exhaustive prior-art search before filing.
                      </p>
                    </div>
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 md:p-5 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row gap-3 flex-shrink-0">
          <Button
            variant="outline"
            onClick={() => onRunNoveltySearch(idea.id)}
            disabled={runningNoveltySearch === idea.id}
            className="flex-1 border-slate-300"
          >
            {runningNoveltySearch === idea.id ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Opening search...
              </>
            ) : (
              <>
                <Search className="w-4 h-4 mr-2" />
                Run Novelty Search
              </>
            )}
          </Button>
          <Button
            onClick={() => {
              onToggleExport(idea.id)
              onClose()
            }}
            className="flex-1 bg-slate-800 hover:bg-slate-900 text-white"
          >
            <Download className="w-4 h-4 mr-2" />
            {isSelectedForExport ? 'Remove from Export' : 'Add to Export'}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}

export default function IdeaFramePanel({
  ideas,
  onSelectIdea,
  onRunNoveltySearch,
  onExport,
  onClose,
  onDeleteIdea,
  feedbackLoopResults,
  qualityMetrics,
}: IdeaFramePanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [selectedForExport, setSelectedForExport] = useState<Set<string>>(new Set())
  const [selectedSuggestions, setSelectedSuggestions] = useState<Record<string, Set<string>>>({})
  const [runningNoveltySearch, setRunningNoveltySearch] = useState<string | null>(null)
  const [fullscreenIdea, setFullscreenIdea] = useState<IdeaFrame | null>(null)
  const [copied, setCopied] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  // Check for mobile viewport
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Handle escape key for fullscreen
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && fullscreenIdea) {
        setFullscreenIdea(null)
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [fullscreenIdea])

  // Update fullscreenIdea when ideas prop changes
  useEffect(() => {
    if (fullscreenIdea) {
      const updatedIdea = ideas.find(i => i.id === fullscreenIdea.id)
      if (updatedIdea && updatedIdea.noveltyAssessment && !fullscreenIdea.noveltyAssessment) {
        setFullscreenIdea(updatedIdea)
      }
    }
  }, [ideas])

  const handleRunNoveltySearch = async (ideaId: string) => {
    setRunningNoveltySearch(ideaId)
    await onRunNoveltySearch(ideaId)
    setRunningNoveltySearch(null)
  }

  const toggleExportSelection = (ideaId: string) => {
    setSelectedForExport(prev => {
      const next = new Set(prev)
      if (next.has(ideaId)) {
        next.delete(ideaId)
      } else {
        next.add(ideaId)
      }
      return next
    })
  }

  const toggleSuggestion = (ideaId: string, suggestion: string) => {
    setSelectedSuggestions(prev => {
      const ideaSuggestions = prev[ideaId] || new Set<string>()
      const next = new Set(ideaSuggestions)
      if (next.has(suggestion)) {
        next.delete(suggestion)
      } else {
        next.add(suggestion)
      }
      return { ...prev, [ideaId]: next }
    })
  }

  const handleExport = () => {
    if (selectedForExport.size > 0) {
      // Convert selected suggestions to record format
      const suggestions: Record<string, string[]> = {}
      selectedForExport.forEach(ideaId => {
        const ideaSuggestions = selectedSuggestions[ideaId]
        if (ideaSuggestions && ideaSuggestions.size > 0) {
          suggestions[ideaId] = Array.from(ideaSuggestions)
        }
      })
      onExport(Array.from(selectedForExport), Object.keys(suggestions).length > 0 ? suggestions : undefined)
    }
  }

  // Copy to clipboard handler
  const handleCopyToClipboard = async (idea: IdeaFrame) => {
    const suggestionsList = selectedSuggestions[idea.id]
    const text = `
Core Mechanism: ${idea.coreMechanism}

Inventive Leap: ${idea.inventiveLeap}

Eliminated Assumption: ${idea.eliminatedAssumption || 'Not specified'}

${idea.contradictionResolved ? `Contradiction Resolved: ${idea.contradictionResolved}` : ''}

Why Non-Obvious: ${idea.whyNotObvious}

${idea.mechanismBoundaryTest ? `
Boundaries:
- Does NOT solve: ${idea.mechanismBoundaryTest.whatItDoesNotSolve}
${idea.mechanismBoundaryTest.failureByDesign ? `- Failure by design: ${idea.mechanismBoundaryTest.failureByDesign}` : ''}${idea.mechanismBoundaryTest.outOfScope ? `- Out of scope: ${idea.mechanismBoundaryTest.outOfScope}` : ''}
` : ''}

${idea.noveltyAssessment ? `
Preliminary Assessment:
- Originality: ${idea.noveltyAssessment.originalityStrength}
- Risk Level: ${idea.noveltyAssessment.noveltyRiskLevel}
- Strongest Aspect: ${idea.noveltyAssessment.strongestNovelAspect}
- Area for Improvement: ${idea.noveltyAssessment.weakestNovelAspect}
- Examiner Objection: ${idea.noveltyAssessment.likelyExaminerObjection}
${suggestionsList && suggestionsList.size > 0 ? `
Selected Improvements:
${Array.from(suggestionsList).map(s => `• ${s}`).join('\n')}
` : ''}

⚠️ Preliminary assessment only. Perform prior-art search before filing.
` : ''}
    `.trim()

    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      {/* Fullscreen Modal */}
      <AnimatePresence>
        {fullscreenIdea && (
          <FullscreenIdeaModal
            idea={fullscreenIdea}
            onClose={() => setFullscreenIdea(null)}
            onCopy={handleCopyToClipboard}
            copied={copied}
            onRunNoveltySearch={handleRunNoveltySearch}
            runningNoveltySearch={runningNoveltySearch}
            onToggleExport={toggleExportSelection}
            isSelectedForExport={selectedForExport.has(fullscreenIdea.id)}
            selectedSuggestions={selectedSuggestions[fullscreenIdea.id] || new Set()}
            onToggleSuggestion={(suggestion) => toggleSuggestion(fullscreenIdea.id, suggestion)}
          />
        )}
      </AnimatePresence>

      <div className="flex flex-col h-full bg-white">
        {/* Header - Professional subtle design */}
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold text-slate-800 flex items-center gap-2 text-sm">
              <FileText className="w-4 h-4 text-slate-500" />
              Generated Ideas
              <span className="text-slate-400 font-normal">({ideas.length})</span>
            </h3>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-slate-200 rounded-md transition-colors"
            >
              <X className="w-4 h-4 text-slate-500" />
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Click to expand • Double-click for full view
          </p>

          {/* Quality Metrics */}
          {qualityMetrics && (
            <div className="mt-3 flex gap-4">
              <div className="text-xs">
                <span className="text-slate-500">Inventive Leap:</span>{' '}
                <span className="font-medium text-slate-700">{Math.round(qualityMetrics.inventiveLeapRatio * 100)}%</span>
              </div>
              <div className="text-xs">
                <span className="text-slate-500">Cross-Domain:</span>{' '}
                <span className="font-medium text-slate-700">{Math.round(qualityMetrics.analogyRatio * 100)}%</span>
              </div>
            </div>
          )}
        </div>

        {/* Ideas List */}
        <div className="flex-1 overflow-auto">
          {ideas.map((idea, index) => {
            const originalityStyle = getOriginalityIndicator(idea.noveltyAssessment?.originalityStrength)
            const riskStyle = getRiskIndicator(idea.noveltyAssessment?.noveltyRiskLevel)
            
            return (
              <motion.div
                key={idea.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03 }}
                className="border-b border-slate-100"
              >
                {/* Idea Header */}
                <div
                  className={`p-4 cursor-pointer hover:bg-slate-50 transition-colors ${
                    selectedForExport.has(idea.id) ? 'bg-lamp-50/50' : ''
                  }`}
                  onClick={() => setExpandedId(expandedId === idea.id ? null : idea.id)}
                  onDoubleClick={() => setFullscreenIdea(idea)}
                >
                  <div className="flex items-start gap-3">
                    {/* Selection Checkbox */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleExportSelection(idea.id)
                      }}
                      className={`flex-shrink-0 w-5 h-5 rounded border flex items-center justify-center mt-0.5 transition-colors ${
                        selectedForExport.has(idea.id)
                          ? 'bg-slate-800 border-slate-800'
                          : 'border-slate-300 hover:border-slate-400'
                      }`}
                    >
                      {selectedForExport.has(idea.id) && (
                        <Check className="w-3 h-3 text-white" />
                      )}
                    </button>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {getStatusIcon(idea.status)}
                        <h4 className="font-medium text-slate-800 text-sm line-clamp-1">
                          {idea.coreMechanism || idea.title || 'Mechanism-based Idea'}
                        </h4>
                      </div>
                      <p className="text-xs text-slate-500 line-clamp-2 mb-2">
                        {idea.inventiveLeap}
                      </p>

                      {/* Assessment Indicators */}
                      {idea.noveltyAssessment && (
                        <div className="flex flex-wrap items-center gap-2">
                          <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs ${originalityStyle.bg}`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${originalityStyle.dot}`} />
                            <span className={originalityStyle.text}>{idea.noveltyAssessment.originalityStrength}</span>
                          </div>
                          <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs ${riskStyle.bg}`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${riskStyle.dot}`} />
                            <span className={riskStyle.text}>{idea.noveltyAssessment.noveltyRiskLevel} risk</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setFullscreenIdea(idea)
                        }}
                        className="p-1.5 hover:bg-slate-200 rounded-md transition-colors"
                        title="View fullscreen"
                      >
                        <Maximize2 className="w-4 h-4 text-slate-400" />
                      </button>
                      {onDeleteIdea && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            if (window.confirm('Delete this idea? This cannot be undone.')) {
                              onDeleteIdea(idea.id)
                            }
                          }}
                          className="p-1.5 hover:bg-rose-100 rounded-md transition-colors group"
                          title="Delete idea"
                        >
                          <Trash2 className="w-4 h-4 text-slate-400 group-hover:text-rose-500" />
                        </button>
                      )}
                      <div className="hidden md:block ml-1">
                        {expandedId === idea.id ? (
                          <ChevronUp className="w-4 h-4 text-slate-400" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-slate-400" />
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Expanded Details */}
                <AnimatePresence>
                  {expandedId === idea.id && !isMobile && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4 space-y-3">
                        {/* Eliminated Assumption */}
                        <div>
                          <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                            Eliminated Assumption
                          </label>
                          <p className="text-sm text-slate-700 mt-1">
                            {idea.eliminatedAssumption || 'Not specified'}
                          </p>
                        </div>

                        {/* Why Not Obvious */}
                        <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                          <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                            Why Non-Obvious
                          </label>
                          <p className="text-sm text-slate-700 mt-1">
                            {idea.whyNotObvious}
                          </p>
                        </div>

                        {/* Assessment Summary */}
                        {idea.noveltyAssessment && (
                          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                            <div className="flex items-center justify-between mb-2">
                              <label className="text-xs font-medium text-slate-500 uppercase tracking-wider flex items-center gap-1">
                                <Scale className="w-3 h-3" />
                                Assessment
                              </label>
                              <div className="flex gap-2">
                                <span className={`text-xs px-2 py-0.5 rounded ${originalityStyle.bg} ${originalityStyle.text}`}>
                                  {idea.noveltyAssessment.originalityStrength}
                                </span>
                                <span className={`text-xs px-2 py-0.5 rounded ${riskStyle.bg} ${riskStyle.text}`}>
                                  {idea.noveltyAssessment.noveltyRiskLevel}
                                </span>
                              </div>
                            </div>
                            {idea.noveltyAssessment.strongestNovelAspect && (
                              <p className="text-xs text-slate-600 line-clamp-2">
                                <span className="text-emerald-600 font-medium">✓</span> {idea.noveltyAssessment.strongestNovelAspect}
                              </p>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setFullscreenIdea(idea)
                              }}
                              className="text-xs text-lamp-600 hover:text-lamp-800 mt-2"
                            >
                              View full assessment →
                            </button>
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleRunNoveltySearch(idea.id)
                            }}
                            disabled={runningNoveltySearch === idea.id}
                            className="text-xs border-slate-300"
                          >
                            {runningNoveltySearch === idea.id ? (
                              <>
                                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                Opening...
                              </>
                            ) : (
                              <>
                                <Search className="w-3 h-3 mr-1" />
                                Run Novelty Search
                              </>
                            )}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              setFullscreenIdea(idea)
                            }}
                            className="text-xs border-slate-300"
                          >
                            <Maximize2 className="w-3 h-3 mr-1" />
                            Full View
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Mobile Expand */}
                {expandedId === idea.id && isMobile && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="px-4 pb-4"
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setFullscreenIdea(idea)}
                      className="w-full text-xs border-slate-300"
                    >
                      <Maximize2 className="w-3 h-3 mr-1" />
                      View Full Details
                    </Button>
                  </motion.div>
                )}
              </motion.div>
            )
          })}
        </div>

        {/* Export Footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-slate-500">
              {selectedForExport.size} idea{selectedForExport.size !== 1 ? 's' : ''} selected
            </span>
            {selectedForExport.size > 0 && (
              <button
                onClick={() => setSelectedForExport(new Set())}
                className="text-xs text-slate-600 hover:text-slate-800"
              >
                Clear
              </button>
            )}
          </div>
          <Button
            onClick={handleExport}
            disabled={selectedForExport.size === 0}
            className="w-full bg-slate-800 hover:bg-slate-900 text-white"
          >
            <Download className="w-4 h-4 mr-2" />
            Export to Idea Bank
          </Button>
        </div>
      </div>
    </>
  )
}
