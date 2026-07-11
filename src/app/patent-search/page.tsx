'use client'

import { useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Bot,
  Database,
  Download,
  FileText,
  Globe2,
  Loader2,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'
import { useAuth } from '@/lib/auth-context'

type SearchMode = 'intelligent' | 'manual'

type QueryPlan = {
  searchQuery?: string
  inventionFeatures?: string[]
  technicalKeywords?: string[]
  cpcCodes?: string[]
  ipcCodes?: string[]
  classificationHints?: string[]
  warnings?: string[]
}

type SearchResult = {
  publicationNumber: string
  applicationNumber?: string | null
  title: string
  abstract?: string | null
  snippet?: string | null
  applicants?: unknown
  inventors?: string[]
  classifications?: string[]
  filingDate?: string | null
  sourceProvider?: string
  sourceProviders?: string[]
  sourcePdfName?: string | null
  sourcePageNumber?: number | null
  publicationDate?: string | null
  numberOfPages?: number | null
  numberOfClaims?: number | null
  relevanceScore?: number | null
  link?: string | null
  matchedFields?: string[]
  jurisdiction?: string
}

type ProviderStat = {
  providerId: string
  label: string
  enabled: boolean
  requested: boolean
  resultCount: number
  error?: string
}

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
  numberOfPagesMin: string
  numberOfPagesMax: string
  numberOfClaimsMin: string
  numberOfClaimsMax: string
  sourcePdfName: string
  excludeTerms: string
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
  numberOfPagesMin: '',
  numberOfPagesMax: '',
  numberOfClaimsMin: '',
  numberOfClaimsMax: '',
  sourcePdfName: '',
  excludeTerms: '',
}

const jurisdictionOptions = [
  { value: 'IN', label: 'India', provider: 'Indian + international patents' },
  { value: 'US', label: 'United States', provider: 'International patents' },
  { value: 'WO', label: 'PCT/WO', provider: 'International patents' },
  { value: 'EP', label: 'Europe', provider: 'European + international patents' },
  { value: 'AU', label: 'Australia', provider: 'Australian + international patents' },
  { value: '*', label: 'Global', provider: 'International patents' },
]

function splitValues(value: string) {
  return value.split(/[,;\n]/).map(item => item.trim()).filter(Boolean)
}

