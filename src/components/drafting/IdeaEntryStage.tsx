'use client'

import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  Sparkles, 
  ChevronDown, 
  ChevronRight,
  Edit2, 
  Check, 
  RefreshCw, 
  AlertCircle,
  FileText,
  Globe,
  Lightbulb,
  Scale,
  Layers,
  Plus,
  Trash2,
  Hash,
  Target,
  Cpu,
  Box,
  Puzzle,
  Radio,
  Gauge,
  Cog,
  HardDrive,
  Monitor,
  Wifi,
  Zap,
  CircleDot,
  ArrowRight,
  ArrowLeft,
  Link2,
  Image,
  FileSearch
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import KishoNormalizationLoader from '@/components/ui/kisho-normalization-loader'
import Stage0PatentIntelligenceOverlay, {
  type Stage0PatentIntelligenceStatus
} from '@/components/ui/stage0-patent-intelligence-overlay'
import {
  coerceScopeRecommendations,
  getEffectiveScopeUse,
  type ScopeRecommendationElement,
  type ScopeRecommendations,
  type ScopeUseSelection
} from '@/lib/scope-recommendations'
import SupportDataSourcesEditor from '@/components/drafting/SupportDataSourcesEditor'
import {
  coerceSupportDataSources,
  type SupportDataSource
} from '@/lib/support-data-sources'
import { isLegacyExtractionFailure } from '@/lib/normalized-data'

// Tooltip wrapper component for hover explanations
const Tooltip = ({ children, content, position = 'bottom' }: { children: React.ReactNode; content: string; position?: 'top' | 'bottom' | 'left' | 'right' }) => (
  <div className="relative group">
    {children}
    <div className={`absolute z-50 hidden group-hover:block px-3 py-2 text-xs text-white bg-gray-900 rounded-lg shadow-lg whitespace-normal max-w-xs pointer-events-none
      ${position === 'bottom' ? 'top-full mt-2 left-1/2 -translate-x-1/2' : ''}
      ${position === 'top' ? 'bottom-full mb-2 left-1/2 -translate-x-1/2' : ''}
      ${position === 'left' ? 'right-full mr-2 top-1/2 -translate-y-1/2' : ''}
      ${position === 'right' ? 'left-full ml-2 top-1/2 -translate-y-1/2' : ''}
    `}>
      {content}
    </div>
  </div>
)

interface IdeaEntryStageProps {
  session: any
  patent: any
  onComplete: (data: any) => Promise<any>
  onRefresh: () => Promise<void>
}

