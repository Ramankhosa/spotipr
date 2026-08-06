'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  User,
  Sparkles, 
  Upload, 
  FileText, 
  Check, 
  Loader2, 
  Code, 
  Trash2, 
  Edit2, 
  Eye, 
  RefreshCw, 
  Image as ImageIcon, 
  Zap,
  LayoutGrid,
  Pencil,
  Star,
  StarOff,
  Wand2,
  Grid3X3,
  AlertCircle,
  GripVertical,
  Layers,
  Lock,
  Unlock,
  RotateCcw,
  Info,
  ExternalLink,
  History,
  Download,
  UploadCloud,
  HelpCircle,
  Paintbrush,
  Languages,
  Lightbulb,
  Link2,
  Plus,
  ChevronRight,
  MoreHorizontal,
  Scissors
} from 'lucide-react'
import FigureWorkProgress from './FigureWorkProgress'

// DnD Kit imports
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { useToast } from '@/components/ui/toast'
import Hint from '@/components/ui/hint'
import {
  explainFigurePlannerError,
  type FigurePlannerErrorArea
} from '@/lib/figure-planner-error-guidance'
import dynamic from 'next/dynamic'

// Dynamic import for the in-browser canvas image editor (Konva-based; ssr:false is required)
const ImageEditor = dynamic(() => import('@/components/ui/canvas-editor'), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center">
      <div className="text-white text-center">
        <Loader2 className="w-10 h-10 animate-spin mx-auto mb-3" />
        <p>Loading Image Editor...</p>
      </div>
    </div>
  )
})

interface FigurePlannerStageProps {
  session: any
  patent: any
  onComplete: (data: any) => Promise<any>
  onRefresh: () => Promise<void>
}

type LLMFigure = {
  title: string
  purpose: string
  plantuml: string
}

type ManualUploadSlot = {
  id: string
  title: string
  description: string
  file: File | null
  previewUrl: string | null
  status: 'idle' | 'detecting' | 'saving' | 'saved' | 'error'
  error?: string
  warnings?: string[]
  aiGenerated?: boolean
  imageWidth?: number
  imageHeight?: number
  scaledForDetection?: boolean
}

const EXTERNAL_AI_MAX_SIDE = 1920
const EXTERNAL_AI_MAX_PIXELS = 1920 * 1080
const EXTERNAL_AI_MAX_BYTES = 10 * 1024 * 1024
const EXTERNAL_UPLOAD_ACCEPT = 'image/png,image/jpeg,image/jpg,image/webp,image/svg+xml'

