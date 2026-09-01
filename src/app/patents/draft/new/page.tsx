'use client'

import { useState, useEffect, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { defaultLanguageForJurisdiction } from '@/lib/jurisdiction-language'
import Link from 'next/link'
import { Check, Image as ImageIcon, Loader2, Trash2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import Stage0PatentIntelligenceOverlay, {
  type Stage0PatentIntelligenceStatus
} from '@/components/ui/stage0-patent-intelligence-overlay'
import {
  MAX_DRAFTING_INPUT_CHARS,
  MAX_DRAFTING_UPLOAD_BYTES,
  MAX_DRAFTING_UPLOAD_MB
} from '@/lib/drafting-constants'
import { detectNumericResults } from '@/lib/supporting-data-detection'

const DRAFTING_INPUT_WARNING_CHARS = Math.floor(MAX_DRAFTING_INPUT_CHARS * 0.9)
const EXTRACTED_IMAGE_UPLOAD_MAX_BYTES = 25 * 1024 * 1024
const EXTERNAL_UPLOAD_ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/svg+xml',
])

type CountryOption = {
  code: string
  label: string
  description: string
  continent: string
  office: string
  applicationTypes: string[]
  languages: string[]
}

type SourceInputMeta = {
  originalFileName?: string
  mimeType?: string
  fileSize?: number
  detectedFormat?: string
  extractedCharCount?: number
  extractedImageCount?: number
  extractionHash?: string
  extractedAt?: string
}

type ExtractedDraftImage = {
  id: string
  fileName: string
  mimeType: string
  size: number
  dataUrl: string
  source: string
  label: string
  width?: number
  height?: number
}

type SelectableDraftImage = ExtractedDraftImage & {
  selected: boolean
  status: 'idle' | 'saving' | 'saved' | 'error'
  error?: string
}

const areLanguageMapsEqual = (a: Record<string, string>, b: Record<string, string>) => {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false
  }
  return true
}

// Language display names
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
  ru: 'Russian (Русский)',
  ar: 'Arabic (العربية)',
  it: 'Italian (Italiano)',
  nl: 'Dutch (Nederlands)',
  sv: 'Swedish (Svenska)',
}

function formatImageBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function dataUrlToBase64(dataUrl: string) {
  return dataUrl.split(',')[1] || ''
}

function dataUrlToFile(dataUrl: string, fileName: string, mimeType: string) {
  const base64 = dataUrlToBase64(dataUrl)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new File([bytes], fileName, { type: mimeType })
}

interface Project {
  id: string
  name: string
  applicantProfile?: {
    applicantLegalName: string
  }
}

