'use client'

import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  Sparkles, 
  Lock, 
  Unlock, 
  ChevronDown, 
  ChevronRight,
  Edit2, 
  Check, 
  RefreshCw, 
  AlertCircle,
  FileText,
  Globe,
  Lightbulb,
  Scale
} from 'lucide-react'
import RichTextEditor, { ClaimsEditor, RichTextEditorRef } from '@/components/ui/rich-text-editor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import KishoNormalizationLoader from '@/components/ui/kisho-normalization-loader'
import PersonaManager, { type PersonaSelection } from '@/components/drafting/PersonaManager'
import { useAuth } from '@/lib/auth-context'

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

interface Claim {
  number: number
  type: 'independent' | 'dependent'
  dependsOn?: number
  text: string
  category?: 'method' | 'system' | 'apparatus' | 'composition' | 'product'
}

// Helper function to parse HTML claims content into structured claims array
// This ensures manual edits in the editor are properly captured in structured format
const parseClaimsFromHtml = (html: string): Claim[] => {
  if (!html || html.trim() === '' || html === '<p></p>') return []
  
  const claims: Claim[] = []
  // Split by closing paragraph tags to handle block-level claims
  const blocks = html.split(/<\/p>/i)
  
  blocks.forEach((block) => {
    // Strip HTML tags and normalize whitespace
    const plain = block.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    if (!plain) return
    
    // Match claim number pattern: "1. claim text" or "1 claim text"
    const match = plain.match(/^(\d+)\.?\s*(.+)$/)
    if (match) {
      const number = Number(match[1])
      const text = match[2].trim()
      
      // Check for dependency references like "The method of claim 1" or "(Claim 1)"
      const depMatch = text.match(/(?:claim|claims?)\s+(\d+)/i)
      const dependsOn = depMatch ? Number(depMatch[1]) : undefined
      
      claims.push({
        number,
        text,
        type: number === 1 || !dependsOn ? 'independent' : 'dependent',
        dependsOn: number === 1 ? undefined : dependsOn,
        category: 'method' // Default category, will be preserved from original if available
      })
    }
  })
  
  return claims
}

