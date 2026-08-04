'use client'

import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Lightbulb,
  Search,
  Download,
  CheckCircle2,
  XCircle,
  ExternalLink,
  ChevronDown,
  Loader2,
  Maximize2,
  Copy,
  Check,
  Scale,
  AlertTriangle,
  Trash2,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Hint } from '@/components/ui/hint'

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

// Plain-language labels. The raw enum ("HIGH") means nothing on its own — every
// badge says what the value is *about*, and pairs colour with a word so colour
// is never the only signal.
const ORIGINALITY_LABEL: Record<string, string> = {
  HIGH: 'Highly original',
  MEDIUM: 'Moderately original',
  LOW: 'Close to known art',
}

const RISK_LABEL: Record<string, string> = {
  LOW: 'Low novelty risk',
  MODERATE: 'Moderate novelty risk',
  HIGH: 'High novelty risk',
}

const BADGE_LEGEND =
  'Originality is how far the idea departs from what already exists. Novelty risk is how likely ' +
  'an examiner is to find something similar. Both come from a first-pass read of the idea itself — ' +
  'run a novelty search to check it against real patents.'

// Plain-language captions for the patent vocabulary used in each idea.
const FIELD_HELP = {
  coreMechanism: 'The physical or logical thing that actually does the work.',
  inventiveLeap: 'What makes this different from the obvious solution.',
  eliminatedAssumption: 'The constraint everyone else takes for granted, that this idea drops.',
  contradictionResolved: 'The trade-off this idea escapes instead of balancing.',
  whyNotObvious: 'The argument you would make to an examiner who says "anyone would do this".',
  boundaries: 'What this idea deliberately does not cover — useful when drafting claims.',
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
      return <CheckCircle2 className="w-4 h-4 text-emerald-500" aria-hidden="true" />
    case 'REJECTED':
      return <XCircle className="w-4 h-4 text-rose-500" aria-hidden="true" />
    case 'EXPORTED':
      return <ExternalLink className="w-4 h-4 text-lamp-500" aria-hidden="true" />
    default:
      return <Lightbulb className="w-4 h-4 text-slate-400" aria-hidden="true" />
  }
}

const iconButton =
  'p-2 rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-lamp-500'

/** Section heading inside an idea, with an optional plain-language explainer. */
function FieldLabel({ children, help }: { children: React.ReactNode; help?: string }) {
  return (
    <div className="mb-2 flex items-center gap-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{children}</h3>
      {help && <Hint text={help} />}
    </div>
  )
}

// Fullscreen Modal Component
interface FullscreenIdeaModalProps {
  idea: IdeaFrame
  index: number
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
  index,
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
        initial={{ scale: 0.98, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.98, opacity: 0 }}
        transition={{ duration: 0.15 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="idea-modal-title"
        className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-5 md:p-6 border-b border-slate-200 bg-slate-50 flex-shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="mb-2 flex items-center gap-2">
                <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600">
                  Idea {index + 1}
                </span>
                {getStatusIcon(idea.status)}
              </div>
              <h2
                id="idea-modal-title"
                className="text-lg md:text-xl font-semibold text-slate-900 leading-snug"
              >
                {idea.coreMechanism || idea.title || 'Mechanism-based Idea'}
              </h2>
              {idea.noveltyAssessment && (
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md ${originalityStyle.bg}`}>
                    <span className={`w-2 h-2 rounded-full ${originalityStyle.dot}`} aria-hidden="true" />
                    <span className={`text-xs font-medium ${originalityStyle.text}`}>
                      {ORIGINALITY_LABEL[idea.noveltyAssessment.originalityStrength] ??
                        idea.noveltyAssessment.originalityStrength}
                    </span>
                  </span>
                  <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md ${riskStyle.bg}`}>
                    <span className={`w-2 h-2 rounded-full ${riskStyle.dot}`} aria-hidden="true" />
                    <span className={`text-xs font-medium ${riskStyle.text}`}>
                      {RISK_LABEL[idea.noveltyAssessment.noveltyRiskLevel] ??
                        idea.noveltyAssessment.noveltyRiskLevel}
                    </span>
                  </span>
                  <Hint title="What do these mean?" text={BADGE_LEGEND} />
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={e => {
                  e.stopPropagation()
                  onCopy(idea)
                }}
                className="hidden md:flex"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 mr-1 text-emerald-500" aria-hidden="true" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 mr-1" aria-hidden="true" />
                    Copy
                  </>
                )}
              </Button>
              <button onClick={onClose} className={iconButton} aria-label="Close idea">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Modal Content */}
        <div className="flex-1 overflow-auto p-5 md:p-6">
          <div className="grid gap-5">
            <section>
              <FieldLabel help={FIELD_HELP.coreMechanism}>Core mechanism</FieldLabel>
              <p className="text-sm md:text-base text-slate-800 leading-relaxed bg-slate-50 p-4 rounded-lg border border-slate-200">
                {idea.coreMechanism}
              </p>
            </section>

