'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, CalendarRange, ChevronDown, CheckCircle2, Database, FileText, FolderOpen, Globe2, History, ListChecks, Loader2, Plus, RefreshCw, Search, SlidersHorizontal, Sparkles, Trash2, Upload, X } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import {
  DEFAULT_PATENT_COUNTRY_CODES,
  listPatentCountries,
} from '@/lib/patent-search/patent-countries'

type Project = { id: string; name: string }
type MatterGroup = { id: string; name: string; referenceCode?: string | null; client: { id: string; name: string } }
type SearchPath = 'automatic' | 'manual'
type Stage0Review = {
  searchQuery: string
  inventionFeatures: string[]
  featureDetails?: Array<{ feature: string; [key: string]: unknown }>
  epoTitleKeywords?: string[]
  epoAbstractKeywords?: string[]
  epoCombinedKeywords?: string[]
  paperSearchQuery?: string
  paperKeywords?: string[]
  paperSearchQueries?: string[]
  googleScholarSearchQuery?: string
  academicDatabaseSearchQuery?: string
  paperYearFrom?: number
  paperYearTo?: number
  [key: string]: unknown
}

const literatureSources = [
  { id: 'google_scholar', label: 'Google Scholar' },
  { id: 'semantic_scholar', label: 'Semantic Scholar' },
  { id: 'crossref', label: 'Crossref' },
  { id: 'openalex', label: 'OpenAlex' },
  { id: 'pubmed', label: 'PubMed' },
  { id: 'arxiv', label: 'arXiv' },
  { id: 'core', label: 'CORE' },
]

// Paced to cover the ~30–40s the model typically takes to prepare the plan, so
// the progress never stalls at "done" while the request is still running. The
// final entries are gentle reassurances in case the model takes a little longer.
const queryPreparationStages = [
  {
    label: 'Reading the disclosure',
    detail: 'Identifying the problem, core mechanism, and technical field from your invention text.',
  },
  {
    label: 'Extracting claim-worthy features',
    detail: 'Separating the inventive features from background context and worked examples.',
  },
  {
    label: 'Mapping the inventive concept',
    detail: 'Grouping related features into the distinct ideas that define your novelty.',
  },
  {
    label: 'Building patent retrieval language',
    detail: 'Translating each feature into search terms that patent databases can match.',
  },
  {
    label: 'Expanding synonyms and variants',
    detail: 'Adding alternate terminology and technical equivalents so relevant art is not missed.',
  },
  {
    label: 'Aligning with patent classifications',
    detail: 'Relating your concept to the IPC/CPC technology areas examiners use.',
  },
  {
    label: 'Balancing broad and narrow terms',
    detail: 'Tuning the query so retrieval is neither too generic nor too restrictive.',
  },
  {
    label: 'Cross-checking feature coverage',
    detail: 'Making sure every key feature is represented in the search plan.',
  },
  {
    label: 'Filtering out noisy terms',
    detail: 'Dropping ambiguous words that would pull in unrelated prior art.',
  },
  {
    label: 'Assembling your review plan',
    detail: 'Formatting the query and feature list for your approval before retrieval starts.',
  },
  {
    label: 'Almost ready',
    detail: 'Finalizing and validating the plan — this can take a few more moments.',
  },
]
type ManualFields = {
  anyText: string
  title: string
  abstract: string
  patentText: string
  applicant: string
  inventor: string
  publicationNumber: string
  applicationNumber: string
  classifications: string
  filingFrom: string
  filingTo: string
  publicationFrom: string
  publicationTo: string
  excludeTerms: string
}
type ManualResult = {
  publicationNumber: string
  title: string
  abstract?: string | null
  snippet?: string | null
  publicationDate?: string | null
  filingDate?: string | null
  applicants?: unknown
  inventors?: string[]
  sourceProvider?: string
  sourceProviders?: string[]
  link?: string | null
  relevanceScore?: number | null
}

const defaultManualFields: ManualFields = {
  anyText: '',
  title: '',
  abstract: '',
  patentText: '',
  applicant: '',
  inventor: '',
  publicationNumber: '',
  applicationNumber: '',
  classifications: '',
  filingFrom: '',
  filingTo: '',
  publicationFrom: '',
  publicationTo: '',
  excludeTerms: '',
}

function splitValues(value: string) {
  return value.split(/[,;\n]/).map(item => item.trim()).filter(Boolean)
}

// Retrieval always runs against the stored corpus — ~45M Google Patents records plus
// the IPIndia corpus — searched with Voyage embeddings and reranking. Users pick
// countries, not data sources; live provider APIs are a server-side fallback that only
// fires when the corpus returns nothing, so there is no source picker to expose.
const LOCAL_CORPUS_PROVIDER_IDS = ['google-patents-corpus', 'indian-corpus']

const PATENT_COUNTRIES = listPatentCountries()
const PRIMARY_COUNTRIES = PATENT_COUNTRIES.filter(country => country.primary)
const SECONDARY_COUNTRIES = PATENT_COUNTRIES.filter(country => !country.primary)

function listText(value: unknown, limit = 4) {
  if (!value) return ''
  const values = Array.isArray(value)
    ? value.map(item => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>
        return String(record.name || record.applicant || record.value || '').trim()
      }
      return String(item || '').trim()
    })
    : typeof value === 'object'
      ? Object.values(value as Record<string, unknown>).map(item => String(item || '').trim())
      : [String(value)]
  return values.filter(Boolean).slice(0, limit).join(', ')
}

function displayPatentNationality(value: unknown) {
  const raw = String(value || '').trim()
  const normalized = raw.toLowerCase()
  if (normalized === 'indian-corpus' || /indian patent/i.test(raw)) return 'Indian patents'
  if (normalized === 'pqai' || normalized === 'pqai-corpus' || /international/i.test(raw) || /pqai/i.test(raw)) return 'International patents'
  if (normalized === 'epo-ops' || normalized === 'epo-ops-corpus' || /european/i.test(raw) || /epo/i.test(raw)) return 'European patents'
  if (normalized === 'ip-australia' || /australia/i.test(raw)) return 'Australian patents'
  if (normalized === 'google-patents-bigquery' || /google patents bigquery/i.test(raw)) return 'Google Patents BigQuery'
  if (normalized === 'google-patents' || /google patents/i.test(raw)) return 'Google Patents'
  return raw
}

function displayPatentNationalities(values: unknown[]) {
  return Array.from(new Set(values.map(displayPatentNationality).filter(Boolean))).join(', ')
}