export default function IdeaEntryStage({ session, patent, onComplete, onRefresh }: IdeaEntryStageProps) {
  const [normalizedData, setNormalizedData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [showNormalized, setShowNormalized] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)
  const [showInventionDetails, setShowInventionDetails] = useState(true)
  const [showClaimsDetails, setShowClaimsDetails] = useState(true)
  const [isNavigating, setIsNavigating] = useState(false)

  // Claims state
  const [claims, setClaims] = useState<Claim[]>([])
  const [claimsText, setClaimsText] = useState('')
  const [claimsFrozen, setClaimsFrozen] = useState(false)
  const [claimsFrozenAt, setClaimsFrozenAt] = useState<string | null>(null)
  const [isGeneratingClaims, setIsGeneratingClaims] = useState(false)
  const [showClaimsSection, setShowClaimsSection] = useState(true)
  const claimsEditorRef = useRef<RichTextEditorRef>(null)
  const [isEditingClaims, setIsEditingClaims] = useState(false)

  // Patent Type state (decided pre-claims, stored on session - NOT normalizedData)
  const [patentType, setPatentType] = useState<'PRODUCT' | 'SYSTEM' | 'PROCESS' | 'COMPOSITION' | null>(null)
  const [isUpdatingPatentType, setIsUpdatingPatentType] = useState(false)
  const [showPatentTypeDropdown, setShowPatentTypeDropdown] = useState(false)
  
  // User Claim Remarks (influences claim drafting, NOT patent type)
  const [userClaimRemarks, setUserClaimRemarks] = useState('')

  // Persona/Style state for claims generation
  const [usePersonaStyle, setUsePersonaStyle] = useState(false)
  const [personaSelection, setPersonaSelection] = useState<PersonaSelection | undefined>(undefined)
  const [showPersonaManager, setShowPersonaManager] = useState(false)
  const [showNoPersonasModal, setShowNoPersonasModal] = useState(false)
  const [personasAvailable, setPersonasAvailable] = useState<{ myCount: number; orgCount: number } | null>(null)
  const [checkingPersonas, setCheckingPersonas] = useState(false)
  
  // Get user auth context for role-based messaging
  const { token, user } = useAuth()
  const isAdmin = user?.roles?.some((r: string) => ['OWNER', 'ADMIN'].includes(r))

  // Editable fields
  const [problem, setProblem] = useState('')
  const [objectives, setObjectives] = useState('')
  const [logic, setLogic] = useState('')
  const [bestMethod, setBestMethod] = useState('')
  const [components, setComponents] = useState<any[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [abstractText, setAbstractText] = useState('')
  const [cpcCodes, setCpcCodes] = useState<string[]>([])
  const [ipcCodes, setIpcCodes] = useState<string[]>([])
  const [useInitialClaimsForDraft, setUseInitialClaimsForDraft] = useState(false)
  const [skipPriorArtClicked, setSkipPriorArtClicked] = useState(false)
  const [regenerateInstructions, setRegenerateInstructions] = useState('')
  const [draftSaved, setDraftSaved] = useState(false)

  // Use data from existing idea record
  const rawIdea = session?.ideaRecord?.rawInput || ''
  const title = session?.ideaRecord?.title || ''
  
  // Jurisdiction info
  const activeJurisdiction = (session?.activeJurisdiction || session?.draftingJurisdictions?.[0] || 'US').toUpperCase()
  const allJurisdictions = session?.draftingJurisdictions || [activeJurisdiction]
  const allowRefine = session?.ideaRecord?.allowRefine !== false // Default to true

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
          ipcCodes: session.ideaRecord.ipcCodes
        }
      })
      setShowNormalized(true)

      // Initialize editable state
      setProblem(session.ideaRecord.problem || '')
      setObjectives(session.ideaRecord.objectives || '')
      setLogic(session.ideaRecord.logic || '')
      setBestMethod(session.ideaRecord.bestMethod || '')
      setComponents(Array.isArray(session.ideaRecord.components) ? session.ideaRecord.components : [])
      setSearchQuery((session as any)?.ideaRecord?.searchQuery || '')
      setAbstractText(session.ideaRecord.abstract || '')
      setCpcCodes(Array.isArray(session.ideaRecord.cpcCodes) ? session.ideaRecord.cpcCodes : [])
      setIpcCodes(Array.isArray(session.ideaRecord.ipcCodes) ? session.ideaRecord.ipcCodes : [])
    }

    // Load claims data from normalizedData
    const normalizedData = (session?.ideaRecord?.normalizedData as any) || {}
    if (normalizedData.claims) {
      const savedClaims = normalizedData.claims
      if (Array.isArray(savedClaims)) {
        setClaims(savedClaims)
        // Convert structured claims to text for editor
        const claimsTextContent = savedClaims.map((c: Claim) => {
          const prefix = c.type === 'dependent' && c.dependsOn ? `(Claim ${c.dependsOn}) ` : ''
          return `${c.number}. ${prefix}${c.text}`
        }).join('\n\n')
        setClaimsText(claimsTextContent)
      } else if (typeof savedClaims === 'string') {
        setClaimsText(savedClaims)
      }
    }
    
    // Check if claims are frozen
    if (normalizedData.claimsApprovedAt) {
      setClaimsFrozen(true)
      setClaimsFrozenAt(normalizedData.claimsApprovedAt)
    }
    
    // Load user claim remarks from normalizedData
    if (normalizedData.userClaimRemarks) {
      setUserClaimRemarks(normalizedData.userClaimRemarks)
    }
  }, [session])

  // Load patent type from session (stored on session, NOT normalizedData)
  useEffect(() => {
    if (session?.patentTypePrimary) {
      setPatentType(session.patentTypePrimary as any)
    }
  }, [session?.patentTypePrimary])

  // Close patent type dropdown when clicking outside or pressing Escape
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showPatentTypeDropdown) {
        const target = event.target as HTMLElement
        if (!target.closest('[data-patent-type-dropdown]')) {
          setShowPatentTypeDropdown(false)
        }
      }
    }
    
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && showPatentTypeDropdown) {
        setShowPatentTypeDropdown(false)
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [showPatentTypeDropdown])

  // Reset draft saved state when claims content changes
  useEffect(() => {
    if (draftSaved) {
      setDraftSaved(false)
    }
  }, [claimsText])

  const strippedClaims = typeof claimsText === 'string' ? claimsText.replace(/<[^>]*>/g, '').trim() : ''
  const hasClaims = strippedClaims.length > 0 || claims.length > 0
  const canProceed = !!normalizedData && hasClaims

  // Check for available personas
  const checkPersonasAvailable = async (): Promise<boolean> => {
    if (!token) return false
    
    setCheckingPersonas(true)
    try {
      const res = await fetch('/api/personas', {
        headers: { Authorization: `Bearer ${token}` }
      })
      
      if (!res.ok) {
        console.warn('Failed to fetch personas')
        return false
      }
      
      const data = await res.json()
      const myCount = (data.myPersonas || []).length
      const orgCount = (data.orgPersonas || []).length
      
      setPersonasAvailable({ myCount, orgCount })
      return (myCount + orgCount) > 0
    } catch (err) {
      console.error('Error checking personas:', err)
      return false
    } finally {
      setCheckingPersonas(false)
    }
  }

  // Handle persona button click - check availability first
  const handlePersonaButtonClick = async () => {
    const hasPersonas = await checkPersonasAvailable()
    if (hasPersonas) {
      setShowPersonaManager(true)
    } else {
      setShowNoPersonasModal(true)
    }
  }

  // Handle style toggle - check if personas exist when enabling
  const handleStyleToggle = async () => {
    if (!usePersonaStyle) {
      // Trying to enable style - check if personas available
      const hasPersonas = await checkPersonasAvailable()
      if (!hasPersonas) {
        setShowNoPersonasModal(true)
        return
      }
      // If no persona selected yet, prompt to select one
      if (!personaSelection?.primaryPersonaId) {
        setShowPersonaManager(true)
        return
      }
    }
    setUsePersonaStyle(!usePersonaStyle)
  }

  // Generate claims using jurisdiction-aware rules
  const handleGenerateClaims = async () => {
    if (!session?.id) return
    
    try {
      setIsGeneratingClaims(true)
      setError(null)

      const response = await onComplete({
        action: 'generate_claims',
        sessionId: session.id,
        jurisdiction: activeJurisdiction,
        userInstructions: regenerateInstructions.trim() || undefined,
        userClaimRemarks: userClaimRemarks.trim() || undefined, // User remarks for claim drafting
        // Pass persona style settings for claims generation
        usePersonaStyle,
        personaSelection,
        ideaContext: {
          title,
          problem,
          objectives,
          logic,
          components,
          bestMethod,
          abstract: abstractText
        }
      })

      if (response?.error) {
        throw new Error(response.error)
      }

      if (!response) {
        throw new Error('No response received while generating claims.')
      }

      const responseClaims = Array.isArray(response.claims) ? response.claims : []
      const responseClaimsHtml = typeof response.claimsHtml === 'string' ? response.claimsHtml.trim() : ''

      if (responseClaims.length > 0) {
        setClaims(responseClaims)
        if (responseClaimsHtml) {
          setClaimsText(responseClaimsHtml)
        } else {
          const formatted = responseClaims
            .map((c: Claim) => `<p><strong>${c.number}.</strong> ${c.text}</p>`)
            .join('\n')
          setClaimsText(formatted)
        }
      } else if (responseClaimsHtml) {
        setClaims(parseClaimsFromHtml(responseClaimsHtml))
        setClaimsText(responseClaimsHtml)
      } else {
        throw new Error('No claims were returned. Please try again.')
      }
      
      // Update patent type from response (decided during claim generation)
      if (response?.patentType) {
        setPatentType(response.patentType as any)
      }

      await onRefresh()
      // Clear instructions after successful regeneration
      setRegenerateInstructions('')
    } catch (e) {
      console.error('Failed to generate claims:', e)
      setError('Failed to generate claims. Please try again.')
    } finally {
      setIsGeneratingClaims(false)
    }
  }

  // Handle patent type manual override
  const handleUpdatePatentType = async (newType: 'PRODUCT' | 'SYSTEM' | 'PROCESS' | 'COMPOSITION') => {
    if (!session?.id || newType === patentType) return
    
    try {
      setIsUpdatingPatentType(true)
      setError(null)
      
      await onComplete({
        action: 'update_patent_type',
        sessionId: session.id,
        patentType: newType
      })
      
      setPatentType(newType)
      setShowPatentTypeDropdown(false)
      await onRefresh()
    } catch (e) {
      console.error('Failed to update patent type:', e)
      setError('Failed to update patent type. Please try again.')
    } finally {
      setIsUpdatingPatentType(false)
    }
  }

  // Save claims (without freezing)
  const handleSaveClaims = async () => {
    if (!session?.id) return

    try {
      setError(null)
      const claimsContent = claimsEditorRef.current?.getHTML() || claimsText
      
      // CRITICAL: Parse HTML content into structured claims to ensure manual edits are captured
      // This fixes the bug where manual edits in the editor weren't propagated to ClaimRefinementStage
      const parsedFromHtml = parseClaimsFromHtml(claimsContent)
      // Use parsed claims if available, otherwise fall back to existing structured claims
      const structuredToSave = parsedFromHtml.length > 0 ? parsedFromHtml : (claims.length > 0 ? claims : null)

      await onComplete({
        action: 'save_claims',
        sessionId: session.id,
        claims: claimsContent,
        claimsStructured: structuredToSave
      })

      await onRefresh()
      setDraftSaved(true)
    } catch (e) {
      console.error('Failed to save claims:', e)
      setError('Failed to save claims.')
    }
  }

  // Done Editing: Save claims and exit edit mode (unified handler for top and bottom buttons)
  const handleDoneEditing = async () => {
    if (!session?.id) return
    
    try {
      setError(null)
      const claimsContent = claimsEditorRef.current?.getHTML() || claimsText
      
      // Parse HTML content into structured claims to ensure manual edits are captured
      const parsedFromHtml = parseClaimsFromHtml(claimsContent)
      const structuredToSave = parsedFromHtml.length > 0 ? parsedFromHtml : (claims.length > 0 ? claims : null)

      await onComplete({
        action: 'save_claims',
        sessionId: session.id,
        claims: claimsContent,
        claimsStructured: structuredToSave
      })

      await onRefresh()
      setDraftSaved(true)
      setIsEditingClaims(false) // Exit edit mode after saving
    } catch (e) {
      console.error('Failed to save claims:', e)
      setError('Failed to save claims.')
    }
  }

  // Freeze/approve claims
  const handleFreezeClaims = async () => {
    if (!session?.id) return

    try {
      setError(null)
      const claimsContent = claimsEditorRef.current?.getHTML() || claimsText

      if (!claimsContent || claimsContent.trim() === '' || claimsContent === '<p></p>') {
        setError('Please generate or enter claims before freezing.')
        return
      }

      // CRITICAL: Parse HTML content into structured claims to ensure manual edits are captured
      const parsedFromHtml = parseClaimsFromHtml(claimsContent)
      const structuredToSave = parsedFromHtml.length > 0 ? parsedFromHtml : (claims.length > 0 ? claims : null)

      await onComplete({
        action: 'freeze_claims',
        sessionId: session.id,
        claims: claimsContent,
        claimsStructured: structuredToSave,
        jurisdiction: activeJurisdiction
      })

      setClaimsFrozen(true)
      setClaimsFrozenAt(new Date().toISOString())
      await onRefresh()
    } catch (e) {
      console.error('Failed to freeze claims:', e)
      setError('Failed to freeze claims.')
    }
  }

  // Unfreeze claims for editing
  const handleUnfreezeClaims = async () => {
    if (!session?.id) return

    try {
      setError(null)
      await onComplete({
        action: 'unfreeze_claims',
        sessionId: session.id
      })

      setClaimsFrozen(false)
      setClaimsFrozenAt(null)
      await onRefresh()
    } catch (e) {
      console.error('Failed to unfreeze claims:', e)
      setError('Failed to unfreeze claims.')
    }
  }

  const persistClaimsDraft = async () => {
    if (!session?.id) return
    const claimsContent = claimsEditorRef.current?.getHTML() || claimsText
    if (!claimsContent || claimsContent.trim() === '' || claimsContent === '<p></p>') {
      throw new Error('Please add claims before continuing.')
    }
    // CRITICAL: Parse HTML content into structured claims to ensure manual edits are captured
    const parsedFromHtml = parseClaimsFromHtml(claimsContent)
    const structuredToSave = parsedFromHtml.length > 0 ? parsedFromHtml : (claims.length > 0 ? claims : null)
    await onComplete({
      action: 'save_claims',
      sessionId: session.id,
      claims: claimsContent,
      claimsStructured: structuredToSave
    })
  }

  const proceedToPriorArt = async () => {
    if (!session?.id) return
    try {
      setIsNavigating(true)
      setError(null)
      if (!claimsFrozen) {
        await persistClaimsDraft()
      }
      await onComplete({
        action: 'set_stage',
        sessionId: session.id,
        stage: 'RELATED_ART'
      })
      await onRefresh()
    } catch (e) {
      console.error('Failed to proceed to prior art:', e)
      setError(e instanceof Error ? e.message : 'Failed to proceed to prior art')
    } finally {
      setIsNavigating(false)
    }
  }

  const handleSkipClick = () => {
    setSkipPriorArtClicked(true)
  }

  const skipPriorArtAndFreeze = async () => {
    if (!session?.id) return
    try {
      setIsNavigating(true)
      setError(null)
      if (!claimsFrozen) {
        await persistClaimsDraft()
      }
      await onComplete({
        action: 'set_stage',
        sessionId: session.id,
        stage: 'COMPONENT_PLANNER',
        skipPriorArt: true,
        useInitialClaimsForDrafting: useInitialClaimsForDraft
      })
      await onRefresh()
    } catch (e) {
      console.error('Failed to skip prior art:', e)
      setError(e instanceof Error ? e.message : 'Failed to skip prior art')
    } finally {
      setIsNavigating(false)
    }
  }

  return (
    <div className="px-6 py-8 max-w-[1400px] mx-auto">
      {/* Header with Jurisdiction Badge */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
              <div className="p-2 bg-indigo-100 rounded-lg">
                <Lightbulb className="w-6 h-6 text-indigo-600" />
              </div>
              Idea & Claims Review
            </h2>
            <p className="text-gray-500 mt-2">
              Review your invention structure and generate jurisdiction-aware patent claims.
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            {/* Mode indicator */}
            <Badge variant={allowRefine ? 'default' : 'secondary'} className="flex items-center gap-1.5 px-3 py-1.5">
              {allowRefine ? (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  Kisho Enhanced
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
              Complete each stage sequentially for best results: <span className="font-medium">Idea → Prior Art → Claims → Components → Figures → Draft</span>
            </p>
            {/* Experimental Data Notice */}
            <p className="text-xs text-amber-700 leading-relaxed">
              <strong>About Experimental Data:</strong> This stage extracts the invention structure. Experimental data and test results will be handled in the <strong>Drafting Stage</strong>.
            </p>
          </div>
        </div>
      </div>

      {(!showNormalized || !normalizedData) && (
        <KishoNormalizationLoader mode={allowRefine ? 'enhance' : 'preserve'} />
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Left Column: Invention Details */}
        <div className="space-y-4">
          {/* Collapsible Original Input */}
          <div className="border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm">
            <button 
              onClick={() => setShowOriginal(!showOriginal)} 
              className="w-full flex justify-between items-center px-5 py-3 bg-gray-50/50 hover:bg-gray-50 transition-colors text-left"
            >
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-gray-400" />
                <span className="text-sm font-medium text-gray-700">Original Input Reference</span>
              </div>
              {showOriginal ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
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
                  <div className="p-5 border-t border-gray-100 bg-gray-50/30">
                    <div className="mb-4">
                      <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 block mb-1">Title</span>
                      <p className="text-sm text-gray-900 font-medium">{title}</p>
                    </div>
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 block mb-1">Description</span>
                      <div className="bg-white p-4 rounded border border-gray-200 text-sm text-gray-600 whitespace-pre-wrap font-mono leading-relaxed max-h-60 overflow-y-auto">
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
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <button
                onClick={() => setShowInventionDetails(!showInventionDetails)}
                className="w-full flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-white to-indigo-50/30 hover:bg-indigo-50/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-full bg-indigo-100 flex items-center justify-center">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                  </div>
                  <h3 className="text-sm font-semibold text-gray-900">
                    Invention Structure
                  </h3>
                  <Badge variant="secondary" className="text-xs">
                    {allowRefine ? 'AI Enhanced' : 'Parsed'}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  {!showInventionDetails && (
                    <span className="text-xs text-gray-500">Click to expand</span>
                  )}
                  {showInventionDetails ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
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
                    <div className="flex items-center justify-end px-6 py-2 border-b border-gray-100 bg-gray-50/50">
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => setIsEditing((v) => !v)}
                          className={`inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${isEditing ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100 bg-white border border-gray-200'}`}
                        >
                          {isEditing ? <><Check className="w-3 h-3 mr-1" /> Done</> : <><Edit2 className="w-3 h-3 mr-1" /> Edit</>}
                        </button>
                        <button
                          onClick={async () => {
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
                              setShowNormalized(false)
                              setNormalizedData(null)
                              await onComplete({
                                action: 'normalize_idea',
                                sessionId: session.id,
                                rawIdea: currentRaw,
                                title: currentTitle
                              })
                              await onRefresh()
                              setShowNormalized(true)
                            } catch (e) {
                              setError('Failed to regenerate AI output. Please try again.')
                            } finally {
                              setIsRegenerating(false)
                            }
                          }}
                          className="inline-flex items-center px-2 py-1.5 text-xs font-medium rounded-md text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-60"
                          disabled={isRegenerating}
                          title="Regenerate AI Structure"
                        >
                          <RefreshCw className={`w-3 h-3 ${isRegenerating ? 'animate-spin' : ''}`} />
                        </button>
                      </div>
                    </div>

                    <div className="p-6 space-y-6 max-h-[600px] overflow-y-auto">
                      {/* Experimental Data Reminder */}
                      <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-md text-xs text-blue-700">
                        <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>
                          <strong>Tip:</strong> Experimental data, measurements, or test results can be added in the Drafting Stage → Detailed Description section.
                        </span>
                      </div>

                      {/* Classification Codes */}
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">CPC Codes</label>
                          {isEditing ? (
                            <input
                              className="w-full text-sm border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                              placeholder="e.g., H04L 29/08"
                              value={cpcCodes.join(', ')}
                              onChange={(e) => setCpcCodes(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                            />
                          ) : (
                            <div className="text-sm font-mono bg-gray-50 px-3 py-1.5 rounded border border-gray-100 text-gray-700">
                              {cpcCodes?.length ? cpcCodes.join(', ') : <span className="text-gray-400">None</span>}
                            </div>
                          )}
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">IPC Codes</label>
                          {isEditing ? (
                            <input
                              className="w-full text-sm border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                              placeholder="e.g., G06F 17/30"
                              value={ipcCodes.join(', ')}
                              onChange={(e) => setIpcCodes(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                            />
                          ) : (
                            <div className="text-sm font-mono bg-gray-50 px-3 py-1.5 rounded border border-gray-100 text-gray-700">
                              {ipcCodes?.length ? ipcCodes.join(', ') : <span className="text-gray-400">None</span>}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Problem Statement */}
                      <div>
                        <h4 className="text-sm font-medium text-gray-900 mb-1.5">Problem Statement</h4>
                        {isEditing ? (
                          <textarea
                            className="w-full text-sm border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                            rows={3}
                            value={problem}
                            onChange={(e) => setProblem(e.target.value)}
                          />
                        ) : (
                          <div className="text-sm text-gray-700 leading-relaxed bg-gray-50 p-3 rounded border border-gray-100">
                            {problem || <span className="text-gray-400 italic">Not specified</span>}
                          </div>
                        )}
                      </div>

                      {/* Objectives */}
                      <div>
                        <h4 className="text-sm font-medium text-gray-900 mb-1.5">Objectives</h4>
                        {isEditing ? (
                          <textarea
                            className="w-full text-sm border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                            rows={2}
                            value={objectives}
                            onChange={(e) => setObjectives(e.target.value)}
                          />
                        ) : (
                          <div className="text-sm text-gray-700 leading-relaxed bg-gray-50 p-3 rounded border border-gray-100">
                            {objectives || <span className="text-gray-400 italic">Not specified</span>}
                          </div>
                        )}
                      </div>

                      {/* Technical Logic */}
                      <div>
                        <h4 className="text-sm font-medium text-gray-900 mb-1.5">Technical Logic</h4>
                        {isEditing ? (
                          <textarea
                            className="w-full text-sm border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                            rows={3}
                            value={logic}
                            onChange={(e) => setLogic(e.target.value)}
                          />
                        ) : (
                          <div className="text-sm text-gray-700 leading-relaxed bg-gray-50 p-3 rounded border border-gray-100">
                            {logic || <span className="text-gray-400 italic">Not specified</span>}
                          </div>
                        )}
                      </div>

                      {/* Key Components - Editable */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <h4 className="text-sm font-medium text-gray-900">
                            Key Components <span className="text-gray-400 font-normal text-xs">({components?.length || 0})</span>
                          </h4>
                          {isEditing && (
                            <button
                              onClick={() => setComponents([...(components || []), { name: '', type: 'OTHER', description: '' }])}
                              className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                            >
                              <span className="text-lg leading-none">+</span> Add Component
                            </button>
                          )}
                        </div>
                        
                        {isEditing ? (
                          // Editable components list
                          <div className="space-y-2 max-h-[400px] overflow-y-auto">
                            {components?.length > 0 ? (
                              components.map((comp: any, idx: number) => (
                                <div key={idx} className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-2">
                                  <div className="flex items-start gap-2">
                                    <div className="flex-1 space-y-2">
                                      {/* Component Name */}
                                      <div>
                                        <label className="block text-[10px] font-medium text-gray-500 mb-0.5">
                                          Name {!(comp.name?.trim()) && <span className="text-red-500">*</span>}
                                        </label>
                                        <input
                                          type="text"
                                          value={comp.name || ''}
                                          onChange={(e) => {
                                            const updated = [...(components || [])]
                                            updated[idx] = { ...updated[idx], name: e.target.value }
                                            setComponents(updated)
                                          }}
                                          className={`w-full px-2 py-1.5 text-sm border rounded-md focus:ring-indigo-500 focus:border-indigo-500 ${
                                            !(comp.name?.trim()) ? 'border-red-300 bg-red-50' : 'border-gray-300'
                                          }`}
                                          placeholder="Component name (required)"
                                        />
                                        {!(comp.name?.trim()) && (
                                          <p className="text-[10px] text-red-500 mt-0.5">Empty names will be removed on save</p>
                                        )}
                                      </div>
                                      
                                      {/* Component Type */}
                                      <div>
                                        <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Type</label>
                                        <select
                                          value={comp.type || 'OTHER'}
                                          onChange={(e) => {
                                            const updated = [...(components || [])]
                                            updated[idx] = { ...updated[idx], type: e.target.value }
                                            setComponents(updated)
                                          }}
                                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                                        >
                                          <option value="MAIN_CONTROLLER">Main Controller</option>
                                          <option value="SUBSYSTEM">Subsystem</option>
                                          <option value="MODULE">Module</option>
                                          <option value="INTERFACE">Interface</option>
                                          <option value="SENSOR">Sensor</option>
                                          <option value="ACTUATOR">Actuator</option>
                                          <option value="PROCESSOR">Processor</option>
                                          <option value="MEMORY">Memory</option>
                                          <option value="DISPLAY">Display</option>
                                          <option value="COMMUNICATION">Communication</option>
                                          <option value="POWER_SUPPLY">Power Supply</option>
                                          <option value="OTHER">Other</option>
                                        </select>
                                      </div>
                                      
                                      {/* Component Description */}
                                      <div>
                                        <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Description</label>
                                        <textarea
                                          value={comp.description || ''}
                                          onChange={(e) => {
                                            const updated = [...(components || [])]
                                            updated[idx] = { ...updated[idx], description: e.target.value }
                                            setComponents(updated)
                                          }}
                                          rows={2}
                                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                                          placeholder="Technical role/function"
                                        />
                                      </div>
                                    </div>
                                    
                                    {/* Remove Button */}
                                    <button
                                      onClick={() => {
                                        const updated = (components || []).filter((_, i) => i !== idx)
                                        setComponents(updated)
                                      }}
                                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                      title="Remove component"
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                    </button>
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="text-center py-4 text-sm text-gray-500">
                                No components. Click "Add Component" to add one.
                              </div>
                            )}
                          </div>
                        ) : (
                          // Read-only display
                          components?.length > 0 ? (
                            <div className="grid grid-cols-2 gap-2">
                              {components.slice(0, 6).map((comp: any, idx: number) => (
                                <div key={idx} className="p-2 bg-gray-50 rounded border border-gray-100 text-xs">
                                  <span className="font-medium text-gray-900">{comp.name}</span>
                                  {comp.type && (
                                    <span className="text-gray-500 ml-1">({comp.type})</span>
                                  )}
                                </div>
                              ))}
                              {components.length > 6 && (
                                <div className="p-2 text-xs text-gray-500">
                                  +{components.length - 6} more...
                                </div>
                              )}
                            </div>
                          ) : (
                            <p className="text-sm text-gray-500 italic">No components identified</p>
                          )
                        )}
                        
                        {/* Edit hint when not editing */}
                        {!isEditing && components?.length > 0 && (
                          <p className="text-[10px] text-gray-400 mt-2">
                            Click "Edit" above to rename, modify, or remove components
                          </p>
                        )}
                      </div>

                      {/* Best Method */}
                      <div>
                        <h4 className="text-sm font-medium text-gray-900 mb-1.5">Best Method</h4>
                        {isEditing ? (
                          <textarea
                            className="w-full text-sm border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                            rows={2}
                            value={bestMethod}
                            onChange={(e) => setBestMethod(e.target.value)}
                          />
                        ) : (
                          <div className="text-sm text-gray-700 leading-relaxed bg-gray-50 p-3 rounded border border-gray-100">
                            {bestMethod || <span className="text-gray-400 italic">Not specified</span>}
                          </div>
                        )}
                      </div>

                      {/* Search Query */}
                      <div className="pt-4 border-t border-gray-100">
                        <h4 className="text-sm font-medium text-gray-900 mb-1.5">Search Query</h4>
                        {isEditing ? (
                          <input
                            className="w-full text-sm font-mono bg-gray-50 border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                          />
                        ) : (
                          <div className="text-sm font-mono text-gray-600 bg-gray-50 p-3 rounded border border-gray-100">
                            {searchQuery || <span className="text-gray-400 italic">Not specified</span>}
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {/* Edit Actions Footer */}
                    {isEditing && (
                      <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex justify-end">
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
                                  searchQuery, abstract: abstractText, cpcCodes, ipcCodes
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

        {/* Right Column: Claims Section */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {/* Claims Header */}
            <button
              onClick={() => setShowClaimsDetails(!showClaimsDetails)}
              className="w-full flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-white to-indigo-50/30 hover:bg-indigo-50/30 transition-colors"
            >
              <div className="flex items-center gap-2">
                <div className="h-6 w-6 rounded-full bg-indigo-100 flex items-center justify-center">
                  <Scale className="w-3.5 h-3.5 text-indigo-600" />
                </div>
                <h3 className="text-sm font-semibold text-gray-900">
                  Initial Patent Claims
                </h3>
                <Badge variant="secondary" className="text-xs">
                  {activeJurisdiction} Rules
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                {!showClaimsDetails && (
                  <span className="text-xs text-gray-500">Click to expand</span>
                )}
                {showClaimsDetails ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
              </div>
            </button>

            {/* Patent Type Badge + Persona Style Controls */}
            {showClaimsDetails && (
              <div className="px-6 py-3 bg-gradient-to-r from-indigo-50/50 to-violet-50/50 border-b border-indigo-100">
                {/* Row 1: Patent Type (editable with dropdown) */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-600">Invention Type:</span>
                    <div className="relative" data-patent-type-dropdown>
                      <Tooltip content="Click to change the invention type if the AI classification is incorrect" position="bottom">
                        <button
                          onClick={() => setShowPatentTypeDropdown(!showPatentTypeDropdown)}
                          disabled={isUpdatingPatentType || claimsFrozen}
                          className={`text-xs font-bold px-2.5 py-1 rounded-md flex items-center gap-1.5 transition-all ${
                            isUpdatingPatentType ? 'opacity-50 cursor-wait' :
                            claimsFrozen ? 'cursor-not-allowed opacity-70' :
                            'cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-indigo-300'
                          } ${
                            patentType === 'PRODUCT' ? 'bg-blue-100 text-blue-800 border border-blue-200' :
                            patentType === 'SYSTEM' ? 'bg-purple-100 text-purple-800 border border-purple-200' :
                            patentType === 'PROCESS' ? 'bg-green-100 text-green-800 border border-green-200' :
                            patentType === 'COMPOSITION' ? 'bg-amber-100 text-amber-800 border border-amber-200' :
                            'bg-gray-100 text-gray-600 border border-gray-200'
                          }`}
                        >
                          {isUpdatingPatentType ? (
                            <RefreshCw className="w-3 h-3 animate-spin" />
                          ) : (
                            patentType || 'Not classified'
                          )}
                          {!claimsFrozen && !isUpdatingPatentType && (
                            <ChevronDown className={`w-3 h-3 transition-transform ${showPatentTypeDropdown ? 'rotate-180' : ''}`} />
                          )}
                        </button>
                      </Tooltip>
                      
                      {/* Dropdown Menu */}
                      <AnimatePresence>
                        {showPatentTypeDropdown && !claimsFrozen && (
                          <motion.div
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            transition={{ duration: 0.15 }}
                            className="absolute left-0 top-full mt-1 z-50 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[160px]"
                          >
                            {(['PRODUCT', 'SYSTEM', 'PROCESS', 'COMPOSITION'] as const).map((type) => (
                              <button
                                key={type}
                                onClick={() => handleUpdatePatentType(type)}
                                disabled={isUpdatingPatentType}
                                className={`w-full px-3 py-2 text-left text-xs font-medium flex items-center gap-2 transition-colors ${
                                  patentType === type 
                                    ? 'bg-indigo-50 text-indigo-700' 
                                    : 'hover:bg-gray-50 text-gray-700'
                                }`}
                              >
                                <span className={`w-2 h-2 rounded-full ${
                                  type === 'PRODUCT' ? 'bg-blue-500' :
                                  type === 'SYSTEM' ? 'bg-purple-500' :
                                  type === 'PROCESS' ? 'bg-green-500' :
                                  'bg-amber-500'
                                }`} />
                                <span>{type}</span>
                                {patentType === type && (
                                  <Check className="w-3 h-3 ml-auto text-indigo-600" />
                                )}
                              </button>
                            ))}
                            <div className="border-t border-gray-100 mt-1 pt-1 px-3 py-2">
                              <p className="text-[10px] text-gray-500 leading-relaxed">
                                <strong>PRODUCT:</strong> Single device/article<br/>
                                <strong>SYSTEM:</strong> Multi-component setup<br/>
                                <strong>PROCESS:</strong> Method/steps<br/>
                                <strong>COMPOSITION:</strong> Chemical/material
                              </p>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                    {!patentType && normalizedData && (
                      <span className="text-[10px] text-gray-400">(Classifying...)</span>
                    )}
                  </div>
                  {!claimsFrozen && (
                    <span className="text-[10px] text-gray-400">Click to override</span>
                  )}
                </div>
                
                {/* Row 2: Writing Style Controls */}
                <div className="flex items-center justify-between">
                  <div className="text-xs text-gray-600">
                    <span className="font-medium">Writing Style:</span> {usePersonaStyle 
                      ? (personaSelection?.primaryPersonaName || 'Enabled') 
                      : 'Off (default style)'}
                  </div>
                <div className="flex items-center gap-2">
                  <Tooltip content={usePersonaStyle 
                    ? "Persona style is ON - Claims will be generated using your selected writing style"
                    : "Enable to generate claims in your preferred writing style"
                  } position="bottom">
                    <div
                      onClick={handleStyleToggle}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                        checkingPersonas ? 'opacity-50 cursor-wait' : ''
                      } ${
                        usePersonaStyle 
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-700' 
                          : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                      }`}
                    >
                      <span className="text-sm">{checkingPersonas ? '...' : usePersonaStyle ? '✓' : '○'}</span>
                      <span className="text-xs font-medium">Style</span>
                    </div>
                  </Tooltip>

                  <Tooltip content="Select a writing persona (e.g., CSE, Bio, Chemistry) for your claims" position="bottom">
                    <button
                      onClick={handlePersonaButtonClick}
                      disabled={checkingPersonas}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${
                        checkingPersonas ? 'opacity-50 cursor-wait' : ''
                      } ${
                        personaSelection?.primaryPersonaName
                          ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <span>👤</span>
                      <span className="font-medium">
                        {checkingPersonas ? 'Checking...' : personaSelection?.primaryPersonaName || 'Persona'}
                      </span>
                      {personaSelection?.secondaryPersonaNames?.length ? (
                        <span className="text-[10px] bg-indigo-200 text-indigo-700 px-1 rounded">
                          +{personaSelection.secondaryPersonaNames.length}
                        </span>
                      ) : null}
                    </button>
                  </Tooltip>
                </div>
                </div>
              </div>
            )}

            <AnimatePresence>
              {showClaimsDetails && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  {/* Claims Status Banner */}
                  {!claimsFrozen && (
                    <div className="px-6 py-3 bg-amber-50 border-b border-amber-100">
                      <div className="flex items-center gap-2 text-sm text-amber-800">
                        <AlertCircle className="w-4 h-4" />
                        <span>Claims must be frozen before proceeding. They will be used throughout the drafting pipeline.</span>
                      </div>
                    </div>
                  )}

                  {claimsFrozen && claimsFrozenAt && (
                    <div className="px-6 py-3 bg-green-50 border-b border-green-100">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm text-green-800">
                          <Check className="w-4 h-4" />
                          <span>Claims frozen on {new Date(claimsFrozenAt).toLocaleDateString()}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleUnfreezeClaims}
                          className="text-amber-700 hover:text-amber-800 hover:bg-amber-50"
                        >
                          <Unlock className="w-3 h-3 mr-1" />
                          Unfreeze to Edit
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Multi-Jurisdiction Notice */}
                  {allJurisdictions.length > 1 && (
                    <div className="px-6 py-3 bg-blue-50 border-b border-blue-100">
                      <div className="flex items-start gap-2 text-sm text-blue-800">
                        <Globe className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <div>
                          <span className="font-medium">Multi-Jurisdiction Filing:</span>{' '}
                          <span>These reference claims are generated for initial review using {activeJurisdiction} rules. Jurisdiction-specific claims will be drafted one-by-one during the drafting stage.</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Claims Editor */}
                  <div className="p-6">
                    {!claimsText && !isGeneratingClaims ? (
                      <div className="py-6">
                        <div className="text-center mb-6">
                          <Scale className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                          <p className="text-gray-600">No claims generated yet.</p>
                        </div>
                        
                        {/* User Remarks Textarea */}
                        <div className="max-w-lg mx-auto mb-6">
                          <div className="flex items-center gap-2 mb-2">
                            <Lightbulb className="w-4 h-4 text-amber-500" />
                            <span className="text-sm text-gray-600">
                              Add remarks to guide claim drafting (optional)
                            </span>
                          </div>
                          <textarea
                            value={userClaimRemarks}
                            onChange={(e) => setUserClaimRemarks(e.target.value)}
                            placeholder="Any specific emphasis, exclusions, embodiments, or scope preferences for claim drafting?"
                            className="w-full px-4 py-3 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 resize-none"
                            rows={3}
                          />
                          <p className="text-[11px] text-gray-400 mt-1">
                            These remarks influence scope and emphasis, not the patent type.
                          </p>
                        </div>
                        
                        <div className="text-center">
                          <Button
                            onClick={handleGenerateClaims}
                            className="bg-amber-600 hover:bg-amber-700 text-white"
                            disabled={!normalizedData}
                          >
                            <Sparkles className="w-4 h-4 mr-2" />
                            Generate Claims for {activeJurisdiction}
                          </Button>
                          <p className="text-xs text-gray-500 mt-3">
                            Claims will be generated using {activeJurisdiction} patent office rules
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {isGeneratingClaims ? (
                          <div className="flex items-center justify-center py-12">
                            <div className="text-center">
                              <RefreshCw className="w-8 h-8 text-amber-600 animate-spin mx-auto mb-3" />
                              <p className="text-sm text-gray-600">Generating jurisdiction-aware claims...</p>
                              <p className="text-xs text-gray-500 mt-1">Applying {activeJurisdiction} rules</p>
                            </div>
                          </div>
                        ) : (
                          <>
                            {/* Edit Mode Header */}
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-gray-700">
                                  {isEditingClaims ? 'Editing Claims' : 'Generated Claims'}
                                </span>
                                {isEditingClaims && (
                                  <Badge variant="secondary" className="bg-blue-100 text-blue-700 text-xs">
                                    <Edit2 className="w-3 h-3 mr-1" />
                                    Edit Mode
                                  </Badge>
                                )}
                              </div>
                              
                              {/* Edit Toggle Button */}
                              {!claimsFrozen && (
                                <div className="flex items-center gap-2">
                                  {!isEditingClaims ? (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => setIsEditingClaims(true)}
                                      className="text-indigo-600 border-indigo-200 hover:bg-indigo-50"
                                    >
                                      <Edit2 className="w-3.5 h-3.5 mr-1.5" />
                                      Edit Claims
                                    </Button>
                                  ) : (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={handleDoneEditing}
                                      className="text-green-600 border-green-200 hover:bg-green-50"
                                    >
                                      <Check className="w-3.5 h-3.5 mr-1.5" />
                                      Done Editing
                                    </Button>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Claims Display/Editor */}
                            {isEditingClaims ? (
                              <div className="border-2 border-indigo-200 rounded-lg bg-indigo-50/30">
                                <div className="px-3 py-2 bg-indigo-100 border-b border-indigo-200 text-xs text-indigo-700 flex items-center gap-2">
                                  <Edit2 className="w-3 h-3" />
                                  <span>Make your changes below. Click "Done Editing" when finished to save your changes.</span>
                                </div>
                                <div className="p-1">
                                  <ClaimsEditor
                                    ref={claimsEditorRef}
                                    value={claimsText}
                                    onChange={setClaimsText}
                                    disabled={claimsFrozen}
                                    placeholder="1. A method for... comprising:
   a) a first step of...
   b) a second step of...

2. The method of claim 1, wherein..."
                                  />
                                </div>
                              </div>
                            ) : (
                              <div 
                                className="border border-gray-200 rounded-lg bg-gray-50/50 cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/20 transition-colors group"
                                onClick={() => !claimsFrozen && setIsEditingClaims(true)}
                              >
                                {/* Match ClaimsEditor styling: prose prose-sm with text-gray-700 leading-relaxed */}
                                <div className="px-4 py-3 prose prose-sm max-w-none text-gray-700 leading-relaxed [&>p]:mb-3 [&>p:last-child]:mb-0">
                                  <div 
                                    dangerouslySetInnerHTML={{ __html: claimsText }} 
                                  />
                                </div>
                                {!claimsFrozen && (
                                  <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 text-xs text-gray-500 flex items-center gap-1 group-hover:text-indigo-600 group-hover:bg-indigo-50 transition-colors">
                                    <Edit2 className="w-3 h-3" />
                                    Click to edit claims
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Action Buttons */}
                            <div className="flex flex-col gap-3 pt-4 border-t border-gray-100">
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={regenerateInstructions}
                                  onChange={(e) => setRegenerateInstructions(e.target.value)}
                                  placeholder="Enter instructions for claim regeneration (optional)"
                                  className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                  disabled={claimsFrozen || isGeneratingClaims}
                                />
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={handleGenerateClaims}
                                  disabled={claimsFrozen || isGeneratingClaims}
                                >
                                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                                  Regenerate
                                </Button>
                              </div>

                              <div className="flex items-center gap-2">
                                {!claimsFrozen && (
                                  <>
                                    {isEditingClaims && (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={handleDoneEditing}
                                        className={draftSaved ? "bg-green-50 border-green-200 text-green-700" : "text-green-600 border-green-200 hover:bg-green-50"}
                                      >
                                        {draftSaved ? (
                                          <>
                                            <Check className="w-3.5 h-3.5 mr-1.5 text-green-600" />
                                            Saved!
                                          </>
                                        ) : (
                                          <>
                                            <Check className="w-3.5 h-3.5 mr-1.5" />
                                            Done Editing
                                          </>
                                        )}
                                      </Button>
                                    )}
                                    <Button
                                      size="sm"
                                      onClick={handleFreezeClaims}
                                      className="bg-green-600 hover:bg-green-700 text-white"
                                    >
                                      <Lock className="w-3.5 h-3.5 mr-1.5" />
                                      Freeze Initial Claims
                                    </Button>
                                  </>
                                )}
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Info Box */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-blue-900 mb-2">Why freeze claims?</h4>
            <ul className="text-xs text-blue-800 space-y-1">
              <li>• Claims define the legal scope of your patent protection</li>
              <li>• Frozen claims will be used in Figure Planner for relevant diagrams</li>
              <li>• Prior Art analysis will compare patents against your specific claims</li>
              <li>• Final draft will use these exact claims (no regeneration)</li>
              <li>• Multi-jurisdiction support: claims transform to country-specific style</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="mt-10 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2 text-sm text-amber-700">
            <AlertCircle className="w-4 h-4" />
            <span>
              {claimsFrozen ? 'Claims are frozen; you can still proceed or unfreeze to edit.' : 'Claims are provisional; you can continue to prior art or skip and freeze them as final.'}
            </span>
          </div>
          <div className="flex items-center gap-3 flex-wrap justify-end">
            {skipPriorArtClicked ? (
              <>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={useInitialClaimsForDraft}
                    onChange={(e) => setUseInitialClaimsForDraft(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  Use Initial Claims for drafting
                </label>
                <Button
                  onClick={skipPriorArtAndFreeze}
                  disabled={!canProceed || isNavigating}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  Next
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </>
            ) : (
              <>
                <Button
                  onClick={handleSkipClick}
                  disabled={!canProceed || isNavigating}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  Skip Prior Art Stage
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
                <Button
                  variant="outline"
                  onClick={proceedToPriorArt}
                  disabled={!canProceed || isNavigating}
                >
                  Next: Prior Art
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Persona Manager Modal */}
      {showPersonaManager && (
        <PersonaManager
          isOpen={showPersonaManager}
          onClose={() => setShowPersonaManager(false)}
          showSelector={true}
          currentSelection={personaSelection}
          onSelectPersona={(selection) => {
            setPersonaSelection(selection)
            if (selection.primaryPersonaId) {
              setUsePersonaStyle(true) // Auto-enable style when persona selected
            }
          }}
        />
      )}

      {/* No Personas Available Modal */}
      {showNoPersonasModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            {/* Header */}
            <div className="p-6 border-b border-gray-100 bg-gradient-to-r from-indigo-50 to-violet-50">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-amber-100 rounded-xl">
                  <AlertCircle className="w-6 h-6 text-amber-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">No Writing Personas Available</h3>
                  <p className="text-sm text-gray-500 mt-0.5">Create a persona to use your own writing style</p>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600">
                Writing personas allow the AI to mimic your preferred drafting style, terminology, and structure 
                when generating claims and other patent sections.
              </p>

              <div className="space-y-3">
                {/* Option 1: Create your own persona */}
                <div className="p-4 bg-indigo-50 rounded-lg border border-indigo-100">
                  <div className="flex items-start gap-3">
                    <span className="text-lg">✍️</span>
                    <div>
                      <h4 className="font-medium text-indigo-900">Create Your Own Persona</h4>
                      <p className="text-sm text-indigo-700 mt-1">
                        Go to <strong>Personas</strong> page from the main navigation to create your personal writing style.
                      </p>
                      <a 
                        href="/personas" 
                        className="inline-flex items-center gap-1 mt-2 text-sm font-medium text-indigo-600 hover:text-indigo-800"
                      >
                        Open Personas Page
                        <ChevronRight className="w-4 h-4" />
                      </a>
                    </div>
                  </div>
                </div>

                {/* Option 2: Use organizational personas (if not admin) */}
                {!isAdmin && (
                  <div className="p-4 bg-purple-50 rounded-lg border border-purple-100">
                    <div className="flex items-start gap-3">
                      <span className="text-lg">🏢</span>
                      <div>
                        <h4 className="font-medium text-purple-900">Use Organization Personas</h4>
                        <p className="text-sm text-purple-700 mt-1">
                          Contact your Administrator (OWNER or ADMIN) to create shared organization personas 
                          that all team members can use.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Admin-specific guidance */}
                {isAdmin && (
                  <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-100">
                    <div className="flex items-start gap-3">
                      <span className="text-lg">👑</span>
                      <div>
                        <h4 className="font-medium text-emerald-900">Create Organization Personas</h4>
                        <p className="text-sm text-emerald-700 mt-1">
                          As an Admin, you can create <strong>Organization</strong> personas that will be 
                          available to all users in your organization. Set visibility to "Organization" when creating.
                        </p>
                        <a 
                          href="/personas" 
                          className="inline-flex items-center gap-1 mt-2 text-sm font-medium text-emerald-600 hover:text-emerald-800"
                        >
                          Create Organization Persona
                          <ChevronRight className="w-4 h-4" />
                        </a>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => setShowNoPersonasModal(false)}
              >
                Close
              </Button>
              <Button
                onClick={() => {
                  setShowNoPersonasModal(false)
                  window.location.href = '/personas'
                }}
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                Go to Personas Page
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