            <section>
              <FieldLabel help={FIELD_HELP.inventiveLeap}>Inventive leap</FieldLabel>
              <p className="text-sm md:text-base text-slate-800 leading-relaxed bg-slate-50 p-4 rounded-lg border border-slate-200">
                {idea.inventiveLeap}
              </p>
            </section>

            <div className="grid md:grid-cols-2 gap-4">
              <section>
                <FieldLabel help={FIELD_HELP.eliminatedAssumption}>Eliminated assumption</FieldLabel>
                <p className="text-sm text-slate-700 leading-relaxed p-3 bg-slate-50 rounded-lg border border-slate-200">
                  {idea.eliminatedAssumption || 'Not specified'}
                </p>
              </section>

              {idea.contradictionResolved && (
                <section>
                  <FieldLabel help={FIELD_HELP.contradictionResolved}>Contradiction resolved</FieldLabel>
                  <p className="text-sm text-slate-700 leading-relaxed p-3 bg-slate-50 rounded-lg border border-slate-200">
                    {idea.contradictionResolved}
                  </p>
                </section>
              )}
            </div>

            <section>
              <FieldLabel help={FIELD_HELP.whyNotObvious}>Why this is non-obvious</FieldLabel>
              <p className="text-sm md:text-base text-slate-800 leading-relaxed bg-emerald-50/50 p-4 rounded-lg border border-emerald-100">
                {idea.whyNotObvious}
              </p>
            </section>

