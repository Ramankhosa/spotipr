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
    outOfScope: string
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
  onAssessNovelty: (ideaId: string) => void  // Renamed: Preliminary assessment only
  onExport: (ideaIds: string[]) => void
  onClose: () => void
  onDeleteIdea?: (ideaId: string) => void
  feedbackLoopResults?: FeedbackLoopResults | null
  qualityMetrics?: QualityMetrics | null
}

// Helper functions defined outside component to avoid recreation
// Originality strength colors (SRS: HIGH | MEDIUM | LOW)
const getOriginalityColor = (strength?: string) => {
  if (!strength) return 'bg-slate-100 text-slate-600'
  if (strength === 'HIGH') return 'bg-green-100 text-green-700'
  if (strength === 'MEDIUM') return 'bg-yellow-100 text-yellow-700'
  return 'bg-red-100 text-red-700'
}

// Novelty risk colors (SRS: LOW | MODERATE | HIGH)
const getRiskColor = (risk?: string) => {
  if (!risk) return 'bg-slate-100 text-slate-600'
  if (risk === 'LOW') return 'bg-green-100 text-green-700'
  if (risk === 'MODERATE') return 'bg-yellow-100 text-yellow-700'
  return 'bg-red-100 text-red-700'
}

const getStatusIconStatic = (status: string) => {
  switch (status) {
    case 'SHORTLISTED':
      return <CheckCircle2 className="w-4 h-4 text-green-500" />
    case 'REJECTED':
      return <XCircle className="w-4 h-4 text-red-500" />
    case 'EXPORTED':
      return <ExternalLink className="w-4 h-4 text-blue-500" />
    default:
      return <Lightbulb className="w-4 h-4 text-purple-500" />
  }
}

// Fullscreen Modal - defined as a separate component to prevent re-creation on parent re-renders
interface FullscreenIdeaModalProps {
  idea: IdeaFrame
  onClose: () => void
  onCopy: (idea: IdeaFrame) => void
  copied: boolean
  onAssessNovelty: (ideaId: string) => void  // Renamed: Preliminary assessment only
  assessingNovelty: string | null
  onToggleExport: (ideaId: string) => void
  isSelectedForExport: boolean
}