function createManualUploadSlot(): ManualUploadSlot {
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`
  return {
    id,
    title: '',
    description: '',
    file: null,
    previewUrl: null,
    status: 'idle'
  }
}

type DiagramImageAnalysisStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED'

function normalizeDiagramImageAnalysisStatus(value: unknown): DiagramImageAnalysisStatus | null {
  const status = typeof value === 'string' ? value.toUpperCase() : ''
  return status === 'QUEUED' || status === 'PROCESSING' || status === 'COMPLETED' || status === 'FAILED'
    ? status
    : null
}

// Helper function to normalize page sizes from country profiles
// IMPORTANT: This must be defined before the component to avoid TDZ (Temporal Dead Zone) errors
// Readability findings the pipeline attaches to a saved figure. None of them
// block anything — they mean "this will be hard to read at filing scale", which
// is exactly when splitting the figure is the useful next action.
const FIGURE_DENSITY_CODES = ['DENSE_FIGURE', 'PAGE_FIT_MINIMUM_TEXT', 'EXTREME_ASPECT_RATIO']

function figureDensityNote(plan: any): string | null {
  const issues = Array.isArray(plan?.validationReport?.issues) ? plan.validationReport.issues : []
  const found = issues.find((issue: any) => FIGURE_DENSITY_CODES.includes(issue?.code))
  return typeof found?.message === 'string' ? found.message : null
}

function normalizePageSizes(input: any): string[] {
  if (!input) return []
  if (Array.isArray(input)) return input.flatMap((val) => normalizePageSizes(val))
  if (typeof input === 'string') {
    const trimmed = input.trim()
    return trimmed ? [trimmed] : []
  }
  if (typeof input === 'object') return Object.values(input).flatMap((val) => normalizePageSizes(val))
  return []
}

// The planner's diagram kinds, in the words an attorney uses. The stored value
// is the DIAGRAM_KINDS enum from the pipeline; only the label differs.
const FIGURE_KIND_LABELS: Record<string, string> = {
  COMPONENT: 'Parts & connections',
  PROCESS: 'Step-by-step process',
  SEQUENCE: 'Interaction over time',
  CONSTITUENT: "What it's made of"
}
const FIGURE_KIND_ORDER = ['COMPONENT', 'PROCESS', 'SEQUENCE', 'CONSTITUENT'] as const

type PlanFigure = {
  key: string
  title: string
  purpose: string
  kind: string
  detailLevel?: string
  componentIds?: string[]
  claimCriticalComponentIds?: string[]
}

type DiagramFailurePayload = {
  code?: string
  stage?: string
  title?: string
  whatHappened?: string
  retryable?: boolean
  actions?: string[]
  automaticCorrection?: { attempted?: boolean; attempts?: number; result?: string }
}

// Progress narration for both waits now lives in FigureWorkProgress, which
// describes the checks the server is actually running instead of a flat
// message rotation, and deliberately shows no elapsed timer.

type ActionableErrorPanelProps = {
  message: string
  area: FigurePlannerErrorArea
  details?: string[]
  onRetry?: () => void
  retryLabel?: string
  retrying?: boolean
  onDismiss?: () => void
  failure?: DiagramFailurePayload
}

function ActionableErrorPanel({
  message,
  area,
  details = [],
  onRetry,
  retryLabel = 'Try again',
  retrying = false,
  onDismiss,
  failure,
}: ActionableErrorPanelProps) {
  const fallbackGuidance = explainFigurePlannerError(message, area)
  const guidance = failure ? {
    title: failure.title || fallbackGuidance.title,
    whatHappened: failure.whatHappened || fallbackGuidance.whatHappened,
    actions: failure.actions?.length ? failure.actions : fallbackGuidance.actions,
    autoRecovery: failure.automaticCorrection?.attempted
      ? `The server attempted ${failure.automaticCorrection.attempts || 1} automatic correction${(failure.automaticCorrection.attempts || 1) === 1 ? '' : 's'} before stopping.`
      : fallbackGuidance.autoRecovery,
  } : fallbackGuidance
  const uniqueDetails = Array.from(new Set(details.filter(detail => detail && detail !== message)))

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="rounded-xl border border-red-200 bg-red-50/80 p-4 text-red-950 shadow-sm sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100">
          <AlertCircle className="h-5 w-5 text-red-700" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{guidance.title}</p>
          <p className="mt-1 text-sm leading-relaxed text-red-900">{guidance.whatHappened}</p>

          {guidance.autoRecovery && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
              <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span><span className="font-medium">Automatic recovery:</span> {guidance.autoRecovery}</span>
            </div>
          )}

          <div className="mt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-red-800">What you can do</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm leading-relaxed text-red-900">
              {guidance.actions.map(action => <li key={action}>{action}</li>)}
            </ul>
          </div>

          <details className="mt-3 rounded-lg border border-red-200 bg-white/60 px-3 py-2 text-xs text-red-900">
            <summary className="cursor-pointer font-medium">Technical details</summary>
            <p className="mt-2 whitespace-pre-wrap break-words font-mono">{message}</p>
            {(failure?.code || failure?.stage) && (
              <p className="mt-1 font-mono">{[failure.stage, failure.code].filter(Boolean).join(' / ')}</p>
            )}
            {uniqueDetails.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 font-sans">
                {uniqueDetails.map(detail => <li key={detail}>{detail}</li>)}
              </ul>
            )}
          </details>

          {(onRetry || onDismiss) && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {onRetry && (
                <Button size="sm" onClick={onRetry} disabled={retrying}>
                  {retrying
                    ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                  {retrying ? 'Trying again...' : retryLabel}
                </Button>
              )}
              {onDismiss && (
                <Button size="sm" variant="ghost" onClick={onDismiss}>Dismiss</Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function inferSketchViewType(title: string, description?: string): string {
  const text = `${title || ''} ${description || ''}`.toLowerCase()
  if (/exploded|disassembled/.test(text)) return 'Exploded view'
  if (/cross[- ]?section|sectional|cutaway|internal/.test(text)) return 'Internal view'
  if (/detail|close[- ]?up|enlarged/.test(text)) return 'Detail view'
  if (/install|deploy|mounted|in use/.test(text)) return 'Deployment view'
  if (/interface|screen|display|user interface|\bui\b/.test(text)) return 'Interface view'
  if (/isometric|perspective|three-quarter|3\/4/.test(text)) return 'Perspective view'
  if (/front|rear|back|side|top|bottom|plan view|elevation/.test(text)) return 'Orthographic view'
  return 'Physical view'
}

export default function FigurePlannerStage({ session, patent, onComplete, onRefresh }: FigurePlannerStageProps) {
  const { toast } = useToast()
  const [isGenerating, setIsGenerating] = useState(false)
  const [figures, setFigures] = useState<LLMFigure[]>([])
  const [error, setError] = useState<string | null>(null)
  // Recoverable failures carry their own retry so the user can re-run the exact
  // action that failed instead of reading a raw error string.
  const [generationFailure, setGenerationFailure] = useState<
    { message: string; details: string[]; retry: () => void; failure?: DiagramFailurePayload } | null
  >(null)
  const [generationWarning, setGenerationWarning] = useState<string | null>(null)
  // In AI mode, null/empty means "AI decides the count"
  // User can optionally override by entering a number
  const [diagramCount, setDiagramCount] = useState<number | null>(null)
  
  // Helper for cleaning titles
  const sanitizeFigureLabel = (text?: string | null) => {
    const raw = typeof text === 'string' ? text : ''
    if (!raw.trim()) return ''
    const cpcIpcPattern = /\b(?:CPC|IPC)?\s*(?:class\s*)?[A-H][0-9]{1,2}[A-Z]\s*\d+\/\d+\b/gi
    let cleaned = raw.replace(cpcIpcPattern, '')
    cleaned = cleaned.replace(/\b(?:CPC|IPC)\b[:\-]?\s*/gi, '')
    cleaned = cleaned.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1')
    cleaned = cleaned.replace(/^[\s,:;.-]+|[\s,:;.-]+$/g, '')
    return cleaned.trim()
  }

  const diagramSources = session?.diagramSources || []
  const figurePlans = (session?.figurePlans || []).map((plan: any) => ({
    ...plan,
    title: sanitizeFigureLabel(plan.title) || `Figure ${plan.figureNo}`
  }))
  const figuresSkipped = !!session?.figuresSkipped
  const hasExistingFigures = (session?.figurePlans?.length || 0) > 0 || diagramSources.length > 0
  const extractComponentsFromReferenceMap = (referenceMap: any): any[] => {
    if (!referenceMap?.components) return []
    if (referenceMap.components.components && Array.isArray(referenceMap.components.components)) {
      return referenceMap.components.components
    }
    if (Array.isArray(referenceMap.components)) return referenceMap.components
    return []
  }

  const buildFigureImageUrl = (filename: string) =>
    `/api/projects/${patent.project.id}/patents/${patent.id}/upload?filename=${encodeURIComponent(filename)}`

  // Reference numerals offered by the editor's label picker. Typing a numeral
  // that isn't here is still allowed — parts get added to figures before the
  // reference map catches up.
  const referenceComponents = useMemo(() => {
    const seen = new Set<string>()
    return extractComponentsFromReferenceMap(session?.referenceMap)
      .map((c: any) => ({
        numeral: c?.numeral === undefined || c?.numeral === null ? '' : String(c.numeral).trim(),
        name: String(c?.name || '').trim()
      }))
      .filter((c: any) => {
        if (!c.numeral || seen.has(c.numeral)) return false
        seen.add(c.numeral)
        return true
      })
      .sort((a: any, b: any) => a.numeral.localeCompare(b.numeral, undefined, { numeric: true }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.referenceMap])

  const formatDiagramGenerationWarnings = (response: any): string | null => {
    const messages: string[] = []
    if (Array.isArray(response?.filingReadiness?.reviewNotes) && response.filingReadiness.reviewNotes.length) {
      messages.push(...response.filingReadiness.reviewNotes.map((note: any) => `FIG. ${note.figureNo}: ${note.message}`))
    }
    // A claim-recited component that appears in no drawn figure. Informational:
    // the figures already saved; the attorney decides whether to regenerate.
    if (response?.claimCoverage?.evaluated && Array.isArray(response.claimCoverage.missing) && response.claimCoverage.missing.length) {
      const missing = response.claimCoverage.missing.map((item: any) => {
        const claims = Array.isArray(item.matchedClaims) && item.matchedClaims.length
          ? ` — claim${item.matchedClaims.length === 1 ? '' : 's'} ${item.matchedClaims.join(', ')}`
          : ''
        return `${item.name} (${item.referenceLabel})${claims}`
      })
      messages.push(`Recited in the claims but not shown in any figure: ${missing.join('; ')}.`)
    }
    if (Array.isArray(response?.warnings)) {
      messages.push(...response.warnings.filter((warning: any) => typeof warning === 'string' && warning.trim()))
    }
    if (Array.isArray(response?.failedFigures) && response.failedFigures.length > 0) {
      messages.push(...response.failedFigures.map((failure: any) => {
        const label = failure?.title || (failure?.index ? `Figure ${failure.index}` : 'A diagram')
        return `${label}: ${failure?.reason || 'repair failed'}`
      }))
    }
    // Automatic repairs change what gets filed, so they are always disclosed
    // rather than applied silently.
    if (Array.isArray(response?.figures)) {
      const corrections = Array.from(new Set(
        response.figures.flatMap((figure: any) =>
          Array.isArray(figure?.validation?.corrections) ? figure.validation.corrections : []),
      )) as string[]
      if (corrections.length) {
        messages.push(`Automatic corrections applied: ${corrections.slice(0, 4).join('; ')}${corrections.length > 4 ? `; and ${corrections.length - 4} more` : ''}.`)
      }
    }
    return messages.length > 0 ? messages.join(' ') : null
  }

  // Turns a diagram-pipeline error payload into short human-readable lines.
  // The API returns structured validation issues; rendering the raw JSON was
  // unreadable and made a recoverable failure look catastrophic.
  const describeDiagramFailure = (response: any): string[] => {
    if (!response) return []
    const lines: string[] = []
    const details = response.details
    if (typeof details === 'string' && details.trim()) {
      lines.push(details.trim())
    } else if (Array.isArray(details)) {
      for (const item of details.slice(0, 6)) {
        if (typeof item === 'string') { lines.push(item); continue }
        const figure = item?.figure ? `Figure ${item.figure}: ` : ''
        const message = item?.message || item?.code
        if (message) lines.push(`${figure}${message}`)
      }
      if (details.length > 6) lines.push(`…and ${details.length - 6} more`)
    }
    if (Array.isArray(response.failedFigures)) {
      lines.push(...response.failedFigures.map((failure: any) =>
        `${failure?.title || (failure?.index ? `Figure ${failure.index}` : 'A diagram')}: ${failure?.reason || 'could not be generated'}`))
    }
    return Array.from(new Set(lines))
  }

  const [isUploading, setIsUploading] = useState(false)
  const [isSkippingFigures, setIsSkippingFigures] = useState(false)
  const [isRestoringFigures, setIsRestoringFigures] = useState(false)
  const [uploaded, setUploaded] = useState<Record<string, boolean>>({})
  const [processingStatus, setProcessingStatus] = useState<Record<string, string>>({})
  const [processingStep, setProcessingStep] = useState<Record<string, number>>({})
  const [modifyFigNo, setModifyFigNo] = useState<number | null>(null)
  const [modifyTextSaved, setModifyTextSaved] = useState('')
  // Keyed by figure number: a dense-figure prompt can be open on several cards
  // at once, so the part count cannot be a single shared value.
  const [splitPartsCount, setSplitPartsCount] = useState<Record<number, number>>({})
  const splitPartsFor = (figNo: number) => splitPartsCount[figNo] ?? 2

  /** Splits one figure into N parts. Shared by the dense-figure prompt and the
   *  Request-changes panel so both paths behave identically. */
  const handleSplitFigure = async (figNo: number, instructions?: string) => {
    const parts = splitPartsFor(figNo)
    // Splitting overwrites this figure with part 1 and there is no undo, so the
    // replacement is confirmed the same way an expert-override replacement is.
    const confirmed = window.confirm(
      `Split FIG. ${figNo} into ${parts} figures?\n\n`
      + `FIG. ${figNo} will be replaced by the first part, and ${parts - 1} new figure${parts === 2 ? '' : 's'} will be added at the end of the set.\n`
      + 'The current version of this figure cannot be recovered, and figure ordering will reset.',
    )
    if (!confirmed) return
    const request = { action: 'split_figure_llm', sessionId: session?.id, figureNo: figNo, parts, instructions }
    setRegeneratingFigure(prev => ({ ...prev, [figNo]: true }))
    setError(null)
    setGenerationWarning(null)
    try {
      let resp = await onComplete(request)
      if (resp?.code === 'RAW_OVERRIDE_CONFIRMATION_REQUIRED'
        && window.confirm('This figure contains expert PlantUML customizations. Replace them with managed sub-figures?')) {
        resp = await onComplete({ ...request, confirmRawReplacement: true })
      }
      if (resp?.success) {
        setGenerationWarning(formatDiagramGenerationWarnings(resp))
        await onRefresh()
        setModifyFigNo(null)
        setModifyTextSaved('')
      } else if (resp?.error) {
        setError(`Figure split failed: ${resp.error}`)
      }
    } catch (e) {
      setError(e instanceof Error ? `Failed to split: ${e.message}` : 'Failed to split figure')
    } finally {
      setRegeneratingFigure(prev => ({ ...prev, [figNo]: false }))
    }
  }
  const [regeneratingFigure, setRegeneratingFigure] = useState<Record<number, boolean>>({})
  const [isViewing, setIsViewing] = useState<Record<number, boolean>>({})
  const [rendering, setRendering] = useState<Record<string, boolean>>({})
  const [renderPreview, setRenderPreview] = useState<Record<string, string | null>>({})
  const [expandedFigNo, setExpandedFigNo] = useState<number | null>(null)
  // Manual mode: figures are added one at a time rather than asking for a count
  // up front and rendering that many blank boxes. `kind` empty means the AI
  // picks the diagram type, which is the default.
  const [manualFigures, setManualFigures] = useState<Array<{ id: string; text: string; kind: string }>>(
    () => [{ id: `manual-fig-${Date.now()}`, text: '', kind: '' }]
  )
  const manualFiguresReady = manualFigures.filter(f => f.text.trim().length > 0)
  const [stateInitialized, setStateInitialized] = useState(false)

  // UI Mode state
  const [mode, setMode] = useState<'ai' | 'manual'>('ai')
  const [includeExistingFigures, setIncludeExistingFigures] = useState(true)
  // Default to replacing: the primary Generate button plans a complete figure
  // set, so appending would duplicate coverage. This especially matters after
  // an interrupted run — the server may have persisted the first set even
  // though the client never saw the response, and a retry that appended used
  // to double the set to 10-15 figures. Append stays available by unchecking.
  const [replaceExistingDiagrams, setReplaceExistingDiagrams] = useState(true)


  const [manualUploadSlots, setManualUploadSlots] = useState<ManualUploadSlot[]>([])
  const [showManual, setShowManual] = useState(false)
  const [manualDetectingAll, setManualDetectingAll] = useState(false)
  const [manualDetectionProgress, setManualDetectionProgress] = useState<{ current: number; total: number } | null>(null)
  const [retryingImageAnalysis, setRetryingImageAnalysis] = useState<Record<string, boolean>>({})
  const manualUploadSlotsRef = useRef<ManualUploadSlot[]>([])
  const [showPlantUML, setShowPlantUML] = useState<Record<number, boolean>>({})
  const [plantUmlDrafts, setPlantUmlDrafts] = useState<Record<number, string>>({})
  const [savingPlantUml, setSavingPlantUml] = useState<Record<number, boolean>>({})
  const [countryProfile, setCountryProfile] = useState<any | null>(null)
  const uploadSectionRef = useRef<HTMLDivElement>(null)
  const [highlightUpload, setHighlightUpload] = useState(false)
  const renderQueueRef = useRef<Promise<void>>(Promise.resolve())
  // Ref to hold latest handleUploadImage function to avoid stale closures in queueUpload
  const handleUploadImageRef = useRef<((figureNo: number, file: File, customFilename?: string, language?: string, opEpoch?: number) => Promise<void>) | null>(null)

  useEffect(() => {
    manualUploadSlotsRef.current = manualUploadSlots
  }, [manualUploadSlots])

  useEffect(() => {
    return () => {
      manualUploadSlotsRef.current.forEach(slot => {
        if (slot.previewUrl) URL.revokeObjectURL(slot.previewUrl)
      })
    }
  }, [])

  // === FIGURE PLANNER TAB STATE ===
  const [activeTab, setActiveTab] = useState<'diagrams' | 'sketches' | 'arrange'>('diagrams')

  // === PLAN REVIEW STATE ===
  // The figure plan is approved before anything is drawn, so a wrong figure is
  // caught before it costs a render. `planFigures` holds the attorney's edits;
  // the server keeps the authoritative plan (component ids and the rest).
  const [planFigures, setPlanFigures] = useState<PlanFigure[] | null>(null)
  const [isPlanning, setIsPlanning] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)
  const [planDirty, setPlanDirty] = useState(false)

  
  // === ARRANGE TAB STATE ===
  const [arrangedFigures, setArrangedFigures] = useState<any[]>([])
  const [arrangeLoading, setArrangeLoading] = useState(false)
  const [arrangeError, setArrangeError] = useState<string | null>(null)
  const [isSequenceFinalized, setIsSequenceFinalized] = useState(false)
  const [selectedArrangeFigure, setSelectedArrangeFigure] = useState<any | null>(null)
  const [aiInsight, setAiInsight] = useState<string | null>(null)
  const [aiReasons, setAiReasons] = useState<Array<{ id: string; title: string; reason: string; finalFigNo?: number }> | null>(null)
  const [aiArranging, setAiArranging] = useState(false)
  const [savingSequence, setSavingSequence] = useState(false)
  const [showUnlockPrompt, setShowUnlockPrompt] = useState(false)
  
  // === SKETCH TAB STATE ===
  const [sketches, setSketches] = useState<any[]>([])
  const [sketchesLoading, setSketchesLoading] = useState(false)
  const [sketchSuggestions, setSketchSuggestions] = useState<any[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null)
  // "Zero suggestions" is a normal outcome for abstract inventions, not an error.
  // Held separately so it renders as an explanation rather than a red alert.
  const [suggestionsNotice, setSuggestionsNotice] = useState<string | null>(null)
  const [sketchError, setSketchError] = useState<string | null>(null)
  const [sketchGenerating, setSketchGenerating] = useState(false)
  const [sketchMode, setSketchMode] = useState<'auto' | 'guided' | 'refine'>('auto')
  const [sketchPrompt, setSketchPrompt] = useState('')
  const [sketchTitle, setSketchTitle] = useState('')
  const [sketchUploadFile, setSketchUploadFile] = useState<File | null>(null)
  const [sketchUploadPreview, setSketchUploadPreview] = useState<string | null>(null)
  const [expandedSketchId, setExpandedSketchId] = useState<string | null>(null)
  const [modifyingSketchId, setModifyingSketchId] = useState<string | null>(null)
  const [modifySketchPrompt, setModifySketchPrompt] = useState('')
  const sketchFileInputRef = useRef<HTMLInputElement>(null)
  // Reference figure selection for sketch suggestions
  const [showReferenceSelector, setShowReferenceSelector] = useState(false)
  const [selectedReferenceFigures, setSelectedReferenceFigures] = useState<string[]>([])
  // Reference sketch selection for visual style consistency (passes actual images to AI)
  const [selectedReferenceSketchIds, setSelectedReferenceSketchIds] = useState<string[]>([])
  const persistentSketchSuggestions = sketches.filter(sketch => sketch.status === 'SUGGESTED')
  const displayedSketchSuggestions = [
    ...persistentSketchSuggestions,
    ...sketchSuggestions.filter(suggestion => !persistentSketchSuggestions.some(persisted =>
      persisted.title === suggestion.title && persisted.description === suggestion.description)),
  ]

  // === IMAGE EDITOR STATE ===
  const [imageEditorOpen, setImageEditorOpen] = useState(false)
  const [editingImage, setEditingImage] = useState<{
    type: 'diagram' | 'sketch'
    id: string | number  // figureNo for diagrams, id for sketches
    imagePath: string    // image the editor draws on (the pristine base when annotations exist)
    baseImageFilename?: string | null
    title: string
    originalImagePath?: string | null
    language?: string  // diagram language variant, so edits hit the right DiagramSource row
    shapes?: any[]     // previously saved annotation layer, re-applied on open
  } | null>(null)
  const [savingEditedImage, setSavingEditedImage] = useState(false)

  // === TRANSLATION STATE ===
  const [showTranslateModal, setShowTranslateModal] = useState(false)
  const [translateTargetLang, setTranslateTargetLang] = useState('')
  const [translateFigureNo, setTranslateFigureNo] = useState<number | null>(null) // null = translate all
  const [translating, setTranslating] = useState(false)
  const [translateProgress, setTranslateProgress] = useState<{ current: number; total: number } | null>(null)
  const [diagramTranslations, setDiagramTranslations] = useState<Record<number, Array<{ language: string; id: string; hasImage: boolean }>>>({})
  // Track selected language tab per figure (for multi-language view)
  const [selectedLangByFigure, setSelectedLangByFigure] = useState<Record<number, string>>({})

  // Language labels for translation UI
  const LANGUAGE_LABELS: Record<string, string> = {
    en: 'English',
    hi: 'Hindi (हिन्दी)',
    ja: 'Japanese (日本語)',
    zh: 'Chinese (中文)',
    ko: 'Korean (한국어)',
    de: 'German (Deutsch)',
    fr: 'French (Français)',
    es: 'Spanish (Español)',
    pt: 'Portuguese (Português)',
    it: 'Italian (Italiano)',
    ru: 'Russian (Русский)',
    ar: 'Arabic (العربية)',
    nl: 'Dutch (Nederlands)',
    sv: 'Swedish (Svenska)',
    th: 'Thai (ไทย)',
    vi: 'Vietnamese (Tiếng Việt)'
  }

  const activeJurisdiction = (session?.activeJurisdiction || session?.draftingJurisdictions?.[0] || 'IN').toUpperCase()

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const res = await fetch(`/api/country-profiles/${activeJurisdiction}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}` }
        })
        if (res.ok) {
          const data = await res.json()
          setCountryProfile(data?.profile || null)
        } else if (res.status === 404) {
          // Country profile not found, use defaults
          console.warn(`Country profile for ${activeJurisdiction} not found, using defaults`)
          setCountryProfile(null)
        } else {
          console.warn('Failed to load country profile for figures', res.status, res.statusText)
        }
      } catch (e) {
        console.warn('Failed to load country profile for figures', e)
        setCountryProfile(null)
      }
    }
    loadProfile()
  }, [activeJurisdiction])

  const countWords = (text: string) => (text || '').trim().split(/\s+/).filter(Boolean).length
  const getDiagramKey = (figureNo: number, language?: string | null) => `${figureNo}_${(language || 'en').toLowerCase()}`
  const preferredFigureLanguage = useMemo(() => {
    const status = (session as any)?.jurisdictionDraftStatus || {}
    const explicitFiguresLang = typeof status.__figuresLanguage === 'string' && status.__figuresLanguage.trim()
      ? status.__figuresLanguage.trim().toLowerCase()
      : null
    const activeLang = typeof status?.[activeJurisdiction]?.language === 'string' && status?.[activeJurisdiction]?.language.trim()
      ? status[activeJurisdiction].language.trim().toLowerCase()
      : null
    const commonLang = typeof status.__commonLanguage === 'string' && status.__commonLanguage.trim()
      ? status.__commonLanguage.trim().toLowerCase()
      : null
    return explicitFiguresLang || activeLang || commonLang || 'en'
  }, [session?.jurisdictionDraftStatus, activeJurisdiction])

  // Group diagram sources by figure number for language-tabbed view
  const diagramsByFigure = useMemo(() => {
    const grouped: Record<number, any[]> = {}
    diagramSources.forEach((ds: any) => {
      const figNo = ds.figureNo
      if (!grouped[figNo]) grouped[figNo] = []
      grouped[figNo].push(ds)
    })
    // Keep languages sorted for stable tab order (English first)
    Object.values(grouped).forEach(list => {
      list.sort((a: any, b: any) => {
        const la = (a.language || 'en').toLowerCase()
        const lb = (b.language || 'en').toLowerCase()
        if (la === 'en' && lb !== 'en') return -1
        if (lb === 'en' && la !== 'en') return 1
        return la.localeCompare(lb)
      })
    })
    return grouped
  }, [diagramSources])

  const hasActiveDiagramImageAnalysis = useMemo(() => {
    return diagramSources.some((source: any) => {
      const status = normalizeDiagramImageAnalysisStatus(source?.imageAnalysisStatus)
      return status === 'QUEUED' || status === 'PROCESSING'
    })
  }, [diagramSources])

  useEffect(() => {
    if (!hasActiveDiagramImageAnalysis || !session?.id) return
    const interval = window.setInterval(() => {
      void onRefresh().catch((err) => console.warn('Failed to refresh diagram image analysis status:', err))
    }, 5000)
    return () => window.clearInterval(interval)
  }, [hasActiveDiagramImageAnalysis, onRefresh, session?.id])

  // Default selected language per figure to English (or first available)
  useEffect(() => {
    const updates: Record<number, string> = {}
    Object.entries(diagramsByFigure).forEach(([figNoStr, list]) => {
      const figNo = Number(figNoStr)
      if (selectedLangByFigure[figNo]) return
      const langs = list.map((d: any) => (d.language || 'en').toLowerCase())
      const preferred = langs.includes(preferredFigureLanguage)
        ? preferredFigureLanguage
        : langs.includes('en')
          ? 'en'
          : langs[0]
      if (preferred) updates[figNo] = preferred
    })
    if (Object.keys(updates).length > 0) {
      setSelectedLangByFigure(prev => ({ ...prev, ...updates }))
    }
  }, [diagramsByFigure, selectedLangByFigure, preferredFigureLanguage])

  // Load diagram translations on mount
  useEffect(() => {
    const loadTranslations = async () => {
      if (!session?.id || !patent?.id) return
      try {
        const res = await fetch(`/api/patents/${patent.id}/drafting`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
          },
          body: JSON.stringify({
            action: 'get_diagram_translations',
            sessionId: session.id
          })
        })
        if (res.ok) {
          const data = await res.json()
          setDiagramTranslations(data.translations || {})
        }
      } catch (err) {
        console.warn('Failed to load diagram translations:', err)
      }
    }
    loadTranslations()
  }, [session?.id, patent?.id, diagramSources])

  // Handle translating a single diagram or all diagrams
  const handleTranslateDiagrams = async () => {
    if (!translateTargetLang || translating) return

    setTranslating(true)
    setTranslateProgress(null)

    try {
      if (translateFigureNo !== null) {
        // Single diagram translation
        const res = await fetch(`/api/patents/${patent?.id}/drafting`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
          },
          body: JSON.stringify({
            action: 'translate_plantuml',
            sessionId: session?.id,
            figureNo: translateFigureNo,
            targetLanguage: translateTargetLang,
            sourceLanguage: 'en'
          })
        })

        const data = await res.json()
        if (!res.ok) {
          throw new Error(data.error || 'Translation failed')
        }

        // Refresh to load new translation
        await onRefresh()
        
        toast({ title: `Figure ${translateFigureNo} translated to ${LANGUAGE_LABELS[translateTargetLang] || translateTargetLang}`, variant: 'success' })
      } else {
        // Translate all diagrams - process one by one with progress
        const englishDiagrams = diagramSources.filter((d: any) => !d.language || d.language === 'en')
        const total = englishDiagrams.length
        
        if (total === 0) {
          toast({ title: 'No English diagrams found to translate', variant: 'warning' })
          return
        }

        let successCount = 0
        let failCount = 0

        for (let i = 0; i < englishDiagrams.length; i++) {
          const d = englishDiagrams[i]
          setTranslateProgress({ current: i + 1, total })

          try {
            const res = await fetch(`/api/patents/${patent?.id}/drafting`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
              },
              body: JSON.stringify({
                action: 'translate_plantuml',
                sessionId: session?.id,
                figureNo: d.figureNo,
                targetLanguage: translateTargetLang,
                sourceLanguage: 'en'
              })
            })

            if (res.ok) {
              successCount++
            } else {
              failCount++
            }
          } catch {
            failCount++
          }
        }

        // Refresh to load new translations
        await onRefresh()

        toast({
          title: 'Translation complete',
          description: `${successCount} diagram${successCount === 1 ? '' : 's'} translated${failCount > 0 ? `, ${failCount} failed` : ''}.`,
          variant: failCount > 0 ? 'warning' : 'success'
        })
      }

      setShowTranslateModal(false)
      setTranslateTargetLang('')
      setTranslateFigureNo(null)
      
      // Refresh translations list
      const res = await fetch(`/api/patents/${patent?.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'get_diagram_translations',
          sessionId: session?.id
        })
      })
      if (res.ok) {
        const data = await res.json()
        setDiagramTranslations(data.translations || {})
      }
    } catch (err) {
      console.error('Translation error:', err)
      toast({
        title: 'Translation failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'error'
      })
    } finally {
      setTranslating(false)
      setTranslateProgress(null)
    }
  }

  // Get available jurisdictions with their languages for translation target options
  const getAvailableTargetLanguages = () => {
    const jurisdictions = session?.draftingJurisdictions || []
    const status = (session as any)?.jurisdictionDraftStatus || {}
    const languages: Set<string> = new Set()
    
    // Always include English as base
    languages.add('en')
    
    // Add languages from selected jurisdictions
    jurisdictions.forEach((code: string) => {
      const lang = status[code]?.language
      if (lang && lang !== 'en') {
        languages.add(lang)
      }
    })
    
    // Add common translation languages
    const commonLangs = ['ja', 'zh', 'ko', 'de', 'fr', 'es', 'hi']
    commonLangs.forEach(l => languages.add(l))
    
    return Array.from(languages).filter(l => l !== 'en') // Exclude English as target (source is English)
  }

  // Animated dots component for waiting states
  // Handle upload button click with scroll and animation
  const handleUploadToggle = () => {
    const newShowManual = !showManual
    setShowManual(newShowManual)

    if (newShowManual) {
      setManualUploadSlots(prev => prev.length > 0 ? prev : [createManualUploadSlot()])
      // Scroll to upload section after a brief delay to allow animation to start
      setTimeout(() => {
        uploadSectionRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        })
        // Trigger highlight animation
        setHighlightUpload(true)
        setTimeout(() => setHighlightUpload(false), 2000)
      }, 100)
    }
  }

  // Render-pipeline status messages, in the order the steps actually run
  const intelligentMessages = [
    "Preparing diagram...",
    "Rendering diagram...",
    "Processing image...",
    "Saving image..."
  ]

  // Track which figures have been queued for rendering to prevent duplicate calls (language-aware)
  const queuedForRenderRef = useRef<Set<string>>(new Set())
  // Track figures that have already had one centralized validation/re-render attempt.
  // This ref is NEVER cleared by useEffects - only manually by user clicking "Retry Render"
  const autoFixAttemptedRef = useRef<Set<string>>(new Set())
  // Increment to invalidate in-flight renders/uploads when a figure is deleted.
  const diagramOpEpochRef = useRef<Record<string, number>>({})
  const getDiagramOpEpoch = useCallback((key: string) => diagramOpEpochRef.current[key] ?? 0, [])
  const bumpDiagramOpEpoch = useCallback((key: string) => {
    const next = (diagramOpEpochRef.current[key] ?? 0) + 1
    diagramOpEpochRef.current[key] = next
    return next
  }, [])
  const renderAbortControllersRef = useRef<Record<string, AbortController | null>>({})
  const uploadQueueRef = useRef<Promise<void>>(Promise.resolve())
  const [uploadingByKey, setUploadingByKey] = useState<Record<string, boolean>>({})

  // Cleanup effect: abort pending requests and revoke blob URLs on unmount
  useEffect(() => {
    const controllersRef = renderAbortControllersRef
    return () => {
      // Abort all pending render requests
      Object.values(controllersRef.current).forEach(controller => {
        try { controller?.abort() } catch {}
      })
      controllersRef.current = {}
    }
  }, [])

  // Cleanup blob URLs on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      // Revoke all blob URLs stored in renderPreview
      Object.values(renderPreview).forEach(url => {
        if (url && typeof url === 'string' && url.startsWith('blob:')) {
          try { URL.revokeObjectURL(url) } catch {}
        }
      })
    }
  }, []) // Empty deps - only run on unmount

  // Automatically process diagrams when PlantUML code is available
  // This effect runs after state initialization and when diagramSources change
  useEffect(() => {
    if (!stateInitialized) return

    // Immediate processing without delay for better responsiveness
    diagramSources.forEach((d: any) => {
      const figNo = d.figureNo
      const lang = (d.language || 'en').toLowerCase()
      const key = getDiagramKey(figNo, lang)
      // Check all conditions for auto-rendering:
      // 1. Has PlantUML code
      // 2. Not already uploaded/rendered
      // 3. No existing image
      // 4. Not currently rendering
      // 5. No processing status (not in progress or failed)
      // 6. Not already queued for rendering (prevents duplicate calls)
      // 7. Not already attempted centralized repair (prevents retry loops after failure)
      const hasFailedAutoFix = autoFixAttemptedRef.current.has(key)
      const shouldRender =
        d.plantumlCode &&
        !uploaded[key] &&
        !d.imageUploadedAt &&
        !rendering[key] &&
        !processingStatus[key] &&
        !queuedForRenderRef.current.has(key) &&
        !hasFailedAutoFix  // Don't auto-render if auto-fix was already attempted

      if (shouldRender) {
        const opEpoch = getDiagramOpEpoch(key)
        queuedForRenderRef.current.add(key)
        autoProcessDiagram(figNo, d.plantumlCode, lang, opEpoch)
      }
    })
  }, [diagramSources, uploaded, rendering, processingStatus, stateInitialized])

  // Initialize state for new figures when diagramSources changes
  // Also reset uploaded state when image data is cleared (e.g., after regeneration)
  useEffect(() => {
    const newFigureNos = diagramSources.map((d: any) => d.figureNo)
    const newDiagramKeys = diagramSources.map((d: any) => getDiagramKey(d.figureNo, d.language || 'en'))
    setUploaded((prev) => {
      const updated = { ...prev }
      diagramSources.forEach((d: any) => {
        const key = getDiagramKey(d.figureNo, d.language || 'en')
        // For diagrams without an image, clear the queued ref to allow re-rendering
        // BUT: Don't clear if auto-fix was already attempted - prevents infinite retry loops
        // Users must manually click "Retry Render" to attempt again after a failure
        if (!d?.imageUploadedAt && !autoFixAttemptedRef.current.has(key)) {
          queuedForRenderRef.current.delete(key)
        }
        // Reset uploaded to false if no image exists OR if imageUploadedAt is null (cleared after regeneration)
        if (updated[key] === undefined || (!d?.imageUploadedAt && updated[key] !== false)) {
          updated[key] = false
        }
      })
      return updated
    })
    setRendering((prev) => {
      const updated = { ...prev }
      newDiagramKeys.forEach((key: string) => {
        if (updated[key] === undefined) updated[key] = false
      })
      return updated
    })
    setProcessingStatus((prev) => {
      const updated = { ...prev }
      diagramSources.forEach((d: any) => {
        const key = getDiagramKey(d.figureNo, d.language || 'en')
        // Clear processing status if: new key OR diagram has code but no image (needs re-rendering)
        // BUT: DO NOT clear if status contains "Failed" - this prevents infinite retry loops
        // Users must manually click "Retry Render" to attempt again after a failure
        const currentStatus = updated[key] || ''
        const isFailed = currentStatus.toLowerCase().includes('failed')
        if (updated[key] === undefined || (d.plantumlCode && !d.imageUploadedAt && !isFailed)) {
          updated[key] = ''
        }
      })
      return updated
    })
    setProcessingStep((prev) => {
      const updated = { ...prev }
      diagramSources.forEach((d: any) => {
        const key = getDiagramKey(d.figureNo, d.language || 'en')
        // Clear processing step if: new key OR diagram has code but no image (needs re-rendering)
        // BUT: DO NOT clear if step is -1 (failed) - this prevents infinite retry loops
        const currentStep = updated[key]
        const isFailed = currentStep === -1
        if (updated[key] === undefined || (d.plantumlCode && !d.imageUploadedAt && !isFailed)) {
          updated[key] = 0
        }
      })
      return updated
    })
    setRenderPreview((prev) => {
      const updated = { ...prev }
      newDiagramKeys.forEach((key: string) => {
        if (updated[key] === undefined) updated[key] = null
      })
      return updated
    })
    setIsViewing((prev) => {
      const updated = { ...prev }
      newFigureNos.forEach((no: number) => {
        if (updated[no] === undefined) updated[no] = false
      })
      return updated
    })
    setStateInitialized(true)
  }, [diagramSources])

  // === SKETCH TAB EFFECTS AND FUNCTIONS ===
  
  // Load sketches when tab changes to sketches
  useEffect(() => {
    if (activeTab === 'sketches' && session?.id) {
      loadSketches()
    }
  }, [activeTab, session?.id])

  // === ARRANGE TAB EFFECTS AND FUNCTIONS ===
  
  // DnD Kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 5px movement before drag starts
      }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const [activeDragId, setActiveDragId] = useState<string | null>(null)

  // Load combined figures when arrange tab is active
  useEffect(() => {
    if (activeTab === 'arrange' && session?.id) {
      loadCombinedFigures()
    }
  }, [activeTab, session?.id])

  const loadCombinedFigures = async () => {
    if (!session?.id) return
    
    try {
      setArrangeLoading(true)
      setArrangeError(null)
      
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'get_combined_figures',
          sessionId: session.id
        })
      })
      
      if (!res.ok) throw new Error('Failed to load figures')
      
      const data = await res.json()
      setArrangedFigures(data.figures || [])
      setIsSequenceFinalized(data.isFinalized || false)
      setAiReasons(null)
      if (data.figures?.length > 0 && !selectedArrangeFigure) {
        setSelectedArrangeFigure(data.figures[0])
      }
    } catch (err) {
      setArrangeError(err instanceof Error ? err.message : 'Failed to load figures')
    } finally {
      setArrangeLoading(false)
    }
  }

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(event.active.id as string)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    setActiveDragId(null)

    if (!over || active.id === over.id) return
    if (isSequenceFinalized) return

    const oldIndex = arrangedFigures.findIndex(f => f.id === active.id)
    const newIndex = arrangedFigures.findIndex(f => f.id === over.id)

    if (oldIndex !== -1 && newIndex !== -1) {
      const newOrder = arrayMove(arrangedFigures, oldIndex, newIndex)
      // Update finalFigNo for each item
      const updatedOrder = newOrder.map((fig, idx) => ({
        ...fig,
        finalFigNo: idx + 1
      }))
      setArrangedFigures(updatedOrder)
      
      // Fix #4: Update selected figure to reflect new position
      if (selectedArrangeFigure) {
        const updatedSelected = updatedOrder.find(f => f.id === selectedArrangeFigure.id)
        if (updatedSelected) {
          setSelectedArrangeFigure(updatedSelected)
        }
      }
      
      // Auto-save the sequence; refetch if persistence fails so UI stays backend-aligned.
      const saved = await saveSequence(updatedOrder)
      if (!saved) {
        await loadCombinedFigures()
      }
    }
  }

  const saveSequence = async (figures: any[]): Promise<boolean> => {
    if (!session?.id) return false
    
    try {
      setSavingSequence(true)
      setArrangeError(null)
      const sequence = figures.map(f => ({
        id: f.id,
        type: f.type,
        sourceId: f.sourceId,
        finalFigNo: f.finalFigNo
      }))

      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'save_figure_sequence',
          sessionId: session.id,
          sequence
        })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to save figure sequence')
      }
      if (Array.isArray(data?.sequence)) {
        setArrangedFigures((current) => {
          const byId = new Map(current.map((f: any) => [f.id, f]))
          return data.sequence.map((item: any) => ({
            ...(byId.get(item.id) || {}),
            ...item
          }))
        })
      }
      return true
    } catch (err) {
      console.error('Failed to save sequence:', err)
      setArrangeError(err instanceof Error ? err.message : 'Failed to save figure sequence')
      return false
    } finally {
      setSavingSequence(false)
    }
  }

  const handleAIArrange = async () => {
    if (!session?.id) return
    // Guard: Need at least 2 figures to arrange
    if (arrangedFigures.length < 2) {
      setArrangeError('Need at least 2 figures to use AI arrangement')
      return
    }
    
    try {
      setAiArranging(true)
      setArrangeError(null)
      setAiInsight(null)
      setAiReasons(null)
      
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'ai_arrange_figures',
          sessionId: session.id
        })
      })
      
      if (!res.ok) throw new Error('Failed to arrange figures')
      
      const data = await res.json()
      if (data.sequence) {
        setArrangedFigures(data.sequence)
        setAiReasons(data.reasons || null)
        // Fix #4: Preserve selection if possible, otherwise select first
        if (selectedArrangeFigure) {
          const updatedSelected = data.sequence.find((f: any) => f.id === selectedArrangeFigure.id)
          setSelectedArrangeFigure(updatedSelected || data.sequence[0] || null)
        } else if (data.sequence.length > 0) {
          setSelectedArrangeFigure(data.sequence[0])
        }
      }
      if (data.insight) {
        setAiInsight(data.insight)
        setAiReasons(data.reasons || null)
      }
      
      // Save the AI-suggested sequence
      if (data.sequence) {
        const saved = await saveSequence(data.sequence)
        if (!saved) await loadCombinedFigures()
      }
    } catch (err) {
      setArrangeError(err instanceof Error ? err.message : 'Failed to arrange figures')
    } finally {
      setAiArranging(false)
    }
  }

  const handleFinalizeSequence = async () => {
    if (!session?.id) return
    
    try {
      setSavingSequence(true)
      
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'finalize_figure_sequence',
          sessionId: session.id
        })
      })
      
      if (!res.ok) throw new Error('Failed to finalize sequence')
      
      setIsSequenceFinalized(true)
    } catch (err) {
      setArrangeError(err instanceof Error ? err.message : 'Failed to finalize sequence')
    } finally {
      setSavingSequence(false)
    }
  }

  const handleUnlockSequence = async () => {
    if (!session?.id) return
    
    try {
      setSavingSequence(true)
      
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'unlock_figure_sequence',
          sessionId: session.id
        })
      })
      
      if (!res.ok) throw new Error('Failed to unlock sequence')
      
      setIsSequenceFinalized(false)
    } catch (err) {
      setArrangeError(err instanceof Error ? err.message : 'Failed to unlock sequence')
    } finally {
      setSavingSequence(false)
    }
  }

  const handleResetSequence = async () => {
    // Reload original order
    await loadCombinedFigures()
    setAiInsight(null)
    setAiReasons(null)
  }

  const loadSketches = async () => {
    if (!session?.id) return
    
    try {
      setSketchesLoading(true)
      setSketchError(null)
      
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'list_sketches',
          sessionId: session.id
        })
      })
      
      if (!res.ok) throw new Error('Failed to load sketches')
      
      const data = await res.json()
      setSketches(data.sketches || [])
    } catch (err) {
      setSketchError(err instanceof Error ? err.message : 'Failed to load sketches')
    } finally {
      setSketchesLoading(false)
    }
  }

  // === IMAGE EDITOR FUNCTIONS ===

  // Open the in-browser image editor. When a saved annotation layer exists the
  // editor must draw on the pristine original, otherwise the previous edits
  // would be baked into the base image and re-applied on top of themselves.
  const openImageEditor = (opts: {
    type: 'diagram' | 'sketch'
    id: string | number
    title: string
    imageFilename?: string | null
    originalImageFilename?: string | null
    fallbackImagePath: string
    originalImagePath?: string | null
    language?: string
    annotations?: any
  }) => {
    const shapes = Array.isArray(opts.annotations?.shapes) ? opts.annotations.shapes : []
    const baseFilename = shapes.length
      ? opts.originalImageFilename || opts.imageFilename
      : opts.imageFilename
    setEditingImage({
      type: opts.type,
      id: opts.id,
      title: opts.title,
      imagePath: baseFilename ? buildFigureImageUrl(baseFilename) : opts.fallbackImagePath,
      baseImageFilename: baseFilename || null,
      originalImagePath: opts.originalImagePath,
      language: opts.language,
      shapes
    })
    setImageEditorOpen(true)
  }

  // Handle save from the image editor (receives base64 directly)
  const handleImageEditorSave = async (base64: string, imageObject: any, annotations?: any) => {
    if (!editingImage) return
    
    try {
      setSavingEditedImage(true)
      setError(null)
      
      const updateRes = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'update_image',
          sessionId: session?.id,
          type: editingImage.type,
          id: editingImage.id,
          language: editingImage.language,
          imageBase64: base64,
          filename: `${editingImage.title.replace(/[^a-zA-Z0-9]/g, '_')}_edited.png`,
          preserveOriginal: true,
          // Editable layer stored beside the flattened PNG so edits stay revisable.
          annotations: annotations ?? null
        })
      })
      
      if (!updateRes.ok) {
        const errData = await updateRes.json().catch(() => ({}))
        const detail = Array.from(new Set([errData.error, errData.reason].filter(Boolean))).join(' — ')
        throw new Error(detail || `Failed to save edited image (HTTP ${updateRes.status})`)
      }
      
      // Close editor and refresh
      setImageEditorOpen(false)
      setEditingImage(null)
      
      // Refresh data based on type
      if (editingImage.type === 'sketch') {
        await loadSketches()
      } else {
        await onRefresh()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save edited image')
      // Re-throw so the editor can show the reason inline; its modal covers this
      // component's error banner, so a swallowed failure looks like nothing happened.
      throw err
    } finally {
      setSavingEditedImage(false)
    }
  }

  // Close image editor without saving
  const handleImageEditorClose = () => {
    setImageEditorOpen(false)
    setEditingImage(null)
  }

  // Restore original image
  const restoreOriginalImage = async () => {
    if (!editingImage || !editingImage.originalImagePath) return
    
    if (!confirm('Restore the original AI-generated image? This will discard your edits.')) return
    
    try {
      setSavingEditedImage(true)
      
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'restore_original_image',
          sessionId: session?.id,
          type: editingImage.type,
          id: editingImage.id,
          language: editingImage.language
        })
      })
      
      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || 'Failed to restore original')
      }
      
      setImageEditorOpen(false)
      setEditingImage(null)
      
      if (editingImage.type === 'sketch') {
        await loadSketches()
      } else {
        await onRefresh()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore original')
    } finally {
      setSavingEditedImage(false)
    }
  }

  const handleGenerateSketch = async () => {
    if (!session?.id) return
    
    // Validation
    if (sketchMode === 'guided' && sketchPrompt.trim().length < 10) {
      setSketchError('Please provide at least 10 characters of instructions')
      return
    }
    if (sketchMode === 'refine' && !sketchUploadFile) {
      setSketchError('Please upload a sketch to refine')
      return
    }
    
    try {
      setSketchGenerating(true)
      setSketchError(null)
      
      let action = 'generate_sketch'
      let body: any = {
        sessionId: session.id,
        title: sketchTitle || undefined,
        contextFlags: {
          useIdeaSummary: true,
          useClaims: true,
          useDiagrams: true,
          useComponents: true
        },
        // Pass selected reference sketch IDs for visual style consistency
        referenceSketchIds: selectedReferenceSketchIds.length > 0 ? selectedReferenceSketchIds : undefined
      }
      
      if (sketchMode === 'guided') {
        action = 'generate_sketch_guided'
        body.userPrompt = sketchPrompt
      } else if (sketchMode === 'refine') {
        action = 'refine_sketch'
        body.userPrompt = sketchPrompt || undefined
        
        // Convert file to base64
        if (sketchUploadFile) {
          const reader = new FileReader()
          const base64 = await new Promise<string>((resolve, reject) => {
            reader.onload = () => {
              const result = reader.result as string
              resolve(result.split(',')[1]) // Remove data URL prefix
            }
            reader.onerror = reject
            reader.readAsDataURL(sketchUploadFile)
          })
          body.uploadedImageBase64 = base64
          body.uploadedImageMimeType = sketchUploadFile.type
        }
      }
      
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({ action, ...body })
      })
      
      const data = await res.json()
      
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Sketch generation failed')
      }
      
      // Refresh sketches list
      await loadSketches()
      
      // Reset form
      setSketchPrompt('')
      setSketchTitle('')
      setSketchUploadFile(null)
      setSketchUploadPreview(null)
      
    } catch (err) {
      setSketchError(err instanceof Error ? err.message : 'Sketch generation failed')
    } finally {
      setSketchGenerating(false)
    }
  }

  const handleGenerateSketchSuggestions = async () => {
    if (!session?.id) return

    try {
      setSuggestionsLoading(true)
      setSuggestionsError(null)
      setSuggestionsNotice(null)

      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'generate_sketch_suggestions',
          sessionId: session.id,
          // Pass selected reference figures (optional)
          referenceFigureIds: selectedReferenceFigures.length > 0 ? selectedReferenceFigures : undefined
        })
      })

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        throw new Error(data?.error || 'Couldn\'t reach the suggestion service. Please try again.')
      }

      const returned: any[] = Array.isArray(data?.suggestions) ? data.suggestions : []

      if (returned.length > 0) {
        // Suggestions are persisted by the API and loaded with the rest of the
        // sketch records, so they survive refreshes and can be reused.
        setSketchSuggestions([])
        await loadSketches()
        setShowReferenceSelector(false)
        if (data?.autoCorrectionAttempted) {
          setSuggestionsNotice('The first AI reply was malformed, so the Figure Planner corrected it automatically and saved the recovered suggestions.')
        }
        return
      }

      // Zero suggestions. Explain which of the three cases this is, instead of
      // leaving the screen unchanged with no feedback at all.
      const type = data?.inventionType && data.inventionType !== 'GENERAL'
        ? ` Yours is recorded as ${String(data.inventionType).toLowerCase()}.`
        : ''

      if (data?.emptyReason === 'not_applicable') {
        setSuggestionsNotice(
          data?.hasExistingSketches
            ? `No new sketch ideas — your ${data.existingSketchCount} existing sketch${data.existingSketchCount === 1 ? '' : 'es'} already cover the views worth drawing. Add a sketch manually below if you have a specific view in mind.`
            : `Sketches aren't a good fit for this invention, so none were suggested.${type} Inventions that are mostly software, algorithms or business methods are better shown with the managed diagrams above. You can still add a sketch manually below.`
        )
      } else if (data?.emptyReason === 'incomplete') {
        setSuggestionsError('The suggestions came back missing their titles or descriptions. Try again — if it keeps happening, the figure-planner model may need a higher output limit.')
      } else {
        setSuggestionsError('Couldn\'t read the model\'s reply, so there\'s nothing to show. Try again — if it keeps happening, check the figure-planner model configuration.')
      }
    } catch (err) {
      setSuggestionsError(err instanceof Error ? err.message : 'Failed to generate sketch suggestions')
    } finally {
      setSuggestionsLoading(false)
    }
  }

  const handleModifySketch = async (sketchId: string) => {
    if (!session?.id || !modifySketchPrompt.trim()) return
    
    try {
      setSketchGenerating(true)
      setSketchError(null)
      
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'modify_sketch',
          sessionId: session.id,
          sourceSketchId: sketchId,
          userPrompt: modifySketchPrompt
        })
      })
      
      const data = await res.json()
      
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Sketch modification failed')
      }
      
      // Refresh and close modify dialog
      await loadSketches()
      setModifyingSketchId(null)
      setModifySketchPrompt('')
      
    } catch (err) {
      setSketchError(err instanceof Error ? err.message : 'Sketch modification failed')
    } finally {
      setSketchGenerating(false)
    }
  }

  const handleDeleteSketch = async (sketchId: string) => {
    if (!confirm('Delete this sketch?')) return
    
    try {
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'delete_sketch',
          sketchId,
          sessionId: session?.id // Include sessionId for figure sequence cleanup
        })
      })
      
      if (!res.ok) throw new Error('Failed to delete sketch')
      
      await loadSketches()
      // Also refresh arrange tab data if it was previously loaded
      if (arrangedFigures.length > 0) {
        await loadCombinedFigures()
      }
    } catch (err) {
      setSketchError(err instanceof Error ? err.message : 'Failed to delete sketch')
    }
  }

  const handleToggleFavorite = async (sketchId: string) => {
    try {
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'toggle_sketch_favorite',
          sketchId
        })
      })
      
      if (!res.ok) throw new Error('Failed to toggle favorite')
      
      const data = await res.json()
      setSketches(prev => prev.map(s => 
        s.id === sketchId ? { ...s, isFavorite: data.isFavorite } : s
      ))
    } catch (err) {
      console.error('Toggle favorite error:', err)
      toast({ title: 'Could not update favorite', description: 'Please try again.', variant: 'error' })
    }
  }

  const handleRetrySketch = async (sketchId: string) => {
    try {
      setSketchGenerating(true)
      
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'retry_sketch',
          sketchId
        })
      })
      
      if (!res.ok) throw new Error('Failed to retry sketch')
      
      await loadSketches()
    } catch (err) {
      setSketchError(err instanceof Error ? err.message : 'Failed to retry sketch')
    } finally {
      setSketchGenerating(false)
    }
  }

  // Handle generating image from a SUGGESTED sketch (DB-stored)
  const [generatingSuggestionId, setGeneratingSuggestionId] = useState<string | null>(null)
  
  const handleGenerateFromSuggestion = async (sketchId: string) => {
    try {
      setGeneratingSuggestionId(sketchId)
      setSketchError(null)
      
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'generate_from_suggestion',
          sketchId
        })
      })
      
      const data = await res.json()
      
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to generate sketch')
      }
      
      await loadSketches()
    } catch (err) {
      setSketchError(err instanceof Error ? err.message : 'Failed to generate sketch from suggestion')
    } finally {
      setGeneratingSuggestionId(null)
    }
  }

  // Handle generating image from a MANUAL suggestion (from sketchSuggestions state)
  const [generatingManualSuggestionIdx, setGeneratingManualSuggestionIdx] = useState<number | null>(null)
  
  const handleGenerateFromManualSuggestion = async (suggestion: { title: string; description: string }, index: number) => {
    if (!session?.id) return
    
    try {
      setGeneratingManualSuggestionIdx(index)
      setSketchError(null)
      
      // Use guided mode with the suggestion description as the prompt
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'generate_sketch_guided',
          sessionId: session.id,
          title: suggestion.title,
          userPrompt: suggestion.description,
          contextFlags: {
            useIdeaSummary: true,
            useClaims: true,
            useDiagrams: true,
            useComponents: true
          },
          referenceSketchIds: selectedReferenceSketchIds.length > 0 ? selectedReferenceSketchIds : undefined
        })
      })
      
      const data = await res.json()
      
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to generate sketch')
      }
      
      // Refresh sketches list
      await loadSketches()
    } catch (err) {
      setSketchError(err instanceof Error ? err.message : 'Failed to generate sketch from suggestion')
    } finally {
      setGeneratingManualSuggestionIdx(null)
    }
  }

  const handleSketchFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    // Validate file type
    if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(file.type)) {
      setSketchError('Please upload a PNG, JPEG, or WebP image')
      return
    }
    
    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setSketchError('Image must be less than 10MB')
      return
    }
    
    setSketchUploadFile(file)
    
    // Create preview
    const reader = new FileReader()
    reader.onload = () => setSketchUploadPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  // Step 1 of the two-step flow: ask the planner what it intends to draw.
  // Nothing is rendered yet, so this returns in seconds and costs a fraction of
  // a full generation.
  const handlePlanFigures = async () => {
    try {
      setIsPlanning(true)
      setPlanError(null)
      setError(null)
      setGenerationFailure(null)
      setGenerationWarning(null)

      const res = await onComplete({
        action: 'plan_figures_llm',
        sessionId: session?.id,
        includeExistingFigures: !replaceExistingDiagrams,
        ...(diagramCount ? { figureCount: diagramCount } : {})
      })

      if (!res) throw new Error('Planning failed — no response received')
      if (res.error) throw Object.assign(new Error(res.error), { diagramFailure: res })

      const figures = Array.isArray(res.plan?.figures) ? res.plan.figures : []
      if (figures.length === 0) throw new Error('The planner did not return any figures')

      setPlanFigures(figures.map((figure: any) => ({
        key: String(figure.key || ''),
        title: sanitizeFigureLabel(figure.title) || 'Untitled figure',
        purpose: String(figure.purpose || ''),
        kind: String(figure.kind || 'COMPONENT'),
        detailLevel: figure.detailLevel,
        componentIds: figure.componentIds,
        claimCriticalComponentIds: figure.claimCriticalComponentIds,
      })))
      setPlanDirty(false)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Planning failed'
      setPlanError(message)
      setGenerationFailure({
        message,
        details: describeDiagramFailure((e as any)?.diagramFailure),
        retry: () => { void handlePlanFigures() },
        failure: (e as any)?.diagramFailure?.failure,
      })
    } finally {
      setIsPlanning(false)
    }
  }

  const updatePlanFigure = (key: string, patch: Partial<PlanFigure>) => {
    setPlanFigures(prev => prev ? prev.map(f => f.key === key ? { ...f, ...patch } : f) : prev)
    setPlanDirty(true)
  }

  const removePlanFigure = (key: string) => {
    setPlanFigures(prev => {
      if (!prev || prev.length <= 1) return prev
      return prev.filter(f => f.key !== key)
    })
    setPlanDirty(true)
  }

  const movePlanFigure = (key: string, direction: -1 | 1) => {
    setPlanFigures(prev => {
      if (!prev) return prev
      const index = prev.findIndex(f => f.key === key)
      const target = index + direction
      if (index === -1 || target < 0 || target >= prev.length) return prev
      const next = [...prev]
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved)
      return next
    })
    setPlanDirty(true)
  }

  // Step 2: persist whatever the attorney approved, then draw exactly that.
  // `figureCount` records the attorney's preferred reviewed count. Coverage
  // repair may still add a necessary figure and reports that change afterward.
  const handleApprovePlan = async () => {
    if (!planFigures || planFigures.length === 0) return
    const approvedCount = planFigures.length

    try {
      setIsGenerating(true)
      setPlanError(null)
      setError(null)
      setGenerationFailure(null)
      setGenerationWarning(null)

      const saved = await onComplete({
        action: 'save_figure_plan',
        sessionId: session?.id,
        figures: planFigures.map(f => ({
          key: f.key,
          title: f.title,
          purpose: f.purpose,
          kind: f.kind
        }))
      })
      if (!saved) throw new Error('Could not save your figure plan')
      if (saved.error) throw Object.assign(new Error(saved.error), { diagramFailure: saved })

      const res = await onComplete({
        action: 'generate_diagrams_llm',
        sessionId: session?.id,
        usePlan: true,
        figureCount: approvedCount,
        replaceExisting: replaceExistingDiagrams
      })

      if (!res) throw new Error('Figure generation failed — no response received')
      if (res.error) throw Object.assign(new Error(res.error), { diagramFailure: res })
      if (!res.success) throw new Error(res.message || 'Figure generation failed')

      setGenerationWarning(formatDiagramGenerationWarnings(res))
      // Drawing succeeded, so the plan-review screen has served its purpose and
      // the figures themselves become the subject of the page.
      setPlanFigures(null)
      setPlanDirty(false)
      setFigures([])
      await onRefresh()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Generation failed'
      setGenerationFailure({
        message,
        details: describeDiagramFailure((e as any)?.diagramFailure),
        retry: () => { void handleApprovePlan() },
        failure: (e as any)?.diagramFailure?.failure,
      })
    } finally {
      setIsGenerating(false)
    }
  }

  const handleGenerateFromLLM = async () => {
    try {
      setIsGenerating(true)
      setError(null)
      setGenerationWarning(null)
      setGenerationFailure(null)

      // Manual mode draws exactly the figures the attorney described — the
      // chosen diagram type rides along in the instruction text so the planner
      // honours it without needing a separate field.
      if (mode === 'manual' && manualFiguresReady.length > 0) {
        const instructions = manualFiguresReady.map(figure => {
          const text = figure.text.trim()
          const label = figure.kind ? FIGURE_KIND_LABELS[figure.kind] : ''
          return label ? `${text} (draw this as: ${label.toLowerCase()})` : text
        })
        const manualResp = await onComplete({
          action: 'generate_diagrams_llm',
          sessionId: session?.id,
          mode: 'manual',
          figureInstructions: instructions,
          figureCount: instructions.length,
          includeExistingFigures,
          replaceExisting: false
        })
        if (!manualResp) throw new Error('LLM did not return valid figure list')
        if (manualResp.error) {
          if (manualResp.code === 'PHYSICAL_VIEW_REQUIRES_SKETCH' && manualResp.sketchSuggestion) {
            setSketchSuggestions(prev => [manualResp.sketchSuggestion, ...prev])
            setSuggestionsNotice('This physical view was moved to Sketches because it needs patent line art rather than a logical PlantUML diagram.')
            setActiveTab('sketches')
            return
          }
          throw Object.assign(new Error(manualResp.error), { diagramFailure: manualResp })
        }
        setGenerationWarning(formatDiagramGenerationWarnings(manualResp))
        setManualFigures([{ id: `manual-fig-${Date.now()}`, text: '', kind: '' }])
        await onRefresh()
        return
      }

      // ═══════════════════════════════════════════════════════════════════════════════
      // AI MODE: Use two-stage figure generation (Plan → Generate)
      // ═══════════════════════════════════════════════════════════════════════════════
      // Stage 1: AI analyzes invention and creates a figure plan
      // Stage 2: AI generates PlantUML code based on the plan
      // 
      // If user specified a diagramCount, AI will plan exactly that many figures.
      // If diagramCount is null/empty, AI decides the optimal count (typically 3-7).

      const res = await onComplete({
        action: 'plan_and_generate_diagrams_llm',
        sessionId: session?.id,
        // Pass figureCount only if user specified one (null means AI decides)
        ...(diagramCount ? { figureCount: diagramCount } : {}),
        // Replace only when explicitly requested by the user
        replaceExisting: replaceExistingDiagrams
      })

      // Handle error responses (including API errors that return error object)
      if (!res) {
        throw new Error('Figure generation failed - no response received')
      }
      if (res.error) {
        throw Object.assign(new Error(res.error), { diagramFailure: res })
      }
      if (!res.success) {
        throw new Error(res.message || 'Figure generation failed')
      }
      setGenerationWarning(formatDiagramGenerationWarnings(res))

      // `res.plan.rationale` used to be logged here, but the planner's schema has
      // no rationale field, so the line only ever printed `undefined`.
      console.log('[FigurePlanner] Generated', res.figures?.length, 'figures from plan')

      // Update sketch suggestions from the planning stage (if any)
      if (res.sketchSuggestions && Array.isArray(res.sketchSuggestions) && res.sketchSuggestions.length > 0) {
        console.log('[FigurePlanner] Received', res.sketchSuggestions.length, 'sketch suggestions')
        setSketchSuggestions(res.sketchSuggestions)
      }

      setFigures([]) // Clear proposed figures since they're now automatically approved

      // Refresh to pull saved plans and sources immediately
      console.log('[FigurePlanner] Refreshing session to load saved diagrams...')
      await onRefresh()
      console.log('[FigurePlanner] Session refresh complete')
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Generation failed'
      console.error('[FigurePlanner] Generation error:', errorMessage, e)
      // Generation is safely repeatable and most failures are transient, so the
      // user gets an actionable retry rather than a red wall of raw API text.
      setGenerationFailure({
        message: errorMessage,
        details: describeDiagramFailure((e as any)?.diagramFailure),
        retry: () => { void handleGenerateFromLLM() },
        failure: (e as any)?.diagramFailure?.failure,
      })
    } finally {
      setIsGenerating(false)
    }
  }

  const queueUpload = useCallback((key: string, figureNo: number, blob: Blob, language: string, opEpoch?: number) => {
    const expectedEpoch = typeof opEpoch === 'number' ? opEpoch : getDiagramOpEpoch(key)
    uploadQueueRef.current = uploadQueueRef.current.then(async () => {
      try {
        if (getDiagramOpEpoch(key) !== expectedEpoch) return
        setUploadingByKey(prev => ({ ...prev, [key]: true }))
        setIsUploading(true)
        const filename = `figure_${figureNo}_${language}_${Date.now()}.png`
        const file = new File([blob], filename, { type: 'image/png' })
        // Use ref to get latest handleUploadImage and avoid stale closure
        if (handleUploadImageRef.current) {
          await handleUploadImageRef.current(figureNo, file, filename, language, expectedEpoch)
        }
      } finally {
        setUploadingByKey(prev => ({ ...prev, [key]: false }))
        setIsUploading(false)
      }
    }).catch((e) => {
      console.warn('Queued upload failed:', e instanceof Error ? e.message : e)
    })
  }, [])

  const invalidateDiagramOps = useCallback((figureNo: number, language?: string | null) => {
    const key = getDiagramKey(figureNo, (language || 'en').toLowerCase())
    bumpDiagramOpEpoch(key)
    queuedForRenderRef.current.delete(key)
    autoFixAttemptedRef.current.delete(key)
    const controller = renderAbortControllersRef.current[key]
    if (controller) {
      try { controller.abort() } catch {}
    }
    renderAbortControllersRef.current[key] = null
  }, [bumpDiagramOpEpoch])

  const runSingleRender = async (figureNo: number, plantumlCode: string, language = 'en', isAutoFixRetry = false, opEpoch?: number) => {
    const key = getDiagramKey(figureNo, language)
    const runEpoch = typeof opEpoch === 'number' ? opEpoch : getDiagramOpEpoch(key)
    if (getDiagramOpEpoch(key) !== runEpoch) {
      queuedForRenderRef.current.delete(key)
      return
    }
    setProcessingStatus(prev => ({ ...prev, [key]: isAutoFixRetry ? 'Retrying with fixed code...' : intelligentMessages[0] }))
    setProcessingStep(prev => ({ ...prev, [key]: 0 }))

    try {
      // Minimal delay for UI feedback
      await new Promise(resolve => setTimeout(resolve, 50))
      setProcessingStatus(prev => ({ ...prev, [key]: intelligentMessages[1] }))
      setProcessingStep(prev => ({ ...prev, [key]: 1 }))

      setRendering((prev) => ({ ...prev, [key]: true }))
      setError(null)

      // Abort any in-flight render for this figure/language to keep UI responsive
      try {
        const prev = renderAbortControllersRef.current[key]
        prev?.abort()
      } catch {}
      const controller = new AbortController()
      renderAbortControllersRef.current[key] = controller

      const resp = await fetch(`/api/patents/${patent.id}/drafting/plantuml-render`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          code: plantumlCode,
          format: 'png',
          figureNo,
          patentId: patent?.id,
          sessionId: session?.id,
          language,
          persistArtifacts: true
        })
      })

      if (!resp.ok) {
        const info = await resp.json().catch(() => ({}))
        const renderError = info.error || info.details || 'Render failed'
        
        // Attempt the centralized sanitize/validate/render path once per figure.
        // Check both isAutoFixRetry flag AND autoFixAttemptedRef to prevent infinite loops
        // The ref persists across re-renders and is only cleared by manual "Retry Render" click
        if (getDiagramOpEpoch(key) !== runEpoch) {
          queuedForRenderRef.current.delete(key)
          return
        }

        const hasAttemptedAutoFix = autoFixAttemptedRef.current.has(key)
        
        if (!isAutoFixRetry && !hasAttemptedAutoFix) {
          console.log(`[AutoFix] Render failed for figure ${figureNo}, attempting one centralized repair...`)
          // Mark as attempted before the request to prevent race conditions from useEffect triggers.
          autoFixAttemptedRef.current.add(key)
          setProcessingStatus(prev => ({ ...prev, [key]: 'Render failed - validating and rebuilding...' }))
          
          try {
            const fixResp = await onComplete({
              action: 'fix_plantuml_render',
              sessionId: session?.id,
              figureNo,
              plantumlCode,
              renderError
            })
            
            if (fixResp?.success && fixResp?.fixedCode) {
              console.log(`[AutoFix] Successfully got fixed code for figure ${figureNo}, retrying render...`)
              setGenerationWarning(prev => prev?.includes('Diagram repaired automatically') ? null : prev)
              setProcessingStatus(prev => ({ ...prev, [key]: 'Code fixed! Re-rendering...' }))
              // Refresh to get updated code in diagramSources
              await onRefresh()
              // Retry with fixed code (mark as retry to prevent duplicate auto-fix attempts)
              // The attempt marker prevents another repair call if useEffect triggers.
              await runSingleRender(figureNo, fixResp.fixedCode, language, true, runEpoch)
              return // Exit - the retry will handle completion
            } else {
              console.warn(`[AutoFix] Central repair did not return valid code for figure ${figureNo}`)
            }
          } catch (fixError) {
            console.warn(`[AutoFix] Auto-fix attempt failed for figure ${figureNo}:`, fixError)
          }
        } else if (hasAttemptedAutoFix) {
          console.log(`[AutoFix] Skipping auto-fix for figure ${figureNo} - already attempted once`)
        }
        
        // Auto-fix failed, already attempted, or this is a retry - throw the original error
        throw new Error(renderError)
      }

      setProcessingStatus(prev => ({ ...prev, [key]: intelligentMessages[2] }))
      setProcessingStep(prev => ({ ...prev, [key]: 2 }))

      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      setRenderPreview((prev) => {
        const prevUrl = prev?.[key]
        if (prevUrl && typeof prevUrl === 'string') {
          try { URL.revokeObjectURL(prevUrl) } catch {}
        }
        return ({ ...prev, [key]: url })
      })
      setError(prev => prev?.startsWith(`Figure ${figureNo} processing failed:`) ? null : prev)
      setGenerationWarning(prev => prev?.includes('Diagram repaired automatically') ? null : prev)

      setProcessingStatus(prev => ({ ...prev, [key]: intelligentMessages[3] }))
      setProcessingStep(prev => ({ ...prev, [key]: 3 }))

      // The server writes both SVG and PNG masters for a saved source.
      if (getDiagramOpEpoch(key) !== runEpoch) {
        queuedForRenderRef.current.delete(key)
        return
      }
      if (resp.headers.get('X-Artifact-Persisted') === 'true') {
        setUploaded(prev => ({ ...prev, [key]: true }))
        await onRefresh()
      } else {
        queueUpload(key, figureNo, blob, language, runEpoch)
      }

      // Clear processing status
      setProcessingStatus(prev => ({ ...prev, [key]: '' }))
      setProcessingStep(prev => ({ ...prev, [key]: 0 }))

    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error'
      console.error(`Processing failed for figure ${figureNo}:`, errorMessage)
      setError(`Figure ${figureNo} processing failed: ${errorMessage}`)
      setProcessingStatus(prev => ({ ...prev, [key]: `Failed: ${errorMessage}` }))
      setProcessingStep(prev => ({ ...prev, [key]: -1 })) // Mark as failed
      // Clear from queued set so user can retry
      queuedForRenderRef.current.delete(key)
    } finally {
      setRendering((prev) => ({ ...prev, [key]: false }))
    }
  }

  // Intelligent automatic diagram processing with serialized queue and reduced gap between requests
  const autoProcessDiagram = (figureNo: number, plantumlCode: string, language = 'en', opEpoch?: number) => {
    renderQueueRef.current = renderQueueRef.current.then(async () => {
      // Reduced gap between render requests for better responsiveness
      await new Promise(resolve => setTimeout(resolve, 150))
      await runSingleRender(figureNo, plantumlCode, language, false, opEpoch)
    }).catch((err) => {
      // Catch any unhandled errors to prevent queue breakage
      console.error(`[AutoProcess] Error processing figure ${figureNo}:`, err)
      // Don't re-throw - let the queue continue for other diagrams
    })
    return renderQueueRef.current
  }

  const handleUploadImage = async (figureNo: number, file: File, customFilename?: string, language = 'en', opEpoch?: number) => {
    const key = getDiagramKey(figureNo, language)
    const expectedEpoch = typeof opEpoch === 'number' ? opEpoch : getDiagramOpEpoch(key)
    if (getDiagramOpEpoch(key) !== expectedEpoch) return

    try {
      setIsUploading(true)
      setError(null)
      const form = new FormData()
      form.append('file', file)
      const uploadResp = await fetch(`/api/projects/${patent.project.id}/patents/${patent.id}/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
        body: form
      })
      if (!uploadResp.ok) {
        let message = 'Upload failed'
        try {
          const j = await uploadResp.json()
          if (j?.error) message = j.error
        } catch {}
        throw new Error(message)
      }
      const uploadedMeta = await uploadResp.json()
      // Use custom filename if provided, otherwise use the filename from response
      const filename = customFilename || uploadedMeta.filename
      await onComplete({ action: 'upload_diagram', sessionId: session?.id, figureNo, language, filename, checksum: uploadedMeta.checksum, imagePath: uploadedMeta.path })
      setUploaded((prev) => ({ ...prev, [getDiagramKey(figureNo, language)]: true }))
      setError(prev => prev?.startsWith(`Figure ${figureNo} processing failed:`) ? null : prev)
      setGenerationWarning(prev => prev?.includes('Diagram repaired automatically') ? null : prev)
      setProcessingStatus(prev => ({ ...prev, [key]: '' }))
      setProcessingStep(prev => ({ ...prev, [key]: 0 }))
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setIsUploading(false)
    }
  }
  // Keep ref updated with latest handleUploadImage to avoid stale closures
  handleUploadImageRef.current = handleUploadImage

  const updateManualUploadSlot = (slotId: string, patch: Partial<ManualUploadSlot>) => {
    setManualUploadSlots(prev => prev.map(slot => slot.id === slotId ? { ...slot, ...patch } : slot))
  }

  const addManualUploadSlot = () => {
    setManualUploadSlots(prev => [...prev, createManualUploadSlot()])
  }

  const removeManualUploadSlot = (slotId: string) => {
    setManualUploadSlots(prev => {
      const slot = prev.find(item => item.id === slotId)
      if (slot?.previewUrl) URL.revokeObjectURL(slot.previewUrl)
      const next = prev.filter(item => item.id !== slotId)
      return next.length > 0 ? next : [createManualUploadSlot()]
    })
  }

  const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

  const loadImageFromDataUrl = (dataUrl: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not read image dimensions'))
    img.src = dataUrl
  })

  const dataUrlToBase64 = (dataUrl: string) => dataUrl.split(',')[1] || ''

  const prepareExternalImageForAiDetection = async (file: File) => {
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml']
    if (!allowedTypes.includes(file.type)) {
      throw new Error('Please choose a PNG, JPEG, WebP, or SVG image')
    }
    if (file.size > 25 * 1024 * 1024) {
      throw new Error('Image upload files must be 25MB or smaller')
    }

    const dataUrl = await readFileAsDataUrl(file)
    const image = await loadImageFromDataUrl(dataUrl)
    const originalWidth = image.naturalWidth || image.width
    const originalHeight = image.naturalHeight || image.height
    if (!originalWidth || !originalHeight) {
      throw new Error('Could not read image dimensions')
    }

    const sideScale = Math.min(EXTERNAL_AI_MAX_SIDE / originalWidth, EXTERNAL_AI_MAX_SIDE / originalHeight, 1)
    const pixelScale = Math.min(Math.sqrt(EXTERNAL_AI_MAX_PIXELS / (originalWidth * originalHeight)), 1)
    const scale = Math.min(sideScale, pixelScale)
    const targetWidth = Math.max(1, Math.round(originalWidth * scale))
    const targetHeight = Math.max(1, Math.round(originalHeight * scale))
    const mustRasterize = file.type === 'image/svg+xml' || scale < 1 || file.size > EXTERNAL_AI_MAX_BYTES

    if (!mustRasterize) {
      return {
        base64: dataUrlToBase64(dataUrl),
        mimeType: file.type === 'image/jpg' ? 'image/jpeg' : file.type,
        width: originalWidth,
        height: originalHeight,
        scaled: false
      }
    }

    const canvas = document.createElement('canvas')
    canvas.width = targetWidth
    canvas.height = targetHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not prepare image for AI detection')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, targetWidth, targetHeight)
    ctx.drawImage(image, 0, 0, targetWidth, targetHeight)

    let outputMimeType = file.type === 'image/png' || file.type === 'image/svg+xml' ? 'image/png' : 'image/jpeg'
    let outputDataUrl = canvas.toDataURL(outputMimeType, 0.86)
    const approxBytes = Math.ceil(dataUrlToBase64(outputDataUrl).length * 3 / 4)
    if (approxBytes > EXTERNAL_AI_MAX_BYTES) {
      outputMimeType = 'image/jpeg'
      outputDataUrl = canvas.toDataURL(outputMimeType, 0.82)
    }

    return {
      base64: dataUrlToBase64(outputDataUrl),
      mimeType: outputMimeType,
      width: targetWidth,
      height: targetHeight,
      scaled: scale < 1 || file.type === 'image/svg+xml' || file.size > EXTERNAL_AI_MAX_BYTES
    }
  }

  const handleManualFileChange = (slotId: string, file?: File | null) => {
    if (!file) return
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml']
    if (!allowedTypes.includes(file.type)) {
      updateManualUploadSlot(slotId, { error: 'Please choose a PNG, JPEG, WebP, or SVG image', status: 'error' })
      return
    }
    if (file.size > 25 * 1024 * 1024) {
      updateManualUploadSlot(slotId, { error: 'Image upload files must be 25MB or smaller', status: 'error' })
      return
    }

    const current = manualUploadSlotsRef.current.find(slot => slot.id === slotId)
    if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl)
    updateManualUploadSlot(slotId, {
      file,
      previewUrl: URL.createObjectURL(file),
      description: current?.aiGenerated ? '' : current?.description || '',
      status: 'idle',
      error: undefined,
      warnings: undefined,
      aiGenerated: false,
      scaledForDetection: undefined,
      imageWidth: undefined,
      imageHeight: undefined
    })
  }

  const detectManualImageContent = async (slotId: string, skipValidDescription = false): Promise<boolean> => {
    const slot = manualUploadSlotsRef.current.find(item => item.id === slotId)
    if (!slot) return false
    if (!slot.file) {
      updateManualUploadSlot(slotId, { status: 'error', error: 'Choose an image before running AI detection' })
      return false
    }
    if (skipValidDescription && countWords(slot.description) >= 20) return true

    try {
      updateManualUploadSlot(slotId, { status: 'detecting', error: undefined, warnings: undefined })
      const prepared = await prepareExternalImageForAiDetection(slot.file)
      const resp = await onComplete({
        action: 'detect_external_image_content',
        sessionId: session?.id,
        title: slot.title || undefined,
        uploadedImageBase64: prepared.base64,
        uploadedImageMimeType: prepared.mimeType
      })

      if (!resp?.success || !resp.description) {
        throw new Error(resp?.error || 'AI image content detection failed')
      }

      updateManualUploadSlot(slotId, {
        title: slot.title || resp.titleSuggestion || '',
        description: resp.description,
        status: 'idle',
        error: undefined,
        warnings: Array.isArray(resp.warnings) ? resp.warnings : undefined,
        aiGenerated: true,
        imageWidth: prepared.width,
        imageHeight: prepared.height,
        scaledForDetection: prepared.scaled
      })
      return true
    } catch (err) {
      updateManualUploadSlot(slotId, {
        status: 'error',
        error: err instanceof Error ? err.message : 'AI image content detection failed'
      })
      return false
    }
  }

  const detectAllManualImageContent = async () => {
    const targets = manualUploadSlotsRef.current.filter(slot => slot.file && countWords(slot.description) < 20 && slot.status !== 'saved')
    if (targets.length === 0) {
      setError('Choose at least one image that needs a description before running AI detection')
      return
    }

    setError(null)
    setManualDetectingAll(true)
    setManualDetectionProgress({ current: 0, total: targets.length })
    try {
      for (let i = 0; i < targets.length; i++) {
        setManualDetectionProgress({ current: i + 1, total: targets.length })
        await detectManualImageContent(targets[i].id, true)
      }
    } finally {
      setManualDetectingAll(false)
      setManualDetectionProgress(null)
    }
  }

  const saveManualUploadSlot = async (slotId: string): Promise<boolean> => {
    const slot = manualUploadSlotsRef.current.find(item => item.id === slotId)
    if (!slot) return false
    if (!slot.file) {
      updateManualUploadSlot(slotId, { status: 'error', error: 'Choose an image before adding it to figures' })
      return false
    }
    if (countWords(slot.description) < 20) {
      updateManualUploadSlot(slotId, { status: 'error', error: 'Description must contain at least 20 words' })
      return false
    }

    try {
      updateManualUploadSlot(slotId, { status: 'saving', error: undefined })
      const title = sanitizeFigureLabel(slot.title) || slot.title || undefined
      const resp = await onComplete({
        action: 'create_manual_figure',
        sessionId: session?.id,
        title,
        description: slot.description
      })
      const createdNo = resp?.created?.figureNo
      if (!createdNo) throw new Error('Manual figure could not be created')
      await handleUploadImage(createdNo, slot.file)
      updateManualUploadSlot(slotId, { status: 'saved', error: undefined })
      return true
    } catch (err) {
      updateManualUploadSlot(slotId, {
        status: 'error',
        error: err instanceof Error ? err.message : 'Failed to add image to figures'
      })
      return false
    }
  }

  const saveAllReadyManualUploads = async () => {
    const targets = manualUploadSlotsRef.current.filter(slot => slot.status !== 'saved' && slot.file && countWords(slot.description) >= 20)
    if (targets.length === 0) {
      setError('No external images are ready to add. Each image needs a file and at least 20 description words.')
      return
    }

    setError(null)
    for (const slot of targets) {
      await saveManualUploadSlot(slot.id)
    }
  }

  const handleRetryDiagramImageAnalysis = async (source: any) => {
    if (!source?.id) return
    try {
      setRetryingImageAnalysis(prev => ({ ...prev, [source.id]: true }))
      setError(null)
      await onComplete({
        action: 'retry_diagram_image_analysis',
        sessionId: session?.id,
        diagramSourceId: source.id
      })
      await onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry diagram image analysis')
    } finally {
      setRetryingImageAnalysis(prev => ({ ...prev, [source.id]: false }))
    }
  }

  const handleViewImage = async (figureNo: number, filename?: string) => {
    if (!filename) return
    try {
      setIsViewing(prev => ({ ...prev, [figureNo]: true }))
      setError(null)
      const url = `/api/projects/${patent.project.id}/patents/${patent.id}/upload?filename=${encodeURIComponent(filename)}`
      const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` } })
      if (!resp.ok) throw new Error('Failed to load image')
      const blob = await resp.blob()
      const blobUrl = URL.createObjectURL(blob)
      window.open(blobUrl, '_blank', 'noopener,noreferrer')
      // Revoke blob URL after a delay to allow browser to load it
      setTimeout(() => {
        try { URL.revokeObjectURL(blobUrl) } catch {}
      }, 5000)
    } catch (e) {
      setError('Unable to open image')
    } finally {
      setIsViewing(prev => ({ ...prev, [figureNo]: false }))
    }
  }

  const handleDownloadFigureImage = async (imageUrl: string | null, figureNo: number, language?: string) => {
    if (!imageUrl) return
    try {
      setError(null)
      const headers: HeadersInit = imageUrl.startsWith('blob:')
        ? {}
        : { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      const resp = await fetch(imageUrl, { headers })
      if (!resp.ok) throw new Error('Failed to download image')

      const blob = await resp.blob()
      const mime = blob.type || resp.headers.get('content-type') || 'image/png'
      const extension = mime.includes('svg') ? 'svg' : mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'png'
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `figure-${figureNo}-${language || 'en'}.${extension}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => {
        try { URL.revokeObjectURL(url) } catch {}
      }, 1000)
    } catch (e) {
      console.error('Figure image download failed:', e)
      setError(e instanceof Error ? e.message : 'Unable to download image')
    }
  }

  const handleSkipFigures = async () => {
    if (!session?.id) return
    try {
      setIsSkippingFigures(true)
      setError(null)
      await onComplete({ action: 'skip_figures', sessionId: session.id })
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to continue without figures')
    } finally {
      setIsSkippingFigures(false)
    }
  }

  const handleRestoreFigures = async () => {
    if (!session?.id) return
    try {
      setIsRestoringFigures(true)
      setError(null)
      await onComplete({ action: 'restore_figures', sessionId: session.id })
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to re-enable figures')
    } finally {
      setIsRestoringFigures(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-3 sm:p-8 max-w-[1800px] mx-auto space-y-6 sm:space-y-8"
    >
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-ai-graphite-900 tracking-tight flex items-center gap-3">
            <div className="p-2 bg-ai-blue-50 rounded-lg">
              <LayoutGrid className="w-6 h-6 text-ai-blue-600" />
            </div>
            Figure Planner
            <Hint
              title="What happens here"
              text="This is where your patent's drawings are created — block diagrams, flowcharts, and illustrations. They're generated from your specification and reuse its reference numerals, so figures and text stay consistent."
            />
          </h2>
          <p className="text-ai-graphite-500 mt-2">Create the drawings your application will file with.</p>
        </div>

        {/* An escape hatch, not a competing call to action — it used to be an
            amber button beside the primary flow. */}
        {!figuresSkipped && (
          <button
            type="button"
            onClick={handleSkipFigures}
            disabled={isSkippingFigures}
            className="text-sm text-ai-graphite-500 hover:text-ai-graphite-800 underline underline-offset-4 decoration-paper-400 disabled:opacity-50 shrink-0 py-2"
          >
            {isSkippingFigures ? 'Switching…' : 'Continue without figures'}
          </button>
        )}
      </div>

      {figuresSkipped && (
        <Alert className="border-amber-200 bg-amber-50 text-amber-900">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <span>
              Figureless draft mode is enabled. Existing diagrams and sketches are preserved but ignored during drafting, review, preview, and export.
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRestoreFigures}
              disabled={isRestoringFigures}
              className="bg-white border-amber-300 text-amber-800 hover:bg-amber-100"
            >
              {isRestoringFigures ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RotateCcw className="w-4 h-4 mr-2" />}
              Re-enable figures
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Numbered steps. The three panels are a sequence with one optional step,
          not three equal places to browse, so each carries its position, its
          purpose in one line, and a live status. */}
      <nav className="grid grid-cols-1 sm:grid-cols-3 gap-3" aria-label="Figure Planner steps">
        {([
          {
            id: 'diagrams' as const,
            n: 1,
            name: 'Diagrams',
            desc: 'Flowcharts & block diagrams from your specification',
            status: isPlanning
              ? { text: 'Planning…', tone: 'busy' as const }
              : planFigures
                ? { text: `${planFigures.length} planned · awaiting approval`, tone: 'busy' as const }
                : diagramSources.length > 0
                  ? { text: `${diagramSources.length} figure${diagramSources.length === 1 ? '' : 's'}`, tone: 'ready' as const }
                  : { text: 'Not started', tone: 'idle' as const }
          },
          {
            id: 'sketches' as const,
            n: 2,
            name: 'Illustrations',
            desc: 'Line-art views of the physical product — optional',
            status: (() => {
              const done = sketches.filter(s => s.status === 'SUCCESS').length
              return done > 0
                ? { text: `${done} added`, tone: 'ready' as const }
                : { text: 'Optional', tone: 'idle' as const }
            })()
          },
          {
            id: 'arrange' as const,
            n: 3,
            name: 'Final set',
            desc: 'Order and lock the figures for filing',
            status: isSequenceFinalized
              ? { text: 'Finalized', tone: 'done' as const }
              : { text: 'Not finalized', tone: 'idle' as const }
          }
        ]).map(step => {
          const selected = activeTab === step.id
          return (
            <button
              key={step.id}
              onClick={() => setActiveTab(step.id)}
              aria-current={selected ? 'step' : undefined}
              className={`relative text-left rounded-lg border p-4 transition-colors ${
                selected
                  ? 'border-ai-blue-600 bg-white'
                  : 'border-paper-300 bg-white hover:border-paper-400'
              }`}
            >
              <span className="flex items-center gap-2">
                <span className={`w-5 h-5 rounded-md border text-[11px] font-semibold flex items-center justify-center shrink-0 ${
                  selected ? 'bg-ai-blue-50 text-ai-blue-700 border-transparent' : 'bg-paper-100 text-ai-graphite-500 border-paper-300'
                }`}>
                  {step.n}
                </span>
                <span className="font-semibold text-sm text-ai-graphite-900">{step.name}</span>
              </span>
              <span className="hidden sm:block text-xs text-ai-graphite-500 mt-1 ml-7">{step.desc}</span>
              <span className="block mt-2 ml-7">
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                  step.status.tone === 'done'
                    ? 'border-transparent bg-emerald-50 text-emerald-700'
                    : 'border-paper-300 bg-paper-100 text-ai-graphite-600'
                }`}>
                  {step.status.tone === 'busy'
                    ? <Loader2 className="w-2.5 h-2.5 animate-spin text-ai-blue-600" />
                    : <span className={`w-1.5 h-1.5 rounded-full ${
                        step.status.tone === 'done' ? 'bg-emerald-600'
                          : step.status.tone === 'ready' ? 'bg-ai-blue-600'
                          : 'bg-ai-graphite-400'
                      }`} />}
                  {step.status.text}
                </span>
              </span>
            </button>
          )
        })}
      </nav>

      {/* Errors are shown here so they're visible from any tab */}
      {error && (
        <ActionableErrorPanel
          message={error}
          area={/plantuml|render|processing failed/i.test(error) ? 'render' : 'general'}
          onDismiss={() => setError(null)}
        />
      )}

      {generationFailure && (
        <ActionableErrorPanel
          message={generationFailure.message}
          area="diagram"
          details={generationFailure.details}
          failure={generationFailure.failure}
          onRetry={() => {
            const retry = generationFailure.retry
            setGenerationFailure(null)
            retry()
          }}
          retrying={isGenerating || isPlanning}
          onDismiss={() => setGenerationFailure(null)}
        />
      )}

      {generationWarning && (
        <Alert className="border-amber-200 bg-amber-50 text-amber-900">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{generationWarning}</AlertDescription>
        </Alert>
      )}

      {/* TAB CONTENT */}
      {activeTab === 'diagrams' && (
        <>
          {/* One entry point for creating figures. The old screen asked the user
              to pick AI-vs-manual, a count, and a replace/append policy before
              anything appeared; those are now defaults with an explicit choice
              only where it changes the outcome. */}
          {!planFigures && !isPlanning && (
            <div className="rounded-lg border border-paper-300 bg-white p-5">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div>
                  <h3 className="font-semibold text-ai-graphite-900">
                    {diagramSources.length === 0 ? 'Create your figures' : 'Add more figures'}
                  </h3>
                  <p className="text-sm text-ai-graphite-500 mt-1 max-w-prose">
                    The AI plans a figure set from your specification and shows you the plan before drawing anything.
                    You approve it first — nothing is drawn until you do.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <Button
                    onClick={handlePlanFigures}
                    disabled={isPlanning || isGenerating}
                    className="bg-ai-blue-600 hover:bg-ai-blue-700 text-white gap-2"
                  >
                    <Sparkles className="w-4 h-4" />
                    Plan my figures
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setMode(mode === 'manual' ? 'ai' : 'manual')}
                    disabled={isPlanning || isGenerating}
                  >
                    {mode === 'manual' ? 'Hide manual entry' : 'Describe figures myself'}
                  </Button>
                  <Button variant="ghost" onClick={handleUploadToggle} disabled={isPlanning || isGenerating}>
                    {showManual ? 'Hide uploads' : 'Upload drawings'}
                  </Button>
                </div>
              </div>

              {hasExistingFigures && (
                <div className="flex items-start gap-2 mt-4 pt-4 border-t border-paper-200">
                  <Checkbox
                    id="replace-existing-diagrams"
                    checked={replaceExistingDiagrams}
                    onCheckedChange={(checked) => setReplaceExistingDiagrams(checked === true)}
                    disabled={isGenerating || isPlanning}
                  />
                  <div>
                    <Label htmlFor="replace-existing-diagrams" className="text-sm text-ai-graphite-700">
                      Replace my existing diagrams
                    </Label>
                    <p className="text-xs text-ai-graphite-500 mt-0.5">
                      Uncheck to keep them and add the new figures after.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Planning is the fast half of the pipeline, but it is still an LLM
              call — the wait is narrated rather than left as a dead button. */}
          {isPlanning && <FigureWorkProgress phase="planning" />}

          {/* PLAN REVIEW — the approval gate. Drawing is the slow, expensive
              step, so a wrong figure is caught here rather than after a render. */}
          {planFigures && !isPlanning && (
            <div className="rounded-lg border border-paper-300 bg-white overflow-hidden">
              <div className="p-5 border-b border-paper-200">
                <h3 className="font-semibold text-ai-graphite-900 flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-600" />
                  Your figure plan is ready
                </h3>
                <p className="text-sm text-ai-graphite-500 mt-1 max-w-prose">
                  {planFigures.length} figure{planFigures.length === 1 ? '' : 's'} planned from your specification — nothing has been drawn yet.
                  Edit any title or description, change a figure&rsquo;s type, reorder or remove figures, then approve to start drawing.
                </p>
              </div>

              {planError && (
                <div className="px-5 pt-4">
                  <ActionableErrorPanel
                    message={planError}
                    area="diagram"
                    onRetry={handlePlanFigures}
                    retrying={isPlanning}
                    onDismiss={() => setPlanError(null)}
                  />
                </div>
              )}

              <ul className="divide-y divide-paper-200">
                {planFigures.map((figure, index) => (
                  <li key={figure.key} className="p-4 sm:p-5">
                    <div className="flex items-start gap-3">
                      <span className="font-mono text-xs font-semibold text-ai-graphite-700 pt-2.5 w-14 shrink-0 tabular-nums">
                        FIG. {index + 1}
                      </span>
                      <div className="flex-1 min-w-0 space-y-3">
                        <Input
                          value={figure.title}
                          onChange={(e) => updatePlanFigure(figure.key, { title: e.target.value })}
                          disabled={isGenerating}
                          aria-label={`Title for figure ${index + 1}`}
                          className="font-medium"
                        />

                        <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Diagram type for figure ${index + 1}`}>
                          {FIGURE_KIND_ORDER.map(kind => (
                            <button
                              key={kind}
                              type="button"
                              onClick={() => updatePlanFigure(figure.key, { kind })}
                              disabled={isGenerating}
                              aria-pressed={figure.kind === kind}
                              className={`inline-flex items-center px-3 min-h-[40px] sm:min-h-0 sm:px-2.5 sm:py-1 rounded-full border text-xs font-medium transition-colors ${
                                figure.kind === kind
                                  ? 'border-transparent bg-ai-blue-50 text-ai-blue-700'
                                  : 'border-paper-300 bg-white text-ai-graphite-600 hover:border-paper-400'
                              }`}
                            >
                              {FIGURE_KIND_LABELS[kind]}
                            </button>
                          ))}
                        </div>

                        <Textarea
                          value={figure.purpose}
                          onChange={(e) => updatePlanFigure(figure.key, { purpose: e.target.value })}
                          disabled={isGenerating}
                          rows={2}
                          aria-label={`What figure ${index + 1} will show`}
                          placeholder="What should this figure show?"
                          className="text-sm resize-y"
                        />
                      </div>

                      <div className="flex flex-col gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => movePlanFigure(figure.key, -1)}
                          disabled={index === 0 || isGenerating}
                          aria-label={`Move figure ${index + 1} earlier`}
                          className="p-3 sm:p-1.5 rounded text-ai-graphite-400 hover:text-ai-graphite-700 hover:bg-paper-100 disabled:opacity-30 disabled:hover:bg-transparent"
                        >
                          <ChevronRight className="w-4 h-4 -rotate-90" />
                        </button>
                        <button
                          type="button"
                          onClick={() => movePlanFigure(figure.key, 1)}
                          disabled={index === planFigures.length - 1 || isGenerating}
                          aria-label={`Move figure ${index + 1} later`}
                          className="p-3 sm:p-1.5 rounded text-ai-graphite-400 hover:text-ai-graphite-700 hover:bg-paper-100 disabled:opacity-30 disabled:hover:bg-transparent"
                        >
                          <ChevronRight className="w-4 h-4 rotate-90" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removePlanFigure(figure.key)}
                          disabled={planFigures.length <= 1 || isGenerating}
                          aria-label={`Remove figure ${index + 1}`}
                          className="p-3 sm:p-1.5 rounded text-ai-graphite-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30 disabled:hover:bg-transparent"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="p-5 border-t border-paper-200 flex flex-col sm:flex-row sm:items-center gap-3">
                <Button
                  onClick={handleApprovePlan}
                  disabled={isGenerating}
                  className="bg-ai-blue-600 hover:bg-ai-blue-700 text-white gap-2 w-full sm:w-auto"
                >
                  {isGenerating
                    ? <><Loader2 className="w-4 h-4 animate-spin" />Drawing your figures</>
                    : <><Check className="w-4 h-4" />Approve plan &amp; draw {planFigures.length} figure{planFigures.length === 1 ? '' : 's'}</>}
                </Button>
                <Button
                  variant="outline"
                  onClick={handlePlanFigures}
                  disabled={isGenerating}
                  className="w-full sm:w-auto"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Plan again
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => { setPlanFigures(null); setPlanDirty(false) }}
                  disabled={isGenerating}
                  className="w-full sm:w-auto"
                >
                  Discard plan
                </Button>
                <span className="text-xs text-ai-graphite-500 sm:ml-auto">
                  {planDirty ? 'Your edits will be saved when you approve.' : 'Only approved figures are drawn.'}
                </span>
              </div>

              {/* Drawing is the long half of the pipeline. The plan above stays
                  on screen so the attorney keeps their context while it runs. */}
              {isGenerating && (
                <div className="border-t border-paper-200 p-5">
                  <FigureWorkProgress
                    phase="drawing"
                    figureCount={planFigures.length}
                  />
                </div>
              )}
            </div>
          )}

          {/* MANUAL ENTRY — figures are added one at a time. The old form asked
              for a count first and then rendered that many blank boxes. */}
          {mode === 'manual' && !planFigures && !isPlanning && (
            <div className="rounded-lg border border-paper-300 bg-white p-5 space-y-4">
              <div>
                <h3 className="font-semibold text-ai-graphite-900">Describe your figures</h3>
                <p className="text-sm text-ai-graphite-500 mt-1 max-w-prose">
                  The AI draws exactly what you describe — it will not add, merge, or remove figures.
                </p>
              </div>

              <div className="space-y-3">
                {manualFigures.map((figure, index) => (
                  <div key={figure.id} className="rounded-lg border border-paper-300 p-3">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="font-mono text-xs font-semibold text-ai-graphite-700 tabular-nums">
                        FIG. {index + 1}
                      </span>
                      <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Diagram type for figure ${index + 1}`}>
                        {([{ value: '', label: 'Let AI choose' }, ...FIGURE_KIND_ORDER.map(k => ({ value: k as string, label: FIGURE_KIND_LABELS[k] }))]).map(option => (
                          <button
                            key={option.value || 'auto'}
                            type="button"
                            onClick={() => setManualFigures(prev => prev.map(f => f.id === figure.id ? { ...f, kind: option.value } : f))}
                            disabled={isGenerating}
                            aria-pressed={figure.kind === option.value}
                            className={`inline-flex items-center px-3 min-h-[40px] sm:min-h-0 sm:px-2.5 sm:py-1 rounded-full border text-xs font-medium transition-colors ${
                              figure.kind === option.value
                                ? 'border-transparent bg-ai-blue-50 text-ai-blue-700'
                                : 'border-paper-300 bg-white text-ai-graphite-600 hover:border-paper-400'
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                      {manualFigures.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setManualFigures(prev => prev.filter(f => f.id !== figure.id))}
                          disabled={isGenerating}
                          aria-label={`Remove figure ${index + 1}`}
                          className="ml-auto p-3 sm:p-1.5 rounded text-ai-graphite-400 hover:text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <Textarea
                      value={figure.text}
                      onChange={(e) => setManualFigures(prev => prev.map(f => f.id === figure.id ? { ...f, text: e.target.value } : f))}
                      disabled={isGenerating}
                      rows={2}
                      placeholder="What should this figure show?"
                      aria-label={`Description for figure ${index + 1}`}
                      className="text-sm resize-y"
                    />
                  </div>
                ))}
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setManualFigures(prev => [...prev, { id: `manual-fig-${Date.now()}-${prev.length}`, text: '', kind: '' }])}
                disabled={isGenerating}
              >
                <Plus className="w-4 h-4 mr-2" />
                Add another figure
              </Button>

              <p className="text-xs text-ai-graphite-500 max-w-prose">
                Describe logical architecture, operations, interactions, or constituents — for example,
                &ldquo;Controller receiving sensor measurements and sending an actuator command.&rdquo; Physical, cross-sectional,
                exploded, and perspective views are created in Sketches.
              </p>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="include-existing"
                  checked={includeExistingFigures}
                  onCheckedChange={(checked) => setIncludeExistingFigures(checked === true)}
                  disabled={isGenerating}
                />
                <Label htmlFor="include-existing" className="text-sm text-ai-graphite-700">
                  Consider my existing figures, so new ones don&rsquo;t duplicate them
                </Label>
              </div>

              <Button
                onClick={handleGenerateFromLLM}
                disabled={isGenerating || manualFiguresReady.length === 0}
                className="bg-ai-blue-600 hover:bg-ai-blue-700 text-white gap-2 w-full sm:w-auto"
              >
                {isGenerating
                  ? <><Loader2 className="w-4 h-4 animate-spin" />Drawing your figures</>
                  : manualFiguresReady.length === 0
                    ? <>Draw my figures</>
                    : <>Draw {manualFiguresReady.length} figure{manualFiguresReady.length === 1 ? '' : 's'}</>}
              </Button>

              {/* Manual mode draws one figure per written instruction, so the
                  same narration applies — it just already knows the count. */}
              {isGenerating && (
                <div className="mt-5">
                  <FigureWorkProgress phase="drawing" figureCount={manualFiguresReady.length} />
                </div>
              )}
            </div>
          )}


      {/* Generating a figure set clears the filing order (the pipeline resets
          figureSequence), and nothing on this tab said so — a drawing set could
          be filed in generation order by default. This is a signpost to Arrange,
          not a second copy of the ordering action: the AI's per-figure reasoning
          and the drag-to-adjust list both live there, and ordering spans
          sketches too, so it would be misleading to run it from this tab. */}
      {(() => {
        // Sketches only load on their own tab, so the count here can be short.
        // The copy therefore states no total — it would be wrong for a session
        // whose sketches have not been fetched yet.
        const orderableCount = Object.keys(diagramsByFigure).length + sketches.length
        if (orderableCount < 2 || (session as any)?.figureSequenceFinalized) return null
        return (
          <div className="mt-10 rounded-lg border border-ai-blue-200 bg-ai-blue-50 px-4 py-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-ai-graphite-800">
                <span className="font-medium">Filing order not set yet.</span>{' '}
                Figures are numbered in the order they were created until you arrange them. Arranging covers diagrams and sketches together.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 bg-white"
                onClick={() => setActiveTab('arrange')}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Set filing order
              </Button>
            </div>
          </div>
        )
      })()}

      {/* Saved Diagrams Grid */}
      <div className="mt-10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-lg font-semibold text-ai-graphite-900">Your diagrams</h3>
            {/* A batch summary, so progress reads without scanning every card. */}
            {diagramSources.length > 0 && (() => {
              // Counted per figure, never per language variant — a figure with
              // three translations is still one figure to the attorney.
              const figureNos = Object.keys(diagramsByFigure).map(Number)
              const total = figureNos.length
              const drawing = figureNos.filter(figNo => (diagramsByFigure[figNo] || []).some((d: any) => {
                const key = getDiagramKey(figNo, d.language || 'en')
                return !!processingStatus[key] && processingStep[key] !== -1
              })).length
              const ready = figureNos.filter(figNo =>
                (diagramsByFigure[figNo] || []).some((d: any) => d.imageUploadedAt)).length
              return (
                <span className="text-sm text-ai-graphite-500 truncate">
                  {drawing > 0
                    ? `· Drawing ${drawing} — ${ready} of ${total} ready`
                    : `· ${total} figure${total === 1 ? '' : 's'}`}
                </span>
              )
            })()}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {diagramSources.length > 0 && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setTranslateFigureNo(null) // null = translate all
                    setShowTranslateModal(true)
                  }}
                >
                  <Languages className="w-4 h-4 mr-2" />
                  Translate all
                </Button>
                <Hint
                  title="Translating diagrams"
                  text="Translation converts the text labels inside each diagram. Reference numerals stay exactly the same, so translated figures still match your specification."
                />
              </>
            )}
          </div>
        </div>

        
{diagramSources.length === 0 ? (
          <div className="text-center py-12 px-6 bg-paper-100 rounded-xl border border-dashed border-paper-300">
            <ImageIcon className="w-10 h-10 text-ai-graphite-300 mx-auto mb-3" />
            <p className="font-medium text-ai-graphite-800">No figures yet</p>
            <p className="text-sm text-ai-graphite-500 mt-1 max-w-sm mx-auto">
              Use <span className="font-medium text-ai-graphite-700">Plan my figures</span> above and the AI will
              propose a figure set from your specification for you to approve.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {Object.keys(diagramsByFigure)
              .map(n => Number(n))
              .sort((a, b) => a - b)
              .map((figNo: number) => {
                const sources = diagramsByFigure[figNo] || []
                if (sources.length === 0) return null

                const availableLangs = Array.from(new Set(sources.map((s: any) => (s.language || 'en').toLowerCase())))
                const selectedLang = (() => {
                  const chosen = selectedLangByFigure[figNo]
                  if (chosen && availableLangs.includes(chosen)) return chosen
                  if (availableLangs.includes(preferredFigureLanguage)) return preferredFigureLanguage
                  if (availableLangs.includes('en')) return 'en'
                  return availableLangs[0]
                })()

                const selectedSource = sources.find((s: any) => (s.language || 'en').toLowerCase() === selectedLang) || sources[0]
                const imageAnalysisStatus = normalizeDiagramImageAnalysisStatus(selectedSource.imageAnalysisStatus)

                const plan = figurePlans.find((f: any) => f.figureNo === figNo)
                const diagramKey = getDiagramKey(figNo, selectedSource.language || 'en')
                const previewUrl = renderPreview[diagramKey] as string | undefined
                const serverImageUrl = selectedSource.imageFilename
                  ? `/api/projects/${patent.project.id}/patents/${patent.id}/upload?filename=${encodeURIComponent(selectedSource.imageFilename)}`
                  : undefined
                const displayUrl = previewUrl || serverImageUrl
                const editorImageUrl = previewUrl && !previewUrl.startsWith('blob:')
                  ? previewUrl
                  : serverImageUrl || previewUrl

                return (
              // No `overflow-hidden` on this Card: it clipped the actions menu
              // that opens from the footer. The preview image sits between the
              // header and footer rather than against a rounded corner, so
              // nothing here needs clipping.
              <Card key={`figure_${figNo}`} className="hover:shadow-lg transition-all duration-300">
                <CardHeader className="pb-3">
                  {/* One status, in the attorney's terms. The pipeline's own
                      states — code generated, image analysed, raw override —
                      are machine bookkeeping and stay out of the card; the
                      "Edited" mark survives because it warns that re-rendering
                      would discard the user's own work. */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-xs font-semibold text-ai-graphite-700 tabular-nums shrink-0">
                        FIG. {figNo}
                      </span>
                      {selectedSource.originalImagePath && (
                        <span title="You edited this figure. Re-drawing it from the diagram source would discard those edits.">
                          <Badge variant="outline" className="text-xs text-ai-graphite-600 bg-paper-100 border-paper-300">
                            Edited
                          </Badge>
                        </span>
                      )}
                    </div>
                    {(() => {
                      const isBusy = !!processingStatus[diagramKey] && processingStep[diagramKey] !== -1
                      const failed = processingStep[diagramKey] === -1
                      const ready = !!selectedSource.imageUploadedAt && !isBusy && !failed
                      if (failed) {
                        return (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-transparent bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 shrink-0">
                            <AlertCircle className="w-3 h-3" />
                            Needs a retry
                          </span>
                        )
                      }
                      if (isBusy) {
                        return (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-transparent bg-ai-blue-50 px-2 py-0.5 text-[11px] font-medium text-ai-blue-700 shrink-0">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Drawing…
                          </span>
                        )
                      }
                      return (
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium shrink-0 ${
                          ready ? 'border-transparent bg-emerald-50 text-emerald-700' : 'border-paper-300 bg-paper-100 text-ai-graphite-600'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${ready ? 'bg-emerald-600' : 'bg-ai-graphite-400'}`} />
                          {ready ? 'Ready' : 'Waiting'}
                        </span>
                      )
                    })()}
                  </div>
                  {/* Caption (Title) - shown prominently */}
                  <CardTitle className="text-base font-semibold text-ai-graphite-900 mt-2 line-clamp-2">
                    {(() => {
                      const caption = plan?.title || `Figure ${figNo}`
                      // Remove redundant "Fig. X" prefix from caption if present
                      return caption.replace(/^(Fig\.\s*\d+\s*[-:"]\s*)/i, '').trim() || caption
                    })()}
                  </CardTitle>
                </CardHeader>
                
                <div className="px-4 pb-3 flex flex-wrap gap-2 border-b bg-white">
                  {availableLangs.map(lang => (
                    <button
                      key={`${figNo}_${lang}`}
                      onClick={() => setSelectedLangByFigure(prev => ({ ...prev, [figNo]: lang }))}
                      className={`px-3 py-1 rounded-md text-sm border transition ${
                        lang === selectedLang
                          ? 'bg-green-50 border-green-500 text-green-700 font-semibold'
                          : 'bg-white border-paper-300 text-ai-graphite-600 hover:bg-paper-100'
                      }`}
                    >
                      {LANGUAGE_LABELS[lang]?.split(' ')[0] || lang.toUpperCase()}
                    </button>
                  ))}
                </div>
                
                <CardContent className="p-0 relative bg-paper-200 min-h-[200px] flex items-center justify-center group">
                  {/* Preview Image */}
                  {(renderPreview[diagramKey] || (selectedSource.imageFilename && !processingStatus[diagramKey])) ? (
                    <>
                      <img 
                        src={displayUrl || ''} 
                        alt={`Fig ${figNo}`}
                        className="w-full h-64 object-contain bg-white"
                      />
                      {/* On touch screens there is no hover, so these actions
                          would be unreachable — they stay visible there. */}
                      <div className="reveal-scrim absolute inset-0 bg-black/50 opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-within:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <Button variant="secondary" size="sm" onClick={() => setExpandedFigNo(figNo)}>
                          <Eye className="w-4 h-4 mr-2" /> Expand
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={!serverImageUrl || !!processingStatus[diagramKey]}
                          title="Edit this figure (erase, draw, add labels)"
                          onClick={() => {
                            if (serverImageUrl) {
                              openImageEditor({
                                type: 'diagram',
                                id: figNo,
                                title: `Fig ${figNo}`,
                                imageFilename: selectedSource.imageFilename,
                                originalImageFilename: selectedSource.originalImageFilename,
                                fallbackImagePath: serverImageUrl,
                                originalImagePath: selectedSource.originalImagePath,
                                language: (selectedSource.language || 'en').toLowerCase(),
                                annotations: selectedSource.annotations
                              })
                            }
                          }}
                        >
                          <Paintbrush className="w-4 h-4 mr-2" /> Edit
                        </Button>
                      </div>
                    </>
                  ) : (
                  <div className="flex flex-col items-center p-6 text-center">
                    {processingStatus[diagramKey] ? (
                      <div className="space-y-3">
                        <div className="relative w-16 h-16 mx-auto">
                          <div className="absolute inset-0 border-4 border-ai-blue-100 rounded-full"></div>
                          <div className="absolute inset-0 border-4 border-ai-blue-500 rounded-full border-t-transparent animate-spin"></div>
                          <Sparkles className="absolute inset-0 m-auto w-6 h-6 text-ai-blue-500 animate-pulse" />
                        </div>
                        <p className="text-sm font-medium text-ai-blue-600 animate-pulse">
                          {processingStatus[diagramKey]}
                        </p>
                        {processingStep[diagramKey] === -1 && selectedSource.plantumlCode && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-2"
                            onClick={() => {
                              const opEpoch = getDiagramOpEpoch(diagramKey)
                              // Clear states and re-queue for rendering
                              setProcessingStatus(prev => ({ ...prev, [diagramKey]: '' }))
                              setProcessingStep(prev => ({ ...prev, [diagramKey]: 0 }))
                              queuedForRenderRef.current.delete(diagramKey) // Allow re-queueing
                              // Allow one fresh centralized repair on an explicit manual retry.
                              autoFixAttemptedRef.current.delete(diagramKey)
                              autoProcessDiagram(figNo, selectedSource.plantumlCode, selectedSource.language || 'en', opEpoch)
                            }}
                          >
                            <RefreshCw className="w-4 h-4 mr-2" /> Retry Render
                          </Button>
                        )}
                      </div>
                    ) : selectedSource.plantumlCode ? (
                      <div className="text-center">
                        <Code className="w-12 h-12 text-gray-300 mx-auto mb-2" />
                        <p className="text-sm text-ai-graphite-500 mb-4">Code ready for processing</p>
                        <Button size="sm" onClick={() => {
                          const opEpoch = getDiagramOpEpoch(diagramKey)
                          queuedForRenderRef.current.delete(diagramKey) // Ensure it can be queued
                          // Allow one centralized repair for this user-initiated render.
                          autoFixAttemptedRef.current.delete(diagramKey)
                          autoProcessDiagram(figNo, selectedSource.plantumlCode, selectedSource.language || 'en', opEpoch)
                        }}>
                          <RefreshCw className="w-4 h-4 mr-2" /> Render Image
                        </Button>
                      </div>
                    ) : (
                      <p className="text-sm text-ai-graphite-400">No image data</p>
                    )}
                  </div>
                )}
                </CardContent>

                {/* Figure Caption & Description - Academic Style */}
                {(() => {
                  const caption = plan?.title || ''
                  const description = plan?.description || ''
                  // Clean caption: remove "Fig. X -" prefix if present
                  const cleanCaption = caption.replace(/^(Fig\.\s*\d+\s*[-:"]\s*)/i, '').trim()
                  
                  // Only show this section if there's either a caption or description
                  if (!cleanCaption && !description) return null
                  
                  return (
                    <div className="px-4 py-3 bg-paper-100 border-t border-paper-300 space-y-2">
                      {/* Caption Line - for draft export (one line max) */}
                      {cleanCaption && (
                        <p className="text-sm font-medium text-ai-graphite-800 truncate" title={cleanCaption}>
                          <span className="text-ai-blue-600">Fig. {figNo}:</span> {cleanCaption}
                        </p>
                      )}
                      {/* Description - detailed explanation */}
                      {description && (
                        <p className="text-xs text-ai-graphite-600 leading-relaxed text-justify">
                          <span className="font-medium text-ai-graphite-700">Description:</span> {description}
                        </p>
                      )}
                    </div>
                  )
                })()}

                {/* Only the failed case is shown: queued/processing/completed
                    are the pipeline narrating itself, which tells the attorney
                    nothing they can act on. A failure has a Retry, so it stays. */}
                {imageAnalysisStatus === 'FAILED' && (
                  <div className="px-4 py-2 border-t text-xs border-amber-200 bg-amber-50 text-amber-900">
                    <div className="flex items-center justify-between gap-3">
                      <span>{selectedSource.imageAnalysisError || 'This image could not be read automatically.'}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 shrink-0 bg-white text-xs"
                        onClick={() => handleRetryDiagramImageAnalysis(selectedSource)}
                        disabled={!!retryingImageAnalysis[selectedSource.id]}
                      >
                        {retryingImageAnalysis[selectedSource.id]
                          ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          : <RefreshCw className="mr-1 h-3 w-3" />}
                        Retry
                      </Button>
                    </div>
                  </div>
                )}

                {/* A dense figure is the one case where splitting is the obvious
                    next action, so it is offered right under the drawing instead
                    of inside Request changes. Advisory: the figure is already
                    saved and exportable. */}
                {(() => {
                  const densityNote = figureDensityNote(plan)
                  if (!densityNote) return null
                  return (
                    <div className="px-4 py-3 border-t border-amber-200 bg-amber-50">
                      <p className="text-xs text-amber-900">
                        <span className="font-medium">This figure is dense.</span> {densityNote}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Label className="text-xs text-amber-900">Split into</Label>
                        <select
                          className="rounded border border-amber-300 bg-white px-1 py-0.5 text-xs"
                          value={splitPartsFor(figNo)}
                          onChange={(e) => setSplitPartsCount(prev => ({ ...prev, [figNo]: Number(e.target.value) }))}
                          disabled={!!regeneratingFigure[figNo]}
                          aria-label={`Number of parts to split figure ${figNo} into`}
                        >
                          {[2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                        <Label className="text-xs text-amber-900">parts</Label>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 shrink-0 bg-white text-xs"
                          disabled={!!regeneratingFigure[figNo]}
                          onClick={() => handleSplitFigure(figNo)}
                        >
                          {regeneratingFigure[figNo]
                            ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            : <Scissors className="mr-1 h-3 w-3" />}
                          Split figure
                        </Button>
                      </div>
                    </div>
                  )
                })()}

                {/* One named action the attorney reaches for, with the rest
                    behind an overflow menu so the card reads at a glance. */}
                <div className="p-3 bg-white border-t grid grid-cols-1 gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <Button variant="ghost" size="sm" onClick={() => { setModifyFigNo(figNo); setModifyTextSaved('') }}>
                      <Edit2 className="w-4 h-4 mr-2" /> Request changes
                    </Button>
                    <FigureActionsMenu
                      label={`More actions for figure ${figNo}`}
                      items={[
                        {
                          label: 'Translate this figure',
                          icon: <Languages className="w-4 h-4" />,
                          onSelect: () => { setTranslateFigureNo(figNo); setShowTranslateModal(true) }
                        },
                        {
                          label: 'Download image',
                          icon: <Download className="w-4 h-4" />,
                          disabled: !displayUrl,
                          onSelect: () => handleDownloadFigureImage(displayUrl as any, figNo, selectedLang as any)
                        },
                        {
                          label: 'Delete figure',
                          icon: <Trash2 className="w-4 h-4" />,
                          danger: true,
                          onSelect: async () => {
                            const langLabel = LANGUAGE_LABELS[selectedLang]?.split(' ')[0] || selectedLang.toUpperCase()
                            if (!confirm(`Delete Figure ${figNo} (${langLabel})?`)) return
                            try {
                              invalidateDiagramOps(figNo, selectedLang)
                              await onComplete({ action: 'delete_figure', sessionId: session?.id, figureNo: figNo, language: selectedLang })
                              await onRefresh()
                              if (selectedArrangeFigure?.id === `diagram-${figNo}`) {
                                setSelectedArrangeFigure(null)
                              }
                              if (arrangedFigures.length > 0) {
                                await loadCombinedFigures()
                              }
                            } catch (e) { setError('Failed to delete') }
                          }
                        }
                      ]}
                    />
                  </div>

                  {selectedSource.plantumlCode && (
                    <div>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="w-full text-xs text-ai-graphite-500"
                          onClick={() => {
                            setShowPlantUML(prev => ({ ...prev, [figNo]: !prev[figNo] }))
                            setPlantUmlDrafts(prev => prev[figNo] === undefined ? ({ ...prev, [figNo]: selectedSource.plantumlCode }) : prev)
                          }}
                        >
                          {showPlantUML[figNo] ? 'Hide diagram source' : 'Edit diagram source (advanced)'}
                        </Button>
                        {showPlantUML[figNo] && (
                           <div className="mt-2 space-y-2">
                             <Textarea 
                              readOnly={selectedLang !== 'en'}
                              value={plantUmlDrafts[figNo] ?? selectedSource.plantumlCode}
                              onChange={(event) => setPlantUmlDrafts(prev => ({ ...prev, [figNo]: event.target.value }))}
                              className="font-mono text-xs h-48 bg-paper-100"
                            />
                            <div className="flex gap-2">
                              <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(plantUmlDrafts[figNo] ?? selectedSource.plantumlCode)}>
                                Copy
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => setPlantUmlDrafts(prev => ({ ...prev, [figNo]: selectedSource.plantumlCode }))}>
                                Revert
                              </Button>
                              <Button
                                size="sm"
                                disabled={selectedLang !== 'en' || !!savingPlantUml[figNo]}
                                onClick={async () => {
                                  setSavingPlantUml(prev => ({ ...prev, [figNo]: true }))
                                  setError(null)
                                  try {
                                    const response = await onComplete({
                                      action: 'save_plantuml',
                                      sessionId: session?.id,
                                      figureNo: figNo,
                                      title: plan?.title,
                                      description: plan?.description,
                                      plantumlCode: plantUmlDrafts[figNo] ?? selectedSource.plantumlCode,
                                    })
                                    if (response?.error) throw new Error(response.details ? `${response.error}: ${JSON.stringify(response.details)}` : response.error)
                                    setPlantUmlDrafts(prev => ({ ...prev, [figNo]: response?.plantumlCode || prev[figNo] }))
                                    await onRefresh()
                                  } catch (saveError) {
                                    setError(saveError instanceof Error ? saveError.message : 'Failed to save PlantUML')
                                  } finally {
                                    setSavingPlantUml(prev => ({ ...prev, [figNo]: false }))
                                  }
                                }}
                              >
                                {savingPlantUml[figNo] && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                                Save expert override
                              </Button>
                            </div>
                            {selectedLang !== 'en' && <p className="text-xs text-ai-graphite-500">Edit the English source; translated variants are regenerated from it.</p>}
                    </div>
                        )}
                  </div>
                )}

                  {/* Modification Panel */}
                {modifyFigNo === figNo && (
                    <div className="mt-2 pt-2 border-t">
                      <Label className="text-xs mb-1 block">Describe changes:</Label>
                      <Textarea 
                        className="text-sm mb-2"
                        value={modifyTextSaved}
                        onChange={(e) => setModifyTextSaved(e.target.value)}
                      />
                        <div className="flex gap-2">
                          <Button size="sm" className="flex-1" onClick={async () => {
                            setRegeneratingFigure(prev => ({ ...prev, [figNo]: true }))
                            setError(null) // Clear previous errors
                            setGenerationWarning(null)
                            try {
                             let resp = await onComplete({ action: 'regenerate_diagram_llm', sessionId: session?.id, figureNo: figNo, instructions: modifyTextSaved })
                              if (resp?.code === 'RAW_OVERRIDE_CONFIRMATION_REQUIRED' && window.confirm('This figure contains expert PlantUML customizations. Replace them and return the figure to managed mode?')) {
                                resp = await onComplete({ action: 'regenerate_diagram_llm', sessionId: session?.id, figureNo: figNo, instructions: modifyTextSaved, confirmRawReplacement: true })
                              }
                              if (resp?.diagramSource?.plantumlCode) {
                                setGenerationWarning(formatDiagramGenerationWarnings(resp))
                                await onRefresh()
                                setModifyFigNo(null)
                                setModifyTextSaved('')
                              } else if (resp?.error) {
                                // Handle API error response
                                const baseError = resp.details
                                  ? `${resp.error}: ${typeof resp.details === 'string' ? resp.details : JSON.stringify(resp.details)}`
                                  : resp.error
                                const repairDetails = formatDiagramGenerationWarnings(resp)
                                const errorMsg = [baseError, repairDetails].filter(Boolean).join(' ')
                                setError(`Diagram modification failed: ${errorMsg}`)
                              } else if (!resp) {
                                // Handle null response (error handled by parent, but show something)
                                setError('Diagram modification failed. Please try again with different instructions.')
                              }
                            } catch (e) { 
                              console.error('Diagram modification error:', e)
                              setError(e instanceof Error ? `Failed to modify: ${e.message}` : 'Failed to modify diagram') 
                            } finally {
                              setRegeneratingFigure(prev => ({ ...prev, [figNo]: false }))
                            }
                          }} disabled={!!regeneratingFigure[figNo]}>
                            {regeneratingFigure[figNo] ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                            Apply
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setModifyFigNo(null)}>Cancel</Button>
                      </div>
                      {/* Dense figures already offer this above the card, so it
                          is not repeated here. */}
                      {!figureDensityNote(plan) && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
                          <Label className="text-xs">Or split this figure into</Label>
                          <select
                            className="rounded border border-paper-300 px-1 py-0.5 text-xs"
                            value={splitPartsFor(figNo)}
                            onChange={(e) => setSplitPartsCount(prev => ({ ...prev, [figNo]: Number(e.target.value) }))}
                            disabled={!!regeneratingFigure[figNo]}
                            aria-label={`Number of parts to split figure ${figNo} into`}
                          >
                            {[2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}
                          </select>
                          <Label className="text-xs">parts</Label>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={!!regeneratingFigure[figNo]}
                            onClick={() => handleSplitFigure(figNo, modifyTextSaved)}
                          >
                            {regeneratingFigure[figNo]
                              ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                              : <Scissors className="mr-1 h-3 w-3" />}
                            Split figure
                          </Button>
                        </div>
                      )}
                      {regeneratingFigure[figNo] && (
                        <div className="mt-2 flex items-center text-xs text-ai-blue-600">
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Regenerating diagram with AI...
                        </div>
                      )}
                    </div>
                  )}
                  </div>
                </Card>
                )})}
                      </div>
                    )}
                      </div>
      {/* Manual Upload Section (Collapsible) */}
      <div ref={uploadSectionRef}>
        <AnimatePresence>
          {showManual && (
            <motion.div
              initial={{ opacity: 0, height: 0, scale: 0.95 }}
              animate={{
                opacity: 1,
                height: 'auto',
                scale: highlightUpload ? [1, 1.02, 1] : 1,
                boxShadow: highlightUpload
                  ? ['0 1px 3px 0 rgb(0 0 0 / 0.1)', '0 10px 25px -5px rgb(99 102 241 / 0.1)', '0 1px 3px 0 rgb(0 0 0 / 0.1)']
                  : '0 1px 3px 0 rgb(0 0 0 / 0.1)'
              }}
              exit={{ opacity: 0, height: 0, scale: 0.95 }}
              transition={{
                duration: highlightUpload ? 0.6 : 0.3,
                scale: {
                  repeat: highlightUpload ? 2 : 0,
                  duration: 0.2
                }
              }}
              className={`bg-white border border-paper-300 rounded-xl p-6 shadow-sm mt-6 ${highlightUpload ? 'ring-2 ring-ai-blue-400 ring-opacity-50' : ''}`}
            >
            <div className="flex flex-col gap-4 mb-6 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h4 className="font-semibold flex items-center gap-2 mb-2">
                  <Upload className="w-5 h-5 text-ai-blue-600" />
                  Upload External Images
                  {highlightUpload && (
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="inline-flex items-center px-2 py-1 text-xs font-medium text-ai-blue-700 bg-ai-blue-100 rounded-full"
                    >
                      <Sparkles className="w-3 h-3 mr-1" />
                      Ready to upload!
                    </motion.span>
                  )}
                </h4>
                <p className="text-sm text-ai-graphite-600 max-w-3xl">
                  Upload patent diagrams or images one at a time. Use AI detection to draft the required description; images sent to AI are limited to Full HD resolution.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={addManualUploadSlot}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add image
                </Button>
                <Button
                  size="sm"
                  onClick={detectAllManualImageContent}
                  disabled={manualDetectingAll || manualUploadSlots.every(slot => !slot.file || countWords(slot.description) >= 20 || slot.status === 'saved')}
                >
                  {manualDetectingAll ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wand2 className="w-4 h-4 mr-2" />}
                  Describe images with AI
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={saveAllReadyManualUploads}
                  disabled={manualUploadSlots.every(slot => !slot.file || countWords(slot.description) < 20 || slot.status === 'saved')}
                >
                  <Check className="w-4 h-4 mr-2" />
                  Add all ready
                </Button>
              </div>
            </div>

            {manualDetectionProgress && (
              <div className="mb-4 rounded-md border border-ai-blue-100 bg-ai-blue-50 px-3 py-2 text-sm text-ai-blue-700 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Detecting image {manualDetectionProgress.current} of {manualDetectionProgress.total}
              </div>
            )}

            <div className="space-y-4">
              {manualUploadSlots.map((slot, i) => {
                const wordCount = countWords(slot.description)
                const ready = !!slot.file && wordCount >= 20 && slot.status !== 'saved'
                return (
                  <div key={slot.id} className="border rounded-lg p-4 bg-paper-100">
                    <div className="flex flex-col gap-4 lg:flex-row">
                      <div className="lg:w-64 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium text-ai-graphite-700">Image {i + 1}</div>
                          <div className="flex items-center gap-2">
                            {slot.status === 'saved' ? (
                              <Badge variant="default" className="bg-green-600">Saved</Badge>
                            ) : ready ? (
                              <Badge variant="default" className="bg-green-500">Ready</Badge>
                            ) : slot.status === 'detecting' ? (
                              <Badge variant="secondary">Detecting</Badge>
                            ) : slot.file ? (
                              <Badge variant="outline">Needs description</Badge>
                            ) : (
                              <Badge variant="outline">Needs image</Badge>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeManualUploadSlot(slot.id)}
                              disabled={slot.status === 'detecting' || slot.status === 'saving'}
                              className="h-8 w-8 p-0 text-ai-graphite-500 hover:text-red-600"
                              title="Remove image"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>

                        <div className="aspect-[4/3] rounded-md border bg-white flex items-center justify-center overflow-hidden">
                          {slot.previewUrl ? (
                            <img src={slot.previewUrl} alt={`External upload ${i + 1}`} className="h-full w-full object-contain" />
                          ) : (
                            <div className="text-center text-ai-graphite-400">
                              <UploadCloud className="w-8 h-8 mx-auto mb-2" />
                              <p className="text-xs">Choose image</p>
                            </div>
                          )}
                        </div>

                        <Input
                          type="file"
                          accept={EXTERNAL_UPLOAD_ACCEPT}
                          className="bg-white"
                          disabled={slot.status === 'detecting' || slot.status === 'saving' || slot.status === 'saved'}
                          onChange={(e) => handleManualFileChange(slot.id, e.target.files?.[0])}
                        />
                        <p className="text-xs text-ai-graphite-500">PNG, JPEG, WebP, or SVG. AI detection analyzes a Full HD copy.</p>
                      </div>

                      <div className="flex-1 grid gap-4">
                        <Input
                          placeholder="Figure Title (Optional)"
                          value={slot.title}
                          disabled={slot.status === 'saving' || slot.status === 'saved'}
                          onChange={(e) => updateManualUploadSlot(slot.id, { title: e.target.value })}
                        />
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <Label className="text-xs text-ai-graphite-500 flex items-center gap-1">
                              Description (min 20 words)
                              <Hint text="The description becomes this figure's caption in your specification, so it needs enough detail to stand on its own. Use 'Describe images with AI' to write it for you." />
                            </Label>
                            <span className={wordCount >= 20 ? 'text-xs text-green-600' : 'text-xs text-ai-graphite-500'}>
                              {wordCount} / 20 words
                            </span>
                          </div>
                          <Textarea
                            placeholder="Describe the image content..."
                            value={slot.description}
                            disabled={slot.status === 'saving' || slot.status === 'saved'}
                            className="min-h-[110px]"
                            onChange={(e) => updateManualUploadSlot(slot.id, {
                              description: e.target.value,
                              aiGenerated: false,
                              error: undefined,
                              status: slot.status === 'error' ? 'idle' : slot.status
                            })}
                          />
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => detectManualImageContent(slot.id)}
                              disabled={!slot.file || slot.status === 'detecting' || slot.status === 'saving' || slot.status === 'saved' || manualDetectingAll}
                            >
                              {slot.status === 'detecting' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wand2 className="w-4 h-4 mr-2" />}
                              Detect this image
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => saveManualUploadSlot(slot.id)}
                              disabled={!ready || slot.status === 'saving' || isUploading}
                            >
                              {slot.status === 'saving' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                              Add to figures
                            </Button>
                            {slot.aiGenerated && (
                              <Badge variant="outline" className="text-ai-blue-700 border-ai-blue-200 bg-ai-blue-50">AI drafted</Badge>
                            )}
                            {slot.scaledForDetection && slot.imageWidth && slot.imageHeight && (
                              <Badge variant="outline" className="text-slate-600">
                                Analyzed at {slot.imageWidth}x{slot.imageHeight}
                              </Badge>
                            )}
                          </div>
                        </div>

                        {slot.error && (
                          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                            <span>{slot.error}</span>
                          </div>
                        )}
                        {slot.warnings && slot.warnings.length > 0 && (
                          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                            {slot.warnings.join(' ')}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </motion.div>
      )}
      </AnimatePresence>
      </div>

      {/* Expanded Image Modal */}
      <AnimatePresence>
        {(() => {
          const sources = diagramSources.filter((d: any) => d.figureNo === expandedFigNo)
          const availableLangs = Array.from(new Set(sources.map((s: any) => (s.language || 'en').toLowerCase())))
          const selectedLang = (() => {
            if (!expandedFigNo) return null
            const chosen = selectedLangByFigure[expandedFigNo]
            if (chosen && availableLangs.includes(chosen)) return chosen
            if (availableLangs.includes(preferredFigureLanguage)) return preferredFigureLanguage
            if (availableLangs.includes('en')) return 'en'
            return availableLangs[0] || null
          })()
          const diagramSource = sources.find((d: any) => (d.language || 'en').toLowerCase() === selectedLang) || sources[0]
          const expandedKey = diagramSource ? getDiagramKey(diagramSource.figureNo, diagramSource.language || 'en') : ''
          const hasImage = expandedFigNo && (renderPreview[expandedKey] || (diagramSource?.imageFilename && !processingStatus[expandedKey]))

          return hasImage ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setExpandedFigNo(null)}
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{
                type: "spring",
                stiffness: 300,
                damping: 30,
                duration: 0.3
              }}
              className="bg-white rounded-xl shadow-2xl p-2 max-w-6xl w-full max-h-[90vh] flex flex-col will-change-transform"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b">
                <h4 className="text-lg font-semibold text-ai-graphite-900">Figure {expandedFigNo} Preview</h4>
                <Button variant="ghost" size="icon" onClick={() => setExpandedFigNo(null)}>
                  <span className="sr-only">Close</span>
                  <span className="text-2xl">&times;</span>
                </Button>
              </div>
              <div className="flex-1 overflow-auto p-4 bg-paper-200 flex items-center justify-center">
                <motion.img
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.1, duration: 0.3 }}
                  src={renderPreview[expandedKey] || `/api/projects/${patent.project.id}/patents/${patent.id}/upload?filename=${encodeURIComponent(diagramSource?.imageFilename || '')}`}
                  alt={`Preview Fig.${expandedFigNo}`}
                  className="max-w-full h-auto shadow-lg"
                  style={{ willChange: 'transform, opacity' }}
                />
              </div>
              <div className="p-4 border-t flex justify-end gap-3">
                <Button
                  variant="outline"
                  disabled={!diagramSource?.imageFilename}
                  title="Edit this figure (erase, draw, add labels)"
                  onClick={() => {
                    const figNo = expandedFigNo
                    setExpandedFigNo(null)
                    if (figNo && diagramSource?.imageFilename) {
                      openImageEditor({
                        type: 'diagram',
                        id: figNo,
                        title: `Fig ${figNo}`,
                        imageFilename: diagramSource.imageFilename,
                        originalImageFilename: diagramSource.originalImageFilename,
                        fallbackImagePath: buildFigureImageUrl(diagramSource.imageFilename),
                        originalImagePath: diagramSource.originalImagePath,
                        language: (diagramSource.language || 'en').toLowerCase(),
                        annotations: diagramSource.annotations
                      })
                    }
                  }}
                >
                  <Paintbrush className="w-4 h-4 mr-2" />
                  Edit image
                </Button>
                <Button variant="outline" onClick={() => setExpandedFigNo(null)}>Close</Button>
                {/* Approval is now automatic - this button removed */}
              </div>
            </motion.div>
          </motion.div>
        ) : null
      })()}
      </AnimatePresence>

      {/* Translation Modal */}
      <AnimatePresence>
        {showTranslateModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => !translating && setShowTranslateModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-ai-blue-100 rounded-lg">
                  <Languages className="w-6 h-6 text-ai-blue-600" />
                </div>
                <div>
                  <h4 className="text-lg font-semibold text-ai-graphite-900">
                    {translateFigureNo !== null ? `Translate Figure ${translateFigureNo}` : 'Translate All Diagrams'}
                  </h4>
                  <p className="text-sm text-ai-graphite-500">
                    {translateFigureNo !== null 
                      ? 'Convert diagram labels to another language' 
                      : `Translate all ${diagramSources.filter((d: any) => !d.language || d.language === 'en').length} English diagrams`}
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <Label className="text-sm font-medium text-ai-graphite-700">Target Language</Label>
                  <select
                    value={translateTargetLang}
                    onChange={(e) => setTranslateTargetLang(e.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-paper-400 rounded-lg focus:ring-2 focus:ring-ai-blue-500 focus:border-ai-blue-500"
                    disabled={translating}
                  >
                    <option value="">Select language...</option>
                    {getAvailableTargetLanguages().map((lang) => (
                      <option key={lang} value={lang}>
                        {LANGUAGE_LABELS[lang] || lang.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>

                {translateFigureNo === null && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <p className="text-sm text-amber-800">
                      <strong>Note:</strong> Diagrams will be translated one by one to ensure accuracy. 
                      This may take a few moments.
                    </p>
                  </div>
                )}

                {translateProgress && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm text-ai-graphite-600">
                      <span>Translating...</span>
                      <span>{translateProgress.current} / {translateProgress.total}</span>
                    </div>
                    <div className="w-full bg-paper-300 rounded-full h-2">
                      <div 
                        className="bg-ai-blue-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${(translateProgress.current / translateProgress.total) * 100}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="bg-paper-100 rounded-lg p-3 text-xs text-ai-graphite-600 space-y-1">
                  <p>• Original English diagrams are preserved</p>
                  <p>• Translated diagrams are stored separately</p>
                  <p>• Assigned reference numerals remain unchanged</p>
                  <p>• Drafting stage will auto-select by jurisdiction</p>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowTranslateModal(false)
                    setTranslateTargetLang('')
                    setTranslateFigureNo(null)
                  }}
                  disabled={translating}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleTranslateDiagrams}
                  disabled={!translateTargetLang || translating}
                  className="flex-1 bg-ai-blue-600 hover:bg-ai-blue-700 text-white"
                >
                  {translating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Translating...
                    </>
                  ) : (
                    <>
                      <Languages className="w-4 h-4 mr-2" />
                      {translateFigureNo !== null ? 'Translate' : 'Translate All'}
                    </>
                  )}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
        </>
      )}

      {/* SKETCHES TAB CONTENT */}
      {activeTab === 'sketches' && (
        <div className="space-y-6">
          {/* Sketch Error Alert */}
          {sketchError && (
            <ActionableErrorPanel
              message={sketchError}
              area="sketch"
              onDismiss={() => setSketchError(null)}
            />
          )}

          {/* Sketch Generation Controls */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wand2 className="w-5 h-5 text-ai-blue-600" />
                Create an illustration
              </CardTitle>
              <CardDescription>
                Illustrations are line-art views of the physical product — a device, housing, or mechanical part shown
                the way it looks, rather than as a diagram. Many filings use diagrams only; add illustrations when a
                visual view strengthens the application.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Step 1 — deciding what to draw. Optional: skip straight to step 2. */}
              <div className="space-y-3">
                <div>
                  <h4 className="text-sm font-semibold text-ai-graphite-900">Not sure what to draw?</h4>
                  <p className="text-xs text-ai-graphite-500 mt-0.5">
                    Grapsi reads your invention facts and proposes views worth illustrating. Optional —
                    skip ahead if you already know what you want.
                  </p>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={handleGenerateSketchSuggestions}
                      disabled={suggestionsLoading}
                      variant="outline"
                      className="gap-2"
                    >
                      {suggestionsLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Sparkles className="w-4 h-4" />
                      )}
                      {suggestionsLoading ? 'Thinking…' : 'Suggest views'}
                    </Button>
                    <Button
                      onClick={() => setShowReferenceSelector(!showReferenceSelector)}
                      variant="ghost"
                      size="sm"
                      className="gap-1 text-xs"
                      title="Add context from existing figures to generate complementary sketch ideas"
                    >
                      <Link2 className="w-3 h-3" />
                      {selectedReferenceFigures.length > 0 
                        ? `${selectedReferenceFigures.length} context refs` 
                        : 'Add Context'}
                    </Button>
                    {displayedSketchSuggestions.length > 0 && (
                      <Badge variant="secondary" className="ml-2">
                        {displayedSketchSuggestions.length} saved suggestions
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Optional Reference Figure Selector - for AI suggestions context (text only) */}
                {showReferenceSelector && (
                  <div className="p-3 border rounded-lg bg-slate-50 space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium text-ai-graphite-600">
                        Context for Suggestions (optional)
                      </Label>
                      {selectedReferenceFigures.length > 0 && (
                        <button 
                          onClick={() => setSelectedReferenceFigures([])}
                          className="text-xs text-ai-graphite-500 hover:text-ai-graphite-700"
                        >
                          Clear all
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-ai-graphite-500">
                      Select existing figures to help AI understand what views already exist. This helps generate complementary sketch <em>ideas</em>.
                    </p>
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {/* Show existing diagrams */}
                      {Object.keys(diagramsByFigure).map((figNoStr) => {
                        const figNo = Number(figNoStr)
                        const sources = diagramsByFigure[figNo] || []
                        const source = sources[0]
                        const figurePlan = session?.figurePlans?.find((fp: any) => fp.figureNo === figNo)
                        const title = figurePlan?.title || source?.figurePlan?.title || `Figure ${figNo}`
                        const figId = `diagram-${figNo}`
                        const isSelected = selectedReferenceFigures.includes(figId)
                        
                        return (
                          <label 
                            key={figId} 
                            className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                              isSelected ? 'bg-ai-blue-100 border-ai-blue-200' : 'hover:bg-paper-200'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedReferenceFigures([...selectedReferenceFigures, figId])
                                } else {
                                  setSelectedReferenceFigures(selectedReferenceFigures.filter(id => id !== figId))
                                }
                              }}
                              className="rounded border-paper-400"
                            />
                            <span className="text-xs">
                              <span className="font-medium">Fig {figNo}:</span> {title}
                              <Badge variant="outline" className="ml-1 text-[10px]">Diagram</Badge>
                            </span>
                          </label>
                        )
                      })}
                      {/* Show existing sketches */}
                      {sketches.filter(s => s.status === 'SUCCESS').map((sketch) => {
                        const sketchId = sketch.id
                        const isSelected = selectedReferenceFigures.includes(sketchId)
                        
                        return (
                          <label 
                            key={sketchId} 
                            className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                              isSelected ? 'bg-amber-100 border-amber-200' : 'hover:bg-paper-200'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedReferenceFigures([...selectedReferenceFigures, sketchId])
                                } else {
                                  setSelectedReferenceFigures(selectedReferenceFigures.filter(id => id !== sketchId))
                                }
                              }}
                              className="rounded border-paper-400"
                            />
                            <span className="text-xs">
                              <span className="font-medium">{sketch.title}</span>
                              <Badge variant="outline" className="ml-1 text-[10px] bg-amber-50">Sketch</Badge>
                            </span>
                          </label>
                        )
                      })}
                      {Object.keys(diagramsByFigure).length === 0 && sketches.filter(s => s.status === 'SUCCESS').length === 0 && (
                        <p className="text-xs text-ai-graphite-400 italic p-2">No existing figures to reference</p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Suggestions Error */}
              {suggestionsError && (
                <ActionableErrorPanel
                  message={suggestionsError}
                  area="suggestion"
                  onRetry={handleGenerateSketchSuggestions}
                  retryLabel="Suggest views again"
                  retrying={suggestionsLoading}
                  onDismiss={() => setSuggestionsError(null)}
                />
              )}

              {/* Nothing suggested, but nothing went wrong — explain why. */}
              {suggestionsNotice && (
                <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                  <Info className="h-4 w-4 shrink-0 mt-0.5 text-slate-500" />
                  <p className="text-sm text-ai-graphite-700 leading-relaxed">{suggestionsNotice}</p>
                </div>
              )}

              {/* Sketch Suggestions - with Generate Image buttons */}
              {displayedSketchSuggestions.length > 0 && (
                <section className="overflow-hidden rounded-2xl border border-ai-blue-100 bg-gradient-to-br from-white via-white to-ai-blue-50/50 shadow-sm">
                  <div className="flex flex-col gap-3 border-b border-ai-blue-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ai-blue-100 text-ai-blue-700">
                        <Lightbulb className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="font-semibold text-ai-graphite-900">Saved view ideas</h4>
                          <Badge className="border-ai-blue-200 bg-white text-ai-blue-700 hover:bg-white">
                            {displayedSketchSuggestions.length} available
                          </Badge>
                        </div>
                        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ai-graphite-500">
                          Generate a sketch now, or customize an idea first. Every idea stays saved and can be reused.
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-emerald-700">
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      Reusable after generation
                    </div>
                  </div>

                  <div className="grid gap-4 p-4 md:grid-cols-2 sm:p-5">
                    {displayedSketchSuggestions.map((suggestion, index) => {
                      const isPersistent = typeof suggestion.id === 'string'
                      const isGeneratingThis = isPersistent
                        ? generatingSuggestionId === suggestion.id
                        : generatingManualSuggestionIdx === index
                      const viewType = inferSketchViewType(suggestion.title, suggestion.description)
                      return (
                      <article
                        key={suggestion.id || `${suggestion.title}-${index}`}
                        className="group flex min-h-[280px] flex-col overflow-hidden rounded-xl border border-paper-300 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-ai-blue-200 hover:shadow-md"
                      >
                        <div className="relative flex h-24 items-center justify-center overflow-hidden border-b border-paper-200 bg-gradient-to-br from-slate-50 to-ai-blue-50">
                          <div className="absolute inset-0 opacity-40" style={{
                            backgroundImage: 'linear-gradient(to right, #cbd5e1 1px, transparent 1px), linear-gradient(to bottom, #cbd5e1 1px, transparent 1px)',
                            backgroundSize: '20px 20px'
                          }} />
                          <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-white bg-white/90 text-ai-blue-600 shadow-sm transition-transform duration-200 group-hover:scale-105">
                            {viewType === 'Exploded view' || viewType === 'Internal view'
                              ? <Layers className="h-6 w-6" aria-hidden="true" />
                              : viewType === 'Detail view'
                                ? <Eye className="h-6 w-6" aria-hidden="true" />
                                : <Pencil className="h-6 w-6" aria-hidden="true" />}
                          </div>
                          <div className="absolute left-3 top-3 flex items-center gap-2">
                            <Badge className="border-white bg-white/90 text-ai-graphite-700 shadow-sm hover:bg-white">
                              {viewType}
                            </Badge>
                          </div>
                          <span className="absolute right-3 top-3 flex h-6 min-w-6 items-center justify-center rounded-full border border-white bg-white/90 px-1.5 text-[11px] font-semibold text-ai-graphite-500 shadow-sm">
                            {index + 1}
                          </span>
                        </div>

                        <div className="flex flex-1 flex-col p-4">
                          <div className="flex-1">
                            <h5 className="font-semibold leading-snug text-ai-graphite-900">{suggestion.title}</h5>
                            <p
                              className="mt-2 line-clamp-4 text-sm leading-relaxed text-ai-graphite-600"
                              title={suggestion.description}
                            >
                              {suggestion.description}
                            </p>
                          </div>

                          <div className="mt-4 flex items-center gap-2 border-t border-paper-200 pt-3">
                            <Button
                              size="sm"
                              className="min-w-0 flex-1 gap-1.5 bg-ai-blue-600 text-white hover:bg-ai-blue-700"
                              onClick={() => isPersistent
                                ? handleGenerateFromSuggestion(suggestion.id)
                                : handleGenerateFromManualSuggestion(suggestion, index)}
                              disabled={generatingSuggestionId !== null || generatingManualSuggestionIdx !== null || sketchGenerating}
                            >
                              {isGeneratingThis ? (
                                <>
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  Generating...
                                </>
                              ) : (
                                <>
                                  <Wand2 className="h-3.5 w-3.5" />
                                  Generate sketch
                                </>
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-9 w-9 shrink-0 p-0 text-ai-graphite-600 hover:border-ai-blue-200 hover:bg-ai-blue-50 hover:text-ai-blue-700"
                              title="Customize this view before generating"
                              aria-label={`Customize ${suggestion.title}`}
                              onClick={() => {
                                setSketchTitle(suggestion.title)
                                setSketchPrompt(suggestion.description)
                                setSketchMode('guided')
                                if (!isPersistent) setSketchSuggestions(prev => prev.filter((_, i) => i !== index))
                                requestAnimationFrame(() => {
                                  document.getElementById('sketch-illustration-form')?.scrollIntoView({
                                    behavior: 'smooth',
                                    block: 'start'
                                  })
                                })
                              }}
                              disabled={generatingSuggestionId !== null || generatingManualSuggestionIdx !== null}
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-9 w-9 shrink-0 p-0 text-ai-graphite-400 hover:bg-red-50 hover:text-red-600"
                              title="Remove saved idea"
                              aria-label={`Remove ${suggestion.title}`}
                              onClick={() => isPersistent
                                ? handleDeleteSketch(suggestion.id)
                                : setSketchSuggestions(prev => prev.filter((_, i) => i !== index))}
                              disabled={generatingSuggestionId !== null || generatingManualSuggestionIdx !== null}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </article>
                    )})}
                  </div>
                </section>
              )}

              {/*
                Step 2 — making the illustration. The mode selector belongs directly above
                the fields it controls; it previously sat between "Get ideas" and the
                suggestions that button produces, splitting one task in half.
              */}
              <div id="sketch-illustration-form" className="scroll-mt-4 space-y-3 border-t border-paper-200 pt-4">
                <div>
                  <h4 className="text-sm font-semibold text-ai-graphite-900">Make the illustration</h4>
                  <p className="text-xs text-ai-graphite-500 mt-0.5">
                    Pick a suggestion above, or describe your own view below.
                  </p>
                </div>

                {/* Mode Selector */}
                <div className="flex items-center gap-2 bg-paper-200 p-1 rounded-lg w-fit">
                  <button
                    onClick={() => setSketchMode('auto')}
                    title="Grapsi chooses the view and draws it from your invention facts."
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
                      sketchMode === 'auto'
                        ? 'bg-white text-ai-blue-600 shadow-sm'
                        : 'text-ai-graphite-600 hover:text-ai-graphite-900'
                    }`}
                  >
                    <Sparkles className="w-4 h-4" />
                    Draw it for me
                  </button>
                  <button
                    onClick={() => setSketchMode('guided')}
                    title="You describe the view you want — angle, components, detail level — and Grapsi draws that."
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
                      sketchMode === 'guided'
                        ? 'bg-white text-ai-blue-600 shadow-sm'
                        : 'text-ai-graphite-600 hover:text-ai-graphite-900'
                    }`}
                  >
                    <Edit2 className="w-4 h-4" />
                    I&apos;ll describe it
                  </button>
                  <button
                    onClick={() => setSketchMode('refine')}
                    title="Upload your own sketch or photo and have it redrawn as patent-style line art."
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
                      sketchMode === 'refine'
                        ? 'bg-white text-ai-blue-600 shadow-sm'
                        : 'text-ai-graphite-600 hover:text-ai-graphite-900'
                    }`}
                  >
                    <Upload className="w-4 h-4" />
                    Clean up my drawing
                  </button>
                </div>
              </div>

              {/* Mode-specific inputs */}
              <div className="space-y-4">
                <div>
                  <Label htmlFor="sketch-title">Title (Optional)</Label>
                  <Input
                    id="sketch-title"
                    placeholder="e.g., System Block Diagram"
                    value={sketchTitle}
                    onChange={(e) => setSketchTitle(e.target.value)}
                    disabled={sketchGenerating}
                  />
                </div>

                {sketchMode !== 'auto' && (
                  <div>
                    <Label htmlFor="sketch-prompt">
                      {sketchMode === 'guided' ? 'Instructions' : 'Refinement Instructions (Optional)'}
                    </Label>
                    <Textarea
                      id="sketch-prompt"
                      placeholder={
                        sketchMode === 'guided'
                          ? "Describe what the sketch should show, layout preferences, focus areas..."
                          : "Optional: Specify how to refine the uploaded sketch..."
                      }
                      value={sketchPrompt}
                      onChange={(e) => setSketchPrompt(e.target.value)}
                      disabled={sketchGenerating}
                      rows={3}
                    />
                  </div>
                )}

                {sketchMode === 'refine' && (
                  <div className="space-y-2">
                    <Label>Upload Your Sketch</Label>
                    <input
                      ref={sketchFileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp"
                      onChange={handleSketchFileChange}
                      className="hidden"
                    />
                    <div
                      onClick={() => sketchFileInputRef.current?.click()}
                      className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                        sketchUploadPreview
                          ? 'border-green-300 bg-green-50'
                          : 'border-paper-400 hover:border-ai-blue-400 hover:bg-ai-blue-50'
                      }`}
                    >
                      {sketchUploadPreview ? (
                        <div className="space-y-2">
                          <img
                            src={sketchUploadPreview}
                            alt="Upload preview"
                            className="max-h-32 mx-auto rounded"
                          />
                          <p className="text-sm text-green-600">{sketchUploadFile?.name}</p>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              setSketchUploadFile(null)
                              setSketchUploadPreview(null)
                            }}
                          >
                            Remove
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <Upload className="w-8 h-8 mx-auto text-ai-graphite-400" />
                          <p className="text-sm text-ai-graphite-500">Click to upload a sketch</p>
                          <p className="text-xs text-ai-graphite-400">PNG, JPEG, WebP up to 10MB</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Reference Sketch Selection - for visual style consistency */}
                {sketches.filter(s => s.status === 'SUCCESS').length > 0 && (
                  <div className="border border-amber-200 bg-amber-50/30 rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Link2 className="w-4 h-4 text-amber-600" />
                        <Label className="text-sm font-medium text-ai-graphite-700">
                          Style Reference (Optional)
                        </Label>
                        {selectedReferenceSketchIds.length > 0 && (
                          <Badge variant="secondary" className="bg-amber-100 text-amber-700 text-xs">
                            {selectedReferenceSketchIds.length} selected
                          </Badge>
                        )}
                      </div>
                      {selectedReferenceSketchIds.length > 0 && (
                        <button 
                          onClick={() => setSelectedReferenceSketchIds([])}
                          className="text-xs text-ai-graphite-500 hover:text-ai-graphite-700"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-ai-graphite-600">
                      Select existing sketches to maintain <strong>visual consistency</strong> (line style, shading, layout). 
                      Selected images are passed to the AI to match the same drawing style.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {sketches.filter(s => s.status === 'SUCCESS').map((sketch) => {
                        const isSelected = selectedReferenceSketchIds.includes(sketch.id)
                        return (
                          <div
                            key={sketch.id}
                            onClick={() => {
                              if (isSelected) {
                                setSelectedReferenceSketchIds(selectedReferenceSketchIds.filter(id => id !== sketch.id))
                              } else {
                                setSelectedReferenceSketchIds([...selectedReferenceSketchIds, sketch.id])
                              }
                            }}
                            className={`relative cursor-pointer rounded-lg border-2 overflow-hidden transition-all ${
                              isSelected 
                                ? 'border-amber-500 ring-2 ring-amber-200 scale-105' 
                                : 'border-paper-300 hover:border-amber-300'
                            }`}
                            title={sketch.title || 'Untitled Sketch'}
                          >
                            <div className="w-16 h-16 bg-paper-200 flex items-center justify-center">
                              {sketch.imagePath ? (
                                <img
                                  src={sketch.imagePath}
                                  alt={sketch.title || 'Sketch'}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <Wand2 className="w-6 h-6 text-ai-graphite-400" />
                              )}
                            </div>
                            {isSelected && (
                              <div className="absolute inset-0 bg-amber-500/20 flex items-center justify-center">
                                <div className="w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center">
                                  <Check className="w-3 h-3 text-white" />
                                </div>
                              </div>
                            )}
                            <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5">
                              <p className="text-[9px] text-white truncate text-center">
                                {sketch.title?.slice(0, 12) || 'Sketch'}
                              </p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>

              <Button
                onClick={handleGenerateSketch}
                disabled={sketchGenerating || (sketchMode === 'refine' && !sketchUploadFile)}
                className="w-full md:w-auto bg-ai-blue-600 hover:bg-ai-blue-700 text-white gap-2"
              >
                {sketchGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating Sketch...
                  </>
                ) : (
                  <>
                    <Wand2 className="w-4 h-4" />
                    {sketchMode === 'auto' && 'Generate from Context'}
                    {sketchMode === 'guided' && 'Generate with Instructions'}
                    {sketchMode === 'refine' && 'Refine Uploaded Sketch'}
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Generated Sketches Grid */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-ai-graphite-900 flex items-center gap-2">
                <Grid3X3 className="w-5 h-5" />
                Generated Sketches
              </h3>
              <Button variant="outline" size="sm" onClick={loadSketches} disabled={sketchesLoading}>
                <RefreshCw className={`w-4 h-4 mr-2 ${sketchesLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>

            {sketchesLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-ai-blue-600" />
              </div>
            ) : sketches.filter(s => s.status !== 'SUGGESTED').length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center">
                  <Pencil className="w-12 h-12 mx-auto text-gray-300 mb-4" />
                  <h4 className="text-lg font-medium text-ai-graphite-900 mb-2">No generated sketches yet</h4>
                  <p className="text-ai-graphite-500 mb-4">
                    {sketches.some(s => s.status === 'SUGGESTED') 
                      ? 'Generate sketches from the suggestions above, or create a new one using the controls.'
                      : 'Generate your first patent-style sketch using the controls above.'}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {sketches.filter((s) => s.status !== 'SUGGESTED').map((sketch) => {
                  const sketchImageUrl = sketch.imageFilename
                    ? `/api/projects/${patent.project.id}/patents/${patent.id}/upload?filename=${encodeURIComponent(sketch.imageFilename)}`
                    : sketch.imagePath

                  return (
                  <motion.div
                    key={sketch.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="group"
                  >
                    <Card className={`overflow-hidden transition-shadow hover:shadow-lg ${
                      sketch.status === 'FAILED' ? 'border-red-200' : ''
                    }`}>
                      {/* Image Preview */}
                      <div
                        className="relative aspect-square bg-paper-200 cursor-pointer"
                        onClick={() => sketchImageUrl && setExpandedSketchId(sketch.id)}
                      >
                        {sketch.status === 'PENDING' ? (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <Loader2 className="w-8 h-8 animate-spin text-ai-blue-600" />
                          </div>
                        ) : sketch.status === 'FAILED' ? (
                          <div className="absolute inset-0 flex flex-col items-center justify-center p-4">
                            <AlertCircle className="w-8 h-8 text-red-500 mb-2" />
                            <p className="text-sm text-red-600 text-center">{sketch.errorMessage || 'Generation failed'}</p>
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-2"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleRetrySketch(sketch.id)
                              }}
                            >
                              <RefreshCw className="w-3 h-3 mr-1" />
                              Retry
                            </Button>
                          </div>
                        ) : sketchImageUrl ? (
                          <img
                            src={sketchImageUrl || ''}
                            alt={sketch.title}
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <ImageIcon className="w-8 h-8 text-gray-300" />
                          </div>
                        )}

                        {/* Hover overlay — stays visible on touch screens,
                            where there is no hover to reveal it. */}
                        {sketchImageUrl && sketch.status === 'SUCCESS' && (
                          <div className="reveal-scrim absolute inset-0 bg-black/50 opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-within:opacity-100 transition-opacity flex items-center justify-center gap-2">
                            <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setExpandedSketchId(sketch.id) }}>
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button 
                              size="sm" 
                              variant="secondary"
                              onClick={(e) => {
                                e.stopPropagation()
                                if (sketchImageUrl) {
                                  openImageEditor({
                                  type: 'sketch',
                                  id: sketch.id,
                                  title: sketch.title,
                                  imageFilename: sketch.imageFilename,
                                  originalImageFilename: sketch.originalImageFilename,
                                  fallbackImagePath: sketchImageUrl,
                                  originalImagePath: sketch.originalImagePath,
                                  annotations: sketch.annotations
                                })
                                }
                              }}
                              title="Edit this sketch"
                            >
                              <Paintbrush className="w-4 h-4" />
                            </Button>
                          </div>
                        )}

                        {/* Favorite badge */}
                        {sketch.isFavorite && (
                          <div className="absolute top-2 right-2">
                            <Star className="w-5 h-5 text-yellow-500 fill-yellow-500" />
                          </div>
                        )}

                        {/* Mode badge */}
                        <div className="absolute top-2 left-2">
                          <Badge variant="secondary" className="text-xs">
                            {sketch.mode}
                          </Badge>
                        </div>
                      </div>

                      {/* Card Footer */}
                      <CardContent className="p-3">
                        <h4 className="font-medium text-ai-graphite-900 truncate text-sm">{sketch.title}</h4>
                        {sketch.description && (
                          <p className="text-xs text-ai-graphite-600 mt-1 line-clamp-2" title={sketch.description}>
                            {sketch.description}
                          </p>
                        )}
                        <p className="text-xs text-ai-graphite-400 mt-1">
                          {new Date(sketch.createdAt).toLocaleDateString()}
                        </p>

                        {/* Actions */}
                        <div className="flex items-center gap-2 mt-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-10 w-10 p-0"
                            onClick={() => handleToggleFavorite(sketch.id)}
                            title="Toggle favorite"
                          >
                            {sketch.isFavorite ? (
                              <Star className="w-5 h-5 text-yellow-500 fill-yellow-500" />
                            ) : (
                              <StarOff className="w-5 h-5 text-ai-graphite-400" />
                            )}
                          </Button>
                          {/* Edit Image button */}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-10 w-10 p-0"
                            onClick={() => {
                              if (sketchImageUrl) {
                                openImageEditor({
                                  type: 'sketch',
                                  id: sketch.id,
                                  title: sketch.title,
                                  imageFilename: sketch.imageFilename,
                                  originalImageFilename: sketch.originalImageFilename,
                                  fallbackImagePath: sketchImageUrl,
                                  originalImagePath: sketch.originalImagePath,
                                  annotations: sketch.annotations
                                })
                              }
                            }}
                            disabled={!sketchImageUrl || sketch.status !== 'SUCCESS'}
                            title="Edit image"
                          >
                            <Paintbrush className={`w-5 h-5 ${sketchImageUrl && sketch.status === 'SUCCESS' ? 'text-ai-blue-500' : 'text-gray-300'}`} />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-10 w-10 p-0"
                            onClick={() => {
                              setModifyingSketchId(sketch.id)
                              setModifySketchPrompt('')
                            }}
                            disabled={sketch.status !== 'SUCCESS'}
                            title="Modify with AI"
                          >
                            <Edit2 className="w-5 h-5 text-ai-graphite-400" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-10 w-10 p-0"
                            onClick={() => handleDeleteSketch(sketch.id)}
                            title="Delete sketch"
                          >
                            <Trash2 className="w-5 h-5 text-ai-graphite-400" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Sketch Expanded Modal */}
          <AnimatePresence>
            {expandedSketchId && (() => {
              const sketch = sketches.find(s => s.id === expandedSketchId)
              if (!sketch) return null
              const modalSketchImageUrl = sketch.imageFilename
                ? `/api/projects/${patent.project.id}/patents/${patent.id}/upload?filename=${encodeURIComponent(sketch.imageFilename)}`
                : sketch.imagePath
              if (!modalSketchImageUrl) return null

              return (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
                  onClick={() => setExpandedSketchId(null)}
                >
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    className="bg-white rounded-xl shadow-2xl p-2 max-w-4xl w-full max-h-[90vh] flex flex-col"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between p-4 border-b">
                      <div>
                        <h4 className="text-lg font-semibold text-ai-graphite-900">{sketch.title}</h4>
                        {sketch.description && (
                          <p className="text-sm text-ai-graphite-600 mt-1 max-w-xl">{sketch.description}</p>
                        )}
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => setExpandedSketchId(null)}>
                        <span className="text-2xl">&times;</span>
                      </Button>
                    </div>
                    <div className="flex-1 overflow-auto p-4 bg-paper-200 flex items-center justify-center">
                      <img
                        src={modalSketchImageUrl}
                        alt={sketch.title}
                        className="max-w-full h-auto shadow-lg"
                      />
                    </div>
                    <div className="p-4 border-t flex justify-between items-center">
                      <div className="text-sm text-ai-graphite-500">
                        Mode: {sketch.mode} • Created: {new Date(sketch.createdAt).toLocaleString()}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          title="Edit this sketch (erase, draw, add labels)"
                          onClick={() => {
                            setExpandedSketchId(null)
                            openImageEditor({
                              type: 'sketch',
                              id: sketch.id,
                              title: sketch.title,
                              imageFilename: sketch.imageFilename,
                              originalImageFilename: sketch.originalImageFilename,
                              fallbackImagePath: modalSketchImageUrl,
                              originalImagePath: sketch.originalImagePath,
                              annotations: sketch.annotations
                            })
                          }}
                        >
                          <Paintbrush className="w-4 h-4 mr-2" />
                          Edit image
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setExpandedSketchId(null)
                            setModifyingSketchId(sketch.id)
                          }}
                        >
                          <Edit2 className="w-4 h-4 mr-2" />
                          Modify
                        </Button>
                        <Button variant="outline" onClick={() => setExpandedSketchId(null)}>
                          Close
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                </motion.div>
              )
            })()}
          </AnimatePresence>

          {/* Modify Sketch Modal */}
          <AnimatePresence>
            {modifyingSketchId && (() => {
              const sketch = sketches.find(s => s.id === modifyingSketchId)
              if (!sketch) return null

              const modalSketchImageUrl = sketch.imageFilename
                ? `/api/projects/${patent.project.id}/patents/${patent.id}/upload?filename=${encodeURIComponent(sketch.imageFilename)}`
                : sketch.imagePath

              return (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
                  onClick={() => setModifyingSketchId(null)}
                >
                  <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    className="bg-white rounded-xl shadow-2xl p-6 max-w-lg w-full"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <h4 className="text-lg font-semibold text-ai-graphite-900 mb-4">Modify Sketch</h4>
                    <p className="text-sm text-ai-graphite-500 mb-4">
                      Describe the changes you want to make to "{sketch.title}"
                    </p>
                    
                    {modalSketchImageUrl && (
                      <div className="mb-4 p-2 bg-paper-200 rounded">
                        <img
                          src={modalSketchImageUrl}
                          alt={sketch.title}
                          className="max-h-32 mx-auto"
                        />
                      </div>
                    )}

                    <Textarea
                      placeholder="e.g., Add more detail to the control module, rotate the layout 90 degrees..."
                      value={modifySketchPrompt}
                      onChange={(e) => setModifySketchPrompt(e.target.value)}
                      rows={3}
                      disabled={sketchGenerating}
                    />

                    <div className="flex gap-2 mt-4">
                      <Button
                        variant="outline"
                        onClick={() => setModifyingSketchId(null)}
                        disabled={sketchGenerating}
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={() => handleModifySketch(sketch.id)}
                        disabled={sketchGenerating || !modifySketchPrompt.trim()}
                        className="bg-ai-blue-600 hover:bg-ai-blue-700 text-white"
                      >
                        {sketchGenerating ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Modifying...
                          </>
                        ) : (
                          <>
                            <Wand2 className="w-4 h-4 mr-2" />
                            Create Modified Sketch
                          </>
                        )}
                      </Button>
                    </div>
                  </motion.div>
                </motion.div>
              )
            })()}
          </AnimatePresence>
        </div>
      )}

      {/* ARRANGE TAB CONTENT */}
      {activeTab === 'arrange' && (
        <div className="space-y-6">
          {/* Arrange Error Alert */}
          {arrangeError && (
            <ActionableErrorPanel
              message={arrangeError}
              area="arrange"
              onRetry={loadCombinedFigures}
              retryLabel="Reload figures"
              retrying={arrangeLoading}
              onDismiss={() => setArrangeError(null)}
            />
          )}

          {/* Header with instruction */}
          <div className="border-b border-paper-300 pb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-ai-graphite-900">
                This is the drawing set that will be filed.
              </p>
              <p className="text-sm text-ai-graphite-500 mt-1 max-w-prose">
                {isSequenceFinalized
                  ? 'The order is locked. Unlock it to make changes.'
                  : 'Drag a figure to reorder — figures are renumbered automatically and every change saves on its own.'}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleAIArrange}
              disabled={isSequenceFinalized || aiArranging || arrangedFigures.length < 2}
              className="shrink-0"
            >
              {aiArranging ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 mr-2" />
              )}
              Suggest Order
            </Button>
          </div>

          {/* AI Insight Banner - only show when present */}
          {aiInsight && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-slate-50 border border-slate-200 rounded-lg p-4 flex flex-col gap-3"
            >
                <div className="flex items-start gap-3">
                  <Info className="w-5 h-5 text-slate-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-slate-700">{aiInsight}</p>
                </div>
                {aiReasons && aiReasons.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-500">
                      Follow the numbered order below (top to bottom).
                    </p>
                    <ol className="space-y-2">
                      {aiReasons
                        .slice()
                        .sort((a, b) => (a.finalFigNo || 0) - (b.finalFigNo || 0))
                        .map((r) => (
                          <li key={r.id} className="rounded-md border border-slate-200 bg-white p-3">
                            <div className="flex items-start gap-2">
                              <span className="text-xs font-semibold text-slate-600 px-2 py-1 rounded bg-slate-100">
                                {r.finalFigNo ? `#${r.finalFigNo}` : '?'}
                              </span>
                              <div>
                                <div className="text-sm font-semibold text-slate-800">
                                  {r.title}
                                </div>
                                <div className="text-sm text-slate-700 leading-relaxed mt-0.5">{r.reason}</div>
                              </div>
                            </div>
                          </li>
                        ))}
                    </ol>
                  </div>
                )}
            </motion.div>
          )}

          {arrangeLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-ai-graphite-400" />
            </div>
          ) : arrangedFigures.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center">
                <Layers className="w-12 h-12 mx-auto text-gray-300 mb-4" />
                <h4 className="text-lg font-medium text-ai-graphite-900 mb-2">No figures to arrange</h4>
                <p className="text-ai-graphite-500">
                  Generate diagrams or sketches first, then return here to arrange them.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left: Sortable List */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-ai-graphite-700 uppercase tracking-wide">
                    Figure Order
                  </h3>
                  <span className="text-xs text-ai-graphite-500">
                    {arrangedFigures.length} figure{arrangedFigures.length !== 1 ? 's' : ''}
                  </span>
                </div>

                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={arrangedFigures.map(f => f.id)}
                    strategy={verticalListSortingStrategy}
                    disabled={isSequenceFinalized}
                  >
                    <div className="space-y-2">
                      {arrangedFigures.map((figure) => (
                        <SortableFigureItem
                          key={figure.id}
                          figure={figure}
                          isSelected={selectedArrangeFigure?.id === figure.id}
                          isFinalized={isSequenceFinalized}
                          onSelect={() => setSelectedArrangeFigure(figure)}
                          onAttemptReorder={() => {
                            if (isSequenceFinalized) setShowUnlockPrompt(true)
                          }}
                        />
                      ))}
                    </div>
                  </SortableContext>

                  <DragOverlay>
                    {activeDragId ? (
                      <div className="bg-white border border-paper-400 rounded-lg p-3 shadow-lg opacity-90">
                        {(() => {
                          const figure = arrangedFigures.find(f => f.id === activeDragId)
                          if (!figure) return null
                          return (
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-mono text-ai-graphite-500 w-12">
                                Fig {figure.finalFigNo}
                              </span>
                              <span className="text-sm font-medium text-ai-graphite-900 truncate">
                                {figure.title}
                              </span>
                            </div>
                          )
                        })()}
                      </div>
                    ) : null}
                  </DragOverlay>
                </DndContext>
              </div>

              {/* Right: Preview Panel */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-ai-graphite-700 uppercase tracking-wide">
                    Preview
                  </h3>
                </div>

                {selectedArrangeFigure ? (
                  <Card>
                    <CardContent className="p-4">
                      {/* Figure preview image */}
                      <div className="aspect-video bg-paper-100 border border-paper-300 rounded-lg mb-4 flex items-center justify-center overflow-hidden">
                        {selectedArrangeFigure.imagePath ? (
                          <img
                            src={selectedArrangeFigure.imagePath}
                            alt={selectedArrangeFigure.title}
                            className="max-w-full max-h-full object-contain"
                            onError={(e) => {
                              // Sketches may be stored in /public/uploads/sketches; provide a direct fallback if the API URL fails.
                              if (selectedArrangeFigure?.type === 'sketch' && selectedArrangeFigure?.imageFilename) {
                                const fallback = `/uploads/sketches/${encodeURIComponent(selectedArrangeFigure.imageFilename)}`
                                if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback
                              }
                            }}
                          />
                        ) : (
                          <div className="text-ai-graphite-400 text-sm">No preview available</div>
                        )}
                      </div>

                      {/* Figure details */}
                      <div className="space-y-3">
                        <div>
                          <h4 className="font-medium text-ai-graphite-900">
                            Fig {selectedArrangeFigure.finalFigNo} – {selectedArrangeFigure.title}
                          </h4>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className="text-xs">
                              {selectedArrangeFigure.type === 'diagram' ? 'Block Diagram' : 'AI Sketch'}
                            </Badge>
                          </div>
                        </div>

                        {selectedArrangeFigure.description && (
                          <p className="text-sm text-ai-graphite-600">
                            {selectedArrangeFigure.description}
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <Card className="border-dashed">
                    <CardContent className="py-12 text-center">
                      <p className="text-ai-graphite-500 text-sm">Select a figure to preview</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          {arrangedFigures.length > 0 && (
            <div className="flex items-center justify-between pt-4 border-t border-paper-300">
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResetSequence}
                  disabled={isSequenceFinalized || arrangeLoading}
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Reset
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAIArrange}
                  disabled={isSequenceFinalized || aiArranging || arrangedFigures.length < 2}
                >
                  {aiArranging ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4 mr-2" />
                  )}
                  Suggest Order
                </Button>
              </div>

              <div className="flex items-center gap-3">
                {savingSequence && (
                  <span className="text-xs text-ai-graphite-500 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Saving...
                  </span>
                )}
                
                {isSequenceFinalized ? (
                  <Button
                    variant="outline"
                    onClick={handleUnlockSequence}
                    disabled={savingSequence}
                  >
                    <Unlock className="w-4 h-4 mr-2" />
                    Unlock to Edit
                  </Button>
                ) : (
                  <Button
                    onClick={handleFinalizeSequence}
                    disabled={savingSequence || arrangedFigures.length === 0}
                    className="bg-gray-900 hover:bg-gray-800 text-white"
                  >
                    <Lock className="w-4 h-4 mr-2" />
                    Finalize Sequence
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* Unlock prompt when drag attempted while finalized */}
      {showUnlockPrompt && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-start gap-3">
              <Lock className="w-5 h-5 text-ai-graphite-500 mt-1" />
              <div>
                <h4 className="text-lg font-semibold text-ai-graphite-900">Sequence locked</h4>
                <p className="text-sm text-ai-graphite-600 mt-1">
                  Unlock the figure sequence to rearrange images.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <Button variant="outline" onClick={() => setShowUnlockPrompt(false)}>
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  setShowUnlockPrompt(false)
                  await handleUnlockSequence()
                }}
                disabled={savingSequence}
              >
                <Unlock className="w-4 h-4 mr-2" />
                Unlock to Edit
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* IN-BROWSER IMAGE EDITOR (erase, draw, add text labels) */}
      {imageEditorOpen && editingImage && (
        <ImageEditor
          imageSrc={editingImage.imagePath}
          title={editingImage.title}
          initialShapes={editingImage.shapes}
          referenceComponents={referenceComponents}
          baseImageFilename={editingImage.baseImageFilename}
          onSave={handleImageEditorSave}
          onClose={handleImageEditorClose}
        />
      )}
      
      <div className="hidden">
        {/* Helper for preserving existing logic not explicitly in UI but needed for compilation if any */}
      </div>

      {/* Forward navigation. This stage previously relied solely on the
          screen-edge arrow overlay for advancing; with that removed it needs
          its own control, like every other stage has. */}
      <div className="flex justify-end border-t border-paper-300 pt-5">
        <Button
          size="lg"
          onClick={() => onComplete({ action: 'set_stage', sessionId: session?.id, stage: 'ANNEXURE_DRAFT' })}
          className="w-full sm:w-auto"
        >
          Continue to Drafting
          <ChevronRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </motion.div>
  )
}

// === FIGURE OVERFLOW MENU ===
// A small popover for the per-figure secondary actions. The card used to lay
// Translate/Download/Delete out as equal-weight buttons, which made every
// figure look like a control panel; these are occasional actions, so they live
// one click away and leave the card readable.
interface FigureActionsMenuProps {
  label: string
  items: Array<{
    label: string
    icon?: React.ReactNode
    onSelect: () => void | Promise<void>
    disabled?: boolean
    danger?: boolean
  }>
}

function FigureActionsMenu({ label, items }: FigureActionsMenuProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        className="p-2 rounded-md text-ai-graphite-500 hover:text-ai-graphite-900 hover:bg-paper-100 transition-colors"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        // Anchored with CSS rather than measured coordinates, so it can never
        // drift away from its button on scroll. It opens upward because the
        // trigger sits in the card footer: downward would run off the card
        // (and, on the last row, off the page).
        <div
          role="menu"
          className="absolute right-0 bottom-full mb-1 z-40 w-56 rounded-lg border border-paper-300 bg-white p-1 shadow-lg"
        >
          {items.map(item => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => { setOpen(false); void item.onSelect() }}
              className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-left transition-colors disabled:opacity-40 disabled:cursor-default ${
                item.danger
                  ? 'text-red-600 hover:bg-red-50'
                  : 'text-ai-graphite-800 hover:bg-paper-100'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// === SORTABLE FIGURE ITEM COMPONENT ===
interface SortableFigureItemProps {
  figure: any
  isSelected: boolean
  isFinalized: boolean
  onSelect: () => void
  onAttemptReorder?: () => void
}

function SortableFigureItem({ figure, isSelected, isFinalized, onSelect, onAttemptReorder }: SortableFigureItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ 
    id: figure.id,
    disabled: isFinalized
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  // Allow dragging from the entire card (not just the handle)
  const dragProps = isFinalized ? {} : { ...attributes, ...listeners }

  const handleBlockedDrag = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isFinalized) return
    e.preventDefault()
    onAttemptReorder?.()
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        flex items-center gap-3 p-3 bg-white border rounded-lg transition-colors
        ${isSelected ? 'border-ai-blue-300 bg-ai-blue-50/50' : 'border-paper-300 hover:border-paper-400'}
        ${isDragging ? 'shadow-md' : ''}
        ${isFinalized ? 'cursor-default' : 'cursor-pointer'}
      `}
      onClick={onSelect}
      onMouseDown={handleBlockedDrag}
      onTouchStart={handleBlockedDrag}
      {...dragProps}
    >
      {/* Drag Handle - only attach drag listeners when not finalized */}
      <button
        className={`
          p-1 rounded touch-none
          ${isFinalized ? 'opacity-30 cursor-not-allowed' : 'cursor-grab active:cursor-grabbing hover:bg-paper-200'}
        `}
        disabled={isFinalized}
        aria-label={isFinalized ? 'Sequence is locked' : 'Drag to reorder'}
      >
        <GripVertical className="w-4 h-4 text-ai-graphite-400" />
      </button>

      {/* Figure Number */}
      <span className="text-sm font-mono text-ai-graphite-500 w-12 flex-shrink-0">
        Fig {figure.finalFigNo}
      </span>

      {/* Thumbnail */}
      <div className="w-10 h-10 bg-paper-200 border border-paper-300 rounded flex-shrink-0 overflow-hidden">
        {figure.imagePath ? (
          <img
            src={figure.imagePath}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => {
              if (figure?.type === 'sketch' && figure?.imageFilename) {
                const fallback = `/uploads/sketches/${encodeURIComponent(figure.imageFilename)}`
                if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback
              }
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon className="w-4 h-4 text-gray-300" />
          </div>
        )}
      </div>

      {/* Title and Type */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ai-graphite-900 truncate">{figure.title}</p>
        <p className="text-xs text-ai-graphite-500">
          {figure.type === 'diagram' ? 'Diagram' : 'Sketch'}
        </p>
      </div>

      {/* Type indicator */}
      <div className={`
        w-2 h-2 rounded-full flex-shrink-0
        ${figure.type === 'diagram' ? 'bg-ai-blue-400' : 'bg-amber-400'}
      `} title={figure.type === 'diagram' ? 'Block Diagram' : 'AI Sketch'} />
    </div>
  )
}
