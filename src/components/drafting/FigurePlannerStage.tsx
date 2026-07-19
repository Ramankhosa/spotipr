'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  Bot, 
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
  Plus
} from 'lucide-react'

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
import dynamic from 'next/dynamic'
import {
  buildFigureScopePromptBlock,
  filterComponentsByScopeForFigures
} from '@/lib/scope-recommendations'

// Dynamic import for ImageEditor (opens miniPaint for image editing)
const ImageEditor = dynamic(() => import('@/components/ui/ImageEditor'), {
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

function diagramImageAnalysisLabel(status: DiagramImageAnalysisStatus) {
  switch (status) {
    case 'QUEUED':
      return 'Queued'
    case 'PROCESSING':
      return 'Analyzing'
    case 'COMPLETED':
      return 'Analyzed'
    case 'FAILED':
      return 'Failed'
  }
}

function diagramImageAnalysisBadgeClass(status: DiagramImageAnalysisStatus) {
  switch (status) {
    case 'QUEUED':
      return 'border-slate-200 bg-slate-50 text-slate-600'
    case 'PROCESSING':
      return 'border-ai-blue-200 bg-ai-blue-50 text-ai-blue-700'
    case 'COMPLETED':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700'
    case 'FAILED':
      return 'border-red-200 bg-red-50 text-red-700'
  }
}

// Helper function to normalize page sizes from country profiles
// IMPORTANT: This must be defined before the component to avoid TDZ (Temporal Dead Zone) errors
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

// Plain-language progress messages shown while figures generate.
// They describe the phases of the real pipeline in order, but advance on a
// timer — so the last one is written to stay honest for long-running jobs.
const FIGURE_GENERATION_MESSAGES = [
  "Reading your specification...",
  "Identifying the components to illustrate...",
  "Choosing figure types that fit your invention...",
  "Planning the system overview figure...",
  "Laying out method and flow figures...",
  "Drawing the diagrams...",
  "Adding reference numerals that match your specification...",
  "Checking the figures against your claims...",
  "Still working — large inventions can take 2–3 minutes..."
]

export default function FigurePlannerStage({ session, patent, onComplete, onRefresh }: FigurePlannerStageProps) {
  const { toast } = useToast()
  const [isGenerating, setIsGenerating] = useState(false)
  const [figures, setFigures] = useState<LLMFigure[]>([])
  const [error, setError] = useState<string | null>(null)
  const [generationWarning, setGenerationWarning] = useState<string | null>(null)
  // In AI mode, null/empty means "AI decides the count"
  // User can optionally override by entering a number
  const [diagramCount, setDiagramCount] = useState<number | null>(null)
  
  // Elapsed time while generating; the phase message is derived from it.
  const [generationSeconds, setGenerationSeconds] = useState(0)
  const generationMessageIndex = Math.min(
    Math.floor(generationSeconds / 4),
    FIGURE_GENERATION_MESSAGES.length - 1
  )
  const generationElapsedLabel = `${Math.floor(generationSeconds / 60)}:${String(generationSeconds % 60).padStart(2, '0')}`

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

  const formatDiagramGenerationWarnings = (response: any): string | null => {
    const messages: string[] = []
    if (Array.isArray(response?.warnings)) {
      messages.push(...response.warnings.filter((warning: any) => typeof warning === 'string' && warning.trim()))
    }
    if (Array.isArray(response?.failedFigures) && response.failedFigures.length > 0) {
      messages.push(...response.failedFigures.map((failure: any) => {
        const label = failure?.title || (failure?.index ? `Figure ${failure.index}` : 'A diagram')
        return `${label}: ${failure?.reason || 'repair failed'}`
      }))
    }
    return messages.length > 0 ? messages.join(' ') : null
  }

  const [isUploading, setIsUploading] = useState(false)
  const [isSkippingFigures, setIsSkippingFigures] = useState(false)
  const [isRestoringFigures, setIsRestoringFigures] = useState(false)
  const [uploaded, setUploaded] = useState<Record<string, boolean>>({})
  const [processingStatus, setProcessingStatus] = useState<Record<string, string>>({})
  const [processingStep, setProcessingStep] = useState<Record<string, number>>({})
  const [modifyFigNo, setModifyFigNo] = useState<number | null>(null)
  const [modifyTextSaved, setModifyTextSaved] = useState('')
  const [regeneratingFigure, setRegeneratingFigure] = useState<Record<number, boolean>>({})
  const [isViewing, setIsViewing] = useState<Record<number, boolean>>({})
  const [rendering, setRendering] = useState<Record<string, boolean>>({})
  const [renderPreview, setRenderPreview] = useState<Record<string, string | null>>({})
  const [expandedFigNo, setExpandedFigNo] = useState<number | null>(null)
  const [overrideCount, setOverrideCount] = useState(0)
  const [overrideInputs, setOverrideInputs] = useState<string[]>([])
  const [stateInitialized, setStateInitialized] = useState(false)

  // UI Mode state
  const [mode, setMode] = useState<'ai' | 'manual'>('ai')
  const [includeExistingFigures, setIncludeExistingFigures] = useState(true)
  const [replaceExistingDiagrams, setReplaceExistingDiagrams] = useState(false)

  // Tick elapsed time while figure generation runs
  useEffect(() => {
    if (!isGenerating) {
      setGenerationSeconds(0)
      return
    }

    const interval = setInterval(() => {
      setGenerationSeconds(prev => prev + 1)
    }, 1000)

    return () => clearInterval(interval)
  }, [isGenerating])

  const [manualUploadSlots, setManualUploadSlots] = useState<ManualUploadSlot[]>([])
  const [showManual, setShowManual] = useState(false)
  const [manualDetectingAll, setManualDetectingAll] = useState(false)
  const [manualDetectionProgress, setManualDetectionProgress] = useState<{ current: number; total: number } | null>(null)
  const [retryingImageAnalysis, setRetryingImageAnalysis] = useState<Record<string, boolean>>({})
  const manualUploadSlotsRef = useRef<ManualUploadSlot[]>([])
  const [showPlantUML, setShowPlantUML] = useState<Record<number, boolean>>({})
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

  // === IMAGE EDITOR STATE ===
  const [imageEditorOpen, setImageEditorOpen] = useState(false)
  const [editingImage, setEditingImage] = useState<{
    type: 'diagram' | 'sketch'
    id: string | number  // figureNo for diagrams, id for sketches
    imagePath: string
    title: string
    originalImagePath?: string | null
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
  const AnimatedDots = () => (
    <span className="inline-flex">
      <span className="animate-pulse">.</span>
      <span className="animate-pulse" style={{ animationDelay: '0.2s' }}>.</span>
      <span className="animate-pulse" style={{ animationDelay: '0.4s' }}>.</span>
    </span>
  )

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
  // Track figures that have already had an auto-fix attempt (prevents infinite LLM loops)
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
      // 7. Not already attempted auto-fix (prevents infinite LLM loops after fix failure)
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
  
  // Open miniPaint Image Editor
  const openImageEditor = (
    type: 'diagram' | 'sketch',
    id: string | number,
    imagePath: string,
    title: string,
    originalImagePath?: string | null
  ) => {
    setEditingImage({ type, id, imagePath, title, originalImagePath })
    setImageEditorOpen(true)
  }

  // Handle save from miniPaint Image Editor (receives base64 directly)
  const handleImageEditorSave = async (base64: string, imageObject: any) => {
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
          imageBase64: base64,
          filename: `${editingImage.title.replace(/[^a-zA-Z0-9]/g, '_')}_edited.png`,
          preserveOriginal: true
        })
      })
      
      if (!updateRes.ok) {
        const errData = await updateRes.json()
        throw new Error(errData.error || 'Failed to save edited image')
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
          id: editingImage.id
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

      if (!res.ok) throw new Error('Failed to generate sketch suggestions')

      const data = await res.json()
      if (data.suggestions && Array.isArray(data.suggestions)) {
        setSketchSuggestions(data.suggestions)
        // Close reference selector after generating
        setShowReferenceSelector(false)
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
      
      // Remove the generated suggestion from the list
      setSketchSuggestions(prev => prev.filter((_, i) => i !== index))
      
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

  const handleGenerateFromLLM = async () => {
    try {
      setIsGenerating(true)
      setError(null)
      setGenerationWarning(null)

      // If user chose to decide and provided an override list, generate exactly those figures instead of auto list
      const overrideList = overrideInputs.filter(Boolean)
      if (mode === 'manual' && overrideCount > 0 && overrideList.length > 0) {
        const manualResp = await onComplete({
          action: 'generate_diagrams_llm',
          sessionId: session?.id,
          mode: 'manual',
          figureInstructions: overrideList,
          figureCount: overrideList.length,
          includeExistingFigures,
          replaceExisting: false
        })
        if (!manualResp) throw new Error('LLM did not return valid figure list')
        if (manualResp.error) {
          const baseError = manualResp.details
            ? `${manualResp.error}: ${typeof manualResp.details === 'string' ? manualResp.details : JSON.stringify(manualResp.details)}`
            : manualResp.error
          const repairDetails = formatDiagramGenerationWarnings(manualResp)
          const errorMsg = [baseError, repairDetails].filter(Boolean).join(' ')
          throw new Error(errorMsg)
        }
        setGenerationWarning(formatDiagramGenerationWarnings(manualResp))
        setOverrideCount(0)
        setOverrideInputs([])
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
        const baseError = res.details
          ? `${res.error}: ${typeof res.details === 'string' ? res.details : JSON.stringify(res.details)}`
          : res.error
        const repairDetails = formatDiagramGenerationWarnings(res)
        const errorMsg = [baseError, repairDetails].filter(Boolean).join(' ')
        throw new Error(errorMsg)
      }
      if (!res.success) {
        throw new Error(res.message || 'Figure generation failed')
      }
      setGenerationWarning(formatDiagramGenerationWarnings(res))

      // Log the plan result
      console.log('[FigurePlanner] Generated', res.figures?.length, 'figures from plan')
      if (res.plan) {
        console.log('[FigurePlanner] Plan rationale:', res.plan.rationale)
      }

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
      setError(errorMessage)
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
          sessionId: session?.id
        })
      })

      if (!resp.ok) {
        const info = await resp.json().catch(() => ({}))
        const renderError = info.error || info.details || 'Render failed'
        
        // AUTO-FIX FEATURE: Attempt auto-fix via LLM ONLY ONCE per figure
        // Check both isAutoFixRetry flag AND autoFixAttemptedRef to prevent infinite loops
        // The ref persists across re-renders and is only cleared by manual "Retry Render" click
        if (getDiagramOpEpoch(key) !== runEpoch) {
          queuedForRenderRef.current.delete(key)
          return
        }

        const hasAttemptedAutoFix = autoFixAttemptedRef.current.has(key)
        
        if (!isAutoFixRetry && !hasAttemptedAutoFix) {
          console.log(`[AutoFix] Render failed for figure ${figureNo}, attempting ONE auto-fix via LLM...`)
          // Mark as attempted BEFORE the LLM call to prevent race conditions from useEffect triggers
          autoFixAttemptedRef.current.add(key)
          setProcessingStatus(prev => ({ ...prev, [key]: 'Render failed - attempting auto-fix via AI...' }))
          
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
              // Note: autoFixAttemptedRef already has this key, so even if useEffect triggers,
              // it won't attempt another LLM call
              await runSingleRender(figureNo, fixResp.fixedCode, language, true, runEpoch)
              return // Exit - the retry will handle completion
            } else {
              // LLM fix failed to produce valid code - mark as failed immediately
              console.warn(`[AutoFix] LLM did not return valid fixed code for figure ${figureNo}`)
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

      // Upload in the background so the next render can start quickly
      if (getDiagramOpEpoch(key) !== runEpoch) {
        queuedForRenderRef.current.delete(key)
        return
      }
      queueUpload(key, figureNo, blob, language, runEpoch)

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
      className="p-8 max-w-[1800px] mx-auto space-y-8"
    >
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold text-ai-graphite-900 tracking-tight flex items-center gap-3">
            <div className="p-2 bg-ai-blue-100 rounded-lg">
              <LayoutGrid className="w-6 h-6 text-ai-blue-600" />
            </div>
            Figure Planner
            <Hint
              title="What happens here"
              text="This is where your patent's drawings are created — block diagrams, flowcharts, and sketches. They're generated from your specification and reuse its reference numerals, so figures and text stay consistent."
            />
          </h2>
          <p className="text-ai-graphite-500 mt-2 text-lg">Create the drawings your application will file with.</p>
        </div>

        {!figuresSkipped && (
          <Button
            variant="outline"
            onClick={handleSkipFigures}
            disabled={isSkippingFigures}
            className="border-amber-300 text-amber-800 hover:bg-amber-50"
          >
            {isSkippingFigures ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}
            Continue without figures
          </Button>
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

      {/* Main Tab Bar: Diagrams vs Sketches */}
      <div className="border-b border-paper-300 flex items-center justify-between">
        <nav className="flex space-x-8" aria-label="Figure Planner Tabs">
          <button
            onClick={() => setActiveTab('diagrams')}
            className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors ${
              activeTab === 'diagrams'
                ? 'border-ai-blue-600 text-ai-blue-600'
                : 'border-transparent text-ai-graphite-500 hover:text-ai-graphite-700 hover:border-paper-400'
            }`}
          >
            <Code className="w-4 h-4" />
            Diagrams
            {diagramSources.length > 0 && (
              <Badge variant="secondary" className="ml-1">{diagramSources.length}</Badge>
            )}
          </button>
          <button
            onClick={() => setActiveTab('sketches')}
            className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors ${
              activeTab === 'sketches'
                ? 'border-ai-blue-600 text-ai-blue-600'
                : 'border-transparent text-ai-graphite-500 hover:text-ai-graphite-700 hover:border-paper-400'
            }`}
          >
            <Pencil className="w-4 h-4" />
            Sketches
            {sketches.filter(s => s.status === 'SUCCESS').length > 0 && (
              <Badge variant="secondary" className="ml-1">{sketches.filter(s => s.status === 'SUCCESS').length}</Badge>
            )}
          </button>
          <button
            onClick={() => setActiveTab('arrange')}
            className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors ${
              activeTab === 'arrange'
                ? 'border-ai-blue-600 text-ai-blue-600'
                : 'border-transparent text-ai-graphite-500 hover:text-ai-graphite-700 hover:border-paper-400'
            }`}
          >
            <Layers className="w-4 h-4" />
            Arrange
            {isSequenceFinalized && (
              <Lock className="w-3 h-3 text-green-600" />
            )}
          </button>
        </nav>
        <Hint
          title="Diagrams, Sketches, Arrange"
          text="Diagrams are structured drawings (block diagrams, flowcharts) generated from your specification. Sketches are AI line-art illustrations. Arrange sets the final figure order for filing."
          className="pr-1"
        />
      </div>

      {/* Errors are shown here so they're visible from any tab */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
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
          {/* Diagrams Mode Selector */}
          <div className="flex items-center gap-2 bg-paper-200 p-1 rounded-lg w-fit">
            <button
              onClick={() => setMode('ai')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
                mode === 'ai' 
                  ? 'bg-white text-ai-blue-600 shadow-sm' 
                  : 'text-ai-graphite-600 hover:text-ai-graphite-900'
              }`}
            >
              <Bot className="w-4 h-4" />
              Automatic (AI)
            </button>
            <button
              onClick={() => setMode('manual')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
                mode === 'manual' 
                  ? 'bg-white text-ai-blue-600 shadow-sm' 
                  : 'text-ai-graphite-600 hover:text-ai-graphite-900'
              }`}
            >
              <User className="w-4 h-4" />
              Manual
            </button>
            <Hint
              title="Automatic vs. Manual"
              text="Automatic: the AI plans the whole figure set from your specification and draws it. Manual: you describe each figure yourself and the AI draws exactly those."
              className="ml-1"
            />
          </div>

      {/* Mode Selection Cards - Only show if no figures yet */}
      {figures.length === 0 && diagramSources.length === 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <button
            className="text-left"
            onClick={() => setMode('ai')}
          >
            <Card
              className={`cursor-pointer transition-all hover:shadow-md ${mode === 'ai' ? 'ring-2 ring-ai-blue-600 border-ai-blue-100 bg-ai-blue-50/30' : ''}`}
            >
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-ai-blue-600" />
                AI-Driven Generation
              </CardTitle>
              <CardDescription>
                Our two-stage AI first plans the optimal figure set, then generates high-quality patent diagrams tailored to your invention.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-ai-graphite-600">
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> AI determines optimal figure count (or override)</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> Claim-aware diagram planning</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> Distinct perspectives per figure</li>
              </ul>
            </CardContent>
          </Card>
          </button>

          <button
            className="text-left"
            onClick={() => setMode('manual')}
          >
            <Card
              className={`cursor-pointer transition-all hover:shadow-md ${mode === 'manual' ? 'ring-2 ring-ai-blue-600 border-ai-blue-100 bg-ai-blue-50/30' : ''}`}
            >
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="w-5 h-5 text-ai-blue-600" />
                Manual Specification
              </CardTitle>
              <CardDescription>
                You know your invention best. Define exactly how many figures you need and what each one should depict.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-ai-graphite-600">
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> Custom figure counts</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> Specific descriptions for each view</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> Full control over the output</li>
              </ul>
            </CardContent>
          </Card>
          </button>
          </div>
      )}

      {/* Actions Area */}
      <AnimatePresence mode="wait">
        {mode === 'ai' ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-4"
          >
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Label htmlFor="diagram-count" className="text-sm font-medium text-ai-graphite-700">
                  Number of Figures:
                </Label>
                <div className="relative">
                  <Input
                    id="diagram-count"
                    type="number"
                    min={1}
                    max={10}
                    value={diagramCount === null ? '' : diagramCount}
                    onChange={(e) => {
                      const val = e.target.value.trim()
                      if (val === '') {
                        setDiagramCount(null) // Empty = AI decides
                      } else {
                        const num = parseInt(val, 10)
                        if (!isNaN(num)) {
                          setDiagramCount(Math.max(1, Math.min(10, num)))
                        }
                      }
                    }}
                    placeholder="Auto"
                    className="w-24 text-center"
                    disabled={isGenerating}
                  />
                </div>
                <span className="text-xs text-ai-graphite-500">
                  {diagramCount === null ? '(AI will decide)' : '(1-10)'}
                </span>
                <Hint
                  title="How many figures?"
                  text="Leave on Auto and the AI picks the count that covers your claims — usually 3 to 7. Or set an exact number between 1 and 10."
                />
              </div>
            </div>
            {hasExistingFigures && (
              <div className="flex items-start gap-2">
                <Checkbox
                  id="replace-existing-diagrams"
                  checked={replaceExistingDiagrams}
                  onCheckedChange={(checked) => setReplaceExistingDiagrams(checked === true)}
                  disabled={isGenerating}
                />
                <div className="space-y-1">
                  <Label htmlFor="replace-existing-diagrams" className="text-sm text-ai-graphite-700">
                    Replace existing diagrams
                  </Label>
                  <p className="text-xs text-ai-graphite-500">
                    If unchecked, new diagrams will be appended after existing figures.
                  </p>
                </div>
              </div>
            )}
            <div className="flex items-center gap-3">
              <Button 
                size="lg"
                onClick={handleGenerateFromLLM}
                disabled={isGenerating}
                className="w-full md:w-auto bg-ai-blue-600 hover:bg-ai-blue-700 text-white gap-2 h-12 px-8 text-lg shadow-lg shadow-ai-blue-200"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Generating figures — {generationElapsedLabel}
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    {diagramCount === null ? 'Generate figures' : `Generate ${diagramCount} figure${diagramCount > 1 ? 's' : ''}`}
                  </>
                )}
              </Button>
            </div>
            {isGenerating && (
              <div className="bg-gradient-to-r from-ai-blue-50 to-ai-blue-50 rounded-xl p-5 border border-ai-blue-100 shadow-sm">
                {/* Progress steps indicator */}
                <div className="flex items-center gap-1.5 mb-4">
                  {FIGURE_GENERATION_MESSAGES.map((_, idx) => (
                    <div 
                      key={idx}
                      className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${
                        idx < generationMessageIndex 
                          ? 'bg-ai-blue-500' 
                          : idx === generationMessageIndex 
                            ? 'bg-ai-blue-400 animate-pulse' 
                            : 'bg-paper-300'
                      }`}
                    />
                  ))}
                </div>
                
                {/* Current status message */}
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-ai-blue-100 flex items-center justify-center flex-shrink-0">
                    <Sparkles className="w-5 h-5 text-ai-blue-600 animate-pulse" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ai-blue-900 mb-1">
                      Working for {generationElapsedLabel}
                    </p>
                    <p className="text-sm text-ai-blue-700 leading-relaxed">
                      {FIGURE_GENERATION_MESSAGES[generationMessageIndex]}
                    </p>
                    {diagramCount && (
                      <p className="text-xs text-ai-blue-500 mt-2">
                        Generating {diagramCount} figure{diagramCount > 1 ? 's' : ''} as requested
                      </p>
                    )}
                  </div>
                </div>

                {/* Helpful tip */}
                <div className="mt-4 pt-3 border-t border-ai-blue-100">
                  <p className="text-xs text-ai-graphite-500 flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5" />
                    Figures reuse the reference numerals from your specification, so drawings and text stay consistent.
                  </p>
                </div>
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-4 bg-paper-100 p-6 rounded-xl border border-paper-300"
          >
            <div className="flex items-center gap-4 mb-4">
              <Label className="whitespace-nowrap">Number of Figures:</Label>
              <Input
                type="number"
                min={1}
                max={20}
                className="w-24 bg-white"
                value={overrideCount}
                onChange={(e) => {
                  const n = Math.max(0, parseInt(e.target.value || '0', 10))
                  setOverrideCount(n)
                  setOverrideInputs(Array.from({ length: n }, (_, i) => overrideInputs[i] || ''))
                }}
              />
            </div>

            <div className="flex items-center space-x-2 mb-4">
              <Checkbox
                id="include-existing"
                checked={includeExistingFigures}
                onCheckedChange={setIncludeExistingFigures}
              />
              <Label htmlFor="include-existing" className="text-sm text-ai-graphite-700">
                Tell AI about existing figures to avoid duplicates
              </Label>
            </div>
            
            <div className="space-y-4">
          {Array.from({ length: overrideCount }).map((_, i) => (
                <motion.div 
                  key={i}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="bg-white p-4 rounded-lg border shadow-sm"
                >
                  <Label className="mb-2 block text-xs uppercase text-ai-graphite-500 font-semibold">Figure {i + 1} Description</Label>
                  <Textarea 
                    placeholder="Describe what this figure should show..."
                    className="resize-none"
                    value={overrideInputs[i] || ''}
                    onChange={(e) => {
                const arr = [...overrideInputs]
                arr[i] = e.target.value
                setOverrideInputs(arr)
                    }}
                  />
                </motion.div>
          ))}
        </div>
            
            {overrideCount > 0 && (
              <Button 
                onClick={handleGenerateFromLLM}
                disabled={isGenerating}
                className="w-full md:w-auto bg-ai-blue-600 hover:bg-ai-blue-700"
              >
                {isGenerating ? <>Generating<AnimatedDots /></> : `Generate ${overrideCount} Custom Figures`}
              </Button>
            )}
          </motion.div>
        )}
      </AnimatePresence>


      {/* Saved Diagrams Grid */}
      <div className="mt-12">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-ai-graphite-900 flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-ai-graphite-600" />
            Project Diagrams
          </h3>
          <div className="flex items-center gap-2">
            {/* Translate All Diagrams Button */}
            {diagramSources.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setTranslateFigureNo(null) // null = translate all
                  setShowTranslateModal(true)
                }}
                className="text-ai-blue-600 border-ai-blue-200 hover:bg-ai-blue-50 hover:border-ai-blue-300"
              >
                <Languages className="w-4 h-4 mr-2" />
                Translate All
              </Button>
            )}
            {diagramSources.length > 0 && (
              <Hint
                title="Translating diagrams"
                text="Translation converts the text labels inside each diagram. Reference numerals stay exactly the same, so translated figures still match your specification."
              />
            )}
            <motion.div
              animate={showManual ? { scale: [1, 1.05, 1] } : {}}
              transition={{ duration: 0.5, repeat: showManual ? Infinity : 0, repeatDelay: 2 }}
            >
              <Button
                variant="outline"
                size="sm"
                onClick={handleUploadToggle}
                className={showManual ? 'border-ai-blue-400 text-ai-blue-700' : ''}
              >
                {showManual ? 'Hide External Uploads' : 'Upload External Images'}
              </Button>
            </motion.div>
          </div>
        </div>

        
{diagramSources.length === 0 ? (
          <div className="text-center py-12 bg-paper-100 rounded-xl border border-dashed border-paper-300">
            <ImageIcon className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-ai-graphite-500">No diagrams created yet.</p>
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
              <Card key={`figure_${figNo}`} className="overflow-hidden hover:shadow-lg transition-all duration-300">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant={uploaded[diagramKey] || selectedSource.imageUploadedAt ? 'default' : 'secondary'} className="shrink-0">
                        Fig. {figNo}
                      </Badge>
                      {/* Show translation count if available */}
                      {diagramTranslations[figNo]?.length > 1 && (
                        <Badge variant="outline" className="text-xs text-green-600 bg-green-50 border-green-200">
                          {diagramTranslations[figNo].length - 1} translation{diagramTranslations[figNo].length > 2 ? 's' : ''}
                        </Badge>
                      )}
                      {imageAnalysisStatus && (
                        <Badge variant="outline" className={`text-xs ${diagramImageAnalysisBadgeClass(imageAnalysisStatus)}`}>
                          {(imageAnalysisStatus === 'QUEUED' || imageAnalysisStatus === 'PROCESSING') && (
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          )}
                          {diagramImageAnalysisLabel(imageAnalysisStatus)}
                        </Badge>
                      )}
                    </div>
                    <Badge variant="outline" className="text-xs text-ai-graphite-500">
                      {selectedSource.imageUploadedAt ? 'Rendered' : selectedSource.plantumlCode ? 'Code Ready' : 'Pending'}
                    </Badge>
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
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <Button variant="secondary" size="sm" onClick={() => setExpandedFigNo(figNo)}>
                          <Eye className="w-4 h-4 mr-2" /> Expand
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
                              // Clear auto-fix attempted flag so user can try auto-fix again on manual retry
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
                          // Clear auto-fix attempted flag so user-initiated render can try auto-fix
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

                {imageAnalysisStatus && (
                  <div className={`px-4 py-2 border-t text-xs ${diagramImageAnalysisBadgeClass(imageAnalysisStatus)}`}>
                    <div className="flex items-center justify-between gap-3">
                      <span>
                        {imageAnalysisStatus === 'QUEUED' && 'AI will describe this image shortly (queued).'}
                        {imageAnalysisStatus === 'PROCESSING' && 'AI is reading this image in the background — you can keep working.'}
                        {imageAnalysisStatus === 'COMPLETED' && 'AI has described this image. You can edit the title or description.'}
                        {imageAnalysisStatus === 'FAILED' && (selectedSource.imageAnalysisError || 'AI could not read this image.')}
                      </span>
                      {imageAnalysisStatus === 'FAILED' && (
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
                      )}
                    </div>
                  </div>
                )}

                <div className="p-3 bg-white border-t grid grid-cols-4 gap-2">
                  <Button variant="ghost" size="sm" className="w-full" onClick={() => { setModifyFigNo(figNo); setModifyTextSaved('') }}>
                    <Edit2 className="w-4 h-4 mr-2" /> Modify
                  </Button>
                  {/* Translate single diagram button */}
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="w-full text-ai-blue-600 hover:text-ai-blue-700 hover:bg-ai-blue-50"
                    onClick={() => {
                      setTranslateFigureNo(figNo)
                      setShowTranslateModal(true)
                    }}
                    title="Translate diagram labels to another language"
                  >
                    <Languages className="w-4 h-4 mr-2" /> Translate
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-slate-600 hover:text-slate-800 hover:bg-slate-50"
                    // @ts-ignore
                    onClick={() => handleDownloadFigureImage(displayUrl, figNo, selectedLang as any)}
                    disabled={!displayUrl}
                    title="Download rendered figure image"
                  >
                    <Download className="w-4 h-4 mr-2" /> Download
                  </Button>
                  <Button variant="ghost" size="sm" className="w-full text-red-600 hover:text-red-700 hover:bg-red-50" 
                    onClick={async () => {
                      const langLabel = LANGUAGE_LABELS[selectedLang]?.split(' ')[0] || selectedLang.toUpperCase()
                      if(!confirm(`Delete Figure ${figNo} (${langLabel})?`)) return
                      try {
                        invalidateDiagramOps(figNo, selectedLang)
                        await onComplete({ action: 'delete_figure', sessionId: session?.id, figureNo: figNo, language: selectedLang })
                        await onRefresh()
                        // Clear selected arrange figure if it was the deleted one
                        if (selectedArrangeFigure?.id === `diagram-${figNo}`) {
                          setSelectedArrangeFigure(null)
                        }
                        // Refresh arrange tab data if it was previously loaded
                        if (arrangedFigures.length > 0) {
                          await loadCombinedFigures()
                        }
                      } catch (e) { setError('Failed to delete') }
                    }}>
                    <Trash2 className="w-4 h-4 mr-2" /> Delete
                  </Button>
                  
                  {selectedSource.plantumlCode && (
                    <div className="col-span-4">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="w-full text-xs text-ai-graphite-500"
                          onClick={() => setShowPlantUML(prev => ({ ...prev, [figNo]: !prev[figNo] }))}
                        >
                          {showPlantUML[figNo] ? 'Hide diagram source' : 'View diagram source'}
                        </Button>
                        {showPlantUML[figNo] && (
                           <div className="mt-2 relative">
                             <Textarea 
                        readOnly
                        value={selectedSource.plantumlCode}
                               className="font-mono text-xs h-32 bg-paper-100"
                      />
                             <Button 
                               size="sm" 
                               variant="secondary"
                               className="absolute top-2 right-2 h-6 text-xs"
                        onClick={() => navigator.clipboard.writeText(selectedSource.plantumlCode)}
                      >
                        Copy
                             </Button>
                    </div>
                        )}
                  </div>
                )}

                  {/* Modification Panel */}
                {modifyFigNo === figNo && (
                    <div className="col-span-4 mt-2 pt-2 border-t">
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
                             const resp = await onComplete({ action: 'regenerate_diagram_llm', sessionId: session?.id, figureNo: figNo, instructions: modifyTextSaved })
                              if (resp?.diagramSource?.plantumlCode) {
                                setGenerationWarning(formatDiagramGenerationWarnings(resp))
                                await onRefresh()
                                setModifyFigNo(null)
                                setModifyTextSaved('')
                                // AUTO-RENDER: Automatically render the new code after successful regeneration
                                const newCode = resp.diagramSource.plantumlCode
                                const lang = resp.diagramSource.language || 'en'
                                const diagramKey = getDiagramKey(figNo, lang)
                                console.log(`[AutoRender] Auto-rendering regenerated diagram for figure ${figNo}`)
                                // Clear auto-fix flag since this is fresh regenerated code - allow one auto-fix attempt
                                autoFixAttemptedRef.current.delete(diagramKey)
                                queuedForRenderRef.current.delete(diagramKey)
                                const opEpoch = getDiagramOpEpoch(diagramKey)
                                autoProcessDiagram(figNo, newCode, lang, opEpoch)
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
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{sketchError}</AlertDescription>
            </Alert>
          )}

          {/* Sketch Generation Controls */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wand2 className="w-5 h-5 text-ai-blue-600" />
                Generate Patent Sketch
              </CardTitle>
              <CardDescription>
                Create patent-style black-and-white line art sketches from your invention context.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Generate Suggestions Section */}
              <div className="space-y-3">
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
                      Generate Suggestions
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
                    {sketchSuggestions.length > 0 && (
                      <Badge variant="secondary" className="ml-2">
                        {sketchSuggestions.length} suggestions
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

              {/* Mode Selector */}
              <div className="flex items-center gap-2 bg-paper-200 p-1 rounded-lg w-fit">
                <button
                  onClick={() => setSketchMode('auto')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
                    sketchMode === 'auto'
                      ? 'bg-white text-ai-blue-600 shadow-sm'
                      : 'text-ai-graphite-600 hover:text-ai-graphite-900'
                  }`}
                >
                  <Sparkles className="w-4 h-4" />
                  Auto Generate
                </button>
                <button
                  onClick={() => setSketchMode('guided')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
                    sketchMode === 'guided'
                      ? 'bg-white text-ai-blue-600 shadow-sm'
                      : 'text-ai-graphite-600 hover:text-ai-graphite-900'
                  }`}
                >
                  <Edit2 className="w-4 h-4" />
                  With Instructions
                </button>
                <button
                  onClick={() => setSketchMode('refine')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
                    sketchMode === 'refine'
                      ? 'bg-white text-ai-blue-600 shadow-sm'
                      : 'text-ai-graphite-600 hover:text-ai-graphite-900'
                  }`}
                >
                  <Upload className="w-4 h-4" />
                  Refine Upload
                </button>
              </div>

              {/* Suggestions Error */}
              {suggestionsError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{suggestionsError}</AlertDescription>
                </Alert>
              )}

              {/* Sketch Suggestions - with Generate Image buttons */}
              {sketchSuggestions.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Lightbulb className="w-4 h-4 text-amber-600" />
                      <Label className="text-sm font-medium text-ai-graphite-700">Sketch Suggestions</Label>
                      <Badge variant="secondary" className="text-xs">{sketchSuggestions.length}</Badge>
                    </div>
                    <button
                      onClick={() => setSketchSuggestions([])}
                      className="text-xs text-ai-graphite-500 hover:text-ai-graphite-700"
                    >
                      Clear all
                    </button>
                  </div>
                  <p className="text-xs text-ai-graphite-500">
                    Click &quot;Generate Image&quot; to create an actual sketch from each suggestion.
                  </p>
                  <div className="grid gap-3">
                    {sketchSuggestions.map((suggestion, index) => (
                      <Card key={index} className="border-amber-200 bg-amber-50/50 overflow-hidden">
                        <CardContent className="p-4">
                          <div className="flex items-start gap-3">
                            <div className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                              <span className="text-xs font-semibold text-amber-700">{index + 1}</span>
                            </div>
                            <div className="flex-1">
                              <h4 className="font-medium text-ai-graphite-900 mb-1">{suggestion.title}</h4>
                              <p className="text-sm text-ai-graphite-600 leading-relaxed mb-3">{suggestion.description}</p>
                              <div className="flex items-center gap-2">
                                <Button
                                  size="sm"
                                  className="bg-amber-600 hover:bg-amber-700 text-white gap-1"
                                  onClick={() => handleGenerateFromManualSuggestion(suggestion, index)}
                                  disabled={generatingManualSuggestionIdx !== null || sketchGenerating}
                                >
                                  {generatingManualSuggestionIdx === index ? (
                                    <>
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                      Generating...
                                    </>
                                  ) : (
                                    <>
                                      <Wand2 className="w-3 h-3" />
                                      Generate Image
                                    </>
                                  )}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-ai-graphite-500 hover:text-ai-graphite-700"
                                  onClick={() => {
                                    // Pre-fill the form with suggestion data for customization
                                    setSketchTitle(suggestion.title)
                                    setSketchPrompt(suggestion.description)
                                    setSketchMode('guided')
                                    // Remove from suggestions
                                    setSketchSuggestions(prev => prev.filter((_, i) => i !== index))
                                  }}
                                  disabled={generatingManualSuggestionIdx !== null}
                                >
                                  <Edit2 className="w-3 h-3 mr-1" />
                                  Customize
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-ai-graphite-400 hover:text-red-500"
                                  onClick={() => setSketchSuggestions(prev => prev.filter((_, i) => i !== index))}
                                  disabled={generatingManualSuggestionIdx !== null}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}

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

          {/* Sketch Suggestions Section - shown first if there are suggestions from diagram generation */}
          {(() => {
            const suggestions = sketches.filter(s => s.status === 'SUGGESTED')
            if (suggestions.length === 0) return null
            
            return (
              <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-ai-graphite-900 flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-amber-500" />
                    AI-Suggested Sketches
                    <Badge variant="secondary" className="ml-2">{suggestions.length}</Badge>
                  </h3>
                </div>
                <p className="text-sm text-ai-graphite-600 mb-4">
                  These sketch ideas were generated alongside your diagrams. Click &quot;Generate Image&quot; to create the actual sketch.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {suggestions.map((suggestion) => (
                    <motion.div
                      key={suggestion.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="group"
                    >
                      <Card className="overflow-hidden transition-shadow hover:shadow-lg border-amber-200 bg-amber-50/50">
                        <div className="relative aspect-[4/3] bg-gradient-to-br from-amber-100 to-amber-50 flex items-center justify-center p-4">
                          {generatingSuggestionId === suggestion.id ? (
                            <div className="flex flex-col items-center">
                              <Loader2 className="w-10 h-10 animate-spin text-amber-600 mb-2" />
                              <p className="text-sm text-amber-700">Generating sketch...</p>
                            </div>
                          ) : (
                            <div className="text-center">
                              <Wand2 className="w-12 h-12 mx-auto text-amber-400 mb-3" />
                              <p className="text-xs text-amber-600 uppercase tracking-wide font-medium">Suggested Sketch</p>
                            </div>
                          )}
                        </div>
                        <CardContent className="p-4">
                          <h4 className="font-semibold text-ai-graphite-900 text-sm mb-2">{suggestion.title}</h4>
                          {suggestion.description && (
                            <p className="text-xs text-ai-graphite-600 mb-3 line-clamp-3">
                              {suggestion.description}
                            </p>
                          )}
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              className="flex-1 bg-amber-600 hover:bg-amber-700 text-white"
                              onClick={() => handleGenerateFromSuggestion(suggestion.id)}
                              disabled={generatingSuggestionId !== null}
                            >
                              {generatingSuggestionId === suggestion.id ? (
                                <>
                                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                  Generating...
                                </>
                              ) : (
                                <>
                                  <Wand2 className="w-3 h-3 mr-1" />
                                  Generate Image
                                </>
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0"
                              onClick={() => handleDeleteSketch(suggestion.id)}
                              disabled={generatingSuggestionId !== null}
                            >
                              <Trash2 className="w-4 h-4 text-ai-graphite-400" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
                </div>
              </div>
            )
          })()}

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

                        {/* Hover overlay */}
                        {sketchImageUrl && sketch.status === 'SUCCESS' && (
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                            <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setExpandedSketchId(sketch.id) }}>
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button 
                              size="sm" 
                              variant="secondary"
                              onClick={(e) => {
                                e.stopPropagation()
                                if (sketchImageUrl) {
                                  openImageEditor('sketch', sketch.id, sketchImageUrl, sketch.title, sketch.originalImagePath)
                                }
                              }}
                              title="Edit this sketch in miniPaint"
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
                                openImageEditor('sketch', sketch.id, sketchImageUrl, sketch.title, sketch.originalImagePath)
                              }
                            }}
                            disabled={!sketchImageUrl || sketch.status !== 'SUCCESS'}
                            title="Edit image in miniPaint"
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
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{arrangeError}</AlertDescription>
            </Alert>
          )}

          {/* Header with instruction */}
          <div className="border-b border-paper-300 pb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-ai-graphite-600">
                Combine and order your figures for the final specification.
              </p>
              <p className="text-sm text-ai-graphite-500 mt-1">
                {isSequenceFinalized 
                  ? 'Sequence is finalized. Unlock to make changes.'
                  : 'Drag to reorder. Changes are saved automatically.'}
              </p>
              <p className="text-xs text-ai-graphite-500 mt-1">
                Tip: Click, hold, and drag anywhere on a figure card to reorder.
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

      {/* MINIPAINT IMAGE EDITOR - Opens miniPaint with image preloaded */}
      {imageEditorOpen && editingImage && (
        <ImageEditor
          imageSrc={editingImage.imagePath}
          title={editingImage.title}
          onSave={handleImageEditorSave}
          onClose={handleImageEditorClose}
        />
      )}
      
      <div className="hidden">
        {/* Helper for preserving existing logic not explicitly in UI but needed for compilation if any */}
      </div>
    </motion.div>
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