            {idea.mechanismBoundaryTest && (
              <section className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                <FieldLabel help={FIELD_HELP.boundaries}>Mechanism boundaries</FieldLabel>
                <div className="grid md:grid-cols-2 gap-3">
                  <div>
                    <span className="text-xs font-medium text-slate-600 block mb-1">Does not solve</span>
                    <p className="text-sm text-slate-700">{idea.mechanismBoundaryTest.whatItDoesNotSolve}</p>
                  </div>
                  {/* Support both legacy (outOfScope) and new (failureByDesign) fields */}
                  {(idea.mechanismBoundaryTest.failureByDesign || idea.mechanismBoundaryTest.outOfScope) && (
                    <div>
                      <span className="text-xs font-medium text-slate-600 block mb-1">
                        {idea.mechanismBoundaryTest.failureByDesign ? 'Fails by design when' : 'Out of scope'}
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
                    <Scale className="w-4 h-4 text-slate-500" aria-hidden="true" />
                    First-pass novelty read
                  </h3>
                </div>

                <div className="p-4 space-y-4">
                  <div className="grid md:grid-cols-2 gap-3">
                    {idea.noveltyAssessment.strongestNovelAspect && (
                      <div className="p-3 bg-emerald-50/50 rounded-lg border border-emerald-100">
                        <span className="text-xs font-semibold text-emerald-700 block mb-1">
                          Strongest aspect
                        </span>
                        <p className="text-sm text-slate-700">{idea.noveltyAssessment.strongestNovelAspect}</p>
                      </div>
                    )}
                    {idea.noveltyAssessment.weakestNovelAspect && (
                      <div className="p-3 bg-amber-50/50 rounded-lg border border-amber-100">
                        <span className="text-xs font-semibold text-amber-700 block mb-1">
                          Where to push further
                        </span>
                        <p className="text-sm text-slate-700">{idea.noveltyAssessment.weakestNovelAspect}</p>
                      </div>
                    )}
                  </div>

                  {idea.noveltyAssessment.likelyExaminerObjection && (
                    <div className="p-3 bg-rose-50/50 rounded-lg border border-rose-100">
                      <span className="text-xs font-semibold text-rose-700 block mb-1">
                        Objection to expect
                      </span>
                      <p className="text-sm text-slate-700">{idea.noveltyAssessment.likelyExaminerObjection}</p>
                    </div>
                  )}

                  {idea.noveltyAssessment.redundancyRisk && (
                    <div className="text-sm text-slate-600">
                      <span className="font-medium">Overlap with your other ideas:</span>{' '}
                      {idea.noveltyAssessment.redundancyRisk}
                    </div>
                  )}

                  {/* Improvement Directions - Selectable */}
                  {idea.noveltyAssessment.improvementDirections &&
                    idea.noveltyAssessment.improvementDirections.length > 0 && (
                      <div className="border-t border-slate-200 pt-4 mt-4">
                        <div className="flex items-center justify-between mb-1">
                          <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-lamp-600" aria-hidden="true" />
                            Ways to strengthen it
                          </h4>
                          <span className="text-xs text-slate-500 tabular-nums">
                            {selectedSuggestions.size} selected
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mb-3">
                          Tick any you want carried into the Idea Bank with this idea.
                        </p>
                        <div className="space-y-2">
                          {idea.noveltyAssessment.improvementDirections.map((direction, i) => {
                            const checked = selectedSuggestions.has(direction)
                            return (
                              <label
                                key={i}
                                className={`flex w-full cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-colors focus-within:ring-2 focus-within:ring-lamp-500 ${
                                  checked
                                    ? 'bg-lamp-50 border-lamp-200'
                                    : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => onToggleSuggestion(direction)}
                                  className="sr-only"
                                />
                                <span
                                  className={`flex-shrink-0 w-5 h-5 rounded border flex items-center justify-center mt-0.5 ${
                                    checked ? 'bg-lamp-600 border-lamp-600' : 'border-slate-300 bg-white'
                                  }`}
                                  aria-hidden="true"
                                >
                                  {checked && <Check className="w-3 h-3 text-white" />}
                                </span>
                                <span className="text-sm text-slate-700 leading-relaxed">{direction}</span>
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    )}

                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 mt-4">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-slate-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
                      <p className="text-xs text-slate-600 leading-relaxed">
                        This read is based on the idea alone. Run a novelty search before you rely on it
                        for filing.
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
            className="flex-1"
          >
            {runningNoveltySearch === idea.id ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                Opening search…
              </>
            ) : (
              <>
                <Search className="w-4 h-4 mr-2" aria-hidden="true" />
                Check against patents
              </>
            )}
          </Button>
          <Button
            onClick={() => {
              onToggleExport(idea.id)
              onClose()
            }}
            variant={isSelectedForExport ? 'outline' : 'default'}
            className="flex-1"
          >
            <Download className="w-4 h-4 mr-2" aria-hidden="true" />
            {isSelectedForExport ? 'Remove from export' : 'Add to export'}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}

export default function IdeaFramePanel({
  ideas,
  onRunNoveltySearch,
  onExport,
  onClose,
  onDeleteIdea,
}: IdeaFramePanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [selectedForExport, setSelectedForExport] = useState<Set<string>>(new Set())
  const [selectedSuggestions, setSelectedSuggestions] = useState<Record<string, Set<string>>>({})
  const [runningNoveltySearch, setRunningNoveltySearch] = useState<string | null>(null)
  const [fullscreenIdea, setFullscreenIdea] = useState<IdeaFrame | null>(null)
  const [copied, setCopied] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [sortByOriginality, setSortByOriginality] = useState(false)

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

  // Generation order is the default — it is what the user watched being produced.
  // Sorting is opt-in and never changes an idea's displayed number.
  const numberedIdeas = useMemo(
    () => ideas.map((idea, index) => ({ idea, number: index + 1 })),
    [ideas]
  )
  const visibleIdeas = useMemo(() => {
    if (!sortByOriginality) return numberedIdeas
    const rank: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 }
    return [...numberedIdeas].sort(
      (a, b) =>
        (rank[a.idea.noveltyAssessment?.originalityStrength ?? ''] ?? 3) -
        (rank[b.idea.noveltyAssessment?.originalityStrength ?? ''] ?? 3)
    )
  }, [numberedIdeas, sortByOriginality])

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

  const allSelected = ideas.length > 0 && selectedForExport.size === ideas.length

  return (
    <>
      {/* Fullscreen Modal */}
      <AnimatePresence>
        {fullscreenIdea && (
          <FullscreenIdeaModal
            idea={fullscreenIdea}
            index={ideas.findIndex(i => i.id === fullscreenIdea.id)}
            onClose={() => setFullscreenIdea(null)}
            onCopy={handleCopyToClipboard}
            copied={copied}
            onRunNoveltySearch={handleRunNoveltySearch}
            runningNoveltySearch={runningNoveltySearch}
            onToggleExport={toggleExportSelection}
            isSelectedForExport={selectedForExport.has(fullscreenIdea.id)}
            selectedSuggestions={selectedSuggestions[fullscreenIdea.id] || new Set()}
            onToggleSuggestion={suggestion => toggleSuggestion(fullscreenIdea.id, suggestion)}
          />
        )}
      </AnimatePresence>

      <div className="flex h-full flex-col bg-white">
        {/* Header */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-slate-50 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Lightbulb className="h-4 w-4 text-slate-500" aria-hidden="true" />
              Your ideas
              <span className="font-normal tabular-nums text-slate-500">({ideas.length})</span>
            </h3>
            <button onClick={onClose} className={iconButton} aria-label="Hide ideas panel">
              <X className="h-4 w-4" />
            </button>
          </div>

          <p className="mb-3 text-xs leading-relaxed text-slate-500">
            Open one to read it in full, tick the ones worth keeping, then send them to your Idea Bank.
          </p>

          {ideas.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <button
                type="button"
                onClick={() =>
                  setSelectedForExport(allSelected ? new Set() : new Set(ideas.map(i => i.id)))
                }
                className="rounded text-xs font-medium text-lamp-700 transition-colors hover:text-lamp-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-lamp-500"
              >
                {allSelected ? 'Clear selection' : 'Select all'}
              </button>
              {ideas.length > 2 && (
                <button
                  type="button"
                  onClick={() => setSortByOriginality(prev => !prev)}
                  className="rounded text-xs text-slate-500 transition-colors hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-lamp-500"
                  aria-pressed={sortByOriginality}
                >
                  {sortByOriginality ? 'Sorted by originality' : 'Sort by originality'}
                </button>
              )}
              <span className="flex items-center gap-1 text-xs text-slate-500">
                What the badges mean
                <Hint title="Originality and risk" text={BADGE_LEGEND} />
              </span>
            </div>
          )}
        </div>

        {/* Ideas List */}
        <div className="flex-1 overflow-auto">
          {ideas.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 py-10 text-center">
              <Lightbulb className="mb-3 h-6 w-6 text-slate-300" aria-hidden="true" />
              <p className="text-sm font-medium text-slate-700">No ideas yet</p>
              <p className="mt-1 max-w-[240px] text-xs leading-relaxed text-slate-500">
                Select a few directions in the map, then generate ideas from the idea builder.
              </p>
            </div>
          ) : (
            visibleIdeas.map(({ idea, number }) => {
              const originalityStyle = getOriginalityIndicator(idea.noveltyAssessment?.originalityStrength)
              const riskStyle = getRiskIndicator(idea.noveltyAssessment?.noveltyRiskLevel)
              const isExpanded = expandedId === idea.id
              const isSelected = selectedForExport.has(idea.id)

              return (
                <motion.div
                  key={idea.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.15 }}
                  className={`border-b border-slate-100 transition-colors ${
                    isSelected ? 'bg-lamp-50/40' : ''
                  }`}
                >
                  <div className="flex items-start gap-2 p-3">
                    {/* Export selection */}
                    <label className="mt-0.5 flex cursor-pointer items-center rounded p-1 focus-within:ring-2 focus-within:ring-lamp-500">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleExportSelection(idea.id)}
                        className="sr-only"
                      />
                      <span className="sr-only">Select idea {number} for export</span>
                      <span
                        className={`flex h-5 w-5 items-center justify-center rounded border transition-colors ${
                          isSelected ? 'border-lamp-600 bg-lamp-600' : 'border-slate-300 bg-white'
                        }`}
                        aria-hidden="true"
                      >
                        {isSelected && <Check className="h-3 w-3 text-white" />}
                      </span>
                    </label>

                    {/* Summary — the whole block toggles the details */}
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : idea.id)}
                      onDoubleClick={() => setFullscreenIdea(idea)}
                      aria-expanded={isExpanded}
                      className="min-w-0 flex-1 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-lamp-500"
                    >
                      <span className="mb-1 flex items-center gap-1.5">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-500">
                          {String(number).padStart(2, '0')}
                        </span>
                        {getStatusIcon(idea.status)}
                        <ChevronDown
                          className={`ml-auto h-3.5 w-3.5 flex-shrink-0 text-slate-500 transition-transform ${
                            isExpanded ? 'rotate-180' : ''
                          }`}
                          aria-hidden="true"
                        />
                      </span>
                      <span className="block text-sm font-medium leading-snug text-slate-800 line-clamp-2">
                        {idea.coreMechanism || idea.title || 'Mechanism-based Idea'}
                      </span>
                      {!isExpanded && (
                        <span className="mt-1 block text-xs leading-relaxed text-slate-500 line-clamp-2">
                          {idea.inventiveLeap}
                        </span>
                      )}

                      {idea.noveltyAssessment && (
                        <span className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span
                            className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] ${originalityStyle.bg}`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${originalityStyle.dot}`} aria-hidden="true" />
                            <span className={originalityStyle.text}>
                              {ORIGINALITY_LABEL[idea.noveltyAssessment.originalityStrength] ??
                                idea.noveltyAssessment.originalityStrength}
                            </span>
                          </span>
                          <span className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] ${riskStyle.bg}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${riskStyle.dot}`} aria-hidden="true" />
                            <span className={riskStyle.text}>
                              {RISK_LABEL[idea.noveltyAssessment.noveltyRiskLevel] ??
                                idea.noveltyAssessment.noveltyRiskLevel}
                            </span>
                          </span>
                        </span>
                      )}
                    </button>

                    {/* Row actions */}
                    <div className="flex flex-shrink-0 items-center">
                      <button
                        onClick={() => setFullscreenIdea(idea)}
                        className={iconButton}
                        aria-label={`Open idea ${number} in full view`}
                      >
                        <Maximize2 className="h-4 w-4" />
                      </button>
                      {onDeleteIdea && (
                        <button
                          onClick={() => {
                            if (window.confirm('Delete this idea? This cannot be undone.')) {
                              onDeleteIdea(idea.id)
                            }
                          }}
                          className={`${iconButton} hover:bg-rose-50 hover:text-rose-600`}
                          aria-label={`Delete idea ${number}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expanded Details */}
                  <AnimatePresence initial={false}>
                    {isExpanded && !isMobile && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18 }}
                        className="overflow-hidden"
                      >
                        <div className="space-y-3 px-4 pb-4 pl-11">
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                                Inventive leap
                              </span>
                              <Hint text={FIELD_HELP.inventiveLeap} />
                            </div>
                            <p className="mt-1 text-sm leading-relaxed text-slate-700">{idea.inventiveLeap}</p>
                          </div>

                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                                Eliminated assumption
                              </span>
                              <Hint text={FIELD_HELP.eliminatedAssumption} />
                            </div>
                            <p className="mt-1 text-sm leading-relaxed text-slate-700">
                              {idea.eliminatedAssumption || 'Not specified'}
                            </p>
                          </div>

                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                                Why non-obvious
                              </span>
                              <Hint text={FIELD_HELP.whyNotObvious} />
                            </div>
                            <p className="mt-1 text-sm leading-relaxed text-slate-700">{idea.whyNotObvious}</p>
                          </div>

                          {idea.noveltyAssessment?.strongestNovelAspect && (
                            <p className="text-xs leading-relaxed text-slate-600">
                              <span className="font-medium text-emerald-700">Strongest aspect:</span>{' '}
                              {idea.noveltyAssessment.strongestNovelAspect}
                            </p>
                          )}

                          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleRunNoveltySearch(idea.id)}
                              disabled={runningNoveltySearch === idea.id}
                              className="text-xs"
                            >
                              {runningNoveltySearch === idea.id ? (
                                <>
                                  <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />
                                  Opening…
                                </>
                              ) : (
                                <>
                                  <Search className="mr-1 h-3 w-3" aria-hidden="true" />
                                  Check against patents
                                </>
                              )}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setFullscreenIdea(idea)}
                              className="text-xs"
                            >
                              <Maximize2 className="mr-1 h-3 w-3" aria-hidden="true" />
                              Read in full
                            </Button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Mobile Expand */}
                  {isExpanded && isMobile && (
                    <div className="px-4 pb-4 pl-11">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setFullscreenIdea(idea)}
                        className="w-full text-xs"
                      >
                        <Maximize2 className="mr-1 h-3 w-3" aria-hidden="true" />
                        Read in full
                      </Button>
                    </div>
                  )}
                </motion.div>
              )
            })
          )}
        </div>

        {/* Export Footer */}
        <div className="flex-shrink-0 border-t border-slate-200 bg-slate-50 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              <span className="font-medium tabular-nums text-slate-700">{selectedForExport.size}</span>{' '}
              of {ideas.length} selected
            </span>
            {selectedForExport.size > 0 && (
              <button
                onClick={() => setSelectedForExport(new Set())}
                className="rounded text-xs text-slate-500 transition-colors hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-lamp-500"
              >
                Clear
              </button>
            )}
          </div>
          <Button onClick={handleExport} disabled={selectedForExport.size === 0} className="w-full">
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            Send to Idea Bank
          </Button>
          {selectedForExport.size === 0 && (
            <p className="mt-2 text-center text-[11px] text-slate-500">
              Tick an idea above to send it to your Idea Bank
            </p>
          )}
        </div>
      </div>
    </>
  )
}