export default function IdeaEntryStage({ session, patent, onComplete, onRefresh }: IdeaEntryStageProps) {
  const [normalizedData, setNormalizedData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [showNormalized, setShowNormalized] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)
  const [showInventionDetails, setShowInventionDetails] = useState(true)
  const [isNavigating, setIsNavigating] = useState(false)
  const [stage0OverlayStatus, setStage0OverlayStatus] = useState<Stage0PatentIntelligenceStatus | null>(null)
  const [stage0StartedAt, setStage0StartedAt] = useState<number | null>(null)
  const [stage0OverlayError, setStage0OverlayError] = useState<string | undefined>(undefined)
  const [activeTab, setActiveTab] = useState<'core' | 'components' | 'supportData' | 'scope' | 'classification'>('core')
  const [expandedComponents, setExpandedComponents] = useState<Set<number>>(new Set())

  // Editable fields
  const [problem, setProblem] = useState('')
  const [objectives, setObjectives] = useState('')
  const [logic, setLogic] = useState('')
  const [bestMethod, setBestMethod] = useState('')
  const [components, setComponents] = useState<any[]>([])
  const [scopeRecommendations, setScopeRecommendations] = useState<ScopeRecommendations | null>(null)
  const [supportDataSources, setSupportDataSources] = useState<SupportDataSource[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [abstractText, setAbstractText] = useState('')
  const [cpcCodes, setCpcCodes] = useState<string[]>([])
  const [ipcCodes, setIpcCodes] = useState<string[]>([])
  // Use data from existing idea record
  const rawIdea = session?.ideaRecord?.rawInput || ''
  const title = session?.ideaRecord?.title || ''
  
  // Jurisdiction info
  const activeJurisdiction = (session?.activeJurisdiction || session?.draftingJurisdictions?.[0] || 'US').toUpperCase()
  const allJurisdictions = session?.draftingJurisdictions || [activeJurisdiction]
  const normalizedRecord = (session?.ideaRecord?.normalizedData as any) || {}
  const sourceHandlingMode = normalizedRecord.sourceHandlingMode
  const allowRefine = sourceHandlingMode === 'PRESERVE' ? false : true
  const extractionFailed = normalizedRecord.extractionFailed === true || isLegacyExtractionFailure(normalizedRecord)

  // Load normalized data and claims on component mount
  useEffect(() => {
    if (session?.ideaRecord?.normalizedData) {
      setNormalizedData({
        normalizedData: session.ideaRecord.normalizedData,
        extractedFields: {
          problem: session.ideaRecord.problem,
          objectives: session.ideaRecord.objectives,
          components: session.ideaRecord.components,
          logic: session.ideaRecord.logic,
          inputs: session.ideaRecord.inputs,
          outputs: session.ideaRecord.outputs,
          variants: session.ideaRecord.variants,
          bestMethod: session.ideaRecord.bestMethod,
          abstract: session.ideaRecord.abstract,
          cpcCodes: session.ideaRecord.cpcCodes,
          ipcCodes: session.ideaRecord.ipcCodes,
          sourceFactLedger: session.ideaRecord.normalizedData?.sourceFactLedger,
          supportDataSources: session.ideaRecord.normalizedData?.supportDataSources,
          scopeRecommendations: session.ideaRecord.normalizedData?.scopeRecommendations,
          normalizationReviewWarnings: session.ideaRecord.normalizedData?.normalizationReviewWarnings,
          sourceHandlingMode: session.ideaRecord.normalizedData?.sourceHandlingMode
        }
      })
      setShowNormalized(true)

      // Initialize editable state
      setProblem(session.ideaRecord.problem || '')
      setObjectives(session.ideaRecord.objectives || '')
      setLogic(session.ideaRecord.logic || '')
      setBestMethod(session.ideaRecord.bestMethod || '')
      setComponents(Array.isArray(session.ideaRecord.components) ? session.ideaRecord.components : [])
      setScopeRecommendations(coerceScopeRecommendations(session.ideaRecord.normalizedData?.scopeRecommendations, session.ideaRecord.normalizedData) || null)
      setSupportDataSources(coerceSupportDataSources(session.ideaRecord.normalizedData?.supportDataSources))
      setSearchQuery((session as any)?.ideaRecord?.searchQuery || '')
      setAbstractText(session.ideaRecord.abstract || '')
      setCpcCodes(Array.isArray(session.ideaRecord.cpcCodes) ? session.ideaRecord.cpcCodes : [])
      setIpcCodes(Array.isArray(session.ideaRecord.ipcCodes) ? session.ideaRecord.ipcCodes : [])
    }

  }, [session])

  const canProceed = !!normalizedData && !extractionFailed

  const scopeSourceTypes = [
    'component', 'subcomponent', 'process_step', 'method_step', 'constituent', 'compound',
    'formulation', 'material', 'biological_entity', 'sequence', 'cell', 'protein',
    'reagent', 'sample', 'assay_step', 'therapeutic_step', 'diagnostic_marker',
    'manufacturing_step', 'condition', 'range', 'data_field', 'interface',
    'use_case', 'environment', 'other'
  ]

  const updateScopeElement = (
    elementId: string,
    field: keyof ScopeUseSelection | 'label' | 'sourceType',
    value: string
  ) => {
    setScopeRecommendations((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        elements: prev.elements.map((element) => {
          if (element.id !== elementId) return element
          if (field === 'label') return { ...element, label: value }
          if (field === 'sourceType') return { ...element, sourceType: value as any }
          return {
            ...element,
            user: {
              ...(element.user || {}),
              [field]: value
            }
          }
        })
      }
    })
  }

  const resetScopeOverrides = () => {
    setScopeRecommendations((prev) => prev ? {
      ...prev,
      elements: prev.elements.map((element) => {
        const { user, ...rest } = element
        return rest
      })
    } : prev)
  }

  const claimCoreOnly = () => {
    setScopeRecommendations((prev) => prev ? {
      ...prev,
      elements: prev.elements.map((element) => {
        const effective = getEffectiveScopeUse(element)
        return {
          ...element,
          user: {
            ...(element.user || {}),
            claim: effective.claim === 'claim_1' ? 'claim_1' : 'none'
          }
        }
      })
    } : prev)
  }

  const excludeEnvironmentUseCases = () => {
    setScopeRecommendations((prev) => prev ? {
      ...prev,
      elements: prev.elements.map((element) => {
        if (element.sourceType !== 'environment' && element.sourceType !== 'use_case') return element
        return {
          ...element,
          user: {
            ...(element.user || {}),
            claim: 'none',
            numbering: 'do_not_number',
            figures: 'do_not_show',
            description: 'exclude'
          }
        }
      })
    } : prev)
  }

  const removeScopeElement = (elementId: string) => {
    setScopeRecommendations((prev) => prev ? {
      ...prev,
      elements: prev.elements.map((element) => element.id === elementId
        ? {
            ...element,
            user: {
              ...(element.user || {}),
              claim: 'none',
              numbering: 'do_not_number',
              figures: 'do_not_show',
              description: 'exclude'
            }
          }
        : element)
    } : prev)
  }

  const addScopeElement = () => {
    const basis = {
      patentTypePrimary: session?.patentTypePrimary || normalizedRecord.patentTypePrimary || 'SYSTEM',
      inventionType: Array.isArray(normalizedRecord.inventionType) ? normalizedRecord.inventionType : ['GENERAL'],
      fieldOfRelevance: normalizedRecord.fieldOfRelevance,
      subfield: normalizedRecord.subfield
    }
    setScopeRecommendations((prev) => {
      const current = prev || {
        version: 1 as const,
        generatedAt: new Date().toISOString(),
        basis,
        elements: []
      }
      const nextIndex = current.elements.length + 1
      const newElement: ScopeRecommendationElement = {
        id: `user_scope_${Date.now()}`,
        label: `New scope element ${nextIndex}`,
        sourceType: 'other',
        recommended: {
          claim: 'dependent_claim',
          numbering: 'number',
          figures: 'optional',
          description: 'include'
        },
        user: {
          claim: 'dependent_claim',
          numbering: 'number',
          figures: 'optional',
          description: 'include'
        },
        reason: 'User-added scope element.',
        sourceRefs: ['user.stage0.scopeRecommendations']
      }
      return {
        ...current,
        elements: [...current.elements, newElement]
      }
    })
  }

  const regenerateStructure = async () => {
    try {
      setError(null)
      if (!session?.id) return
      const currentRaw = session?.ideaRecord?.rawInput || rawIdea || ''
      const currentTitle = session?.ideaRecord?.title || title || ''
      if (!currentRaw || !currentTitle) {
        setError('Cannot regenerate: missing title or description.')
        return
      }
      setIsRegenerating(true)
      setStage0StartedAt(Date.now())
      setStage0OverlayStatus('running')
      setStage0OverlayError(undefined)
      await onComplete({
        action: 'normalize_idea',
        sessionId: session.id,
        rawIdea: currentRaw,
        title: currentTitle,
        sourceInputMeta: normalizedRecord.sourceInputMeta,
        allowRefine
      })
      setStage0OverlayStatus('success')
      await onRefresh()
      await new Promise(resolve => setTimeout(resolve, 500))
      setStage0OverlayStatus(null)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to regenerate AI output. Please try again.'
      setError(message)
      setStage0OverlayError(message)
      setStage0OverlayStatus('error')
    } finally {
      setIsRegenerating(false)
    }
  }

  

  const proceedToClaims = async () => {
    if (!session?.id) return
    try {
      setIsNavigating(true)
      setError(null)

      if (isEditing) {
        const validComponents = components.filter((c: any) => c.name?.trim())
        await onComplete({
          action: 'update_idea_record',
          sessionId: session.id,
          patch: {
            problem, objectives, logic, bestMethod,
            components: validComponents,
            searchQuery, abstract: abstractText, cpcCodes, ipcCodes,
            scopeRecommendations,
            supportDataSources,
            schemaVersion: 2
          }
        })
        setComponents(validComponents)
        setIsEditing(false)
      }

      await onComplete({
        action: 'set_stage',
        sessionId: session.id,
        stage: 'PRELIMINARY_CLAIMS'
      })
      await onRefresh()
    } catch (e) {
      console.error('Failed to proceed to claims:', e)
      setError(e instanceof Error ? e.message : 'Failed to proceed to claims')
    } finally {
      setIsNavigating(false)
    }
  }

  return (
    <>
    <Stage0PatentIntelligenceOverlay
      open={stage0OverlayStatus !== null}
      mode={allowRefine ? 'enhance' : 'preserve'}
      title={title}
      disclosureLength={rawIdea.length}
      disclosureText={rawIdea}
      startedAt={stage0StartedAt}
      status={stage0OverlayStatus || 'running'}
      errorMessage={stage0OverlayError}
      onRetry={regenerateStructure}
      onReturnToEditor={() => {
        setStage0OverlayStatus(null)
        setStage0OverlayError(undefined)
        setIsRegenerating(false)
      }}
    />
    <div className="px-6 py-8 w-full">
      {/* Header with Jurisdiction Badge */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-ai-graphite-900 flex items-center gap-3">
              <div className="p-2 bg-ai-blue-100 rounded-lg">
                <Lightbulb className="w-6 h-6 text-ai-blue-600" />
              </div>
              Invention Structure
            </h2>
            <p className="text-ai-graphite-500 mt-2">
              Review and edit your invention structure before generating patent claims.
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            {/* Mode indicator */}
            <Badge variant={allowRefine ? 'default' : 'secondary'} className="flex items-center gap-1.5 px-3 py-1.5">
              {allowRefine ? (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  Structured by Kisho
                </>
              ) : (
                <>
                  <FileText className="w-3.5 h-3.5" />
                  Original Content
                </>
              )}
            </Badge>
            
            {/* Jurisdiction Badge */}
            <Badge variant="outline" className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border-amber-200 text-amber-800">
              <Globe className="w-3.5 h-3.5" />
              {activeJurisdiction}
              {allJurisdictions.length > 1 && (
                <span className="text-xs opacity-70">+{allJurisdictions.length - 1}</span>
              )}
            </Badge>
          </div>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {extractionFailed && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Stage 0 extraction failed for this record. Regenerate the invention structure before generating claims.
          </AlertDescription>
        </Alert>
      )}

      {/* Combined Notice: Sequential Steps + Experimental Data */}
      <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 p-1.5 bg-amber-100 rounded-full">
            <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="flex-1 space-y-2">
            {/* Sequential Steps Notice */}
            <p className="text-xs text-amber-800 leading-relaxed">
              <span className="inline-flex items-center gap-1 bg-yellow-200 text-yellow-900 px-1.5 py-0.5 rounded text-[10px] font-bold mr-1">⚠️ FOLLOW STEPS IN ORDER</span>
              Complete each stage sequentially for best results: <span className="font-medium">Invention → Claims → Prior Art → Refinement → Components → Figures → Draft</span>
            </p>
            {/* Experimental Data Notice */}
            <p className="text-xs text-amber-700 leading-relaxed">
              <strong>About Support Data:</strong> This stage extracts complex source facts. Review tables, equations, examples, test results, sequences, and exclusions in the <strong>Support Data</strong> tab.
            </p>
          </div>
        </div>
      </div>

      {(!showNormalized || !normalizedData) && (
        <KishoNormalizationLoader mode={allowRefine ? 'enhance' : 'preserve'} />
      )}

      <div className="grid grid-cols-1 gap-6">
        {/* Invention Details */}
        <div className="space-y-4">
          {/* Collapsible Original Input */}
          <div className="border border-paper-300 rounded-lg overflow-hidden bg-white shadow-sm">
            <button 
              onClick={() => setShowOriginal(!showOriginal)} 
              className="w-full flex justify-between items-center px-5 py-3 bg-paper-100/50 hover:bg-paper-100 transition-colors text-left"
            >
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-ai-graphite-400" />
                <span className="text-sm font-medium text-ai-graphite-700">Original Input Reference</span>
              </div>
              {showOriginal ? <ChevronDown className="w-4 h-4 text-ai-graphite-400" /> : <ChevronRight className="w-4 h-4 text-ai-graphite-400" />}
            </button>
            <AnimatePresence>
              {showOriginal && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="p-5 border-t border-paper-200 bg-paper-100/30">
                    <div className="mb-4">
                      <span className="text-xs font-semibold uppercase tracking-wider text-ai-graphite-400 block mb-1">Title</span>
                      <p className="text-sm text-ai-graphite-900 font-medium">{title}</p>
                    </div>
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wider text-ai-graphite-400 block mb-1">Description</span>
                      <div className="bg-white p-4 rounded border border-paper-300 text-sm text-ai-graphite-600 whitespace-pre-wrap font-mono leading-relaxed max-h-60 overflow-y-auto">
                        {rawIdea}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* AI-Normalized Results (Collapsible) */}
          {showNormalized && normalizedData && (
            <div className="bg-white rounded-xl border border-paper-300 shadow-sm overflow-hidden">
              <button
                onClick={() => setShowInventionDetails(!showInventionDetails)}
                className="w-full flex items-center justify-between px-6 py-4 border-b border-paper-200 bg-gradient-to-r from-white to-ai-blue-50/30 hover:bg-ai-blue-50/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-full bg-ai-blue-100 flex items-center justify-center">
                    <Sparkles className="w-3.5 h-3.5 text-ai-blue-600" />
                  </div>
                  <h3 className="text-sm font-semibold text-ai-graphite-900">
                    Invention Structure
                  </h3>
                  <Badge variant="secondary" className="text-xs">
                    {allowRefine ? 'Structured' : 'Parsed'}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  {!showInventionDetails && (
                    <span className="text-xs text-ai-graphite-500">Click to expand</span>
                  )}
                  {showInventionDetails ? <ChevronDown className="w-4 h-4 text-ai-graphite-400" /> : <ChevronRight className="w-4 h-4 text-ai-graphite-400" />}
                </div>
              </button>

              <AnimatePresence>
                {showInventionDetails && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    {/* Toolbar */}
                    <div className="flex items-center justify-end px-6 py-2 border-b border-paper-200 bg-paper-100/50">
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => setIsEditing((v) => !v)}
                          className={`inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${isEditing ? 'bg-ai-blue-600 text-white' : 'text-ai-graphite-600 hover:bg-paper-200 bg-white border border-paper-300'}`}
                        >
                          {isEditing ? <><Check className="w-3 h-3 mr-1" /> Done</> : <><Edit2 className="w-3 h-3 mr-1" /> Edit</>}
                        </button>
                        <button
                          onClick={regenerateStructure}
                          className="inline-flex items-center px-2 py-1.5 text-xs font-medium rounded-md text-ai-graphite-600 bg-white border border-paper-300 hover:bg-paper-100 disabled:opacity-60"
                          disabled={isRegenerating}
                          title="Regenerate Structure"
                        >
                          <RefreshCw className={`w-3 h-3 ${isRegenerating ? 'animate-spin' : ''}`} />
                        </button>
                      </div>
                    </div>

                    {/* Tab Navigation */}
                    <div className="flex border-b border-paper-300 px-4 bg-paper-100/30">
                      {([
                        { key: 'core' as const, label: 'Core Details', icon: Target },
                        { key: 'components' as const, label: `Components (${components?.length || 0})`, icon: Layers },
                        { key: 'supportData' as const, label: `Support Data (${supportDataSources.filter(source => source.status !== 'deleted').length})`, icon: FileSearch },
                        { key: 'scope' as const, label: 'Scope', icon: Scale },
                        { key: 'classification' as const, label: 'Classification', icon: Hash },
                      ]).map(tab => (
                        <button
                          key={tab.key}
                          onClick={() => setActiveTab(tab.key)}
                          className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                            activeTab === tab.key
                              ? 'border-ai-blue-600 text-ai-blue-700'
                              : 'border-transparent text-ai-graphite-500 hover:text-ai-graphite-700 hover:border-paper-400'
                          }`}
                        >
                          <tab.icon className="w-3.5 h-3.5" />
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    <div className="p-6 space-y-6 max-h-[1200px] overflow-y-auto">
                      {/* ═══ CORE TAB ═══ */}
                      {activeTab === 'core' && (
                        <>
                          <div className="flex items-center gap-2 px-3 py-2 bg-ai-blue-50 border border-ai-blue-100 rounded-md text-xs text-ai-blue-700">
                            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span>
                              <strong>Tip:</strong> Add or correct complex source facts in the Support Data tab before generating claims.
                            </span>
                          </div>

                          <div>
                            <h4 className="text-sm font-medium text-ai-graphite-900 mb-1.5">Problem Statement</h4>
                            {isEditing ? (
                              <textarea
                                className="w-full text-sm border-paper-400 rounded-md focus:ring-ai-blue-500 focus:border-ai-blue-500"
                                rows={3}
                                value={problem}
                                onChange={(e) => setProblem(e.target.value)}
                              />
                            ) : (
                              <div className="text-sm text-ai-graphite-700 leading-relaxed bg-paper-100 p-3 rounded border border-paper-200">
                                {problem || <span className="text-ai-graphite-400 italic">Not specified</span>}
                              </div>
                            )}
                          </div>

                          <div>
                            <h4 className="text-sm font-medium text-ai-graphite-900 mb-1.5">Objectives</h4>
                            {isEditing ? (
                              <textarea
                                className="w-full text-sm border-paper-400 rounded-md focus:ring-ai-blue-500 focus:border-ai-blue-500"
                                rows={2}
                                value={objectives}
                                onChange={(e) => setObjectives(e.target.value)}
                              />
                            ) : (
                              <div className="text-sm text-ai-graphite-700 leading-relaxed bg-paper-100 p-3 rounded border border-paper-200">
                                {objectives || <span className="text-ai-graphite-400 italic">Not specified</span>}
                              </div>
                            )}
                          </div>

                          <div>
                            <h4 className="text-sm font-medium text-ai-graphite-900 mb-1.5">Technical Logic</h4>
                            {isEditing ? (
                              <textarea
                                className="w-full text-sm border-paper-400 rounded-md focus:ring-ai-blue-500 focus:border-ai-blue-500"
                                rows={3}
                                value={logic}
                                onChange={(e) => setLogic(e.target.value)}
                              />
                            ) : (
                              <div className="text-sm text-ai-graphite-700 leading-relaxed bg-paper-100 p-3 rounded border border-paper-200">
                                {logic || <span className="text-ai-graphite-400 italic">Not specified</span>}
                              </div>
                            )}
                          </div>

                          <div>
                            <h4 className="text-sm font-medium text-ai-graphite-900 mb-1.5">Best Method</h4>
                            {isEditing ? (
                              <textarea
                                className="w-full text-sm border-paper-400 rounded-md focus:ring-ai-blue-500 focus:border-ai-blue-500"
                                rows={2}
                                value={bestMethod}
                                onChange={(e) => setBestMethod(e.target.value)}
                              />
                            ) : (
                              <div className="text-sm text-ai-graphite-700 leading-relaxed bg-paper-100 p-3 rounded border border-paper-200">
                                {bestMethod || <span className="text-ai-graphite-400 italic">Not specified</span>}
                              </div>
                            )}
                          </div>

                          <div>
                            <h4 className="text-sm font-medium text-ai-graphite-900 mb-1.5">Abstract</h4>
                            {isEditing ? (
                              <textarea
                                className="w-full text-sm border-paper-400 rounded-md focus:ring-ai-blue-500 focus:border-ai-blue-500"
                                rows={3}
                                value={abstractText}
                                onChange={(e) => setAbstractText(e.target.value)}
                              />
                            ) : (
                              <div className="text-sm text-ai-graphite-700 leading-relaxed bg-paper-100 p-3 rounded border border-paper-200">
                                {abstractText || <span className="text-ai-graphite-400 italic">Not specified</span>}
                              </div>
                            )}
                          </div>
                        </>
                      )}

                      {/* ═══ COMPONENTS TAB ═══ */}
                      {activeTab === 'components' && (() => {
                        const COMP_TYPE_META: Record<string, { icon: React.ElementType; color: string; bg: string; label: string }> = {
                          MAIN_CONTROLLER: { icon: Cpu, color: 'text-violet-700', bg: 'bg-violet-50 border-violet-200', label: 'Main Controller' },
                          SUBSYSTEM: { icon: Box, color: 'text-ai-blue-700', bg: 'bg-ai-blue-50 border-ai-blue-200', label: 'Subsystem' },
                          MODULE: { icon: Puzzle, color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', label: 'Module' },
                          INTERFACE: { icon: Link2, color: 'text-ai-blue-700', bg: 'bg-ai-blue-50 border-ai-blue-200', label: 'Interface' },
                          SENSOR: { icon: Radio, color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200', label: 'Sensor' },
                          ACTUATOR: { icon: Gauge, color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200', label: 'Actuator' },
                          PROCESSOR: { icon: Cog, color: 'text-ai-blue-700', bg: 'bg-ai-blue-50 border-ai-blue-200', label: 'Processor' },
                          MEMORY: { icon: HardDrive, color: 'text-pink-700', bg: 'bg-pink-50 border-pink-200', label: 'Memory' },
                          DISPLAY: { icon: Monitor, color: 'text-ai-blue-700', bg: 'bg-ai-blue-50 border-ai-blue-200', label: 'Display' },
                          COMMUNICATION: { icon: Wifi, color: 'text-ai-blue-700', bg: 'bg-ai-blue-50 border-ai-blue-200', label: 'Communication' },
                          POWER_SUPPLY: { icon: Zap, color: 'text-yellow-700', bg: 'bg-yellow-50 border-yellow-200', label: 'Power Supply' },
                          OTHER: { icon: CircleDot, color: 'text-ai-graphite-600', bg: 'bg-paper-100 border-paper-300', label: 'Other' },
                        }

                        const toggleExpand = (idx: number) => {
                          setExpandedComponents(prev => {
                            const next = new Set(prev)
                            next.has(idx) ? next.delete(idx) : next.add(idx)
                            return next
                          })
                        }
                        const expandAll = () => setExpandedComponents(new Set(components.map((_: any, i: number) => i)))
                        const collapseAll = () => setExpandedComponents(new Set())

                        const updateComp = (idx: number, field: string, value: string) => {
                          const updated = [...(components || [])]
                          updated[idx] = { ...updated[idx], [field]: value }
                          setComponents(updated)
                        }

                        const hasHierarchy = components?.some((c: any) => c.parent || (typeof c.level === 'number' && c.level > 0))

                        const buildTree = (comps: any[]) => {
                          if (!hasHierarchy) return comps.map((c: any, i: number) => ({ ...c, _idx: i, _depth: 0, _children: [] }))
                          const parentIndex = new Map<string, number>()
                          comps.forEach((c: any, i: number) => { if (c.name?.trim()) parentIndex.set(c.name.trim().toLowerCase(), i) })
                          const roots: any[] = []
                          const nodeMap = comps.map((c: any, i: number) => ({ ...c, _idx: i, _depth: c.level || 0, _children: [] as any[] }))
                          nodeMap.forEach((node) => {
                            const parentName = node.parent?.trim()?.toLowerCase()
                            if (parentName && parentIndex.has(parentName)) {
                              const parentIdx = parentIndex.get(parentName)!
                              nodeMap[parentIdx]._children.push(node)
                              node._depth = (nodeMap[parentIdx]._depth || 0) + 1
                            } else {
                              roots.push(node)
                            }
                          })
                          const flat: any[] = []
                          const walk = (nodes: any[]) => { nodes.forEach(n => { flat.push(n); walk(n._children) }) }
                          walk(roots)
                          return flat
                        }

                        const tree = buildTree(components || [])
                        const hasDetailFields = (c: any) =>
                          (c.inputs && c.inputs !== 'Not stated by source') ||
                          (c.outputs && c.outputs !== 'Not stated by source') ||
                          (c.dependencies && c.dependencies !== 'Not stated by source') ||
                          (c.figureHint && c.figureHint !== 'Not stated by source') ||
                          (c.parent) || (c.alternatives) || (c.conditions)

                        const typeCounts: Record<string, number> = {}
                        components?.forEach((c: any) => { typeCounts[c.type || 'OTHER'] = (typeCounts[c.type || 'OTHER'] || 0) + 1 })

                        return (
                        <div>
                          <div className="flex items-center justify-between mb-4">
                            <div>
                              <h4 className="text-sm font-medium text-ai-graphite-900">
                                Key Components
                                <span className="ml-1.5 text-xs font-normal text-ai-graphite-400">
                                  {components?.length || 0} total
                                  {hasHierarchy && <span className="ml-1 text-ai-blue-500">&middot; hierarchical</span>}
                                </span>
                              </h4>
                              <p className="text-[11px] text-ai-graphite-500 mt-0.5">
                                {isEditing ? 'Add, remove, or edit components that make up your invention.' : 'Components extracted from your invention disclosure.'}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              {components?.length > 1 && (
                                <div className="flex items-center border border-paper-300 rounded-md overflow-hidden">
                                  <button
                                    onClick={expandAll}
                                    className="px-2 py-1 text-[10px] text-ai-graphite-600 hover:bg-paper-100 transition-colors border-r border-paper-300"
                                    title="Expand all"
                                  >
                                    Expand all
                                  </button>
                                  <button
                                    onClick={collapseAll}
                                    className="px-2 py-1 text-[10px] text-ai-graphite-600 hover:bg-paper-100 transition-colors"
                                    title="Collapse all"
                                  >
                                    Collapse all
                                  </button>
                                </div>
                              )}
                              {isEditing && (
                                <button
                                  onClick={() => setComponents([...(components || []), { name: '', type: 'OTHER', description: '' }])}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-ai-blue-600 hover:bg-ai-blue-700 rounded-md transition-colors"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                  Add
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Type summary pills */}
                          {components?.length > 0 && Object.keys(typeCounts).length > 1 && (
                            <div className="flex flex-wrap gap-1.5 mb-3">
                              {Object.entries(typeCounts).map(([type, count]) => {
                                const meta = COMP_TYPE_META[type] || COMP_TYPE_META.OTHER
                                const Icon = meta.icon
                                return (
                                  <span key={type} className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full border ${meta.bg} ${meta.color}`}>
                                    <Icon className="w-3 h-3" />
                                    {meta.label} ({count})
                                  </span>
                                )
                              })}
                            </div>
                          )}

                          <div className="space-y-1.5 max-h-[800px] overflow-y-auto">
                            {tree.length > 0 ? (
                              tree.map((comp: any) => {
                                const idx = comp._idx
                                const depth = comp._depth || 0
                                const isExpanded = expandedComponents.has(idx)
                                const meta = COMP_TYPE_META[comp.type] || COMP_TYPE_META.OTHER
                                const Icon = meta.icon
                                const showDetails = isExpanded && (hasDetailFields(comp) || isEditing)
                                const childCount = comp._children?.length || 0

                                return (
                                  <div
                                    key={idx}
                                    className="group"
                                    style={{ marginLeft: `${depth * 20}px` }}
                                  >
                                    {/* Hierarchy connector line */}
                                    {depth > 0 && (
                                      <div className="flex items-center gap-1 -mb-1 ml-1" style={{ paddingLeft: '2px' }}>
                                        <div className="w-3 border-l-2 border-b-2 border-paper-400 h-3 rounded-bl-sm" />
                                      </div>
                                    )}
                                    <div className={`rounded-lg border transition-all ${
                                      isExpanded ? 'bg-white border-ai-blue-200 shadow-sm ring-1 ring-ai-blue-100' : 'bg-paper-100/80 border-paper-300 hover:border-paper-400 hover:bg-white'
                                    }`}>
                                      {/* Collapsed header row */}
                                      <div
                                        className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer select-none"
                                        onClick={() => toggleExpand(idx)}
                                      >
                                        {/* Expand chevron */}
                                        <button className="flex-shrink-0 p-0.5 rounded hover:bg-paper-200 transition-colors">
                                          {isExpanded
                                            ? <ChevronDown className="w-3.5 h-3.5 text-ai-blue-500" />
                                            : <ChevronRight className="w-3.5 h-3.5 text-ai-graphite-400" />
                                          }
                                        </button>

                                        {/* Type icon */}
                                        <div className={`flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center border ${meta.bg}`}>
                                          <Icon className={`w-3.5 h-3.5 ${meta.color}`} />
                                        </div>

                                        {/* Name + type + description preview */}
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-2">
                                            {isEditing ? (
                                              <input
                                                type="text"
                                                value={comp.name || ''}
                                                onClick={(e) => e.stopPropagation()}
                                                onChange={(e) => updateComp(idx, 'name', e.target.value)}
                                                className={`flex-1 px-2 py-1 text-sm font-medium border rounded focus:ring-ai-blue-500 focus:border-ai-blue-500 bg-white ${
                                                  !(comp.name?.trim()) ? 'border-red-300 bg-red-50' : 'border-paper-400'
                                                }`}
                                                placeholder="Component name"
                                              />
                                            ) : (
                                              <span className="text-sm font-medium text-ai-graphite-900 truncate">
                                                {comp.name || <span className="text-ai-graphite-400 italic">Unnamed</span>}
                                              </span>
                                            )}
                                            <span className={`flex-shrink-0 text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded border ${meta.bg} ${meta.color}`}>
                                              {meta.label}
                                            </span>
                                            {childCount > 0 && (
                                              <span className="flex-shrink-0 text-[10px] text-ai-graphite-400 bg-paper-200 px-1.5 py-0.5 rounded">
                                                {childCount} sub
                                              </span>
                                            )}
                                          </div>
                                          {!isExpanded && comp.description && (
                                            <p className="text-[11px] text-ai-graphite-500 mt-0.5 truncate">
                                              {comp.description}
                                            </p>
                                          )}
                                        </div>

                                        {/* Quick info badges (collapsed) */}
                                        {!isExpanded && (
                                          <div className="flex items-center gap-1.5 flex-shrink-0">
                                            {comp.inputs && comp.inputs !== 'Not stated by source' && (
                                              <span className="w-5 h-5 rounded flex items-center justify-center bg-green-50 border border-green-200" title={`Inputs: ${comp.inputs}`}>
                                                <ArrowRight className="w-3 h-3 text-green-600" />
                                              </span>
                                            )}
                                            {comp.outputs && comp.outputs !== 'Not stated by source' && (
                                              <span className="w-5 h-5 rounded flex items-center justify-center bg-orange-50 border border-orange-200" title={`Outputs: ${comp.outputs}`}>
                                                <ArrowLeft className="w-3 h-3 text-orange-600" />
                                              </span>
                                            )}
                                            {comp.figureHint && comp.figureHint !== 'Not stated by source' && (
                                              <span className="w-5 h-5 rounded flex items-center justify-center bg-ai-blue-50 border border-ai-blue-200" title={`Figure: ${comp.figureHint}`}>
                                                <Image className="w-3 h-3 text-ai-blue-600" />
                                              </span>
                                            )}
                                          </div>
                                        )}

                                        {/* Delete button (edit mode) */}
                                        {isEditing && (
                                          <button
                                            onClick={(e) => { e.stopPropagation(); setComponents((components || []).filter((_: any, i: number) => i !== idx)) }}
                                            className="flex-shrink-0 p-1.5 text-ai-graphite-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                                            title="Remove component"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </button>
                                        )}
                                      </div>

                                      {/* Expanded detail panel */}
                                      <AnimatePresence>
                                        {isExpanded && (
                                          <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.15 }}
                                            className="overflow-hidden"
                                          >
                                            <div className="px-3 pb-3 pt-1 border-t border-paper-200">
                                              {/* Description */}
                                              <div className="mb-3">
                                                <label className="block text-[10px] font-medium text-ai-graphite-500 uppercase tracking-wide mb-1">Description</label>
                                                {isEditing ? (
                                                  <textarea
                                                    value={comp.description || ''}
                                                    onChange={(e) => updateComp(idx, 'description', e.target.value)}
                                                    rows={2}
                                                    className="w-full px-2.5 py-1.5 text-xs border border-paper-400 rounded-md focus:ring-ai-blue-500 focus:border-ai-blue-500 resize-none bg-white"
                                                    placeholder="Technical role / function of this component"
                                                  />
                                                ) : (
                                                  <p className="text-xs text-ai-graphite-700 leading-relaxed">
                                                    {comp.description || <span className="text-ai-graphite-400 italic">No description</span>}
                                                  </p>
                                                )}
                                              </div>

                                              {/* Type selector (edit mode) */}
                                              {isEditing && (
                                                <div className="mb-3">
                                                  <label className="block text-[10px] font-medium text-ai-graphite-500 uppercase tracking-wide mb-1">Type</label>
                                                  <select
                                                    value={comp.type || 'OTHER'}
                                                    onChange={(e) => updateComp(idx, 'type', e.target.value)}
                                                    className="w-full px-2.5 py-1.5 text-xs border border-paper-400 rounded-md bg-white focus:ring-ai-blue-500 focus:border-ai-blue-500"
                                                  >
                                                    {Object.entries(COMP_TYPE_META).map(([val, m]) => (
                                                      <option key={val} value={val}>{m.label}</option>
                                                    ))}
                                                  </select>
                                                </div>
                                              )}

                                              {/* Detail grid: inputs, outputs, dependencies, figureHint */}
                                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                {/* Inputs */}
                                                {(isEditing || (comp.inputs && comp.inputs !== 'Not stated by source')) && (
                                                  <div className="rounded-md border border-green-100 bg-green-50/50 px-2.5 py-2">
                                                    <div className="flex items-center gap-1.5 mb-1">
                                                      <ArrowRight className="w-3 h-3 text-green-600" />
                                                      <span className="text-[10px] font-medium text-green-700 uppercase tracking-wide">Inputs</span>
                                                    </div>
                                                    {isEditing ? (
                                                      <input
                                                        type="text"
                                                        value={comp.inputs || ''}
                                                        onChange={(e) => updateComp(idx, 'inputs', e.target.value)}
                                                        className="w-full px-2 py-1 text-xs border border-green-200 rounded bg-white focus:ring-green-400 focus:border-green-400"
                                                        placeholder="Signals, data, triggers..."
                                                      />
                                                    ) : (
                                                      <p className="text-xs text-ai-graphite-700">{comp.inputs}</p>
                                                    )}
                                                  </div>
                                                )}

                                                {/* Outputs */}
                                                {(isEditing || (comp.outputs && comp.outputs !== 'Not stated by source')) && (
                                                  <div className="rounded-md border border-orange-100 bg-orange-50/50 px-2.5 py-2">
                                                    <div className="flex items-center gap-1.5 mb-1">
                                                      <ArrowLeft className="w-3 h-3 text-orange-600" />
                                                      <span className="text-[10px] font-medium text-orange-700 uppercase tracking-wide">Outputs</span>
                                                    </div>
                                                    {isEditing ? (
                                                      <input
                                                        type="text"
                                                        value={comp.outputs || ''}
                                                        onChange={(e) => updateComp(idx, 'outputs', e.target.value)}
                                                        className="w-full px-2 py-1 text-xs border border-orange-200 rounded bg-white focus:ring-orange-400 focus:border-orange-400"
                                                        placeholder="Actions, results, data..."
                                                      />
                                                    ) : (
                                                      <p className="text-xs text-ai-graphite-700">{comp.outputs}</p>
                                                    )}
                                                  </div>
                                                )}

                                                {/* Dependencies */}
                                                {(isEditing || (comp.dependencies && comp.dependencies !== 'Not stated by source')) && (
                                                  <div className="rounded-md border border-ai-blue-100 bg-ai-blue-50/50 px-2.5 py-2">
                                                    <div className="flex items-center gap-1.5 mb-1">
                                                      <Link2 className="w-3 h-3 text-ai-blue-600" />
                                                      <span className="text-[10px] font-medium text-ai-blue-700 uppercase tracking-wide">Dependencies</span>
                                                    </div>
                                                    {isEditing ? (
                                                      <input
                                                        type="text"
                                                        value={comp.dependencies || ''}
                                                        onChange={(e) => updateComp(idx, 'dependencies', e.target.value)}
                                                        className="w-full px-2 py-1 text-xs border border-ai-blue-200 rounded bg-white focus:ring-ai-blue-400 focus:border-ai-blue-400"
                                                        placeholder="Other components this depends on..."
                                                      />
                                                    ) : (
                                                      <p className="text-xs text-ai-graphite-700">{comp.dependencies}</p>
                                                    )}
                                                  </div>
                                                )}

                                                {/* Figure hint */}
                                                {(isEditing || (comp.figureHint && comp.figureHint !== 'Not stated by source')) && (
                                                  <div className="rounded-md border border-ai-blue-100 bg-ai-blue-50/50 px-2.5 py-2">
                                                    <div className="flex items-center gap-1.5 mb-1">
                                                      <Image className="w-3 h-3 text-ai-blue-600" />
                                                      <span className="text-[10px] font-medium text-ai-blue-700 uppercase tracking-wide">Figure Hint</span>
                                                    </div>
                                                    {isEditing ? (
                                                      <input
                                                        type="text"
                                                        value={comp.figureHint || ''}
                                                        onChange={(e) => updateComp(idx, 'figureHint', e.target.value)}
                                                        className="w-full px-2 py-1 text-xs border border-ai-blue-200 rounded bg-white focus:ring-ai-blue-400 focus:border-ai-blue-400"
                                                        placeholder="Drawing focus..."
                                                      />
                                                    ) : (
                                                      <p className="text-xs text-ai-graphite-700">{comp.figureHint}</p>
                                                    )}
                                                  </div>
                                                )}

                                                {/* Conditions */}
                                                {(isEditing || (comp.conditions && comp.conditions !== 'Not stated by source')) && (
                                                  <div className="rounded-md border border-yellow-100 bg-yellow-50/50 px-2.5 py-2">
                                                    <div className="flex items-center gap-1.5 mb-1">
                                                      <AlertCircle className="w-3 h-3 text-yellow-600" />
                                                      <span className="text-[10px] font-medium text-yellow-700 uppercase tracking-wide">Conditions</span>
                                                    </div>
                                                    {isEditing ? (
                                                      <input
                                                        type="text"
                                                        value={comp.conditions || ''}
                                                        onChange={(e) => updateComp(idx, 'conditions', e.target.value)}
                                                        className="w-full px-2 py-1 text-xs border border-yellow-200 rounded bg-white focus:ring-yellow-400 focus:border-yellow-400"
                                                        placeholder="Operating conditions..."
                                                      />
                                                    ) : (
                                                      <p className="text-xs text-ai-graphite-700">{comp.conditions}</p>
                                                    )}
                                                  </div>
                                                )}

                                                {/* Alternatives */}
                                                {(isEditing || (comp.alternatives && comp.alternatives !== 'Not stated by source')) && (
                                                  <div className="rounded-md border border-ai-blue-100 bg-ai-blue-50/50 px-2.5 py-2">
                                                    <div className="flex items-center gap-1.5 mb-1">
                                                      <RefreshCw className="w-3 h-3 text-ai-blue-600" />
                                                      <span className="text-[10px] font-medium text-ai-blue-700 uppercase tracking-wide">Alternatives</span>
                                                    </div>
                                                    {isEditing ? (
                                                      <input
                                                        type="text"
                                                        value={comp.alternatives || ''}
                                                        onChange={(e) => updateComp(idx, 'alternatives', e.target.value)}
                                                        className="w-full px-2 py-1 text-xs border border-ai-blue-200 rounded bg-white focus:ring-ai-blue-400 focus:border-ai-blue-400"
                                                        placeholder="Alternative implementations..."
                                                      />
                                                    ) : (
                                                      <p className="text-xs text-ai-graphite-700">{comp.alternatives}</p>
                                                    )}
                                                  </div>
                                                )}
                                              </div>

                                              {/* Parent / hierarchy info */}
                                              {(comp.parent || (typeof comp.level === 'number' && comp.level > 0)) && !isEditing && (
                                                <div className="mt-2 flex items-center gap-2 text-[11px] text-ai-graphite-500">
                                                  <Layers className="w-3 h-3" />
                                                  {comp.parent && <span>Parent: <span className="font-medium text-ai-graphite-700">{comp.parent}</span></span>}
                                                  {typeof comp.level === 'number' && <span className="text-ai-graphite-400">&middot; Level {comp.level}</span>}
                                                </div>
                                              )}

                                              {/* Parent selector (edit mode) */}
                                              {isEditing && (
                                                <div className="mt-2">
                                                  <label className="block text-[10px] font-medium text-ai-graphite-500 uppercase tracking-wide mb-1">Parent Component</label>
                                                  <select
                                                    value={comp.parent || ''}
                                                    onChange={(e) => updateComp(idx, 'parent', e.target.value)}
                                                    className="w-full px-2.5 py-1.5 text-xs border border-paper-400 rounded-md bg-white focus:ring-ai-blue-500 focus:border-ai-blue-500"
                                                  >
                                                    <option value="">None (root level)</option>
                                                    {components?.filter((_: any, i: number) => i !== idx && _?.name?.trim()).map((c: any, i: number) => (
                                                      <option key={i} value={c.name}>{c.name}</option>
                                                    ))}
                                                  </select>
                                                </div>
                                              )}
                                            </div>
                                          </motion.div>
                                        )}
                                      </AnimatePresence>
                                    </div>
                                  </div>
                                )
                              })
                            ) : (
                              <div className="text-center py-10 text-sm text-ai-graphite-500 bg-paper-100 rounded-lg border border-dashed border-paper-400">
                                <Layers className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                                <p className="font-medium text-ai-graphite-600">No components defined yet</p>
                                <p className="text-xs text-ai-graphite-400 mt-1">
                                  {isEditing ? 'Click "Add" to define your invention\'s components.' : 'Components will appear here after normalization.'}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                        )
                      })()}

                      {/* ═══ SCOPE TAB ═══ */}
                      {activeTab === 'supportData' && (
                        <SupportDataSourcesEditor
                          sources={supportDataSources}
                          onChange={setSupportDataSources}
                          isEditing={isEditing}
                        />
                      )}

                      {activeTab === 'scope' && (
                        <div>
                          <div className="flex items-center justify-between gap-3 mb-3">
                            <div>
                              <h4 className="text-sm font-medium text-ai-graphite-900">
                                Scope Recommendations <span className="text-ai-graphite-400 font-normal text-xs">({scopeRecommendations?.elements?.length || 0})</span>
                              </h4>
                              <p className="text-[11px] text-ai-graphite-500 mt-0.5">
                                Controls what the claims stage may claim, number, draw, or describe.
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={addScopeElement}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-ai-blue-600 hover:bg-ai-blue-700 rounded-md transition-colors"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              Add Element
                            </button>
                          </div>

                          {isEditing && scopeRecommendations?.elements?.length ? (
                            <div className="flex flex-wrap gap-2 mb-3">
                              <button type="button" onClick={resetScopeOverrides} className="px-2 py-1 text-[11px] border border-paper-400 rounded-md text-ai-graphite-700 hover:bg-paper-100">
                                Reset to AI recommendations
                              </button>
                              <button type="button" onClick={claimCoreOnly} className="px-2 py-1 text-[11px] border border-paper-400 rounded-md text-ai-graphite-700 hover:bg-paper-100">
                                Claim core only
                              </button>
                              <button type="button" onClick={excludeEnvironmentUseCases} className="px-2 py-1 text-[11px] border border-paper-400 rounded-md text-ai-graphite-700 hover:bg-paper-100">
                                Exclude environment/use-case
                              </button>
                            </div>
                          ) : null}

                          {scopeRecommendations?.elements?.length ? (
                            <div className="space-y-2 max-h-[520px] overflow-y-auto">
                              {scopeRecommendations.elements.map((element) => {
                                const effective = getEffectiveScopeUse(element)
                                return (
                                  <div key={element.id} className="p-3 bg-paper-100 rounded-lg border border-paper-300">
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0 flex-1">
                                        {isEditing ? (
                                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                            <input
                                              type="text"
                                              value={element.label}
                                              onChange={(e) => updateScopeElement(element.id, 'label', e.target.value)}
                                              className="w-full px-2 py-1.5 text-xs border border-paper-400 rounded-md focus:ring-ai-blue-500 focus:border-ai-blue-500"
                                            />
                                            <select
                                              value={element.sourceType}
                                              onChange={(e) => updateScopeElement(element.id, 'sourceType', e.target.value)}
                                              className="w-full px-2 py-1.5 text-xs border border-paper-400 rounded-md bg-white focus:ring-ai-blue-500 focus:border-ai-blue-500"
                                            >
                                              {scopeSourceTypes.map((sourceType) => (
                                                <option key={sourceType} value={sourceType}>{sourceType.replace(/_/g, ' ')}</option>
                                              ))}
                                            </select>
                                          </div>
                                        ) : (
                                          <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-medium text-ai-graphite-900 text-sm">{element.label}</span>
                                            <span className="text-[10px] uppercase tracking-wide text-ai-graphite-500 bg-white border border-paper-300 rounded px-1.5 py-0.5">
                                              {element.sourceType.replace(/_/g, ' ')}
                                            </span>
                                          </div>
                                        )}
                                        {element.reason && (
                                          <p className="text-[11px] text-ai-graphite-500 mt-1 line-clamp-2">{element.reason}</p>
                                        )}
                                      </div>
                                      {isEditing && (
                                        <button
                                          type="button"
                                          onClick={() => removeScopeElement(element.id)}
                                          className="text-[11px] text-red-600 hover:text-red-700"
                                        >
                                          Remove
                                        </button>
                                      )}
                                    </div>

                                    {isEditing ? (
                                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-3">
                                        <label className="block">
                                          <span className="block text-[10px] font-medium text-ai-graphite-500 mb-0.5">Claim</span>
                                          <select value={effective.claim} onChange={(e) => updateScopeElement(element.id, 'claim', e.target.value)} className="w-full px-2 py-1.5 text-xs border border-paper-400 rounded-md bg-white">
                                            <option value="claim_1">Claim 1</option>
                                            <option value="dependent_claim">Dependent</option>
                                            <option value="none">No claim</option>
                                          </select>
                                        </label>
                                        <label className="block">
                                          <span className="block text-[10px] font-medium text-ai-graphite-500 mb-0.5">Numbering</span>
                                          <select value={effective.numbering} onChange={(e) => updateScopeElement(element.id, 'numbering', e.target.value)} className="w-full px-2 py-1.5 text-xs border border-paper-400 rounded-md bg-white">
                                            <option value="number">Number</option>
                                            <option value="do_not_number">No number</option>
                                          </select>
                                        </label>
                                        <label className="block">
                                          <span className="block text-[10px] font-medium text-ai-graphite-500 mb-0.5">Figures</span>
                                          <select value={effective.figures} onChange={(e) => updateScopeElement(element.id, 'figures', e.target.value)} className="w-full px-2 py-1.5 text-xs border border-paper-400 rounded-md bg-white">
                                            <option value="include">Show</option>
                                            <option value="optional">Optional</option>
                                            <option value="do_not_show">Do not show</option>
                                          </select>
                                        </label>
                                        <label className="block">
                                          <span className="block text-[10px] font-medium text-ai-graphite-500 mb-0.5">Description</span>
                                          <select value={effective.description} onChange={(e) => updateScopeElement(element.id, 'description', e.target.value)} className="w-full px-2 py-1.5 text-xs border border-paper-400 rounded-md bg-white">
                                            <option value="include">Include</option>
                                            <option value="optional">Optional</option>
                                            <option value="exclude">Exclude</option>
                                          </select>
                                        </label>
                                      </div>
                                    ) : (
                                      <div className="flex flex-wrap gap-1.5 mt-2 text-[10px]">
                                        <span className="px-1.5 py-0.5 rounded bg-ai-blue-50 text-ai-blue-700 border border-ai-blue-100">Claim: {effective.claim === 'claim_1' ? 'Claim 1' : effective.claim === 'dependent_claim' ? 'Dependent' : 'No claim'}</span>
                                        <span className="px-1.5 py-0.5 rounded bg-slate-50 text-slate-700 border border-slate-100">Numbering: {effective.numbering === 'number' ? 'Number' : 'No number'}</span>
                                        <span className="px-1.5 py-0.5 rounded bg-ai-blue-50 text-ai-blue-700 border border-ai-blue-100">Figures: {effective.figures === 'include' ? 'Show' : effective.figures === 'optional' ? 'Optional' : 'Do not show'}</span>
                                        <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-100">Description: {effective.description}</span>
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          ) : (
                            <div className="text-center py-8 text-sm text-ai-graphite-500 bg-paper-100 rounded-lg border border-dashed border-paper-400">
                              <Scale className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                              <p>No scope recommendations yet.</p>
                              <p className="text-xs text-ai-graphite-400 mt-1">Click "Add Element" to create scope recommendations.</p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* ═══ CLASSIFICATION TAB ═══ */}
                      {activeTab === 'classification' && (
                        <>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-xs font-medium text-ai-graphite-500 mb-1">CPC Codes</label>
                              {isEditing ? (
                                <input
                                  className="w-full text-sm border-paper-400 rounded-md focus:ring-ai-blue-500 focus:border-ai-blue-500"
                                  placeholder="e.g., H04L 29/08"
                                  value={cpcCodes.join(', ')}
                                  onChange={(e) => setCpcCodes(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                                />
                              ) : (
                                <div className="text-sm font-mono bg-paper-100 px-3 py-1.5 rounded border border-paper-200 text-ai-graphite-700">
                                  {cpcCodes?.length ? cpcCodes.join(', ') : <span className="text-ai-graphite-400">None</span>}
                                </div>
                              )}
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-ai-graphite-500 mb-1">IPC Codes</label>
                              {isEditing ? (
                                <input
                                  className="w-full text-sm border-paper-400 rounded-md focus:ring-ai-blue-500 focus:border-ai-blue-500"
                                  placeholder="e.g., G06F 17/30"
                                  value={ipcCodes.join(', ')}
                                  onChange={(e) => setIpcCodes(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                                />
                              ) : (
                                <div className="text-sm font-mono bg-paper-100 px-3 py-1.5 rounded border border-paper-200 text-ai-graphite-700">
                                  {ipcCodes?.length ? ipcCodes.join(', ') : <span className="text-ai-graphite-400">None</span>}
                                </div>
                              )}
                            </div>
                          </div>

                          <div>
                            <h4 className="text-sm font-medium text-ai-graphite-900 mb-1.5">Search Query</h4>
                            {isEditing ? (
                              <input
                                className="w-full text-sm font-mono bg-paper-100 border-paper-400 rounded-md focus:ring-ai-blue-500 focus:border-ai-blue-500"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                              />
                            ) : (
                              <div className="text-sm font-mono text-ai-graphite-600 bg-paper-100 p-3 rounded border border-paper-200">
                                {searchQuery || <span className="text-ai-graphite-400 italic">Not specified</span>}
                              </div>
                            )}
                          </div>

                        </>
                      )}
                    </div>
                    
                    {/* Edit Actions Footer */}
                    {isEditing && (
                      <div className="px-6 py-3 bg-paper-100 border-t border-paper-300 flex justify-end">
                        <Button
                          onClick={async () => {
                            try {
                              // Filter out empty/invalid components before saving
                              const validComponents = (components || [])
                                .filter((c: any) => c && typeof c.name === 'string' && c.name.trim().length > 0)
                                .map((c: any) => ({
                                  ...c,
                                  name: c.name.trim() // Trim whitespace from names
                                }))
                              
                              await onComplete({
                                action: 'update_idea_record',
                                sessionId: session?.id,
                                patch: {
                                  problem, objectives, logic, bestMethod, 
                                  components: validComponents,
                                  searchQuery, abstract: abstractText, cpcCodes, ipcCodes,
                                  scopeRecommendations,
                                  supportDataSources,
                                  schemaVersion: 2
                                }
                              })
                              
                              // Update local state with cleaned components
                              setComponents(validComponents)
                              setIsEditing(false)
                              onRefresh()
                            } catch (err) {
                              console.error('Failed to save edits:', err)
                              setError('Failed to save edits')
                            }
                          }}
                          size="sm"
                        >
                          Save Changes
                        </Button>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

      </div>

      {/* Bottom Navigation */}
      <div className="mt-10 flex justify-end">
        <Button
          onClick={proceedToClaims}
          disabled={!canProceed || isNavigating}
          className="bg-ai-blue-600 hover:bg-ai-blue-700 text-white"
        >
          {isNavigating ? 'Proceeding...' : 'Next: Preliminary Claims'}
          <ChevronRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </div>
    </>
  )
}