export default function NoveltySearchSubmission(props: {
  initialProjectId?: string
  initialTitle?: string
  initialDescription?: string
  sourceMetadata?: {
    source: string
    sessionId?: string
    ideaFrameId?: string
    ideaId?: string
    [key: string]: unknown
  }
  onQueued?: (searchId: string) => void | Promise<void>
}) {
  const router = useRouter()
  const { authFetch } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState(props.initialTitle || '')
  const [description, setDescription] = useState(props.initialDescription || '')
  const [projectId, setProjectId] = useState(props.initialProjectId || '')
  const [groupId, setGroupId] = useState('')
  const jurisdiction = 'IN'
  const [searchPath, setSearchPath] = useState<SearchPath>('automatic')
  // Two-step automatic flow: describe the invention, then review the plan on a
  // dedicated screen before approving. 'review' is only meaningful when `review` is set.
  const [view, setView] = useState<'setup' | 'review'>('setup')
  // Fixed, not stateful: the corpus lane is the only primary source. Live provider APIs
  // are chosen server-side as a fallback when the corpus returns nothing.
  const selectedProviderIds = LOCAL_CORPUS_PROVIDER_IDS
  const [selectedCountries, setSelectedCountries] = useState<string[]>(DEFAULT_PATENT_COUNTRY_CODES)
  const [showAllCountries, setShowAllCountries] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [filingFrom, setFilingFrom] = useState('')
  const [filingTo, setFilingTo] = useState('')
  const [publicationFrom, setPublicationFrom] = useState('')
  const [publicationTo, setPublicationTo] = useState('')
  const [projects, setProjects] = useState<Project[]>([])
  const [groups, setGroups] = useState<MatterGroup[]>([])
  const [review, setReview] = useState<Stage0Review | null>(null)
  const [editedSearchQuery, setEditedSearchQuery] = useState('')
  const [editedFeatures, setEditedFeatures] = useState<string[]>([])
  const [editedEpoTitleKeywords, setEditedEpoTitleKeywords] = useState<string[]>([])
  const [editedEpoAbstractKeywords, setEditedEpoAbstractKeywords] = useState<string[]>([])
  const [includePapers, setIncludePapers] = useState(false)
  const [paperSources, setPaperSources] = useState<string[]>(['google_scholar', 'semantic_scholar', 'crossref'])
  const [paperYearFrom, setPaperYearFrom] = useState('')
  const [paperYearTo, setPaperYearTo] = useState('')
  const [paperLimit, setPaperLimit] = useState('20')
  const [paperOpenAccessOnly, setPaperOpenAccessOnly] = useState(false)
  const [paperHasAbstract, setPaperHasAbstract] = useState(true)
  const [paperMinCitations, setPaperMinCitations] = useState('0')
  const [editedPaperSearchQuery, setEditedPaperSearchQuery] = useState('')
  const [editedGoogleScholarSearchQuery, setEditedGoogleScholarSearchQuery] = useState('')
  const [editedAcademicDatabaseSearchQuery, setEditedAcademicDatabaseSearchQuery] = useState('')
  const [editedPaperSearchQueries, setEditedPaperSearchQueries] = useState<string[]>([])
  const [editedPaperKeywords, setEditedPaperKeywords] = useState<string[]>([])
  const [newPaperKeyword, setNewPaperKeyword] = useState('')
  const [newPaperSearchQuery, setNewPaperSearchQuery] = useState('')
  const [newEpoTitleKeyword, setNewEpoTitleKeyword] = useState('')
  const [newEpoAbstractKeyword, setNewEpoAbstractKeyword] = useState('')
  const [newFeature, setNewFeature] = useState('')
  const [isPreparing, setIsPreparing] = useState(false)
  const [preparationStageIndex, setPreparationStageIndex] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isExtracting, setIsExtracting] = useState(false)
  const [uploadedName, setUploadedName] = useState('')
  const [error, setError] = useState('')
  const [manualFields, setManualFields] = useState<ManualFields>(defaultManualFields)
  const [manualResults, setManualResults] = useState<ManualResult[]>([])
  const [manualWarnings, setManualWarnings] = useState<string[]>([])
  const [manualProviderStats, setManualProviderStats] = useState<any[]>([])
  const [manualHasSearched, setManualHasSearched] = useState(false)
  const [isManualSearching, setIsManualSearching] = useState(false)

  useEffect(() => {
    // The provider list is no longer fetched: retrieval always runs against the local
    // corpus and users choose countries, not sources, so there is nothing to populate.
    Promise.all([
      authFetch('/api/projects').then(response => response.ok ? response.json() : { projects: [] }),
      authFetch('/api/novelty-search/groups').then(response => response.ok ? response.json() : { groups: [] }),
    ]).then(([projectData, groupData]) => {
      const nextProjects = projectData.projects || []
      setProjects(nextProjects)
      setGroups(groupData.groups || [])
      if (!props.initialProjectId && nextProjects.length) {
        setProjectId(nextProjects.find((project: Project) => project.name === 'Default Project')?.id || nextProjects[0].id)
      }
    }).catch(() => setError('Failed to load search organization options.'))
  }, [authFetch, props.initialProjectId])

  useEffect(() => {
    if (!isPreparing) {
      setPreparationStageIndex(0)
      return
    }

    const interval = window.setInterval(() => {
      setPreparationStageIndex(current => Math.min(current + 1, queryPreparationStages.length - 1))
    }, 2900)

    return () => window.clearInterval(interval)
  }, [isPreparing])

  const sourceMode = 'LOCAL_CORPUS'
  // European keyword fields only matter when the EPO provider is in play, which is now
  // a server-side fallback rather than a user choice.
  const usesEpoSearch = false
  const hasSelectedSources = selectedCountries.length > 0 || (includePapers && paperSources.length > 0)
  const dateFilters = useMemo(() => ({
    ...(filingFrom ? { filingDateFrom: filingFrom } : {}),
    ...(filingTo ? { filingDateTo: filingTo } : {}),
    ...(publicationFrom ? { publicationDateFrom: publicationFrom } : {}),
    ...(publicationTo ? { publicationDateTo: publicationTo } : {}),
  }), [filingFrom, filingTo, publicationFrom, publicationTo])
  const hasDateFilters = Object.keys(dateFilters).length > 0
  const searchSourceConfig = {
    mode: sourceMode,
    providerIds: selectedProviderIds,
    searchMode: 'intelligent' as const,
    llmExpansion: true,
    includePatents: selectedCountries.length > 0,
    // Country and date scope ride along as corpus filters; the retrieval SQL applies
    // them, so a narrowed search never pays for candidates it will discard.
    filters: {
      countries: selectedCountries,
      ...dateFilters,
    },
    includePapers,
    paperSources,
    paperSearchQuery: editedPaperSearchQuery.trim() || undefined,
    paperFilters: {
      yearFrom: paperYearFrom ? Number(paperYearFrom) : undefined,
      yearTo: paperYearTo ? Number(paperYearTo) : undefined,
      limit: Math.max(1, Math.min(100, Number(paperLimit) || 20)),
      openAccessOnly: paperOpenAccessOnly,
      hasAbstract: paperHasAbstract,
      minCitations: Math.max(0, Number(paperMinCitations) || 0),
    },
  }
  const allCountriesSelected = selectedCountries.length === PATENT_COUNTRIES.length
  const countryScopeLabel = useMemo(() => {
    if (!selectedCountries.length) return 'No countries selected'
    if (allCountriesSelected) return 'All countries'
    const names = selectedCountries
      .map(code => PATENT_COUNTRIES.find(country => country.code === code)?.name)
      .filter(Boolean) as string[]
    if (names.length <= 3) return names.join(', ')
    return `${names.slice(0, 3).join(', ')} +${names.length - 3} more`
  }, [selectedCountries, allCountriesSelected])

  const preparationStage = queryPreparationStages[preparationStageIndex] || queryPreparationStages[0]
  // Approach but never claim 100% until the request actually returns, so the bar
  // doesn't read as "finished" while the model is still working.
  const preparationProgress = Math.min(95, Math.round(((preparationStageIndex + 1) / queryPreparationStages.length) * 96))

  const manualFilters = useMemo(() => ({
    anyTextContains: splitValues(manualFields.anyText),
    titleContains: splitValues(manualFields.title),
    abstractContains: splitValues(manualFields.abstract),
    patentTextContains: splitValues(manualFields.patentText),
    publicationNumber: manualFields.publicationNumber.trim() || undefined,
    applicationNumber: manualFields.applicationNumber.trim() || undefined,
    applicants: splitValues(manualFields.applicant),
    inventors: splitValues(manualFields.inventor),
    classifications: splitValues(manualFields.classifications),
    filingDateFrom: manualFields.filingFrom || undefined,
    filingDateTo: manualFields.filingTo || undefined,
    publicationDateFrom: manualFields.publicationFrom || undefined,
    publicationDateTo: manualFields.publicationTo || undefined,
    excludeTerms: splitValues(manualFields.excludeTerms),
  }), [manualFields])

  const manualHasCriteria = useMemo(() => Object.values(manualFilters).some(value => (
    Array.isArray(value) ? value.length > 0 : value !== undefined && value !== ''
  )), [manualFilters])

  const stringList = (value: unknown) => Array.isArray(value)
    ? value.map(item => String(item || '').trim()).filter(Boolean)
    : []

  const extractFile = async (file: File) => {
    const allowed = ['.txt', '.md', '.markdown', '.csv', '.tsv', '.xlsx', '.doc', '.docx', '.pdf']
    if (!allowed.some(extension => file.name.toLowerCase().endsWith(extension))) {
      setError('Unsupported file type. Upload a text-based PDF, DOC/DOCX, spreadsheet, Markdown, CSV, or TXT file.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('File size must be less than 5 MB.')
      return
    }
    setIsExtracting(true)
    setError('')
    const form = new FormData()
    form.append('file', file)
    try {
      const response = await authFetch('/api/patent-search/ingest-file', { method: 'POST', body: form })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Failed to extract text from the file.')
      setDescription(body.textContent || '')
      setReview(null)
      setUploadedName(body.fileName || file.name)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to extract text from the file.')
    } finally {
      setIsExtracting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const prepareReview = async () => {
    if (!title.trim() || !description.trim()) {
      setError('Invention title and description are required.')
      return
    }
    if (!hasSelectedSources) {
      setError('Select at least one patent or scholarly-paper source.')
      return
    }
    setIsPreparing(true)
    setPreparationStageIndex(0)
    setError('')
    try {
      const response = await authFetch('/api/novelty-search/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          inventionDescription: description.trim(),
          jurisdiction,
          config: {
            jurisdiction,
            ...(props.sourceMetadata ? { sourceMetadata: props.sourceMetadata } : {}),
            searchSource: searchSourceConfig,
          },
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Failed to generate search terms.')
      const proposed = body.stage0 as Stage0Review
      const features = Array.isArray(proposed?.inventionFeatures) ? proposed.inventionFeatures.map(String).filter(Boolean) : []
      if (!proposed?.searchQuery || features.length === 0) throw new Error('The generated search plan was incomplete. Please regenerate it.')
      setReview(proposed)
      setEditedSearchQuery(String(proposed.searchQuery))
      setEditedFeatures(features)
      setEditedEpoTitleKeywords(usesEpoSearch ? stringList(proposed.epoTitleKeywords) : [])
      setEditedEpoAbstractKeywords(usesEpoSearch ? stringList(proposed.epoAbstractKeywords) : [])
      setEditedPaperSearchQuery(includePapers ? String(proposed.paperSearchQuery || proposed.searchQuery || '') : '')
      setEditedGoogleScholarSearchQuery(includePapers ? String(proposed.googleScholarSearchQuery || proposed.paperSearchQuery || proposed.searchQuery || '') : '')
      setEditedAcademicDatabaseSearchQuery(includePapers ? String(proposed.academicDatabaseSearchQuery || proposed.paperSearchQuery || proposed.searchQuery || '') : '')
      setEditedPaperSearchQueries(includePapers ? stringList(proposed.paperSearchQueries) : [])
      setEditedPaperKeywords(includePapers ? stringList(proposed.paperKeywords) : [])
      if (includePapers && !paperYearFrom) setPaperYearFrom(String(proposed.paperYearFrom || 1900))
      if (includePapers && !paperYearTo) setPaperYearTo(String(proposed.paperYearTo || new Date().getFullYear()))
      setNewFeature('')
      setNewEpoTitleKeyword('')
      setNewEpoAbstractKeyword('')
      setView('review')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to generate search terms.')
    } finally {
      setIsPreparing(false)
    }
  }

  const submit = async () => {
    const approvedQuery = editedSearchQuery.trim()
    const approvedFeatures = editedFeatures.map(feature => feature.trim()).filter(Boolean)
    if (!review || !approvedQuery || approvedFeatures.length === 0) {
      setError('Review and approve a search query and at least one invention feature.')
      return
    }
    if (!hasSelectedSources) {
      setError('Select at least one patent or scholarly-paper source.')
      return
    }
    setIsSubmitting(true)
    setError('')
    try {
      const approvedStage0 = {
        ...review,
        searchQuery: approvedQuery,
        inventionFeatures: approvedFeatures,
        ...(usesEpoSearch ? {
          epoTitleKeywords: editedEpoTitleKeywords.map(keyword => keyword.trim()).filter(Boolean),
          epoAbstractKeywords: editedEpoAbstractKeywords.map(keyword => keyword.trim()).filter(Boolean),
          epoCombinedKeywords: stringList(review.epoCombinedKeywords),
        } : {}),
        ...(includePapers ? {
          paperSearchQuery: editedPaperSearchQuery.trim() || approvedQuery,
          googleScholarSearchQuery: editedGoogleScholarSearchQuery.trim() || editedPaperSearchQuery.trim() || approvedQuery,
          academicDatabaseSearchQuery: editedAcademicDatabaseSearchQuery.trim() || editedPaperSearchQuery.trim() || approvedQuery,
          paperSearchQueries: editedPaperSearchQueries.map(query => query.trim()).filter(Boolean),
          paperKeywords: editedPaperKeywords.map(keyword => keyword.trim()).filter(Boolean),
          paperYearFrom: paperYearFrom ? Number(paperYearFrom) : 1900,
          paperYearTo: paperYearTo ? Number(paperYearTo) : new Date().getFullYear(),
        } : {}),
      }
      if (!usesEpoSearch) {
        delete (approvedStage0 as any).epoTitleKeywords
        delete (approvedStage0 as any).epoAbstractKeywords
        delete (approvedStage0 as any).epoCombinedKeywords
      }
      const response = await authFetch('/api/novelty-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          inventionDescription: description.trim(),
          projectId: projectId || undefined,
          groupId: groupId || undefined,
          jurisdiction,
          config: {
            jurisdiction,
            ...(props.sourceMetadata ? { sourceMetadata: props.sourceMetadata } : {}),
            searchSource: searchSourceConfig,
          },
          approvedStage0,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Failed to queue novelty search.')
      if (body.searchId && props.onQueued) {
        await props.onQueued(String(body.searchId))
      }
      router.push(`/novelty-search/history?highlight=${encodeURIComponent(body.searchId)}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to queue novelty search.')
      setIsSubmitting(false)
    }
  }

  const updateFeature = (index: number, value: string) => {
    setEditedFeatures(current => current.map((feature, featureIndex) => featureIndex === index ? value : feature))
  }

  const addFeature = () => {
    const value = newFeature.trim()
    if (!value || editedFeatures.some(feature => feature.trim().toLowerCase() === value.toLowerCase())) return
    setEditedFeatures(current => [...current, value])
    setNewFeature('')
  }

  const updateKeyword = (kind: 'title' | 'abstract', index: number, value: string) => {
    const setter = kind === 'title' ? setEditedEpoTitleKeywords : setEditedEpoAbstractKeywords
    setter(current => current.map((keyword, keywordIndex) => keywordIndex === index ? value : keyword))
  }

  const removeKeyword = (kind: 'title' | 'abstract', index: number) => {
    const setter = kind === 'title' ? setEditedEpoTitleKeywords : setEditedEpoAbstractKeywords
    setter(current => current.filter((_, keywordIndex) => keywordIndex !== index))
  }

  const addKeyword = (kind: 'title' | 'abstract') => {
    const value = (kind === 'title' ? newEpoTitleKeyword : newEpoAbstractKeyword).trim()
    if (!value) return
    const setter = kind === 'title' ? setEditedEpoTitleKeywords : setEditedEpoAbstractKeywords
    setter(current => current.some(keyword => keyword.trim().toLowerCase() === value.toLowerCase()) ? current : [...current, value])
    if (kind === 'title') setNewEpoTitleKeyword('')
    else setNewEpoAbstractKeyword('')
  }

  // Changing scope invalidates the generated plan, so the user re-approves rather than
  // silently running an approved query against a different corpus slice.
  const toggleCountry = (code: string) => {
    setSelectedCountries(current => current.includes(code)
      ? current.filter(value => value !== code)
      : [...current, code])
    setReview(null)
  }

  const selectAllCountries = () => {
    setSelectedCountries(PATENT_COUNTRIES.map(country => country.code))
    setReview(null)
  }

  const selectMajorCountries = () => {
    setSelectedCountries(DEFAULT_PATENT_COUNTRY_CODES)
    setReview(null)
  }

  const clearCountries = () => {
    setSelectedCountries([])
    setReview(null)
  }

  const clearDateFilters = () => {
    setFilingFrom('')
    setFilingTo('')
    setPublicationFrom('')
    setPublicationTo('')
    setReview(null)
  }

  const updateManualField = (field: keyof ManualFields, value: string) => {
    setManualFields(current => ({ ...current, [field]: value }))
  }

  const runManualSearch = async () => {
    if (!manualHasCriteria) {
      setError('Enter at least one manual patent search field.')
      return
    }
    if (!selectedCountries.length) {
      setError('Select at least one patent office.')
      return
    }
    setIsManualSearching(true)
    setError('')
    setManualHasSearched(true)
    try {
      const response = await authFetch('/api/patent-search/advanced', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          searchMode: 'manual',
          filters: { ...manualFilters, countries: selectedCountries },
          providerIds: selectedProviderIds,
          jurisdictions: selectedCountries,
          sourceMode,
          llmExpansion: false,
          limit: 50,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Manual patent search failed.')
      setManualResults(Array.isArray(body.results) ? body.results : [])
      setManualWarnings(Array.isArray(body.warnings) ? body.warnings : [])
      setManualProviderStats(Array.isArray(body.providerStats) ? body.providerStats : [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Manual patent search failed.')
    } finally {
      setIsManualSearching(false)
    }
  }

  const renderCountryChip = (country: { code: string; name: string; kind: string }) => {
    const checked = selectedCountries.includes(country.code)
    const disabled = isPreparing || isSubmitting || isManualSearching
    return (
      <button
        key={country.code}
        type="button"
        role="checkbox"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => toggleCountry(country.code)}
        className={`group flex min-h-11 items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ai-blue-500/40 ${
          checked
            ? 'border-ai-blue-300 bg-ai-blue-50 text-ai-blue-900'
            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
        }`}
      >
        <span
          aria-hidden
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
            checked ? 'border-ai-blue-600 bg-ai-blue-600 text-white' : 'border-slate-300 bg-white'
          }`}
        >
          {checked && <CheckCircle2 className="h-3.5 w-3.5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{country.name}</span>
        </span>
        <span className={`shrink-0 font-mono text-[11px] ${checked ? 'text-ai-blue-600' : 'text-slate-400'}`}>
          {country.code}
        </span>
      </button>
    )
  }

  const renderSourceSelection = (showLiterature = true) => (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ai-blue-50 text-ai-blue-600">
            <Globe2 className="h-5 w-5" />
          </span>
          <div>
            <div className="text-sm font-semibold text-slate-900">Patent offices to search</div>
            <p className="mt-1 max-w-prose text-xs leading-5 text-slate-500">
              Searched against our stored patent corpus using semantic embeddings and reranking.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 text-xs font-medium">
          <button type="button" onClick={selectMajorCountries} className="rounded-lg px-2.5 py-1.5 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900">Major offices</button>
          <button type="button" onClick={selectAllCountries} className="rounded-lg px-2.5 py-1.5 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900">Select all</button>
          <button type="button" onClick={clearCountries} className="rounded-lg px-2.5 py-1.5 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900">Clear</button>
        </div>
      </div>

      <div role="group" aria-label="Patent offices" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {PRIMARY_COUNTRIES.map(renderCountryChip)}
      </div>

      {showAllCountries && (
        <div role="group" aria-label="Additional patent offices" className="grid gap-2 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-3">
          {SECONDARY_COUNTRIES.map(renderCountryChip)}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setShowAllCountries(current => !current)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-ai-blue-700 transition-colors hover:text-ai-blue-800"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAllCountries ? 'rotate-180' : ''}`} />
          {showAllCountries ? 'Show fewer offices' : `Show ${SECONDARY_COUNTRIES.length} more offices`}
        </button>
        <span className="text-xs text-slate-500">
          {selectedCountries.length} of {PATENT_COUNTRIES.length} selected
        </span>
      </div>

      {!selectedCountries.length && !includePapers && (
        <p className="text-xs font-medium text-red-600">Select at least one patent office, or enable scholarly papers below.</p>
      )}

      {showLiterature && (
        <div className="space-y-3 border-t border-slate-200 pt-4">
          <button
            type="button"
            onClick={() => setAdvancedOpen(current => !current)}
            aria-expanded={advancedOpen}
            className="flex w-full items-center justify-between gap-3 rounded-xl px-1 py-1 text-left transition-colors hover:bg-slate-50"
          >
            <span className="flex items-center gap-2.5">
              <SlidersHorizontal className="h-4 w-4 text-slate-500" />
              <span className="text-sm font-medium text-slate-800">Advanced options</span>
              {hasDateFilters && (
                <span className="inline-flex items-center rounded-full bg-ai-blue-50 px-2 py-0.5 text-[11px] font-semibold text-ai-blue-700">
                  Date filtered
                </span>
              )}
            </span>
            <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
          </button>

          {advancedOpen && (
            <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CalendarRange className="h-4 w-4 text-slate-500" />
                  <span className="text-sm font-medium text-slate-800">Patent date range</span>
                </div>
                {hasDateFilters && (
                  <button type="button" onClick={clearDateFilters} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition-colors hover:text-slate-800">
                    <X className="h-3 w-3" /> Clear dates
                  </button>
                )}
              </div>
              <p className="text-xs leading-5 text-slate-500">
                Restrict prior art by filing or publication date. Leave blank to search the full corpus.
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-xs font-medium text-slate-600">Filed from
                  <input type="date" value={filingFrom} onChange={event => { setFilingFrom(event.target.value); setReview(null) }} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-slate-900 outline-none focus:border-ai-blue-400 focus:ring-2 focus:ring-ai-blue-500/15" />
                </label>
                <label className="text-xs font-medium text-slate-600">Filed to
                  <input type="date" value={filingTo} onChange={event => { setFilingTo(event.target.value); setReview(null) }} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-slate-900 outline-none focus:border-ai-blue-400 focus:ring-2 focus:ring-ai-blue-500/15" />
                </label>
                <label className="text-xs font-medium text-slate-600">Published from
                  <input type="date" value={publicationFrom} onChange={event => { setPublicationFrom(event.target.value); setReview(null) }} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-slate-900 outline-none focus:border-ai-blue-400 focus:ring-2 focus:ring-ai-blue-500/15" />
                </label>
                <label className="text-xs font-medium text-slate-600">Published to
                  <input type="date" value={publicationTo} onChange={event => { setPublicationTo(event.target.value); setReview(null) }} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-slate-900 outline-none focus:border-ai-blue-400 focus:ring-2 focus:ring-ai-blue-500/15" />
                </label>
              </div>
            </div>
          )}
          <label className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors ${includePapers ? 'border-ai-blue-300 bg-ai-blue-50 text-ai-blue-900' : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50'}`}>
            <input
              type="checkbox"
              checked={includePapers}
              disabled={isPreparing || isSubmitting}
              onChange={event => { setIncludePapers(event.target.checked); setReview(null) }}
              className="h-4 w-4 accent-ai-blue-600"
            />
            <span className="flex-1">
              <span className="font-medium">Scholarly papers</span>
              <span className="ml-2 text-xs text-slate-500">also search academic publications as prior art</span>
            </span>
          </label>
          {includePapers && (
            <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">Academic databases</div>
                <div className="mt-1 text-xs text-slate-500">Select one or more publication indexes.</div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {literatureSources.map(source => (
                  <label key={source.id} className="flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={paperSources.includes(source.id)}
                      onChange={() => setPaperSources(current => current.includes(source.id) ? current.filter(id => id !== source.id) : [...current, source.id])}
                      className="h-4 w-4"
                    />
                    {source.label}
                  </label>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="text-xs font-medium text-slate-600">Published from
                  <input type="number" min="1800" max="2100" value={paperYearFrom} onChange={event => setPaperYearFrom(event.target.value)} placeholder="e.g. 2000" className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal text-slate-900" />
                </label>
                <label className="text-xs font-medium text-slate-600">Published to
                  <input type="number" min="1800" max="2100" value={paperYearTo} onChange={event => setPaperYearTo(event.target.value)} placeholder={String(new Date().getFullYear())} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal text-slate-900" />
                </label>
                <label className="text-xs font-medium text-slate-600">Maximum papers
                  <input type="number" min="1" max="100" value={paperLimit} onChange={event => setPaperLimit(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal text-slate-900" />
                </label>
                <label className="text-xs font-medium text-slate-600">Minimum citations
                  <input type="number" min="0" value={paperMinCitations} onChange={event => setPaperMinCitations(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal text-slate-900" />
                </label>
                <label className="flex h-10 items-center gap-2 self-end text-sm text-slate-700"><input type="checkbox" checked={paperHasAbstract} onChange={event => setPaperHasAbstract(event.target.checked)} className="h-4 w-4" /> Require abstract</label>
                <label className="flex h-10 items-center gap-2 self-end text-sm text-slate-700"><input type="checkbox" checked={paperOpenAccessOnly} onChange={event => setPaperOpenAccessOnly(event.target.checked)} className="h-4 w-4" /> Open access only</label>
              </div>
              {!paperSources.length && <div className="text-xs font-medium text-red-600">Select at least one academic database.</div>}
            </div>
          )}
        </div>
      )}
    </section>
  )

  const renderManualInput = (field: keyof ManualFields, label: string, placeholder = '', multiline = false) => (
    <label className="text-xs font-medium text-slate-600">
      {label}
      {multiline ? (
        <textarea
          value={manualFields[field]}
          onChange={event => updateManualField(field, event.target.value)}
          rows={2}
          placeholder={placeholder}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-ai-blue-500"
        />
      ) : (
        <input
          value={manualFields[field]}
          onChange={event => updateManualField(field, event.target.value)}
          placeholder={placeholder}
          type={field.endsWith('From') || field.endsWith('To') ? 'date' : 'text'}
          className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal text-slate-900 outline-none focus:border-ai-blue-500"
        />
      )}
    </label>
  )

  const renderManualSearch = () => (
    <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      {renderSourceSelection(false)}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Manual Patent Search</h2>
          <p className="mt-1 text-sm text-slate-500">Search selected patent nationalities using fielded criteria.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {renderManualInput('anyText', 'Any text', 'Keywords across patent fields', true)}
          {renderManualInput('title', 'Patent title', 'Title keywords', true)}
          {renderManualInput('abstract', 'Abstract', 'Abstract keywords', true)}
          {renderManualInput('publicationNumber', 'Publication no.', 'US2024...', false)}
          {renderManualInput('applicationNumber', 'Application no.', 'Application number', false)}
          {renderManualInput('applicant', 'Applicant / assignee', 'Company or assignee', false)}
          {renderManualInput('inventor', 'Inventor', 'Inventor name', false)}
          {renderManualInput('classifications', 'IPC/CPC', 'A61B, G06F...', false)}
          {renderManualInput('patentText', 'Patent text', 'Claims/specification keywords', true)}
          {renderManualInput('filingFrom', 'Filing from')}
          {renderManualInput('filingTo', 'Filing to')}
          {renderManualInput('publicationFrom', 'Published from')}
          {renderManualInput('publicationTo', 'Published to')}
          {renderManualInput('excludeTerms', 'Exclude terms', 'Comma-separated terms', true)}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void runManualSearch()}
            disabled={isManualSearching || !manualHasCriteria || !selectedCountries.length}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-ai-blue-600 px-5 text-sm font-medium text-white hover:bg-ai-blue-700 disabled:opacity-50"
          >
            {isManualSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {isManualSearching ? 'Searching patents...' : 'Search Patents'}
          </button>
          <button
            type="button"
            onClick={() => {
              setManualFields(defaultManualFields)
              setManualResults([])
              setManualWarnings([])
              setManualProviderStats([])
              setManualHasSearched(false)
              setError('')
            }}
            className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Clear
          </button>
        </div>
      </section>

      {(manualProviderStats.length > 0 || manualWarnings.length > 0 || manualHasSearched) && (
        <section className="space-y-4 border-t border-slate-200 pt-5">
          {manualProviderStats.length > 0 && (
            <div className="grid gap-3 md:grid-cols-3">
              {manualProviderStats.map((stat: any) => (
                <div key={stat.providerId} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                  <div className="font-medium text-slate-900">{displayPatentNationality(stat.providerId || stat.label)}</div>
                  <div className="mt-1 text-xs text-slate-500">{stat.enabled ? `${stat.resultCount} results` : 'Not enabled'}</div>
                  {stat.error && <div className="mt-1 text-xs text-amber-700">{stat.error}</div>}
                </div>
              ))}
            </div>
          )}
          {manualWarnings.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
              {manualWarnings.join(' ')}
            </div>
          )}
          <div className="rounded-lg border border-slate-200">
            <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">
              Results ({manualResults.length})
            </div>
            <div className="divide-y divide-slate-100">
              {manualResults.map((result, index) => {
                const abstract = result.abstract || result.snippet || ''
                return (
                  <article key={`${result.publicationNumber}-${index}`} className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-medium uppercase text-slate-500">
                        {result.publicationNumber} / {displayPatentNationalities(result.sourceProviders || [result.sourceProvider])}
                      </div>
                      {typeof result.relevanceScore === 'number' && (
                        <div className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                          {Math.round(result.relevanceScore * 100)}%
                        </div>
                      )}
                    </div>
                    <a href={result.link || undefined} target="_blank" rel="noreferrer" className="mt-1 block text-sm font-semibold text-ai-blue-700 hover:underline">
                      {result.title}
                    </a>
                    {abstract && (
                      <div className="mt-3">
                        <div className="text-xs font-semibold uppercase text-slate-500">Abstract</div>
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{abstract}</p>
                      </div>
                    )}
                    <div className="mt-2 grid gap-1 text-xs text-slate-500 sm:grid-cols-2">
                      {result.publicationDate && <div><span className="font-medium text-slate-700">Published:</span> {String(result.publicationDate).slice(0, 10)}</div>}
                      {result.filingDate && <div><span className="font-medium text-slate-700">Filed:</span> {String(result.filingDate).slice(0, 10)}</div>}
                      {listText(result.applicants) && <div><span className="font-medium text-slate-700">Applicant:</span> {listText(result.applicants)}</div>}
                      {result.inventors?.length ? <div><span className="font-medium text-slate-700">Inventor:</span> {result.inventors.join(', ')}</div> : null}
                    </div>
                  </article>
                )
              })}
              {!manualResults.length && (
                <div className="p-8 text-center text-sm text-slate-500">
                  {manualHasSearched ? 'No matching patents found for the current filters.' : 'Run a manual search to see matching patents.'}
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  )

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">New Novelty Search</h1>
          <p className="mt-1 text-sm text-slate-600">Review and approve the proposed search query and invention features before the server begins the novelty search.</p>
        </div>
        <button onClick={() => router.push('/novelty-search/history')} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          <History className="h-4 w-4" /> Search History
        </button>
      </div>

      <div className="mb-5 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
        <div className="grid gap-1 sm:grid-cols-2" role="tablist" aria-label="Novelty search mode">
          <button
            type="button"
            role="tab"
            aria-selected={searchPath === 'automatic'}
            onClick={() => {
              setSearchPath('automatic')
              setError('')
            }}
            className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium ${searchPath === 'automatic' ? 'bg-ai-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
          >
            <Search className="h-4 w-4" />
            Automatic Search
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={searchPath === 'manual'}
            onClick={() => {
              setSearchPath('manual')
              setError('')
            }}
            className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium ${searchPath === 'manual' ? 'bg-ai-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Manual Search
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {searchPath === 'manual' ? renderManualSearch() : (
      <div className="space-y-6">
        {/* Two-step progress indicator */}
        <ol className="flex items-center gap-3">
          {[
            { n: 1, label: 'Describe invention', done: view === 'review' || !!review, active: view === 'setup' && !isPreparing },
            { n: 2, label: 'Review & approve', done: false, active: view === 'review' || isPreparing },
          ].map((step, index) => (
            <li key={step.n} className="flex flex-1 items-center gap-3 last:flex-none">
              <div className="flex items-center gap-2.5">
                <span className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ring-1 transition-colors ${step.done ? 'bg-ai-blue-600 text-white ring-ai-blue-600' : step.active ? 'bg-white text-ai-blue-700 ring-ai-blue-500' : 'bg-white text-slate-400 ring-slate-200'}`}>
                  {step.done ? <CheckCircle2 className="h-4 w-4" /> : step.n}
                </span>
                <span className={`text-sm font-medium ${step.done || step.active ? 'text-slate-900' : 'text-slate-400'}`}>{step.label}</span>
              </div>
              {index === 0 && <span className={`hidden h-px flex-1 sm:block ${view === 'review' || !!review ? 'bg-ai-blue-300' : 'bg-slate-200'}`} />}
            </li>
          ))}
        </ol>

        {isPreparing && (
          <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="mx-auto max-w-xl text-center">
              <div className="relative mx-auto flex h-16 w-16 items-center justify-center">
                <span className="absolute inset-0 animate-ping rounded-full bg-ai-blue-400/30" />
                <span className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-ai-blue-500 to-violet-600 text-white shadow-lg">
                  <Sparkles className="h-7 w-7" />
                </span>
              </div>
              <h2 className="mt-5 text-lg font-semibold text-slate-900">Preparing your search plan</h2>
              <p className="mt-1 text-sm text-slate-500">Our patent AI is turning your disclosure into a precise prior-art search. This usually takes 30–40 seconds.</p>

              <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 text-left">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Loader2 className="h-4 w-4 animate-spin text-ai-blue-600" />
                    {preparationStage.label}
                  </div>
                  <div className="text-xs font-semibold text-ai-blue-700">{preparationProgress}%</div>
                </div>
                <p className="mt-1.5 pl-6 text-sm leading-5 text-slate-600">{preparationStage.detail}</p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-gradient-to-r from-ai-blue-500 to-violet-500 transition-all duration-700 ease-out" style={{ width: `${preparationProgress}%` }} />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {queryPreparationStages.map((stage, index) => (
                    <div key={stage.label} className={`h-1.5 flex-1 rounded-full transition-colors ${index <= preparationStageIndex ? 'bg-ai-blue-500' : 'bg-slate-200'}`} />
                  ))}
                </div>
              </div>
              <p className="mt-4 text-xs text-slate-400">Keep this tab open — the editable plan appears here as soon as it is ready.</p>
            </div>
          </section>
        )}

        {!isPreparing && view !== 'review' && (
        <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2 text-sm font-medium text-slate-700">
            <span className="flex items-center gap-2"><FolderOpen className="h-4 w-4" /> Project</span>
            <select value={projectId} onChange={event => setProjectId(event.target.value)} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal">
              <option value="">No project</option>
              {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-700">
            <span>Client / Matter Group</span>
            <select value={groupId} onChange={event => setGroupId(event.target.value)} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal">
              <option value="">Ungrouped</option>
              {groups.map(group => <option key={group.id} value={group.id}>{group.client.name} — {group.name}{group.referenceCode ? ` (${group.referenceCode})` : ''}</option>)}
            </select>
            <button type="button" onClick={() => router.push('/novelty-search/history?createGroup=1')} className="text-xs font-medium text-ai-blue-600 hover:underline">Create a client matter group</button>
          </label>
        </div>

        <label className="block space-y-2 text-sm font-medium text-slate-700">
          <span>Invention Title</span>
          <input value={title} onChange={event => { setTitle(event.target.value); setReview(null) }} disabled={isPreparing || isSubmitting} maxLength={300} className="h-11 w-full rounded-lg border border-slate-300 px-3 font-normal disabled:bg-slate-50" placeholder="Enter a clear invention title" />
        </label>

        <label className="block space-y-2 text-sm font-medium text-slate-700">
          <span>Invention Description</span>
          <textarea value={description} onChange={event => { setDescription(event.target.value); setReview(null) }} disabled={isPreparing || isSubmitting} rows={10} className="w-full rounded-lg border border-slate-300 px-3 py-3 font-normal leading-6 disabled:bg-slate-50" placeholder="Describe the problem, core mechanism, operating steps, and key technical features." />
        </label>

        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 transition-colors focus-within:border-ai-blue-400 focus-within:bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-slate-500 ring-1 ring-slate-200">
                <Upload className="h-4 w-4" />
              </span>
              <div>
                <div className="text-sm font-medium text-slate-800">Upload a disclosure instead</div>
                <div className="text-xs text-slate-500">PDF, DOC/DOCX, spreadsheet, Markdown, CSV or TXT — up to 5 MB.</div>
              </div>
            </div>
            <input
              ref={fileRef}
              type="file"
              aria-label="Upload invention disclosure"
              disabled={isExtracting || isPreparing || isSubmitting}
              onChange={event => event.target.files?.[0] && void extractFile(event.target.files[0])}
              className="max-w-xs text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-200 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-300 disabled:opacity-50"
            />
          </div>
          {isExtracting && (
            <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-ai-blue-700">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Extracting readable text…
            </p>
          )}
          {uploadedName && !isExtracting && (
            <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> Loaded {uploadedName} — text placed in the description above.
            </p>
          )}
        </div>

        {renderSourceSelection()}

        <div className="space-y-3">
          <button
            type="button"
            onClick={review ? () => setView('review') : () => void prepareReview()}
            disabled={isExtracting || !hasSelectedSources || !title.trim() || !description.trim()}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-ai-blue-600 px-5 font-medium text-white shadow-sm transition-colors hover:bg-ai-blue-700 disabled:opacity-50"
          >
            {review ? <>Continue to Review <ArrowRight className="h-5 w-5" /></> : <><Sparkles className="h-5 w-5" /> Generate Search Query & Features</>}
          </button>
          {review && (
            <button type="button" onClick={() => void prepareReview()} className="mx-auto flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800">
              <RefreshCw className="h-3.5 w-3.5" /> Regenerate a fresh plan
            </button>
          )}
          <p className="flex items-center justify-center gap-2 text-xs text-slate-500"><FileText className="h-3.5 w-3.5" /> You review and approve the plan before any search runs.</p>
        </div>
        </div>
        )}

        {!isPreparing && view === 'review' && review && (
          <section className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-start gap-3 border-b border-slate-100 pb-5">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-ai-blue-500 to-violet-600 text-white shadow-sm"><Sparkles className="h-5 w-5" /></span>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-slate-900">Review your search plan</h2>
                <p className="mt-1 max-w-prose text-sm text-slate-600">These terms drive prior-art retrieval and the feature-by-feature comparison. Edit anything, then approve.</p>
              </div>
            </div>

            {/* What this plan will actually search — the scope chosen on the previous
                step, restated here so approval is an informed decision. */}
            <dl className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                  <Database className="h-3.5 w-3.5" /> Corpus
                </dt>
                <dd className="mt-1 text-sm font-medium text-slate-900">Stored patent corpus</dd>
                <dd className="mt-0.5 text-xs text-slate-500">Semantic retrieval + reranking</dd>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                  <Globe2 className="h-3.5 w-3.5" /> Offices
                </dt>
                <dd className="mt-1 text-sm font-medium text-slate-900">{selectedCountries.length} selected</dd>
                <dd className="mt-0.5 truncate text-xs text-slate-500" title={countryScopeLabel}>{countryScopeLabel}</dd>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                  <CalendarRange className="h-3.5 w-3.5" /> Date range
                </dt>
                <dd className="mt-1 text-sm font-medium text-slate-900">{hasDateFilters ? 'Filtered' : 'All dates'}</dd>
                <dd className="mt-0.5 text-xs text-slate-500">
                  {hasDateFilters
                    ? [
                        filingFrom || filingTo ? `Filed ${filingFrom || '…'} → ${filingTo || '…'}` : '',
                        publicationFrom || publicationTo ? `Published ${publicationFrom || '…'} → ${publicationTo || '…'}` : '',
                      ].filter(Boolean).join(' · ')
                    : 'Full corpus history'}
                </dd>
              </div>
            </dl>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-ai-blue-600" />
                <span className="text-sm font-semibold text-slate-900">Patent search query</span>
              </div>
              <p className="text-xs text-slate-500">The concept query used for semantic retrieval across the selected offices.</p>
              <textarea value={editedSearchQuery} onChange={event => setEditedSearchQuery(event.target.value)} rows={3} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-[13px] leading-6 text-slate-800 outline-none transition-colors focus:border-ai-blue-400 focus:bg-white focus:ring-2 focus:ring-ai-blue-500/15" />
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <ListChecks className="h-4 w-4 text-ai-blue-600" />
                <span className="text-sm font-semibold text-slate-900">Key invention features</span>
                <span className="rounded-full bg-ai-blue-50 px-2 py-0.5 text-xs font-semibold text-ai-blue-700">{editedFeatures.length}</span>
              </div>
              {editedFeatures.map((feature, index) => (
                <div key={index} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 transition-colors focus-within:border-ai-blue-300 focus-within:ring-2 focus-within:ring-ai-blue-500/10">
                  <span className="mt-0.5 flex h-7 shrink-0 items-center rounded-lg bg-gradient-to-br from-ai-blue-500 to-violet-600 px-2 text-xs font-semibold text-white shadow-sm">KF{index + 1}</span>
                  <textarea value={feature} onChange={event => updateFeature(index, event.target.value)} rows={2} className="min-h-11 flex-1 resize-none border-0 bg-transparent px-0 py-1 text-sm leading-5 text-slate-800 outline-none" />
                  <button type="button" onClick={() => setEditedFeatures(current => current.filter((_, featureIndex) => featureIndex !== index))} aria-label={`Remove feature ${index + 1}`} className="mt-0.5 rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <input value={newFeature} onChange={event => setNewFeature(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addFeature() } }} className="h-11 flex-1 rounded-xl border border-dashed border-slate-300 bg-white px-3 text-sm outline-none transition-colors focus:border-ai-blue-400 focus:ring-2 focus:ring-ai-blue-500/15" placeholder="Add another technical feature…" />
                <button type="button" onClick={addFeature} className="inline-flex h-11 items-center gap-1 rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"><Plus className="h-4 w-4" /> Add</button>
              </div>
            </div>

            {usesEpoSearch && (
              <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">European patent keyword search</h3>
                  <p className="mt-1 text-xs text-slate-600">These phrases are used for European patent title and abstract searches.</p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-slate-700">Title keywords</div>
                    {editedEpoTitleKeywords.map((keyword, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <input value={keyword} onChange={event => updateKeyword('title', index, event.target.value)} className="h-10 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm" />
                        <button type="button" onClick={() => removeKeyword('title', index)} aria-label={`Remove title keyword ${index + 1}`} className="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <input value={newEpoTitleKeyword} onChange={event => setNewEpoTitleKeyword(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addKeyword('title') } }} className="h-10 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm" placeholder="Add title phrase" />
                      <button type="button" onClick={() => addKeyword('title')} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"><Plus className="h-4 w-4" /> Add</button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-slate-700">Abstract keywords</div>
                    {editedEpoAbstractKeywords.map((keyword, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <input value={keyword} onChange={event => updateKeyword('abstract', index, event.target.value)} className="h-10 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm" />
                        <button type="button" onClick={() => removeKeyword('abstract', index)} aria-label={`Remove abstract keyword ${index + 1}`} className="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <input value={newEpoAbstractKeyword} onChange={event => setNewEpoAbstractKeyword(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addKeyword('abstract') } }} className="h-10 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm" placeholder="Add abstract phrase" />
                      <button type="button" onClick={() => addKeyword('abstract')} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"><Plus className="h-4 w-4" /> Add</button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {includePapers && (
              <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Scholarly paper search</h3>
                  <p className="mt-1 text-xs text-slate-600">Edit the generated academic query and technical phrases before retrieval.</p>
                </div>
                <label className="block space-y-2 text-sm font-medium text-slate-700">
                  <span>Source-neutral paper query</span>
                  <textarea value={editedPaperSearchQuery} onChange={event => setEditedPaperSearchQuery(event.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal leading-6" />
                </label>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block space-y-2 text-sm font-medium text-slate-700">
                    <span>Google Scholar query</span>
                    <textarea value={editedGoogleScholarSearchQuery} onChange={event => setEditedGoogleScholarSearchQuery(event.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal leading-6" />
                  </label>
                  <label className="block space-y-2 text-sm font-medium text-slate-700">
                    <span>Academic database query</span>
                    <textarea value={editedAcademicDatabaseSearchQuery} onChange={event => setEditedAcademicDatabaseSearchQuery(event.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal leading-6" />
                  </label>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  Publication range: {paperYearFrom || '1900'} to {paperYearTo || new Date().getFullYear()}. Edit these values in the scholarly source controls above.
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium text-slate-700">Alternative search strings</div>
                  {editedPaperSearchQueries.map((query, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input value={query} onChange={event => setEditedPaperSearchQueries(current => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} className="h-10 flex-1 rounded-lg border border-slate-300 px-3 text-sm" />
                      <button type="button" onClick={() => setEditedPaperSearchQueries(current => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove paper search string ${index + 1}`} className="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <input value={newPaperSearchQuery} onChange={event => setNewPaperSearchQuery(event.target.value)} className="h-10 flex-1 rounded-lg border border-slate-300 px-3 text-sm" placeholder="Add alternative search string" />
                    <button type="button" onClick={() => { const value = newPaperSearchQuery.trim(); if (value) { setEditedPaperSearchQueries(current => [...current, value]); setNewPaperSearchQuery('') } }} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700"><Plus className="h-4 w-4" /> Add</button>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium text-slate-700">Paper keywords</div>
                  {editedPaperKeywords.map((keyword, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input value={keyword} onChange={event => setEditedPaperKeywords(current => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} className="h-10 flex-1 rounded-lg border border-slate-300 px-3 text-sm" />
                      <button type="button" onClick={() => setEditedPaperKeywords(current => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove paper keyword ${index + 1}`} className="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <input value={newPaperKeyword} onChange={event => setNewPaperKeyword(event.target.value)} className="h-10 flex-1 rounded-lg border border-slate-300 px-3 text-sm" placeholder="Add paper keyword phrase" />
                    <button type="button" onClick={() => { const value = newPaperKeyword.trim(); if (value) { setEditedPaperKeywords(current => [...current, value]); setNewPaperKeyword('') } }} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700"><Plus className="h-4 w-4" /> Add</button>
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
              Approval is required because these terms control prior-art retrieval and feature-by-feature comparison. Internal processing begins only after you approve and queue this plan.
            </div>
            {Array.isArray(review.warnings) && review.warnings.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-white px-4 py-3 text-xs leading-5 text-amber-900">
                <div className="font-semibold">Review warnings</div>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {review.warnings.slice(0, 5).map((warning: unknown, index: number) => (
                    <li key={index}>{String(warning)}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {!isPreparing && view === 'review' && review && (
          <div className="space-y-3">
            <div className="flex flex-col-reverse items-stretch gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <button type="button" onClick={() => setView('setup')} disabled={isSubmitting} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50">
                <ArrowLeft className="h-4 w-4" /> Back to disclosure
              </button>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <button type="button" onClick={() => void prepareReview()} disabled={isSubmitting} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50">
                  <RefreshCw className="h-4 w-4" /> Regenerate
                </button>
                <button type="button" onClick={() => void submit()} disabled={isSubmitting || isPreparing || !hasSelectedSources || !editedSearchQuery.trim() || editedFeatures.every(feature => !feature.trim())} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-6 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-50">
                  {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
                  {isSubmitting ? 'Queueing approved search…' : 'Approve & Queue Search'}
                </button>
              </div>
            </div>
            <p className="flex items-center justify-center gap-2 text-xs text-slate-500"><FileText className="h-3.5 w-3.5" /> After approval, processing continues in the background.</p>
          </div>
        )}
      </div>
      )}
    </div>
  )
}