function FullscreenIdeaModal({
  idea,
  onClose,
  onCopy,
  copied,
  onAssessNovelty,
  assessingNovelty,
  onToggleExport,
  isSelectedForExport,
}: FullscreenIdeaModalProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 md:p-8"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header - SRS Section 4.2D: Display Core Mechanism as title */}
        <div className="p-4 md:p-6 border-b border-slate-200 bg-gradient-to-r from-purple-50 to-violet-50 flex-shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                {getStatusIconStatic(idea.status)}
                <h2 className="text-lg md:text-xl font-bold text-slate-900 line-clamp-2">
                  {idea.coreMechanism || idea.title || 'Mechanism-based Idea'}
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {idea.noveltyAssessment && (
                  <>
                    <Badge className={`${getOriginalityColor(idea.noveltyAssessment.originalityStrength)} text-sm`}>
                      {idea.noveltyAssessment.originalityStrength} originality
                    </Badge>
                    <Badge className={`${getRiskColor(idea.noveltyAssessment.noveltyRiskLevel)} text-sm`}>
                      {idea.noveltyAssessment.noveltyRiskLevel} risk
                    </Badge>
                  </>
                )}
                {idea.userRating && (
                  <div className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map(star => (
                      <Star
                        key={star}
                        className={`w-4 h-4 ${
                          star <= idea.userRating!
                            ? 'text-yellow-400 fill-yellow-400'
                            : 'text-slate-200'
                        }`}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  onCopy(idea)
                }}
                className="hidden md:flex"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 mr-1 text-green-500" />
                    Copied!
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
                className="p-2 hover:bg-slate-200 rounded-full transition-colors"
              >
                <Minimize2 className="w-5 h-5 text-slate-500" />
              </button>
            </div>
          </div>
        </div>

        {/* Modal Content - Scrollable - SRS Section 4.2D fields */}
        <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4 md:space-y-6">
          {/* Core Mechanism */}
          <div className="bg-gradient-to-r from-violet-50 to-purple-50 rounded-xl p-4 border border-violet-200">
            <label className="text-xs md:text-sm font-semibold text-violet-600 uppercase tracking-wider">
              🔧 Core Mechanism
            </label>
            <p className="text-sm md:text-base text-violet-800 mt-2 leading-relaxed">
              {idea.coreMechanism}
            </p>
          </div>

          {/* Inventive Leap */}
          <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl p-4 border border-amber-200">
            <label className="text-xs md:text-sm font-semibold text-amber-600 uppercase tracking-wider">
              🚀 Inventive Leap
            </label>
            <p className="text-sm md:text-base text-amber-800 mt-2 leading-relaxed">
              {idea.inventiveLeap}
            </p>
          </div>

          {/* Eliminated Assumption */}
          <div className="bg-slate-50 rounded-xl p-4">
            <label className="text-xs md:text-sm font-semibold text-slate-500 uppercase tracking-wider">
              ❌ Eliminated Assumption
            </label>
            <p className="text-sm md:text-base text-slate-700 mt-2 leading-relaxed">
              {idea.eliminatedAssumption}
            </p>
          </div>

          {/* Contradiction Resolved */}
          {idea.contradictionResolved && (
            <div className="bg-slate-50 rounded-xl p-4">
              <label className="text-xs md:text-sm font-semibold text-slate-500 uppercase tracking-wider">
                ⚡ Contradiction Resolved
              </label>
              <p className="text-sm md:text-base text-slate-700 mt-2 leading-relaxed">
                {idea.contradictionResolved}
              </p>
            </div>
          )}

          {/* Why Not Obvious */}
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl p-4 border border-green-200">
            <label className="text-xs md:text-sm font-semibold text-green-600 uppercase tracking-wider">
              💡 Why Not Obvious
            </label>
            <p className="text-sm md:text-base text-green-800 mt-2 leading-relaxed">
              {idea.whyNotObvious}
            </p>
          </div>

          {/* Mechanism Boundary Test */}
          {idea.mechanismBoundaryTest && (
            <div className="bg-slate-50 rounded-xl p-4">
              <label className="text-xs md:text-sm font-semibold text-slate-500 uppercase tracking-wider">
                🎯 Mechanism Boundaries
              </label>
              <div className="mt-2 space-y-2">
                <div>
                  <span className="text-xs font-medium text-slate-600">What it does NOT solve:</span>
                  <p className="text-sm text-slate-700">{idea.mechanismBoundaryTest.whatItDoesNotSolve}</p>
                </div>
                <div>
                  <span className="text-xs font-medium text-slate-600">Out of scope:</span>
                  <p className="text-sm text-slate-700">{idea.mechanismBoundaryTest.outOfScope}</p>
                </div>
              </div>
            </div>
          )}

          {/* ===== NOVELTY ASSESSMENT SECTION (LLM-only, NO prior art) ===== */}
          {/* SRS Section 4.2D: Originality Strength, Novelty Risk Level, Examiner Objection, Improvement Directions */}
          {idea.noveltyAssessment && (
            <div className="bg-gradient-to-r from-cyan-50 to-blue-50 rounded-xl p-4 border border-cyan-200">
              <label className="text-xs md:text-sm font-semibold text-cyan-700 uppercase tracking-wider flex items-center gap-2">
                <Scale className="w-4 h-4" />
                Preliminary Novelty Assessment
              </label>
              
              {/* Strength & Risk Badges */}
              <div className="flex flex-wrap gap-2 mt-3">
                <Badge className={`${getOriginalityColor(idea.noveltyAssessment.originalityStrength)} text-sm`}>
                  Originality: {idea.noveltyAssessment.originalityStrength}
                </Badge>
                <Badge className={`${getRiskColor(idea.noveltyAssessment.noveltyRiskLevel)} text-sm`}>
                  Novelty Risk: {idea.noveltyAssessment.noveltyRiskLevel}
                </Badge>
              </div>

              {/* Strongest Novel Aspect */}
              {idea.noveltyAssessment.strongestNovelAspect && (
                <div className="mt-3 p-2 bg-green-50 rounded-lg border border-green-200">
                  <div className="text-xs font-semibold text-green-700">✓ Strongest Novel Aspect:</div>
                  <p className="text-xs text-green-800 mt-1">{idea.noveltyAssessment.strongestNovelAspect}</p>
                </div>
              )}

              {/* Weakest Novel Aspect */}
              {idea.noveltyAssessment.weakestNovelAspect && (
                <div className="mt-2 p-2 bg-amber-50 rounded-lg border border-amber-200">
                  <div className="text-xs font-semibold text-amber-700">⚠️ Weakest Novel Aspect:</div>
                  <p className="text-xs text-amber-800 mt-1">{idea.noveltyAssessment.weakestNovelAspect}</p>
                </div>
              )}

              {/* Likely Examiner Objection */}
              {idea.noveltyAssessment.likelyExaminerObjection && (
                <div className="mt-3 p-2 bg-red-50 rounded-lg border border-red-200">
                  <div className="text-xs font-semibold text-red-700">🔍 Likely Examiner Objection:</div>
                  <p className="text-xs text-red-800 mt-1">{idea.noveltyAssessment.likelyExaminerObjection}</p>
                </div>
              )}

              {/* Redundancy Risk */}
              {idea.noveltyAssessment.redundancyRisk && (
                <div className="mt-2">
                  <div className="text-xs font-semibold text-slate-600">Redundancy Risk:</div>
                  <p className="text-xs text-slate-700 mt-1">{idea.noveltyAssessment.redundancyRisk}</p>
                </div>
              )}

              {/* Improvement Directions */}
              {idea.noveltyAssessment.improvementDirections && idea.noveltyAssessment.improvementDirections.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs font-semibold text-cyan-700 mb-1">📈 Improvement Directions:</div>
                  <ul className="space-y-1">
                    {idea.noveltyAssessment.improvementDirections.map((direction, i) => (
                      <li key={i} className="text-xs text-cyan-800 flex items-start gap-1">
                        <span className="text-cyan-500">→</span>
                        {direction}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* MANDATORY DISCLAIMER - SRS Section 4.2E */}
              <div className="mt-4 p-3 bg-amber-100/50 rounded-lg border border-amber-300">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800 font-medium">
                    This is a preliminary novelty assessment. Perform exhaustive prior-art search before filing.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 md:p-6 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row gap-3 flex-shrink-0">
          <Button
            variant="outline"
            onClick={() => onAssessNovelty(idea.id)}
            disabled={assessingNovelty === idea.id || !!idea.noveltyAssessment}
            className="flex-1"
          >
            {assessingNovelty === idea.id ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Assessing...
              </>
            ) : idea.noveltyAssessment ? (
              <>
                <CheckCircle2 className="w-4 h-4 mr-2 text-green-500" />
                Assessed
              </>
            ) : (
              <>
                <Search className="w-4 h-4 mr-2" />
                Assess Novelty
              </>
            )}
          </Button>
          <Button
            onClick={() => {
              onToggleExport(idea.id)
              onClose()
            }}
            className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700"
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
  onAssessNovelty,
  onExport,
  onClose,
  onDeleteIdea,
  feedbackLoopResults,
  qualityMetrics,
}: IdeaFramePanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [selectedForExport, setSelectedForExport] = useState<Set<string>>(new Set())
  const [assessingNovelty, setAssessingNovelty] = useState<string | null>(null)
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

  // Update fullscreenIdea when ideas prop changes (e.g., after assessment)
  // This ensures the modal shows updated data like noveltyAssessment
  useEffect(() => {
    if (fullscreenIdea) {
      const updatedIdea = ideas.find(i => i.id === fullscreenIdea.id)
      if (updatedIdea) {
        // Check if novelty assessment was added/updated
        const hasNewAssessment = updatedIdea.noveltyAssessment && !fullscreenIdea.noveltyAssessment
        
        if (hasNewAssessment) {
          setFullscreenIdea(updatedIdea)
        }
      }
    }
  }, [ideas]) // Only depend on ideas to avoid infinite loops

  const handleNoveltyAssessment = async (ideaId: string) => {
    setAssessingNovelty(ideaId)
    await onAssessNovelty(ideaId)
    setAssessingNovelty(null)
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

  const handleExport = () => {
    if (selectedForExport.size > 0) {
      onExport(Array.from(selectedForExport))
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'SHORTLISTED':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />
      case 'REJECTED':
        return <XCircle className="w-4 h-4 text-red-500" />
      case 'EXPORTED':
        return <ExternalLink className="w-4 h-4 text-blue-500" />
      default:
        return <Lightbulb className="w-4 h-4 text-purple-500" />
    }
  }

  // Copy to clipboard handler - using new IdeaFrame fields
  const handleCopyToClipboard = async (idea: IdeaFrame) => {
    const text = `
Core Mechanism: ${idea.coreMechanism}

Inventive Leap: ${idea.inventiveLeap}

Eliminated Assumption: ${idea.eliminatedAssumption}

${idea.contradictionResolved ? `Contradiction Resolved: ${idea.contradictionResolved}` : ''}

Why Not Obvious: ${idea.whyNotObvious}

${idea.mechanismBoundaryTest ? `
Boundaries:
- What it does NOT solve: ${idea.mechanismBoundaryTest.whatItDoesNotSolve}
- Out of scope: ${idea.mechanismBoundaryTest.outOfScope}
` : ''}

${idea.noveltyAssessment ? `
Preliminary Novelty Assessment:
- Originality Strength: ${idea.noveltyAssessment.originalityStrength}
- Novelty Risk Level: ${idea.noveltyAssessment.noveltyRiskLevel}
- Strongest Aspect: ${idea.noveltyAssessment.strongestNovelAspect}
- Weakest Aspect: ${idea.noveltyAssessment.weakestNovelAspect}
- Examiner Objection: ${idea.noveltyAssessment.likelyExaminerObjection}
- Improvement Directions: ${idea.noveltyAssessment.improvementDirections?.join(', ') || 'N/A'}

⚠️ This is a preliminary novelty assessment. Perform exhaustive prior-art search before filing.
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
            onAssessNovelty={handleNoveltyAssessment}
            assessingNovelty={assessingNovelty}
            onToggleExport={toggleExportSelection}
            isSelectedForExport={selectedForExport.has(fullscreenIdea.id)}
          />
        )}
      </AnimatePresence>

      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="p-3 md:p-4 border-b border-slate-200 bg-gradient-to-r from-purple-50 to-violet-50 flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-slate-900 flex items-center gap-2 text-sm md:text-base">
              <Lightbulb className="w-4 h-4 text-purple-500" />
              Generated Ideas ({ideas.length})
            </h3>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-slate-200 rounded-md transition-colors"
            >
              <X className="w-4 h-4 text-slate-500" />
            </button>
          </div>
          <p className="text-[10px] md:text-xs text-slate-500">
            Tap an idea to expand • Long press for fullscreen view
          </p>

          {/* Quality Metrics - Responsive Grid */}
          {qualityMetrics && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="bg-white/60 rounded-lg p-2">
                <div className="text-[9px] md:text-[10px] text-slate-500 uppercase">Inventive Leap</div>
                <div className="text-xs md:text-sm font-semibold text-violet-700">
                  {Math.round(qualityMetrics.inventiveLeapRatio * 100)}%
                </div>
              </div>
              <div className="bg-white/60 rounded-lg p-2">
                <div className="text-[9px] md:text-[10px] text-slate-500 uppercase">Cross-Domain</div>
                <div className="text-xs md:text-sm font-semibold text-cyan-700">
                  {Math.round(qualityMetrics.analogyRatio * 100)}%
                </div>
              </div>
            </div>
          )}

          {/* Feedback Loop Results */}
          {feedbackLoopResults && feedbackLoopResults.enabled && (
            <div className="mt-3 p-2 bg-white/60 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-[9px] md:text-[10px] text-slate-500 uppercase">Quality Check</span>
                {feedbackLoopResults.lowNoveltyCount > 0 ? (
                  <Badge className="bg-amber-100 text-amber-700 text-[8px] md:text-[9px]">
                    {feedbackLoopResults.lowNoveltyCount} flagged
                  </Badge>
                ) : (
                  <Badge className="bg-green-100 text-green-700 text-[8px] md:text-[9px]">
                    All pass
                  </Badge>
                )}
              </div>
              <div className="text-[10px] md:text-xs text-slate-600 mt-1">
                {feedbackLoopResults.totalChecked} ideas auto-checked
              </div>
            </div>
          )}
        </div>

        {/* Ideas List */}
        <div className="flex-1 overflow-auto">
          {ideas.map((idea, index) => (
            <motion.div
              key={idea.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="border-b border-slate-100"
            >
              {/* Idea Header */}
              <div
                className={`p-3 md:p-4 cursor-pointer hover:bg-slate-50 transition-colors ${
                  selectedForExport.has(idea.id) ? 'bg-violet-50' : ''
                }`}
                onClick={() => setExpandedId(expandedId === idea.id ? null : idea.id)}
                onDoubleClick={() => setFullscreenIdea(idea)}
              >
                <div className="flex items-start gap-2 md:gap-3">
                  {/* Selection Checkbox */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleExportSelection(idea.id)
                    }}
                    className={`
                      flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center mt-0.5
                      transition-colors touch-manipulation
                      ${selectedForExport.has(idea.id)
                        ? 'bg-violet-500 border-violet-500'
                        : 'border-slate-300 hover:border-violet-400'
                      }
                    `}
                  >
                    {selectedForExport.has(idea.id) && (
                      <CheckCircle2 className="w-3 h-3 text-white" />
                    )}
                  </button>

                  {/* Content - Using new IdeaFrame fields */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {getStatusIcon(idea.status)}
                      <h4 className="font-medium text-slate-900 text-xs md:text-sm line-clamp-1">
                        {idea.coreMechanism || idea.title || 'Mechanism-based Idea'}
                      </h4>
                    </div>
                    <p className="text-[10px] md:text-xs text-slate-500 line-clamp-2">
                      {idea.inventiveLeap}
                    </p>

                    {/* Assessment Badges - NO numeric scores per SRS */}
                    <div className="flex flex-wrap items-center gap-1 md:gap-2 mt-2">
                      {idea.noveltyAssessment && (
                        <>
                          <Badge className={`${getOriginalityColor(idea.noveltyAssessment.originalityStrength)} text-[9px] md:text-[10px] py-0.5`}>
                            {idea.noveltyAssessment.originalityStrength}
                          </Badge>
                          <Badge className={`${getRiskColor(idea.noveltyAssessment.noveltyRiskLevel)} text-[9px] md:text-[10px] py-0.5`}>
                            {idea.noveltyAssessment.noveltyRiskLevel} risk
                          </Badge>
                        </>
                      )}
                      {idea.userRating && (
                        <div className="flex items-center gap-0.5">
                          {[1, 2, 3, 4, 5].map(star => (
                            <Star
                              key={star}
                              className={`w-2.5 h-2.5 md:w-3 md:h-3 ${
                                star <= idea.userRating!
                                  ? 'text-yellow-400 fill-yellow-400'
                                  : 'text-slate-200'
                              }`}
                            />
                          ))}
                        </div>
                      )}
                    </div>
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
                      <Maximize2 className="w-3.5 h-3.5 md:w-4 md:h-4 text-slate-400" />
                    </button>
                    {onDeleteIdea && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          if (window.confirm('Delete this idea? This cannot be undone.')) {
                            onDeleteIdea(idea.id)
                          }
                        }}
                        className="p-1.5 hover:bg-red-100 rounded-md transition-colors group"
                        title="Delete idea"
                      >
                        <Trash2 className="w-3.5 h-3.5 md:w-4 md:h-4 text-slate-400 group-hover:text-red-500" />
                      </button>
                    )}
                    <div className="hidden md:block">
                      {expandedId === idea.id ? (
                        <ChevronUp className="w-4 h-4 text-slate-400" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-slate-400" />
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Expanded Details (Desktop only, use fullscreen on mobile) */}
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
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                          Eliminated Assumption
                        </label>
                        <p className="text-sm text-slate-700 mt-1">
                          {idea.eliminatedAssumption}
                        </p>
                      </div>

                      {/* Why Not Obvious */}
                      <div className="p-2 bg-green-50 rounded-lg border border-green-100">
                        <label className="text-xs font-semibold text-green-600 uppercase tracking-wider">
                          Why Not Obvious
                        </label>
                        <p className="text-sm text-green-800 mt-1">
                          {idea.whyNotObvious}
                        </p>
                      </div>

                      {/* Preliminary Novelty Assessment Summary (Compact) */}
                      {idea.noveltyAssessment && (
                        <div className="p-3 bg-cyan-50 rounded-lg border border-cyan-200">
                          <div className="flex items-center justify-between">
                            <label className="text-xs font-semibold text-cyan-700 uppercase tracking-wider flex items-center gap-1">
                              <Scale className="w-3 h-3" />
                              Preliminary Assessment
                            </label>
                            <div className="flex gap-1">
                              <Badge className={`${getOriginalityColor(idea.noveltyAssessment.originalityStrength)} text-[9px]`}>
                                {idea.noveltyAssessment.originalityStrength}
                              </Badge>
                              <Badge className={`${getRiskColor(idea.noveltyAssessment.noveltyRiskLevel)} text-[9px]`}>
                                {idea.noveltyAssessment.noveltyRiskLevel}
                              </Badge>
                            </div>
                          </div>
                          {idea.noveltyAssessment.strongestNovelAspect && (
                            <p className="text-xs text-slate-600 mt-2 line-clamp-2">
                              <span className="font-medium text-green-700">✓</span> {idea.noveltyAssessment.strongestNovelAspect}
                            </p>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setFullscreenIdea(idea)
                            }}
                            className="text-[10px] text-cyan-600 hover:text-cyan-800 mt-2 underline"
                          >
                            View full assessment →
                          </button>
                          
                          {/* MANDATORY DISCLAIMER */}
                          <p className="text-[9px] text-amber-600 mt-2 italic">
                            ⚠️ Preliminary assessment only. Perform exhaustive prior-art search before filing.
                          </p>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleNoveltyAssessment(idea.id)
                          }}
                          disabled={assessingNovelty === idea.id || !!idea.noveltyAssessment}
                          className="text-xs"
                        >
                          {assessingNovelty === idea.id ? (
                            <>
                              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                              Assessing...
                            </>
                          ) : idea.noveltyAssessment ? (
                            <>
                              <CheckCircle2 className="w-3 h-3 mr-1 text-green-500" />
                              Assessed
                            </>
                          ) : (
                            <>
                              <Search className="w-3 h-3 mr-1" />
                              Assess Novelty
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
                          className="text-xs"
                        >
                          <Maximize2 className="w-3 h-3 mr-1" />
                          Full View
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Mobile: Auto-expand on tap goes to fullscreen */}
              {expandedId === idea.id && isMobile && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="px-3 pb-3 space-y-2"
                >
                  {/* Show novelty assessment indicator on mobile */}
                  {idea.noveltyAssessment && (
                    <div className="p-2 bg-cyan-50 rounded-lg border border-cyan-200 text-xs">
                      <div className="flex items-center gap-2 text-cyan-700">
                        <Scale className="w-3 h-3" />
                        <span className="font-medium">Preliminary Assessment</span>
                        <Badge className={`${getOriginalityColor(idea.noveltyAssessment.originalityStrength)} text-[8px]`}>
                          {idea.noveltyAssessment.originalityStrength}
                        </Badge>
                      </div>
                      <p className="text-[9px] text-amber-600 mt-1 italic">
                        ⚠️ Perform prior-art search before filing
                      </p>
                    </div>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setFullscreenIdea(idea)}
                    className="w-full text-xs"
                  >
                    <Maximize2 className="w-3 h-3 mr-1" />
                    View Full Details
                  </Button>
                </motion.div>
              )}
            </motion.div>
          ))}
        </div>

        {/* Export Footer */}
        <div className="p-3 md:p-4 border-t border-slate-200 bg-slate-50 flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] md:text-xs text-slate-500">
              {selectedForExport.size} selected for export
            </span>
            {selectedForExport.size > 0 && (
              <button
                onClick={() => setSelectedForExport(new Set())}
                className="text-[10px] md:text-xs text-violet-600 hover:text-violet-800"
              >
                Clear selection
              </button>
            )}
          </div>
          <Button
            onClick={handleExport}
            disabled={selectedForExport.size === 0}
            className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white shadow-lg text-xs md:text-sm"
          >
            <Download className="w-3.5 h-3.5 md:w-4 md:h-4 mr-2" />
            Export to Idea Bank ({selectedForExport.size})
          </Button>
        </div>
      </div>
    </>
  )
}