function numberValue(value: string) {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

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

function csvCell(value: unknown) {
  const text = Array.isArray(value) ? value.join('; ') : typeof value === 'object' && value ? JSON.stringify(value) : String(value ?? '')
  return `"${text.replace(/"/g, '""')}"`
}

function displayPatentProviderLabel(value: unknown) {
  const raw = String(value || '').trim()
  const normalized = raw.toLowerCase()
  if (normalized === 'indian-corpus' || /indian patent/i.test(raw)) return 'Indian patents'
  if (normalized === 'pqai' || normalized === 'pqai-corpus' || /pqai/i.test(raw) || /international/i.test(raw)) return 'International patents'
  if (normalized === 'epo-ops' || normalized === 'epo-ops-corpus' || /epo/i.test(raw) || /european/i.test(raw)) return 'European patents'
  if (normalized === 'ip-australia' || /australia/i.test(raw)) return 'Australian patents'
  if (normalized === 'google-patents-bigquery' || /google patents bigquery/i.test(raw)) return 'Google Patents BigQuery'
  if (normalized === 'google-patents' || /google patents/i.test(raw)) return 'Google Patents'
  return raw
}

function displayPatentProviderLabels(values: unknown[]) {
  return Array.from(new Set(values.map(displayPatentProviderLabel).filter(Boolean))).join(', ')
}

export default function PatentSearchPage() {
  const { user } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [searchMode, setSearchMode] = useState<SearchMode>('intelligent')
  const [selectedJurisdictions, setSelectedJurisdictions] = useState<string[]>(['IN'])
  const [query, setQuery] = useState('')
  const [title, setTitle] = useState('')
  const [inventionText, setInventionText] = useState('')
  const [llmExpansion, setLlmExpansion] = useState(true)
  const [showSmartFilters, setShowSmartFilters] = useState(false)
  const [showMoreManualFilters, setShowMoreManualFilters] = useState(false)
  const [smartClassifications, setSmartClassifications] = useState('')
  const [smartApplicant, setSmartApplicant] = useState('')
  const [smartInventor, setSmartInventor] = useState('')
  const [smartPublicationFrom, setSmartPublicationFrom] = useState('')
  const [smartPublicationTo, setSmartPublicationTo] = useState('')
  const [manualFields, setManualFields] = useState<ManualFields>(defaultManualFields)
  const [queryPlan, setQueryPlan] = useState<QueryPlan | null>(null)
  const [results, setResults] = useState<SearchResult[]>([])
  const [providerStats, setProviderStats] = useState<ProviderStat[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)

  const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}` })

  const intelligentFilters = useMemo(() => ({
    classifications: splitValues(smartClassifications),
    applicants: splitValues(smartApplicant),
    inventors: splitValues(smartInventor),
    publicationDateFrom: smartPublicationFrom || undefined,
    publicationDateTo: smartPublicationTo || undefined,
  }), [smartApplicant, smartClassifications, smartInventor, smartPublicationFrom, smartPublicationTo])

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
    numberOfPagesMin: numberValue(manualFields.numberOfPagesMin),
    numberOfPagesMax: numberValue(manualFields.numberOfPagesMax),
    numberOfClaimsMin: numberValue(manualFields.numberOfClaimsMin),
    numberOfClaimsMax: numberValue(manualFields.numberOfClaimsMax),
    sourcePdfName: manualFields.sourcePdfName.trim() || undefined,
    excludeTerms: splitValues(manualFields.excludeTerms),
  }), [manualFields])

  const manualHasCriteria = useMemo(() => Object.values(manualFilters).some(value => (
    Array.isArray(value) ? value.length > 0 : value !== undefined && value !== ''
  )), [manualFilters])

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; onRemove: () => void }> = []
    selectedJurisdictions.forEach(value => {
      const option = jurisdictionOptions.find(item => item.value === value)
      chips.push({
        key: `source-${value}`,
        label: `Patent nationality: ${option?.label || value}`,
        onRemove: () => setSelectedJurisdictions(prev => prev.length <= 1 ? ['IN'] : prev.filter(item => item !== value)),
      })
    })

    if (searchMode === 'manual') {
      const addFieldChip = (field: keyof ManualFields, label: string) => {
        splitValues(manualFields[field]).forEach(value => {
          chips.push({
            key: `${field}-${value}`,
            label: `${label}: ${value}`,
            onRemove: () => {
              setManualFields(prev => ({
                ...prev,
                [field]: splitValues(prev[field]).filter(item => item !== value).join(', '),
              }))
            },
          })
        })
      }
      addFieldChip('anyText', 'Any text')
      addFieldChip('title', 'Title')
      addFieldChip('abstract', 'Abstract')
      addFieldChip('patentText', 'Patent text')
      addFieldChip('applicant', 'Applicant')
      addFieldChip('inventor', 'Inventor')
      addFieldChip('publicationNumber', 'Publication')
      addFieldChip('applicationNumber', 'Application')
      addFieldChip('classifications', 'IPC/CPC')
      addFieldChip('sourcePdfName', 'PDF')
      addFieldChip('excludeTerms', 'Exclude')
      ;([
        ['filingFrom', 'Filed from'],
        ['filingTo', 'Filed to'],
        ['publicationFrom', 'Published from'],
        ['publicationTo', 'Published to'],
        ['numberOfPagesMin', 'Pages min'],
        ['numberOfPagesMax', 'Pages max'],
        ['numberOfClaimsMin', 'Claims min'],
        ['numberOfClaimsMax', 'Claims max'],
      ] as Array<[keyof ManualFields, string]>).forEach(([field, label]) => {
        if (!manualFields[field]) return
        chips.push({
          key: `${field}-${manualFields[field]}`,
          label: `${label}: ${manualFields[field]}`,
          onRemove: () => setManualFields(prev => ({ ...prev, [field]: '' })),
        })
      })
    }

    return chips
  }, [manualFields, searchMode, selectedJurisdictions])

  const visibleDetailFields = useMemo(() => {
    const fields = new Set<string>()
    if (searchMode === 'manual') {
      if (splitValues(manualFields.applicant).length) fields.add('applicants')
      if (splitValues(manualFields.inventor).length) fields.add('inventors')
      if (splitValues(manualFields.classifications).length) fields.add('classifications')
      if (manualFields.publicationNumber.trim()) fields.add('publicationNumber')
      if (manualFields.applicationNumber.trim()) fields.add('applicationNumber')
      if (manualFields.filingFrom || manualFields.filingTo) fields.add('filingDate')
      if (manualFields.publicationFrom || manualFields.publicationTo) fields.add('publicationDate')
      if (manualFields.sourcePdfName.trim()) fields.add('source')
      if (
        manualFields.numberOfPagesMin ||
        manualFields.numberOfPagesMax ||
        manualFields.numberOfClaimsMin ||
        manualFields.numberOfClaimsMax
      ) fields.add('counts')
    } else {
      if (smartApplicant.trim()) fields.add('applicants')
      if (smartInventor.trim()) fields.add('inventors')
      if (smartClassifications.trim()) fields.add('classifications')
      if (smartPublicationFrom || smartPublicationTo) fields.add('publicationDate')
    }
    return fields
  }, [
    manualFields,
    searchMode,
    smartApplicant,
    smartClassifications,
    smartInventor,
    smartPublicationFrom,
    smartPublicationTo,
  ])

  const toggleJurisdiction = (value: string) => {
    setSelectedJurisdictions(prev => {
      if (value === '*') return ['*']
      const base = prev.includes('*') ? [] : prev
      const next = base.includes(value) ? base.filter(item => item !== value) : [...base, value]
      return next.length ? next : ['IN']
    })
  }

  const updateManualField = (field: keyof ManualFields, value: string) => {
    setManualFields(prev => ({ ...prev, [field]: value }))
  }

  const ingestFile = async (file: File) => {
    setLoading('file')
    setError(null)
    setUploadedFileName(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch('/api/patent-search/ingest-file', {
        method: 'POST',
        headers: authHeaders(),
        body: formData,
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Failed to extract file text')
      setInventionText(body.textContent || '')
      setUploadedFileName(body.fileName || file.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to extract file text')
    } finally {
      setLoading(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const runSearch = async (planOnly = false) => {
    if (searchMode === 'manual' && !manualHasCriteria) {
      setError('Enter at least one manual search field.')
      return
    }
    if (searchMode === 'intelligent' && !query.trim() && !inventionText.trim() && !queryPlan?.searchQuery) {
      setError('Enter a query or upload/paste an invention disclosure.')
      return
    }

    setLoading(planOnly ? 'plan' : 'search')
    setError(null)
    try {
      const body = searchMode === 'manual'
        ? {
          searchMode: 'manual',
          filters: manualFilters,
          jurisdictions: selectedJurisdictions,
          llmExpansion: false,
          limit: 50,
        }
        : {
          searchMode: 'intelligent',
          query,
          title,
          inventionText,
          jurisdictions: selectedJurisdictions,
          llmExpansion,
          filters: intelligentFilters,
          limit: 30,
          planOnly,
          ...(queryPlan && !planOnly ? { queryPlan } : {}),
        }

      const response = await fetch('/api/patent-search/advanced', {
        method: 'POST',
        cache: 'no-store',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      const responseBody = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(responseBody.error || 'Search failed')
      setQueryPlan(responseBody.queryPlan || null)
      setWarnings(responseBody.warnings || [])
      setProviderStats(responseBody.providerStats || [])
      if (!planOnly) {
        setResults(responseBody.results || [])
        setHasSearched(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setLoading(null)
    }
  }

  const clearCurrentSearch = () => {
    if (searchMode === 'manual') {
      setManualFields(defaultManualFields)
    } else {
      setQuery('')
      setTitle('')
      setInventionText('')
      setSmartClassifications('')
      setSmartApplicant('')
      setSmartInventor('')
      setSmartPublicationFrom('')
      setSmartPublicationTo('')
      setUploadedFileName(null)
    }
    setQueryPlan(null)
    setWarnings([])
    setProviderStats([])
    setResults([])
    setHasSearched(false)
    setError(null)
  }

  const exportResults = () => {
    if (!results.length) return
    const rows = [
      ['publicationNumber', 'jurisdiction', 'providers', 'title', 'abstract', 'applicants', 'inventors', 'classifications', 'publicationDate', 'sourcePdfName', 'sourcePageNumber', 'relevanceScore'],
      ...results.map(result => [
        result.publicationNumber,
        result.jurisdiction || '',
        (result.sourceProviders || [result.sourceProvider]).filter(Boolean).join('; '),
        result.title,
        result.abstract || result.snippet || '',
        listText(result.applicants, 10),
        (result.inventors || []).join('; '),
        (result.classifications || []).join('; '),
        result.publicationDate || '',
        result.sourcePdfName || '',
        result.sourcePageNumber || '',
        result.relevanceScore ?? '',
      ]),
    ]
    const csv = rows.map(row => row.map(csvCell).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `patent-search-${searchMode}-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  if (!user) {
    return <div className="min-h-screen bg-slate-50 p-8 text-slate-600">Loading patent search...</div>
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">Patent Search</h1>
            <p className="mt-1 text-sm text-slate-600">Search patents by nationality using every configured retrieval path for the selected country.</p>
          </div>
          <div className="inline-flex rounded-md border border-slate-300 bg-white p-1">
            <button
              type="button"
              onClick={() => setSearchMode('intelligent')}
              className={`inline-flex items-center gap-2 rounded px-3 py-2 text-sm font-medium ${searchMode === 'intelligent' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'}`}
            >
              <Sparkles className="h-4 w-4" />
              Intelligent Search
            </button>
            <button
              type="button"
              onClick={() => setSearchMode('manual')}
              className={`inline-flex items-center gap-2 rounded px-3 py-2 text-sm font-medium ${searchMode === 'manual' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'}`}
            >
              <SlidersHorizontal className="h-4 w-4" />
              Manual Search
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <section className="mb-5 rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-2">
            {selectedJurisdictions.includes('IN') ? <Database className="h-4 w-4 text-slate-500" /> : <Globe2 className="h-4 w-4 text-slate-500" />}
            <h2 className="text-sm font-semibold">Patent Nationality</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {jurisdictionOptions.map(option => {
              const selected = selectedJurisdictions.includes(option.value)
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => toggleJurisdiction(option.value)}
                  className={`rounded-md border px-3 py-2 text-left text-sm ${selected ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
                >
                  <span className="font-medium">{option.label}</span>
                  <span className={`ml-2 text-xs ${selected ? 'text-slate-200' : 'text-slate-500'}`}>{option.provider}</span>
                </button>
              )
            })}
          </div>
        </section>

        {searchMode === 'intelligent' ? (
          <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
            <aside className="space-y-4">
              <section className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Bot className="h-4 w-4 text-slate-500" />
                  <h2 className="text-sm font-semibold">Invention Input</h2>
                </div>
                <div className="space-y-3">
                  <input
                    value={title}
                    onChange={event => setTitle(event.target.value)}
                    placeholder="Optional invention title"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  />
                  <textarea
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder="Search query"
                    rows={3}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  />
                  <textarea
                    value={inventionText}
                    onChange={event => setInventionText(event.target.value)}
                    placeholder="Paste invention disclosure"
                    rows={7}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  />
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.md,.markdown,.csv,.tsv,.xlsx,.doc,.docx,.pdf"
                    onChange={event => {
                      const file = event.target.files?.[0]
                      if (file) ingestFile(file)
                    }}
                    disabled={loading === 'file'}
                    className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
                  />
                  {uploadedFileName && (
                    <div className="flex items-center gap-2 text-xs text-emerald-700">
                      <FileText className="h-3.5 w-3.5" />
                      {uploadedFileName}
                    </div>
                  )}
                </div>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4 text-slate-500" />
                  <h2 className="text-sm font-semibold">Controls</h2>
                </div>
                <div className="space-y-3">
                  <label className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm">
                    <span>LLM query extraction</span>
                    <input
                      type="checkbox"
                      checked={llmExpansion}
                      onChange={event => setLlmExpansion(event.target.checked)}
                      className="h-4 w-4"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowSmartFilters(prev => !prev)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {showSmartFilters ? 'Hide Filters' : 'Show Filters'}
                  </button>
                  {showSmartFilters && (
                    <div className="space-y-2 border-t border-slate-100 pt-3">
                      <input value={smartClassifications} onChange={event => setSmartClassifications(event.target.value)} placeholder="IPC/CPC/classifications" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                      <input value={smartApplicant} onChange={event => setSmartApplicant(event.target.value)} placeholder="Applicant" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                      <input value={smartInventor} onChange={event => setSmartInventor(event.target.value)} placeholder="Inventor" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                      <div className="grid grid-cols-2 gap-2">
                        <input type="date" value={smartPublicationFrom} onChange={event => setSmartPublicationFrom(event.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                        <input type="date" value={smartPublicationTo} onChange={event => setSmartPublicationTo(event.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => runSearch(true)}
                      disabled={!!loading}
                      className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {loading === 'plan' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      Fields
                    </button>
                    <button
                      onClick={() => runSearch(false)}
                      disabled={!!loading}
                      className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {loading === 'search' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                      Search
                    </button>
                    <button
                      type="button"
                      onClick={clearCurrentSearch}
                      className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Clear
                    </button>
                  </div>
                </div>
              </section>
            </aside>

            <main className="space-y-4">
              {queryPlan && (
                <section className="rounded-lg border border-slate-200 bg-white p-4">
                  <h2 className="text-sm font-semibold">Generated Search Fields</h2>
                  <textarea
                    value={queryPlan.searchQuery || ''}
                    onChange={event => setQueryPlan(prev => ({ ...(prev || {}), searchQuery: event.target.value }))}
                    rows={2}
                    className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  />
                  <div className="mt-3 grid gap-3 text-xs text-slate-600 md:grid-cols-3">
                    <div><span className="font-medium text-slate-800">Features:</span> {(queryPlan.inventionFeatures || []).join(', ') || 'None'}</div>
                    <div><span className="font-medium text-slate-800">Keywords:</span> {(queryPlan.technicalKeywords || []).slice(0, 12).join(', ') || 'None'}</div>
                    <div><span className="font-medium text-slate-800">Classifications:</span> {[...(queryPlan.cpcCodes || []), ...(queryPlan.ipcCodes || [])].join(', ') || 'None'}</div>
                  </div>
                </section>
              )}
              {hasSearched && (
                <IntelligentResultFilterBar
                  applicant={smartApplicant}
                  classifications={smartClassifications}
                  inventor={smartInventor}
                  loading={loading}
                  onApply={() => runSearch(false)}
                  onChange={{
                    applicant: setSmartApplicant,
                    classifications: setSmartClassifications,
                    inventor: setSmartInventor,
                    publicationFrom: setSmartPublicationFrom,
                    publicationTo: setSmartPublicationTo,
                  }}
                  publicationFrom={smartPublicationFrom}
                  publicationTo={smartPublicationTo}
                />
              )}
              <ResultsPanel
                activeFilterChips={activeFilterChips}
                exportResults={exportResults}
                providerStats={providerStats}
                results={results}
                hasSearched={hasSearched}
                visibleDetailFields={visibleDetailFields}
                warnings={warnings}
              />
            </main>
          </div>
        ) : (
          <div className="space-y-5">
            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4 text-slate-500" />
                  <h2 className="text-sm font-semibold">Manual Fields</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={clearCurrentSearch}
                    className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Clear all
                  </button>
                  <button
                    type="button"
                    onClick={() => runSearch(false)}
                    disabled={!!loading}
                    className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {loading === 'search' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    Search
                  </button>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-3">
                <label className="text-xs font-medium text-slate-600">
                  Any text
                  <textarea value={manualFields.anyText} onChange={event => updateManualField('anyText', event.target.value)} rows={3} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-500" />
                </label>
                <label className="text-xs font-medium text-slate-600">
                  Title contains
                  <textarea value={manualFields.title} onChange={event => updateManualField('title', event.target.value)} rows={3} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-500" />
                </label>
                <label className="text-xs font-medium text-slate-600">
                  Abstract contains
                  <textarea value={manualFields.abstract} onChange={event => updateManualField('abstract', event.target.value)} rows={3} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-500" />
                </label>
              </div>

              <button
                type="button"
                onClick={() => setShowMoreManualFilters(prev => !prev)}
                className="mt-4 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {showMoreManualFilters ? 'Hide field filters' : 'Field filters'}
              </button>

              {showMoreManualFilters && (
                <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-2 lg:grid-cols-4">
                  <label className="text-xs font-medium text-slate-600">
                    Applicant
                    <input value={manualFields.applicant} onChange={event => updateManualField('applicant', event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-500" />
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    Inventor
                    <input value={manualFields.inventor} onChange={event => updateManualField('inventor', event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-500" />
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    Publication no.
                    <input value={manualFields.publicationNumber} onChange={event => updateManualField('publicationNumber', event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-500" />
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    Application no.
                    <input value={manualFields.applicationNumber} onChange={event => updateManualField('applicationNumber', event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-500" />
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    IPC/CPC
                    <input value={manualFields.classifications} onChange={event => updateManualField('classifications', event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-500" />
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    Patent text contains
                    <input value={manualFields.patentText} onChange={event => updateManualField('patentText', event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-500" />
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    Exclude terms
                    <input value={manualFields.excludeTerms} onChange={event => updateManualField('excludeTerms', event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-500" />
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    Source PDF
                    <input value={manualFields.sourcePdfName} onChange={event => updateManualField('sourcePdfName', event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-500" />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs font-medium text-slate-600">
                      Pages min
                      <input type="number" value={manualFields.numberOfPagesMin} onChange={event => updateManualField('numberOfPagesMin', event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-500" />
                    </label>
                    <label className="text-xs font-medium text-slate-600">
                      Pages max
                      <input type="number" value={manualFields.numberOfPagesMax} onChange={event => updateManualField('numberOfPagesMax', event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-500" />
                    </label>
                  </div>
                  <label className="text-xs font-medium text-slate-600">
                    Filing from
                    <input type="date" value={manualFields.filingFrom} onChange={event => updateManualField('filingFrom', event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-500" />
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    Filing to
                    <input type="date" value={manualFields.filingTo} onChange={event => updateManualField('filingTo', event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-500" />
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    Published from
                    <input type="date" value={manualFields.publicationFrom} onChange={event => updateManualField('publicationFrom', event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-500" />
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    Published to
                    <input type="date" value={manualFields.publicationTo} onChange={event => updateManualField('publicationTo', event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-500" />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs font-medium text-slate-600">
                      Claims min
                      <input type="number" value={manualFields.numberOfClaimsMin} onChange={event => updateManualField('numberOfClaimsMin', event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-500" />
                    </label>
                    <label className="text-xs font-medium text-slate-600">
                      Claims max
                      <input type="number" value={manualFields.numberOfClaimsMax} onChange={event => updateManualField('numberOfClaimsMax', event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-500" />
                    </label>
                  </div>
                </div>
              )}
            </section>

            {hasSearched && (
              <ResultFilterBar
                fields={manualFields}
                loading={loading}
                onApply={() => runSearch(false)}
                onChange={updateManualField}
              />
            )}

            <ResultsPanel
              activeFilterChips={activeFilterChips}
              exportResults={exportResults}
              providerStats={providerStats}
              results={results}
              hasSearched={hasSearched}
              visibleDetailFields={visibleDetailFields}
              warnings={warnings}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function IntelligentResultFilterBar({
  applicant,
  classifications,
  inventor,
  loading,
  onApply,
  onChange,
  publicationFrom,
  publicationTo,
}: {
  applicant: string
  classifications: string
  inventor: string
  loading: string | null
  onApply: () => void
  onChange: {
    applicant: (value: string) => void
    classifications: (value: string) => void
    inventor: (value: string) => void
    publicationFrom: (value: string) => void
    publicationTo: (value: string) => void
  }
  publicationFrom: string
  publicationTo: string
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Filter Results</h2>
          <p className="mt-1 text-xs text-slate-500">Narrow the current intelligent search without changing the generated query.</p>
        </div>
        <button
          type="button"
          onClick={onApply}
          disabled={!!loading}
          className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading === 'search' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Apply filters
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
        <label className="text-xs font-medium text-slate-600">
          Applicant
          <input value={applicant} onChange={event => onChange.applicant(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-500" />
        </label>
        <label className="text-xs font-medium text-slate-600">
          Inventor
          <input value={inventor} onChange={event => onChange.inventor(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-500" />
        </label>
        <label className="text-xs font-medium text-slate-600">
          IPC/CPC
          <input value={classifications} onChange={event => onChange.classifications(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-500" />
        </label>
        <label className="text-xs font-medium text-slate-600">
          Published from
          <input type="date" value={publicationFrom} onChange={event => onChange.publicationFrom(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-500" />
        </label>
        <label className="text-xs font-medium text-slate-600">
          Published to
          <input type="date" value={publicationTo} onChange={event => onChange.publicationTo(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-500" />
        </label>
      </div>
    </section>
  )
}

function ResultFilterBar({
  fields,
  loading,
  onApply,
  onChange,
}: {
  fields: ManualFields
  loading: string | null
  onApply: () => void
  onChange: (field: keyof ManualFields, value: string) => void
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Filter Results</h2>
          <p className="mt-1 text-xs text-slate-500">Use these field filters to narrow the current manual search.</p>
        </div>
        <button
          type="button"
          onClick={onApply}
          disabled={!!loading}
          className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading === 'search' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Apply filters
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
        <label className="text-xs font-medium text-slate-600">
          Applicant
          <input value={fields.applicant} onChange={event => onChange('applicant', event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-500" />
        </label>
        <label className="text-xs font-medium text-slate-600">
          Inventor
          <input value={fields.inventor} onChange={event => onChange('inventor', event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-500" />
        </label>
        <label className="text-xs font-medium text-slate-600">
          IPC/CPC
          <input value={fields.classifications} onChange={event => onChange('classifications', event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-500" />
        </label>
        <label className="text-xs font-medium text-slate-600">
          Published from
          <input type="date" value={fields.publicationFrom} onChange={event => onChange('publicationFrom', event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-500" />
        </label>
        <label className="text-xs font-medium text-slate-600">
          Source PDF
          <input value={fields.sourcePdfName} onChange={event => onChange('sourcePdfName', event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-slate-500" />
        </label>
      </div>
    </section>
  )
}

const allResultDetailFields = new Set([
  'applicationNumber',
  'filingDate',
  'publicationDate',
  'counts',
  'source',
  'classifications',
  'applicants',
  'inventors',
])

function dateText(value: unknown) {
  return value ? String(value).slice(0, 10) : ''
}

function resultDetailRows(result: SearchResult, fields: Set<string>) {
  const rows: Array<{ label: string; value: string }> = []
  if (fields.has('applicationNumber') && result.applicationNumber) rows.push({ label: 'Application no.', value: result.applicationNumber })
  if (fields.has('filingDate') && result.filingDate) rows.push({ label: 'Filed', value: dateText(result.filingDate) })
  if (fields.has('publicationDate') && result.publicationDate) rows.push({ label: 'Published', value: dateText(result.publicationDate) })
  if (fields.has('counts')) {
    const counts = [
      result.numberOfPages ? `${result.numberOfPages} pages` : '',
      result.numberOfClaims ? `${result.numberOfClaims} claims` : '',
    ].filter(Boolean).join(', ')
    if (counts) rows.push({ label: 'Counts', value: counts })
  }
  if (fields.has('source')) {
    const source = [
      result.sourcePdfName || '',
      result.sourcePageNumber ? `p.${result.sourcePageNumber}` : '',
    ].filter(Boolean).join(' ')
    if (source) rows.push({ label: 'Source', value: source })
  }
  if (fields.has('classifications') && result.classifications?.length) {
    rows.push({ label: 'IPC/CPC', value: result.classifications.join(', ') })
  }
  if (fields.has('applicants')) {
    const applicants = listText(result.applicants, 20)
    if (applicants) rows.push({ label: 'Applicants', value: applicants })
  }
  if (fields.has('inventors') && result.inventors?.length) {
    rows.push({ label: 'Inventors', value: result.inventors.join(', ') })
  }
  return rows
}

function ResultMetadata({ result, fields }: { result: SearchResult; fields: Set<string> }) {
  const rows = resultDetailRows(result, fields)
  if (!rows.length) return null
  return (
    <div className="grid gap-2 text-xs text-slate-500 md:grid-cols-2">
      {rows.map(row => (
        <div key={row.label}>
          <span className="font-medium text-slate-700">{row.label}:</span> {row.value}
        </div>
      ))}
    </div>
  )
}

function HighlightedResultMetadata({ result, fields }: { result: SearchResult; fields: Set<string> }) {
  const rows = resultDetailRows(result, fields)
  if (!rows.length) return null
  return (
    <div className="mt-3 rounded-md bg-slate-50 p-3">
      <div className="grid gap-2 text-xs text-slate-500 md:grid-cols-2">
        {rows.map(row => (
          <div key={row.label}>
            <span className="font-medium text-slate-700">{row.label}:</span> {row.value}
          </div>
        ))}
      </div>
    </div>
  )
}

function ResultsPanel({
  activeFilterChips,
  exportResults,
  providerStats,
  results,
  hasSearched,
  visibleDetailFields,
  warnings,
}: {
  activeFilterChips: Array<{ key: string; label: string; onRemove: () => void }>
  exportResults: () => void
  providerStats: ProviderStat[]
  results: SearchResult[]
  hasSearched: boolean
  visibleDetailFields: Set<string>
  warnings: string[]
}) {
  return (
    <div className="space-y-4">
      {!!warnings.length && (
        <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{warnings.join(' ')}</span>
        </div>
      )}

      {!!providerStats.length && (
        <div className="grid gap-3 md:grid-cols-3">
          {providerStats.map(stat => (
            <div key={stat.providerId} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
              <div className="font-medium">{displayPatentProviderLabel(stat.providerId || stat.label)}</div>
              <div className="mt-1 text-xs text-slate-500">{stat.enabled ? `${stat.resultCount} results` : 'Not enabled'}</div>
              {stat.error && <div className="mt-1 text-xs text-amber-700">{stat.error}</div>}
            </div>
          ))}
        </div>
      )}

      {!!activeFilterChips.length && (
        <div className="flex flex-wrap gap-2">
          {activeFilterChips.map(chip => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.onRemove}
              className="inline-flex max-w-full items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
            >
              <span className="truncate">{chip.label}</span>
              <X className="h-3 w-3 shrink-0" />
            </button>
          ))}
        </div>
      )}

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold">Results</h2>
          <button
            type="button"
            onClick={exportResults}
            disabled={!results.length}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Export
          </button>
        </div>
        <div className="divide-y divide-slate-100">
          {results.map(result => {
            const abstract = result.abstract || result.snippet || ''
            return (
              <article key={`${result.sourceProvider}-${result.publicationNumber}`} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-medium uppercase text-slate-500">
                    {result.publicationNumber} / {result.jurisdiction || 'Patent'} / {displayPatentProviderLabels(result.sourceProviders || [result.sourceProvider])}
                  </div>
                  <div className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                    {Math.round((result.relevanceScore || 0) * 100)}%
                  </div>
                </div>
                <a href={result.link || undefined} target="_blank" rel="noreferrer" className="mt-1 block text-sm font-semibold text-indigo-700 hover:underline">
                  {result.title}
                </a>
                {abstract && (
                  <div className="mt-3">
                    <div className="text-xs font-semibold uppercase text-slate-500">Abstract</div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{abstract}</p>
                  </div>
                )}
                {visibleDetailFields.size > 0 && <HighlightedResultMetadata result={result} fields={visibleDetailFields} />}
                <details className="mt-3 rounded-md border border-slate-200 px-3 py-2">
                  <summary className="cursor-pointer text-xs font-medium text-slate-700">Patent details</summary>
                  <div className="mt-3">
                    <ResultMetadata result={result} fields={allResultDetailFields} />
                  </div>
                </details>
                {!!result.matchedFields?.length && (
                  <div className="mt-2 text-xs text-slate-500">Matched: {result.matchedFields.join(', ')}</div>
                )}
              </article>
            )
          })}
          {!results.length && (
            <div className="p-8 text-center text-sm text-slate-500">
              {hasSearched ? 'No matching patents found for the current filters.' : 'Run a search to see matching patents.'}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