function NewPatentDraftPageContent() {
  const { user, isLoading: authLoading, authFetch } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialProjectId = searchParams?.get('projectId') || ''
  const ideaId = searchParams?.get('ideaId') || ''
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedProject, setSelectedProject] = useState<string>(initialProjectId)
  const [patentTitle, setPatentTitle] = useState('')
  const [rawIdea, setRawIdea] = useState('')
  // Advisory only: points pharma/chem-style disclosures at the DD supporting-data panel
  const hasNumericResults = useMemo(() => detectNumericResults(rawIdea), [rawIdea])

  // Load content from URL params (for idea bank integration)
  useEffect(() => {
    const urlTitle = searchParams?.get('title')
    const urlRawIdea = searchParams?.get('rawIdea')
    if (urlTitle) setPatentTitle(urlTitle)
    if (urlRawIdea) setRawIdea(urlRawIdea)
  }, [searchParams])
  const [isCreating, setIsCreating] = useState(false)
  const [stage0OverlayStatus, setStage0OverlayStatus] = useState<Stage0PatentIntelligenceStatus | null>(null)
  const [stage0StartedAt, setStage0StartedAt] = useState<number | null>(null)
  const [stage0OverlayError, setStage0OverlayError] = useState<string | undefined>(undefined)
  const [draftCreationContext, setDraftCreationContext] = useState<{
    patentId?: string
    sessionId?: string
    jurisdictionPersisted?: boolean
  } | null>(null)
  const [isFileProcessing, setIsFileProcessing] = useState(false)
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)
  const [sourceInputMeta, setSourceInputMeta] = useState<SourceInputMeta | null>(null)
  const [extractedImages, setExtractedImages] = useState<SelectableDraftImage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [availableCountries, setAvailableCountries] = useState<CountryOption[]>([])
  const [selectedCodes, setSelectedCodes] = useState<string[]>([])
  const [mode, setMode] = useState<'single' | 'multi'>('single')
  const [loadingCountries, setLoadingCountries] = useState<boolean>(true)
  const [allowRefine, setAllowRefine] = useState<boolean>(true)

  // ============================================================================
  // WIZARD STATE — three steps with per-field validation
  // ============================================================================
  const WIZARD_STEPS = ['Your invention', 'Jurisdictions & languages', 'Review & create'] as const
  type WizardStep = 1 | 2 | 3
  const [step, setStep] = useState<WizardStep>(1)
  const [fieldErrors, setFieldErrors] = useState<{
    project?: string
    title?: string
    rawIdea?: string
    jurisdictions?: string
  }>({})

  const clearFieldError = (field: 'project' | 'title' | 'rawIdea' | 'jurisdictions') => {
    setFieldErrors(prev => (prev[field] ? { ...prev, [field]: undefined } : prev))
  }

  const titleWordCount = patentTitle.trim() ? patentTitle.trim().split(/\s+/).length : 0

  const validateInventionStep = () => {
    const errors: typeof fieldErrors = {}
    if (!selectedProject) errors.project = 'Choose a project to store this draft.'
    if (!patentTitle.trim()) {
      errors.title = 'Title is required.'
    } else if (titleWordCount > 15) {
      errors.title = `Keep the title to 15 words or fewer — currently ${titleWordCount}.`
    }
    if (!rawIdea.trim()) {
      errors.rawIdea = 'Describe your invention or upload a file.'
    } else if (rawIdea.length > MAX_DRAFTING_INPUT_CHARS) {
      errors.rawIdea = `Description exceeds the ${MAX_DRAFTING_INPUT_CHARS.toLocaleString()} character limit.`
    }
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  const validateJurisdictionStep = () => {
    const finalSelection = mode === 'single' ? selectedCodes.slice(0, 1) : selectedCodes
    if (finalSelection.length === 0) {
      setFieldErrors({ jurisdictions: 'Select at least one jurisdiction.' })
      return false
    }
    setFieldErrors({})
    return true
  }

  const goToStep = (target: WizardStep) => {
    setStep(target)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleContinue = () => {
    if (step === 1 && validateInventionStep()) goToStep(2)
    else if (step === 2 && validateJurisdictionStep()) goToStep(3)
  }

  // ============================================================================
  // LANGUAGE CONFIGURATION STATE
  // ============================================================================
  // Language Mode:
  // - 'common': All content + figures in one language (requires common language across jurisdictions)
  // - 'individual_english_figures': Each jurisdiction in its own language, figures always English
  // Future: 'full_individual' - per-jurisdiction figures as well
  type LanguageMode = 'common' | 'individual_english_figures'
  
  const [languageMode, setLanguageMode] = useState<LanguageMode>('common')
  const [languageByJurisdiction, setLanguageByJurisdiction] = useState<Record<string, string>>({})
  const [figuresLanguage, setFiguresLanguage] = useState<string>('en') // Primary language for diagrams/sketches
  const [commonLanguage, setCommonLanguage] = useState<string>('en') // Used when mode='common'

  // Derived: currently selected project object from list
  const selectedProjectObj = projects.find(p => p.id === selectedProject)

  // ============================================================================
  // COMPUTED LANGUAGE PROPERTIES
  // ============================================================================
  
  // Selected country objects
  const selectedCountryObjects = useMemo(() =>
    selectedCodes.map(code => availableCountries.find(c => c.code === code)).filter(Boolean) as CountryOption[],
    [selectedCodes, availableCountries]
  )

  // Get unique languages across all selected jurisdictions (union)
  const allLanguages = useMemo(() => {
    const allLanguagesSet = new Set<string>()
    selectedCountryObjects.forEach(country => {
      (country.languages || []).forEach(lang => allLanguagesSet.add(lang))
    })
    return Array.from(allLanguagesSet)
  }, [selectedCountryObjects])

  // Get common languages (intersection - supported by ALL selected jurisdictions)
  const commonLanguages = useMemo(() =>
    selectedCountryObjects.length > 0
      ? allLanguages.filter(lang => selectedCountryObjects.every(c => (c.languages || []).includes(lang)))
      : [],
    [selectedCountryObjects, allLanguages]
  )

  // Check if all jurisdictions support English
  const allSupportEnglish = useMemo(() =>
    selectedCountryObjects.every(c => (c.languages || []).includes('en')),
    [selectedCountryObjects]
  )

  // Check if there are non-English languages available
  const hasNonEnglishLanguages = useMemo(() =>
    allLanguages.some(lang => lang !== 'en'),
    [allLanguages]
  )

  // Check if common language mode is available (at least one shared language)
  const canUseCommonMode = useMemo(() =>
    commonLanguages.length > 0 || selectedCodes.length <= 1,
    [commonLanguages, selectedCodes.length]
  )

  // Determine if we're in a multi-jurisdiction scenario
  const isMultiJurisdiction = useMemo(() =>
    selectedCodes.length > 1,
    [selectedCodes.length]
  )

  // ============================================================================
  // LANGUAGE CONFIGURATION EFFECT
  // ============================================================================
  
  // Helper: Get safe language array with fallback to English
  const getSafeLanguages = (country: CountryOption | undefined): string[] => {
    const langs = country?.languages || []
    // If no languages defined (data error), fallback to English
    return langs.length > 0 ? langs : ['en']
  }

  // Effect 1: Initialize/update language defaults when jurisdictions change
  useEffect(() => {
    if (selectedCodes.length === 0) return

    // Update per-jurisdiction language defaults
    setLanguageByJurisdiction(prev => {
      const next: Record<string, string> = {}
      selectedCodes.forEach(code => {
        const country = availableCountries.find(c => c.code === code)
        const langs = getSafeLanguages(country)
        // Default to English if available, otherwise first language
        const defaultLang = langs.includes('en') ? 'en' : langs[0]
        // Preserve existing selection if valid, otherwise use default
        const existingLang = prev[code]
        next[code] = (existingLang && langs.includes(existingLang)) ? existingLang : defaultLang
      })
      return areLanguageMapsEqual(prev, next) ? prev : next
    })

    // Single jurisdiction: ALWAYS force common mode (no choice)
    if (selectedCodes.length === 1) {
      const country = availableCountries.find(c => c.code === selectedCodes[0])
      const langs = getSafeLanguages(country)
      const defaultLang = langs.includes('en') ? 'en' : langs[0]
      setLanguageMode('common')
      setCommonLanguage(defaultLang)
      setFiguresLanguage(defaultLang)
      return
    }

    // Multi-jurisdiction: smart defaults based on shared languages
    const countriesSelected = selectedCodes.map(code => availableCountries.find(c => c.code === code)).filter(Boolean) as CountryOption[]
    const sharedLanguages = allLanguages.filter(lang => countriesSelected.every(c => getSafeLanguages(c).includes(lang)))
    
    if (sharedLanguages.length > 0) {
      // There's at least one common language - default to common mode with English (if available)
      const preferredCommon = sharedLanguages.includes('en') ? 'en' : sharedLanguages[0]
      // Only set defaults if not already configured (avoid overwriting user choices)
      if (!commonLanguages.includes(commonLanguage)) {
        setLanguageMode('common')
        setCommonLanguage(preferredCommon)
        setFiguresLanguage(preferredCommon)
      }
    } else {
      // No common language - MUST use individual mode with English figures
      setLanguageMode('individual_english_figures')
      setFiguresLanguage('en') // Figures always English when no common language
    }
  }, [selectedCodes, availableCountries, allLanguages, commonLanguage, commonLanguages])

  // Effect 2: Sync figures language when mode or common language changes
  useEffect(() => {
    if (languageMode === 'common') {
      setFiguresLanguage(commonLanguage || 'en')
    } else {
      // Individual mode: figures always in English
      setFiguresLanguage('en')
    }
  }, [languageMode, commonLanguage])

  // Effect 3: Sync per-jurisdiction languages when mode changes to common
  // This ensures all jurisdictions use the common language in common mode
  useEffect(() => {
    if (languageMode === 'common' && selectedCodes.length > 0 && commonLanguage) {
      setLanguageByJurisdiction(prev => {
        const synced: Record<string, string> = {}
        selectedCodes.forEach(code => {
          const country = availableCountries.find(c => c.code === code)
          const langs = getSafeLanguages(country)
          // In common mode, set all to common language if supported, else keep existing
          synced[code] = langs.includes(commonLanguage) ? commonLanguage : prev[code] || langs[0]
        })
        return areLanguageMapsEqual(prev, synced) ? prev : synced
      })
    }
  }, [languageMode, commonLanguage, selectedCodes, availableCountries])

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login')
      return
    }

    if (!authLoading && user) {
      const fetchProjects = async () => {
        try {
          const response = await fetch('/api/projects', {
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
            }
          })

          if (response.ok) {
            const data = await response.json()
            const list: Project[] = data.projects || []
            setProjects(list)

            // If coming from dashboard, find and select the "Default Project"
            if (!initialProjectId && list.length > 0) {
              const defaultProject = list.find(p => p.name === 'Default Project');
              if (defaultProject) {
                setSelectedProject(defaultProject.id);
              } else {
                // Fallback to the first project if "Default Project" is not found
                setSelectedProject(list[0].id);
              }
            }
          }
        } catch (error) {
          console.error('Failed to fetch projects:', error)
        } finally {
          setIsLoading(false)
        }
      }
      fetchProjects()
    }
  }, [authLoading, user, router, initialProjectId])

  // Preselect project if provided via query param
  useEffect(() => {
    if (initialProjectId) {
      setSelectedProject(initialProjectId)
    }
  }, [initialProjectId])

  // Load country profiles for jurisdiction selection
  useEffect(() => {
    const fetchCountries = async () => {
      try {
        setLoadingCountries(true)
        const res = await fetch('/api/country-profiles', {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}` }
        })
        if (!res.ok) throw new Error(`Failed to load country profiles (${res.status})`)
        const data = await res.json()
        const countries: CountryOption[] = Array.isArray(data?.countries) ? data.countries.map((meta: any) => ({
          code: (meta.code || '').toUpperCase(),
          label: `${meta.name || meta.code} (${(meta.code || '').toUpperCase()})`,
          description: `${meta.office || 'Patent Office'} format. Languages: ${(meta.languages || []).join(', ') || 'N/A'}. Applications: ${(meta.applicationTypes || []).join(', ') || 'N/A'}.`,
          continent: meta.continent || 'Unknown',
          office: meta.office || 'Patent Office',
          applicationTypes: meta.applicationTypes || [],
          languages: meta.languages || []
        })) : []
        countries.sort((a, b) => {
          if (a.continent !== b.continent) return a.continent.localeCompare(b.continent)
          return a.label.localeCompare(b.label)
        })
        setAvailableCountries(countries)
      } catch (e) {
        console.error('Failed to load country profiles:', e)
        setError('Failed to load country profiles. Please try again.')
      } finally {
        setLoadingCountries(false)
      }
    }
    fetchCountries()
  }, [])


  const selectedExtractedImages = useMemo(
    () => extractedImages.filter(image => image.selected && image.status !== 'saved'),
    [extractedImages]
  )

  const savedExtractedImageCount = useMemo(
    () => extractedImages.filter(image => image.status === 'saved').length,
    [extractedImages]
  )

  const updateExtractedImage = (id: string, patch: Partial<SelectableDraftImage>) => {
    setExtractedImages(prev => prev.map(image => image.id === id ? { ...image, ...patch } : image))
  }

  const toggleExtractedImage = (id: string, selected: boolean) => {
    updateExtractedImage(id, { selected, error: undefined, status: 'idle' })
  }

  const removeExtractedImage = (id: string) => {
    setExtractedImages(prev => prev.filter(image => image.id !== id))
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return

    const fileName = file.name.toLowerCase()
    const allowedExtensions = ['.txt', '.md', '.markdown', '.csv', '.tsv', '.xlsx', '.doc', '.docx', '.pdf']
    const hasAllowedExtension = allowedExtensions.some(ext => fileName.endsWith(ext))
    if (!hasAllowedExtension) {
      setError('Unsupported file type. Please upload .txt, .md, .csv, .tsv, .xlsx, .doc, .docx, or .pdf files.')
      setUploadedFileName(null)
      setSourceInputMeta(null)
      setExtractedImages([])
      input.value = ''
      return
    }

    if (file.size > MAX_DRAFTING_UPLOAD_BYTES) {
      setError(`File size must be less than ${MAX_DRAFTING_UPLOAD_MB}MB`)
      setUploadedFileName(null)
      setSourceInputMeta(null)
      setExtractedImages([])
      input.value = ''
      return
    }

    setIsFileProcessing(true)
    setError(null)
    setUploadedFileName(null)
    setExtractedImages([])

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await authFetch('/api/patents/draft/ingest-file', {
        method: 'POST',
        body: formData
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || 'Failed to process file. Please check the file format and try again.')
      }

      if (!data.textContent || typeof data.textContent !== 'string') {
        throw new Error('File appears to be empty or contains no readable text.')
      }

      setRawIdea(data.textContent)
      setUploadedFileName(data.fileName || file.name)
      setSourceInputMeta(data.sourceInputMeta || null)
      const images = Array.isArray(data.images) ? data.images : []
      setExtractedImages(images.map((image: ExtractedDraftImage) => ({
        ...image,
        selected: true,
        status: 'idle' as const
      })))
      setError(null)
    } catch (error) {
      console.error('File processing error:', error)
      setUploadedFileName(null)
      setSourceInputMeta(null)
      setExtractedImages([])
      setError(error instanceof Error ? error.message : 'Failed to process file. Please check the file format and try again.')
    } finally {
      setIsFileProcessing(false)
      input.value = ''
    }
  }

  const safeExtractedImageUploadName = (image: SelectableDraftImage) => {
    const extensionMatch = /\.([a-z0-9]+)$/i.exec(image.fileName)
    const extension = extensionMatch?.[1] || (image.mimeType === 'image/jpeg' ? 'jpg' : image.mimeType.split('/')[1] || 'png')
    const base = image.fileName
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 72) || 'embedded-figure'
    const suffix = image.id.replace(/[^a-z0-9]+/gi, '').slice(-12) || Date.now().toString(36)
    return `${base}-${suffix}.${extension === 'jpeg' ? 'jpg' : extension}`
  }

  const attachSelectedExtractedImages = async (patentId: string, sessionId: string) => {
    const targets = selectedExtractedImages
    if (targets.length === 0) return

    const token = localStorage.getItem('auth_token') || ''
    const jsonHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }

    for (let index = 0; index < targets.length; index++) {
      const image = targets[index]
      try {
        updateExtractedImage(image.id, { status: 'saving', error: undefined })

        if (!EXTERNAL_UPLOAD_ALLOWED_MIME_TYPES.has(image.mimeType)) {
          throw new Error('Unsupported embedded image type')
        }

        const uploadFile = dataUrlToFile(
          image.dataUrl,
          safeExtractedImageUploadName(image),
          image.mimeType === 'image/jpg' ? 'image/jpeg' : image.mimeType
        )
        if (uploadFile.size > EXTRACTED_IMAGE_UPLOAD_MAX_BYTES) {
          throw new Error(`${image.fileName} is larger than the 25MB figure upload limit.`)
        }

        const formData = new FormData()
        formData.append('file', uploadFile)
        const uploadResponse = await fetch(`/api/projects/${selectedProject}/patents/${patentId}/upload`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData
        })
        const uploadData = await uploadResponse.json().catch(() => ({}))
        if (!uploadResponse.ok || !uploadData?.filename || !uploadData?.checksum) {
          throw new Error(uploadData.error || 'Failed to upload embedded image')
        }

        const linkResponse = await fetch(`/api/patents/${patentId}/drafting`, {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify({
            action: 'import_uploaded_diagram_image',
            sessionId,
            language: figuresLanguage || 'en',
            filename: uploadData.filename,
            checksum: uploadData.checksum,
            imagePath: uploadData.path,
            title: image.label || image.fileName || `Uploaded Figure ${index + 1}`
          })
        })
        const linkData = await linkResponse.json().catch(() => ({}))
        if (!linkResponse.ok || !linkData?.created?.figureNo) {
          throw new Error(linkData.error || 'Failed to queue embedded image as a figure')
        }

        updateExtractedImage(image.id, { status: 'saved', selected: false, error: undefined })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to attach embedded image'
        updateExtractedImage(image.id, { status: 'error', error: message })
        throw new Error(`${image.label || image.fileName}: ${message}`)
      }
    }
  }

  const handleCreateDraft = async () => {
    if (!selectedProject) {
      setError('Please select a project')
      return
    }

    if (!patentTitle.trim()) {
      setError('Please enter a patent title')
      return
    }

    if (!rawIdea.trim()) {
      setError('Please provide an invention description or upload a file')
      return
    }

    if (rawIdea.length > MAX_DRAFTING_INPUT_CHARS) {
      setError(`Description exceeds ${MAX_DRAFTING_INPUT_CHARS.toLocaleString()} character limit. Please shorten your text.`)
      return
    }

    // Validate title length
    const titleWords = patentTitle.trim().split(/\s+/).length
    if (titleWords > 15) {
      setError('Title must be 15 words or less')
      return
    }

    const normalizedCodes = selectedCodes.map(c => c.toUpperCase())
    const finalSelection = mode === 'single' ? normalizedCodes.slice(0, 1) : normalizedCodes
    if (finalSelection.length === 0) {
      setError('Please select at least one jurisdiction')
      return
    }

    setIsCreating(true)
    setStage0StartedAt(Date.now())
    setStage0OverlayStatus('running')
    setStage0OverlayError(undefined)
    setError(null)

    try {
      let patentId = draftCreationContext?.patentId
      let sessionId = draftCreationContext?.sessionId
      let jurisdictionPersisted = !!draftCreationContext?.jurisdictionPersisted

      if (!patentId) {
        // First create a basic patent record
        const patentResponse = await fetch(`/api/projects/${selectedProject}/patents`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          },
          body: JSON.stringify({
            title: patentTitle.trim(),
            description: 'Created for patent drafting workflow'
          })
        })

        if (!patentResponse.ok) {
          const errorData = await patentResponse.json().catch(() => ({}))
          throw new Error(errorData.error || 'Failed to create patent')
        }

        const patentData = await patentResponse.json()
        patentId = patentData.patent.id
        setDraftCreationContext({ patentId })
      }

      if (!sessionId) {
        // Start drafting session and normalize idea
        const draftingResponse = await fetch(`/api/patents/${patentId}/drafting`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          },
          body: JSON.stringify({
            action: 'start_session'
          })
        })

        if (!draftingResponse.ok) {
          const errorData = await draftingResponse.json().catch(() => ({}))
          throw new Error(errorData.error || 'Failed to start drafting session')
        }

        const draftSessionData = await draftingResponse.json()
        sessionId = draftSessionData.session.id
        setDraftCreationContext({ patentId, sessionId, jurisdictionPersisted: false })
      }

      if (!jurisdictionPersisted) {
        // Persist jurisdiction choice and language preferences
        const setStageResponse = await fetch(`/api/patents/${patentId}/drafting`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          },
          body: JSON.stringify({
            action: 'set_stage',
            sessionId,
            // Keep the session in the initial stage while persisting jurisdiction choice
            stage: 'IDEA_ENTRY',
            draftingJurisdictions: finalSelection,
            activeJurisdiction: finalSelection[0],
            // Language configuration
            languageMode: languageMode,
            languageByJurisdiction: languageByJurisdiction,
            figuresLanguage: figuresLanguage,
            commonLanguage: languageMode === 'common' ? commonLanguage : null
          })
        })

        if (!setStageResponse.ok) {
          const errorData = await setStageResponse.json().catch(() => ({}))
          throw new Error(errorData.error || 'Failed to persist jurisdiction selection')
        }

        jurisdictionPersisted = true
        setDraftCreationContext({ patentId, sessionId, jurisdictionPersisted: true })
      }

      // Normalize the idea
        const normalizeResponse = await fetch(`/api/patents/${patentId}/drafting`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          },
          body: JSON.stringify({
            action: 'normalize_idea',
            sessionId,
            rawIdea: rawIdea.trim(),
            title: patentTitle.trim(),
            sourceInputMeta,
            allowRefine
          })
        })

      if (!normalizeResponse.ok) {
        // Parse the actual error from the API response
        const errorData = await normalizeResponse.json().catch(() => ({}))
        const errorMessage = errorData.error || 'Failed to normalize idea'
        throw new Error(errorMessage)
      }

      if (!patentId || !sessionId) {
        throw new Error('Draft session was not initialized correctly')
      }
      await attachSelectedExtractedImages(patentId, sessionId)

      setStage0OverlayStatus('success')
      setDraftCreationContext(null)
      await new Promise(resolve => setTimeout(resolve, 500))

      // Redirect to the drafting page (already on component planner stage)
      router.push(`/patents/${patentId}/draft`)

    } catch (error) {
      console.error('Failed to create patent draft:', error)
      const message = error instanceof Error ? error.message : 'Failed to start patent draft. Please try again.'
      setError(message)
      setStage0OverlayError(message)
      setStage0OverlayStatus('error')
    } finally {
      setIsCreating(false)
    }
  }

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-paper-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-ai-blue-600"></div>
      </div>
    )
  }

  if (!user) {
    return null
  }

  // A draft must live in a project — show a clear path instead of a disabled form.
  if (projects.length === 0) {
    return (
      <div className="min-h-screen bg-paper-100">
        <div className="max-w-4xl mx-auto py-16 px-4 sm:px-6 lg:px-8">
          <Link
            href="/dashboard"
            className="inline-flex items-center text-ai-graphite-600 hover:text-ai-graphite-900 mb-4"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Dashboard
          </Link>
          <div className="bg-white rounded-lg shadow-sm p-10 text-center">
            <h1 className="text-2xl font-bold text-ai-graphite-900 mb-2">Create a project first</h1>
            <p className="text-ai-graphite-600 mb-6">
              Every patent draft is stored in a project. Create one and you&apos;ll come straight back here.
            </p>
            <Link
              href="/projects/new"
              className="inline-flex items-center px-5 py-2.5 border border-transparent text-sm font-medium rounded-lg text-white bg-ai-blue-600 hover:bg-ai-blue-700"
            >
              Create a project
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-paper-100">
      <Stage0PatentIntelligenceOverlay
        open={stage0OverlayStatus !== null}
        mode={allowRefine ? 'enhance' : 'preserve'}
        title={patentTitle}
        disclosureLength={rawIdea.length}
        disclosureText={rawIdea}
        startedAt={stage0StartedAt}
        status={stage0OverlayStatus || 'running'}
        errorMessage={stage0OverlayError}
        onRetry={handleCreateDraft}
        onReturnToEditor={() => {
          setStage0OverlayStatus(null)
          setStage0OverlayError(undefined)
          setDraftCreationContext(null)
          setIsCreating(false)
        }}
      />
      <div className="max-w-4xl mx-auto py-16 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/dashboard"
            className="inline-flex items-center text-ai-graphite-600 hover:text-ai-graphite-900 mb-4"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Dashboard
          </Link>
          <div className="text-center">
            <h1 className="text-3xl font-bold text-ai-graphite-900 mb-2">Start a patent draft</h1>
            <p className="text-lg text-ai-graphite-600">
              Describe your invention — the AI drafts the application with you, stage by stage
            </p>
            <Link
              href="/patents/draft/batch"
              className="mt-3 inline-flex items-center rounded-lg border border-ai-blue-200 bg-ai-blue-50 px-3 py-2 text-sm font-medium text-ai-blue-700 hover:bg-ai-blue-100"
            >
              Upload a batch instead
            </Link>
          </div>

          {/* Stepper */}
          <nav aria-label="Progress" className="mt-8">
            <ol className="flex items-center justify-center gap-2 sm:gap-3">
              {WIZARD_STEPS.map((label, index) => {
                const stepNumber = (index + 1) as WizardStep
                const isCurrent = step === stepNumber
                const isDone = step > stepNumber
                return (
                  <li key={label} className="flex items-center gap-2 sm:gap-3">
                    {index > 0 && (
                      <span aria-hidden="true" className={`h-px w-6 sm:w-12 ${step > index ? 'bg-ai-blue-600' : 'bg-gray-300'}`} />
                    )}
                    <button
                      type="button"
                      onClick={() => { if (isDone) goToStep(stepNumber) }}
                      disabled={!isDone}
                      aria-current={isCurrent ? 'step' : undefined}
                      className={`flex items-center gap-2 rounded-full py-1 pr-2 sm:pr-3 text-sm transition-colors ${isDone ? 'cursor-pointer hover:text-ai-blue-700' : 'cursor-default'}`}
                    >
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                          isCurrent
                            ? 'bg-ai-blue-600 text-white'
                            : isDone
                              ? 'bg-ai-blue-100 text-ai-blue-700'
                              : 'bg-paper-300 text-ai-graphite-500'
                        }`}
                      >
                        {isDone ? <Check className="h-3.5 w-3.5" /> : stepNumber}
                      </span>
                      <span className={`hidden sm:inline font-medium ${isCurrent ? 'text-ai-graphite-900' : isDone ? 'text-ai-blue-700' : 'text-ai-graphite-400'}`}>
                        {label}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </nav>
        </div>

        {/* Main Form */}
        <div className="bg-white rounded-lg shadow-sm p-8">
          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              </div>
            </div>
          )}

          {/* Idea Bank Banner */}
          {ideaId && (
            <div className="mb-6 bg-ai-blue-50 border border-ai-blue-200 rounded-lg p-4">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-ai-blue-500" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z" />
                  </svg>
                </div>
                <div className="ml-3 flex-1">
                  <p className="text-sm text-ai-blue-800">
                    <span className="font-semibold">Loaded from Idea Bank</span> — The title and description have been pre-filled from your reserved idea. You can edit them before starting the draft.
                  </p>
                </div>
                <Link
                  href="/idea-bank"
                  className="ml-4 text-xs font-medium text-ai-blue-600 hover:text-ai-blue-500"
                >
                  Back to Idea Bank →
                </Link>
              </div>
            </div>
          )}

          <div className="space-y-6">
            {step === 2 && (
            <>
            {/* Jurisdiction Selection */}
            <div className={`border rounded-lg p-4 bg-paper-100 ${fieldErrors.jurisdictions ? 'border-red-300' : 'border-paper-300'}`}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-sm font-semibold text-ai-graphite-900">Jurisdiction & Mode</div>
                  <p className="text-xs text-ai-graphite-600">Choose single or multiple jurisdictions; this controls downstream prompts, figures, and rules.</p>
                </div>
                <div className="flex items-center gap-3 text-sm text-ai-graphite-700">
                  <label className="flex items-center gap-1">
                    <input type="radio" className="h-4 w-4" checked={mode === 'single'} onChange={() => {
                      setMode('single')
                      if (selectedCodes.length > 1) setSelectedCodes([selectedCodes[0]])
                    }} />
                    Single
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="radio" className="h-4 w-4" checked={mode === 'multi'} onChange={() => setMode('multi')} />
                    Multiple
                  </label>
                </div>
              </div>
              {loadingCountries ? (
                <div className="text-sm text-ai-graphite-500">Loading jurisdictions...</div>
              ) : availableCountries.length === 0 ? (
                <div className="text-sm text-red-600">No country profiles available. Please ask an admin to add them.</div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-2 max-h-56 overflow-auto">
                  {availableCountries.map(c => (
                    <label key={c.code} className="flex items-start gap-2 p-2 border border-paper-300 rounded hover:bg-white cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 text-ai-blue-600 border-paper-400 rounded"
                        checked={selectedCodes.includes(c.code)}
                        onChange={() => {
                          clearFieldError('jurisdictions')
                          if (mode === 'single') {
                            setSelectedCodes([c.code])
                          } else {
                            setSelectedCodes(prev => prev.includes(c.code) ? prev.filter(x => x !== c.code) : [...prev, c.code])
                          }
                        }}
                        disabled={false}
                      />
                      <div>
                        <div className="text-sm font-medium text-ai-graphite-900">{c.label}</div>
                        <div className="text-xs text-ai-graphite-600">{c.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
              {fieldErrors.jurisdictions && (
                <p className="text-sm text-red-600 mt-2">{fieldErrors.jurisdictions}</p>
              )}
              <p className="text-xs text-ai-graphite-500 mt-2">
                Your chosen active jurisdiction will drive figures and validation; you can generate other jurisdictions later.
              </p>

              {/* ================================================================
                   LANGUAGE CONFIGURATION SECTION
                   ================================================================ */}
              {selectedCodes.length > 0 && (
                <div className="mt-4 pt-4 border-t border-paper-300">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="text-sm font-semibold text-ai-graphite-900">Language Configuration</div>
                      <p className="text-xs text-ai-graphite-600">Configure drafting language for content and figures</p>
                    </div>
                    {!canUseCommonMode && isMultiJurisdiction && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                        <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        No Common Language
                      </span>
                    )}
                  </div>

                  {/* ============ SINGLE JURISDICTION ============ */}
                  {!isMultiJurisdiction && (
                    <div className="space-y-3">
                      {(() => {
                        const country = availableCountries.find(c => c.code === selectedCodes[0])
                        const langs = country?.languages || []
                        return (
                          <div>
                            <label className="text-xs text-ai-graphite-600 block mb-1">
                              Drafting language for {country?.label || selectedCodes[0]}:
                            </label>
                            <select
                              className="w-full border border-paper-400 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ai-blue-500"
                              value={commonLanguage}
                              onChange={(e) => {
                                setCommonLanguage(e.target.value)
                                setLanguageByJurisdiction(prev => ({ ...prev, [selectedCodes[0]]: e.target.value }))
                              }}
                            >
                              {langs.map(lang => (
                                <option key={lang} value={lang}>
                                  {LANGUAGE_LABELS[lang] || lang.toUpperCase()}
                                </option>
                              ))}
                            </select>
                            <p className="text-xs text-ai-graphite-500 mt-1">
                              Both content and figures will be generated in {LANGUAGE_LABELS[commonLanguage] || commonLanguage}.
                            </p>
                          </div>
                        )
                      })()}
                    </div>
                  )}

                  {/* ============ MULTI-JURISDICTION ============ */}
                  {isMultiJurisdiction && (
                    <div className="space-y-4">
                      {/* Language Mode Selection */}
                      <div className="bg-paper-200 rounded-lg p-3">
                        <div className="text-xs font-medium text-ai-graphite-700 mb-2">Language Mode</div>
                        <div className="space-y-2">
                          {/* Common Language Mode */}
                          <label className={`flex items-start gap-3 p-2 rounded border cursor-pointer transition-colors ${
                            languageMode === 'common' 
                              ? 'bg-ai-blue-50 border-ai-blue-300' 
                              : canUseCommonMode ? 'bg-white border-paper-300 hover:bg-paper-100' : 'bg-paper-100 border-paper-300 opacity-50 cursor-not-allowed'
                          }`}>
                            <input
                              type="radio"
                              className="mt-1 h-4 w-4 text-ai-blue-600"
                              checked={languageMode === 'common'}
                              onChange={() => setLanguageMode('common')}
                              disabled={!canUseCommonMode}
                            />
                            <div className="flex-1">
                              <div className="text-sm font-medium text-ai-graphite-900">Common Language</div>
                              <div className="text-xs text-ai-graphite-600">
                                All content and figures in one shared language
                                {!canUseCommonMode && <span className="text-amber-600 ml-1">(No common language available)</span>}
                              </div>
                              {commonLanguages.length > 0 && (
                                <div className="text-xs text-ai-graphite-500 mt-1">
                                  Available: {commonLanguages.map(l => LANGUAGE_LABELS[l] || l).join(', ')}
                                </div>
                              )}
                            </div>
                          </label>

                          {/* Individual Languages Mode */}
                          <label className={`flex items-start gap-3 p-2 rounded border cursor-pointer transition-colors ${
                            languageMode === 'individual_english_figures' 
                              ? 'bg-ai-blue-50 border-ai-blue-300' 
                              : 'bg-white border-paper-300 hover:bg-paper-100'
                          }`}>
                            <input
                              type="radio"
                              className="mt-1 h-4 w-4 text-ai-blue-600"
                              checked={languageMode === 'individual_english_figures'}
                              onChange={() => setLanguageMode('individual_english_figures')}
                            />
                            <div className="flex-1">
                              <div className="text-sm font-medium text-ai-graphite-900">Individual Languages (English Figures)</div>
                              <div className="text-xs text-ai-graphite-600">
                                Each jurisdiction in its own language; figures/sketches always in English
                              </div>
                              <div className="text-xs text-ai-blue-600 mt-1">
                                ✓ Recommended for international filings with diverse language requirements
                              </div>
                            </div>
                          </label>
                        </div>
                      </div>

                      {/* Common Language Selector */}
                      {languageMode === 'common' && canUseCommonMode && (
                        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                          <label className="text-xs font-medium text-green-800 block mb-2">
                            Select common language:
                          </label>
                          <select
                            className="w-full border border-green-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                            value={commonLanguage}
                            onChange={(e) => setCommonLanguage(e.target.value)}
                          >
                            {commonLanguages.map(lang => (
                              <option key={lang} value={lang}>
                                {LANGUAGE_LABELS[lang] || lang.toUpperCase()}
                              </option>
                            ))}
                          </select>
                          <p className="text-xs text-green-700 mt-2">
                            <span className="font-medium">✓</span> All content and figures will be generated in {LANGUAGE_LABELS[commonLanguage] || commonLanguage}.
                          </p>
                        </div>
                      )}

                      {/* Individual Language Configuration */}
                      {languageMode === 'individual_english_figures' && (
                        <div className="space-y-3">
                          {/* Figures Language Notice */}
                          <div className="bg-ai-blue-50 border border-ai-blue-200 rounded-lg p-3">
                            <div className="flex items-start gap-2">
                              <svg className="w-5 h-5 text-ai-blue-600 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                              </svg>
                              <div className="text-sm text-ai-blue-800">
                                <p className="font-medium">Figures & Sketches: English Only</p>
                                <p className="text-xs mt-1">
                                  All diagrams, flowcharts, and technical sketches will be generated in English for universal compatibility across jurisdictions.
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* Per-Jurisdiction Content Language */}
                          <div className="border border-paper-300 rounded-lg p-3 bg-white">
                            <label className="text-xs font-medium text-ai-graphite-700 block mb-2">
                              Content language per jurisdiction:
                            </label>
                            <div className="space-y-2">
                              {selectedCodes.map(code => {
                                const country = availableCountries.find(c => c.code === code)
                                // Safe languages with fallback to English if none defined
                                const rawLangs = country?.languages || []
                                const langs = rawLangs.length > 0 ? rawLangs : ['en']
                                const hasNoDefinedLanguages = rawLangs.length === 0
                                return (
                                  <div key={code} className="flex items-center gap-3 p-2 bg-paper-100 rounded">
                                    <span className="text-sm font-medium text-ai-graphite-800 w-20 flex-shrink-0">{code}</span>
                                    <select
                                      className={`flex-1 border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ai-blue-500 ${hasNoDefinedLanguages ? 'border-amber-300 bg-amber-50' : 'border-paper-400'}`}
                                      value={languageByJurisdiction[code] || defaultLanguageForJurisdiction(code, langs)}
                                      onChange={(e) => setLanguageByJurisdiction(prev => ({ ...prev, [code]: e.target.value }))}
                                    >
                                      {langs.map(lang => (
                                        <option key={lang} value={lang}>
                                          {LANGUAGE_LABELS[lang] || lang.toUpperCase()}
                                        </option>
                                      ))}
                                    </select>
                                    <span className={`text-xs w-28 flex-shrink-0 ${hasNoDefinedLanguages ? 'text-amber-600' : 'text-ai-graphite-500'}`}>
                                      {hasNoDefinedLanguages ? '⚠️ Default' : `${rawLangs.length} lang${rawLangs.length !== 1 ? 's' : ''}`}
                                    </span>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Summary */}
                      <div className="bg-paper-100 border border-paper-300 rounded p-3 text-xs">
                        <div className="font-medium text-ai-graphite-700 mb-1">Configuration Summary</div>
                        <div className="text-ai-graphite-600 space-y-1">
                          <div>• <span className="font-medium">Mode:</span> {languageMode === 'common' ? 'Common Language' : 'Individual Languages'}</div>
                          <div>• <span className="font-medium">Figures/Sketches:</span> {LANGUAGE_LABELS[figuresLanguage] || figuresLanguage}</div>
                          {languageMode === 'individual_english_figures' && (
                            <div>• <span className="font-medium">Content:</span> Per-jurisdiction (see above)</div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            </>
            )}

            {step === 1 && (
            <>
            {/* Project Display / Selector */}
            <div>
              <label className="block text-sm font-medium text-ai-graphite-700 mb-2">
                Project
              </label>
              {initialProjectId ? (
                <>
                  <div className="flex items-center space-x-3 p-3 bg-ai-blue-50 border border-ai-blue-200 rounded-lg">
                    <div className="w-8 h-8 bg-ai-blue-100 rounded-full flex items-center justify-center">
                      <svg className="w-4 h-4 text-ai-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-ai-graphite-900">{selectedProjectObj?.name || 'Project'}</div>
                      <div className="text-xs text-ai-graphite-500">Linked from project context</div>
                    </div>
                    <Badge variant="secondary" className="text-xs">Locked</Badge>
                  </div>
                  <p className="mt-1 text-sm text-ai-graphite-500">
                    This draft will be saved to {selectedProjectObj?.name || 'the selected project'}.
                  </p>
                </>
              ) : (
                <div className="space-y-2">
                  <select
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ai-blue-500 focus:border-transparent ${fieldErrors.project ? 'border-red-300' : 'border-paper-400'}`}
                    value={selectedProject}
                    onChange={(e) => {
                      clearFieldError('project')
                      setSelectedProject(e.target.value)
                    }}
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {fieldErrors.project && (
                    <p className="text-sm text-red-600">{fieldErrors.project}</p>
                  )}
                  <p className="text-xs text-ai-graphite-500">
                    Choose a project to store this draft. Select “Default Project” for quick drafts.
                  </p>
                </div>
              )}
            </div>

            {/* Patent Title */}
            <div>
              <label htmlFor="title" className="block text-sm font-medium text-ai-graphite-700 mb-2">
                Patent Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="title"
                value={patentTitle}
                onChange={(e) => {
                  clearFieldError('title')
                  setPatentTitle(e.target.value)
                }}
                placeholder="Enter a descriptive title for your patent"
                className={`w-full px-3 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-ai-blue-500 focus:border-transparent ${fieldErrors.title ? 'border-red-300' : 'border-paper-400'}`}
                aria-invalid={fieldErrors.title ? true : undefined}
                required
              />
              {fieldErrors.title && (
                <p className="mt-1 text-sm text-red-600">{fieldErrors.title}</p>
              )}
              <p className={`mt-1 text-sm ${titleWordCount > 15 ? 'text-red-600' : 'text-ai-graphite-500'}`}>
                {titleWordCount} of 15 words • This will be the title of your patent application
              </p>
            </div>
            {/* Invention Description */}
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-ai-graphite-700 mb-2">
                Invention Description <span className="text-red-500">*</span>
              </label>
              <textarea
                id="description"
                value={rawIdea}
                onChange={(e) => {
                  clearFieldError('rawIdea')
                  setRawIdea(e.target.value)
                }}
                rows={8}
                placeholder="Describe your invention in detail. Include the problem it solves, how it works, key components, advantages, and any specific embodiments..."
                className={`w-full px-3 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-ai-blue-500 focus:border-transparent resize-vertical ${fieldErrors.rawIdea ? 'border-red-300' : 'border-paper-400'}`}
                aria-invalid={fieldErrors.rawIdea ? true : undefined}
                required
              />
              {fieldErrors.rawIdea && (
                <p className="mt-1 text-sm text-red-600">{fieldErrors.rawIdea}</p>
              )}
              <p className={`mt-1 text-sm ${rawIdea.length > MAX_DRAFTING_INPUT_CHARS ? 'text-red-600' : rawIdea.length > DRAFTING_INPUT_WARNING_CHARS ? 'text-orange-600' : 'text-ai-graphite-500'}`}>
                {rawIdea.length.toLocaleString()} of {MAX_DRAFTING_INPUT_CHARS.toLocaleString()} characters
                {rawIdea.length > DRAFTING_INPUT_WARNING_CHARS && rawIdea.length <= MAX_DRAFTING_INPUT_CHARS && ' — approaching the limit'}
                {rawIdea.length > MAX_DRAFTING_INPUT_CHARS && ' — over the limit'}
              </p>
              {/* Experimental Data Notice */}
              <div className="mt-3 flex items-start gap-2 px-3 py-2 bg-ai-blue-50 border border-ai-blue-100 rounded-md">
                <svg className="w-4 h-4 text-ai-blue-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-xs text-ai-blue-700">
                  <strong>Note:</strong> Include tables, equations, examples, test measurements, schemas, sequences, or exclusions here if they support the invention. Stage 0 will extract them into editable support data.
                </p>
              </div>
              {/* Supporting-data pointer: shown when the description carries measured results */}
              {hasNumericResults && (
                <div className="mt-2 flex items-start gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-md">
                  <svg className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18M8 6v12M16 6v12M4 6h16a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V7a1 1 0 011-1z" />
                  </svg>
                  <p className="text-xs text-emerald-800">
                    <strong>Experimental data detected.</strong> Later, in the Draft stage, you can paste your
                    measurements into the &quot;Detailed Description Data&quot; panel and present them as
                    formatted tables — useful for efficacy, stability, or trial results.
                  </p>
                </div>
              )}
            </div>

            {/* File Upload */}
            <div>
              <label className="block text-sm font-medium text-ai-graphite-700 mb-2">
                Or upload an idea file
              </label>
              <input
                type="file"
                accept=".txt,.md,.markdown,.csv,.tsv,.xlsx,.doc,.docx,.pdf"
                onChange={handleFileUpload}
                disabled={isFileProcessing}
                className="block w-full text-sm text-ai-graphite-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-ai-blue-50 file:text-ai-blue-700 hover:file:bg-ai-blue-100"
              />
              <p className="mt-1 text-sm text-ai-graphite-500">
                Supported formats: .txt, .md, .csv, .tsv, .xlsx, .doc, .docx, and text-based .pdf files (max {MAX_DRAFTING_UPLOAD_MB}MB, {MAX_DRAFTING_INPUT_CHARS.toLocaleString()} characters)
              </p>
              {isFileProcessing && (
                <p className="mt-1 text-xs text-ai-blue-600">
                  Extracting readable text from the file...
                </p>
              )}
              {uploadedFileName && !isFileProcessing && (
                <p className="mt-1 text-xs text-emerald-600">
                  Extracted text from {uploadedFileName} and loaded it into the description.
                </p>
              )}
              <p className="mt-1 text-xs text-amber-700">
                Note: uploading a file will replace the description text above.
              </p>
            </div>

            {extractedImages.length > 0 && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <ImageIcon className="h-4 w-4 text-slate-600" />
                    <div>
                      <div className="text-sm font-medium text-slate-900">Extracted Images</div>
                      <div className="text-xs text-slate-600">
                        {selectedExtractedImages.length} selected
                        {savedExtractedImageCount > 0 ? `, ${savedExtractedImageCount} saved` : ''} of {extractedImages.length}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setExtractedImages(prev => prev.map(image => image.status === 'saved' ? image : { ...image, selected: true, error: undefined, status: 'idle' }))}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Select all
                    </button>
                    <button
                      type="button"
                      onClick={() => setExtractedImages(prev => prev.map(image => image.status === 'saved' ? image : { ...image, selected: false, error: undefined, status: 'idle' }))}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                    >
                      <X className="h-3.5 w-3.5" />
                      Clear
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {extractedImages.map((image) => (
                    <div key={image.id} className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="relative aspect-[4/3] overflow-hidden rounded-md border border-slate-200 bg-white">
                        <img
                          src={image.dataUrl}
                          alt={image.label || image.fileName}
                          className="h-full w-full object-contain"
                        />
                        {image.status !== 'idle' && (
                          <div className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-white/95 px-2 py-1 text-xs font-medium text-slate-700 shadow-sm">
                            {image.status === 'saving' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            {image.status === 'saving' ? 'Saving' : image.status === 'saved' ? 'Queued' : 'Error'}
                          </div>
                        )}
                      </div>
                      <div className="mt-3 flex items-start justify-between gap-2">
                        <label className="flex min-w-0 items-start gap-2 text-sm text-slate-800">
                          <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-ai-blue-600"
                            checked={image.selected || image.status === 'saved'}
                            disabled={image.status === 'saved' || image.status === 'saving'}
                            onChange={(e) => toggleExtractedImage(image.id, e.target.checked)}
                          />
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{image.label || image.fileName}</span>
                            <span className="block text-xs text-slate-500">
                              {image.width && image.height ? `${image.width}x${image.height} - ` : ''}{formatImageBytes(image.size)}
                            </span>
                          </span>
                        </label>
                        <button
                          type="button"
                          title="Delete extracted image"
                          onClick={() => removeExtractedImage(image.id)}
                          disabled={image.status === 'saving' || image.status === 'saved'}
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Trash2 className="h-4 w-4" />
                          <span className="sr-only">Delete extracted image</span>
                        </button>
                      </div>
                      {image.error && (
                        <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
                          {image.error}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Idea handling — a prominent choice, no longer buried in the footer */}
            <div className="pt-2">
              <div className="text-sm font-medium text-ai-graphite-900 mb-1">How should the AI treat your text?</div>
              <p className="text-xs text-ai-graphite-500 mb-3">This controls how your idea is processed before drafting begins.</p>
              <div className="grid sm:grid-cols-2 gap-3">
                <label
                  className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                    allowRefine ? 'border-ai-blue-300 bg-ai-blue-50' : 'border-paper-300 bg-white hover:bg-paper-100'
                  }`}
                >
                  <input
                    type="radio"
                    className="mt-1 h-4 w-4 text-ai-blue-600"
                    checked={allowRefine === true}
                    onChange={() => setAllowRefine(true)}
                  />
                  <span>
                    <span className="block text-sm font-medium text-ai-graphite-900">Structure and polish</span>
                    <span className="block text-xs text-ai-graphite-600 mt-0.5">
                      Organize and refine your wording without adding technical facts. Recommended.
                    </span>
                  </span>
                </label>
                <label
                  className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                    !allowRefine ? 'border-ai-blue-300 bg-ai-blue-50' : 'border-paper-300 bg-white hover:bg-paper-100'
                  }`}
                >
                  <input
                    type="radio"
                    className="mt-1 h-4 w-4 text-ai-blue-600"
                    checked={allowRefine === false}
                    onChange={() => setAllowRefine(false)}
                  />
                  <span>
                    <span className="block text-sm font-medium text-ai-graphite-900">Keep exactly what I provided</span>
                    <span className="block text-xs text-ai-graphite-600 mt-0.5">
                      Use your text as-is, word for word.
                    </span>
                  </span>
                </label>
              </div>
            </div>
            </>
            )}

            {/* Review & create (step 3) */}
            {step === 3 && (
              <div className="space-y-4">
                <div className="rounded-lg border border-paper-300 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-ai-graphite-900">Your invention</h3>
                    <button
                      type="button"
                      onClick={() => goToStep(1)}
                      className="text-xs font-medium text-ai-blue-600 hover:text-ai-blue-500"
                    >
                      Edit
                    </button>
                  </div>
                  <dl className="space-y-2 text-sm">
                    <div className="flex gap-3">
                      <dt className="w-32 shrink-0 text-ai-graphite-500">Project</dt>
                      <dd className="text-ai-graphite-900">{selectedProjectObj?.name || '—'}</dd>
                    </div>
                    <div className="flex gap-3">
                      <dt className="w-32 shrink-0 text-ai-graphite-500">Title</dt>
                      <dd className="text-ai-graphite-900">{patentTitle || '—'}</dd>
                    </div>
                    <div className="flex gap-3">
                      <dt className="w-32 shrink-0 text-ai-graphite-500">Description</dt>
                      <dd className="text-ai-graphite-900">
                        {rawIdea.length.toLocaleString()} characters
                        {uploadedFileName ? ` · extracted from ${uploadedFileName}` : ''}
                      </dd>
                    </div>
                    {extractedImages.length > 0 && (
                      <div className="flex gap-3">
                        <dt className="w-32 shrink-0 text-ai-graphite-500">Figures</dt>
                        <dd className="text-ai-graphite-900">
                          {selectedExtractedImages.length} extracted image{selectedExtractedImages.length === 1 ? '' : 's'} will be attached
                        </dd>
                      </div>
                    )}
                    <div className="flex gap-3">
                      <dt className="w-32 shrink-0 text-ai-graphite-500">Idea handling</dt>
                      <dd className="text-ai-graphite-900">
                        {allowRefine ? 'Structure and polish (no new technical facts)' : 'Keep exactly as provided'}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="rounded-lg border border-paper-300 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-ai-graphite-900">Jurisdictions & languages</h3>
                    <button
                      type="button"
                      onClick={() => goToStep(2)}
                      className="text-xs font-medium text-ai-blue-600 hover:text-ai-blue-500"
                    >
                      Edit
                    </button>
                  </div>
                  <dl className="space-y-2 text-sm">
                    <div className="flex gap-3">
                      <dt className="w-32 shrink-0 text-ai-graphite-500">Jurisdictions</dt>
                      <dd className="text-ai-graphite-900">
                        {(mode === 'single' ? selectedCodes.slice(0, 1) : selectedCodes)
                          .map(code => availableCountries.find(c => c.code === code)?.label || code)
                          .join(', ') || '—'}
                      </dd>
                    </div>
                    <div className="flex gap-3">
                      <dt className="w-32 shrink-0 text-ai-graphite-500">Language</dt>
                      <dd className="text-ai-graphite-900">
                        {languageMode === 'common'
                          ? `Common — ${LANGUAGE_LABELS[commonLanguage] || commonLanguage}`
                          : 'Per jurisdiction (figures in English)'}
                      </dd>
                    </div>
                    <div className="flex gap-3">
                      <dt className="w-32 shrink-0 text-ai-graphite-500">Figures</dt>
                      <dd className="text-ai-graphite-900">{LANGUAGE_LABELS[figuresLanguage] || figuresLanguage}</dd>
                    </div>
                  </dl>
                </div>

                <p className="text-xs text-ai-graphite-500">
                  Creating the draft runs Stage 0 analysis on your idea. You can review and edit everything in the later drafting stages.
                </p>
              </div>
            )}

            {/* Footer navigation */}
            <div className="flex items-center justify-between gap-4 pt-6 border-t border-paper-300">
              {step === 1 ? (
                <Link
                  href="/dashboard"
                  className="inline-flex items-center px-4 py-2 border border-paper-400 text-sm font-medium rounded-lg text-ai-graphite-700 bg-white hover:bg-paper-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                >
                  Cancel
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => goToStep((step - 1) as WizardStep)}
                  className="inline-flex items-center px-4 py-2 border border-paper-400 text-sm font-medium rounded-lg text-ai-graphite-700 bg-white hover:bg-paper-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                >
                  Back
                </button>
              )}

              {step < 3 ? (
                <button
                  type="button"
                  onClick={handleContinue}
                  disabled={isFileProcessing}
                  className="inline-flex items-center px-6 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-ai-blue-600 hover:bg-ai-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ai-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Continue
                  <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ) : (
                <button
                  onClick={handleCreateDraft}
                  disabled={isCreating || isFileProcessing}
                  className="inline-flex items-center px-6 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-ai-blue-600 hover:bg-ai-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ai-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isCreating ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-3"></div>
                      Creating...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Start drafting
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}

export default function NewPatentDraftPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-paper-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-ai-blue-600"></div>
      </div>
    }>
      <NewPatentDraftPageContent />
    </Suspense>
  )
}
