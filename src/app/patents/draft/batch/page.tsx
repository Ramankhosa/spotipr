'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { PageLoadingBird } from '@/components/ui/loading-bird'
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  History,
  Loader2,
  PackageCheck,
  RefreshCw,
  Upload,
} from 'lucide-react'

type Project = {
  id: string
  name: string
}

type ClaimsHandling = 'draft from brief' | 'use as is' | 'improve' | 'auto'
type PriorArtHandling = 'use only' | 'expand with search' | 'auto'

type PreviewRow = {
  rowNo: number
  title: string
  ideaDetails: string
  noveltyDetails?: string
  literatureReviewInstructions?: string
  literatureReviewContent?: string
  figureRemarks?: string
  draftingRemarks?: string
  jurisdictions: string[]
  filingType: string
  claimsText?: string
  claimsHandling: ClaimsHandling
  claimsNotes?: string
  priorArtHandling: PriorArtHandling
  illustrativeData?: string
  errors: string[]
  warnings: string[]
}

type BatchSummary = {
  id: string
  name: string
  sourceFilename?: string | null
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'FAILED'
  totalItems: number
  completedItems: number
  failedItems: number
  warningItems: number
  itemSummaries?: Array<{
    requestId?: string
    itemNo?: number
    title?: string
    status?: string
    patentId?: string
    sessionId?: string
    error?: string
  }>
  downloadUrl?: string | null
  createdAt: string
  completedAt?: string | null
}

const FILE_TYPES = '.xlsx,.csv,.tsv,.json'
const TERMINAL_BATCH_STATUSES = new Set(['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED'])

function normalizeJurisdictionText(value: string) {
  return value
    .split(/[,\s;]+/)
    .map(item => item.trim().toUpperCase())
    .filter(Boolean)
    .join(',')
}

function statusClasses(status: string) {
  if (status === 'COMPLETED' || status === 'DELIVERED') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'COMPLETED_WITH_ERRORS' || status === 'DELIVERED_WITH_WARNINGS') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (status === 'FAILED' || status === 'REJECTED' || status === 'CANCELED') return 'border-rose-200 bg-rose-50 text-rose-700'
  if (status === 'PROCESSING') return 'border-blue-200 bg-blue-50 text-blue-700'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function downloadBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(href)
}

function filenameFromDisposition(disposition: string | null, fallback: string) {
  const match = disposition?.match(/filename="?([^"]+)"?/i)
  return match?.[1] || fallback
}

export default function PatentDraftBatchPage() {
  const router = useRouter()
  const { user, isLoading: authLoading, authFetch } = useAuth()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [batches, setBatches] = useState<BatchSummary[]>([])
  const [selectedBatch, setSelectedBatch] = useState<BatchSummary | null>(null)
  const [batchName, setBatchName] = useState('')
  const [projectId, setProjectId] = useState('')
  const [defaultJurisdictions, setDefaultJurisdictions] = useState('IN')
  const [defaultFilingType, setDefaultFilingType] = useState('utility')
  const [defaultClaimsHandling, setDefaultClaimsHandling] = useState<ClaimsHandling>('draft from brief')
  const [defaultPriorArtHandling, setDefaultPriorArtHandling] = useState<PriorArtHandling>('auto')
  const [defaultDraftingRemarks, setDefaultDraftingRemarks] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([])
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({})
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [isLoadingData, setIsLoadingData] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const defaults = useMemo(() => ({
    defaultJurisdictions: normalizeJurisdictionText(defaultJurisdictions),
    defaultFilingType,
    defaultClaimsHandling,
    defaultPriorArtHandling,
    defaultDraftingRemarks,
  }), [defaultClaimsHandling, defaultDraftingRemarks, defaultFilingType, defaultJurisdictions, defaultPriorArtHandling])

  const hasBlockingErrors = previewRows.some(row => row.errors.length > 0)
  const hasActiveBatches = batches.some(batch => !TERMINAL_BATCH_STATUSES.has(batch.status))

  const loadBatches = useCallback(async () => {
    const res = await authFetch('/api/auto-patent-drafting/batches', { cache: 'no-store' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || 'Failed to load patent drafting batches.')
    const nextBatches = body.batches || []
    setBatches(nextBatches)
    setSelectedBatch(current => {
      if (!current) return current
      return nextBatches.find((batch: BatchSummary) => batch.id === current.id) || current
    })
  }, [authFetch])

  const loadInitialData = useCallback(async () => {
    try {
      setIsLoadingData(true)
      setError(null)
      const [projectsRes] = await Promise.all([
        authFetch('/api/projects', { cache: 'no-store' }),
        loadBatches(),
      ])
      if (projectsRes.ok) {
        const body = await projectsRes.json()
        setProjects(body.projects || [])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load batch drafting workspace.')
    } finally {
      setIsLoadingData(false)
    }
  }, [authFetch, loadBatches])

  useEffect(() => {
    if (!authLoading && !user) router.push('/login')
  }, [authLoading, router, user])

  useEffect(() => {
    if (!authLoading && user) loadInitialData()
  }, [authLoading, loadInitialData, user])

  useEffect(() => {
    if (!user || !hasActiveBatches) return
    const timer = window.setInterval(() => {
      loadBatches().catch(() => undefined)
    }, 10000)
    return () => window.clearInterval(timer)
  }, [hasActiveBatches, loadBatches, user])

  const handleTemplateDownload = async (format: 'xlsx' | 'csv') => {
    try {
      setError(null)
      const res = await authFetch(`/api/auto-patent-drafting/batches/template?format=${format}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to download template.')
      }
      const blob = await res.blob()
      downloadBlob(blob, filenameFromDisposition(res.headers.get('content-disposition'), `patent-drafting-batch-template.${format}`))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download template.')
    }
  }

  const previewFile = async (file: File) => {
    try {
      setIsPreviewing(true)
      setError(null)
      setNotice(null)
      const formData = new FormData()
      formData.append('file', file)
      Object.entries(defaults).forEach(([key, value]) => {
        if (value) formData.append(key, value)
      })
      const res = await authFetch('/api/auto-patent-drafting/batches/preview', {
        method: 'POST',
        body: formData,
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Failed to preview batch upload.')
      setPreviewRows(body.rows || [])
      setExpandedRows({})
      setNotice(`Previewed ${body.totalRows || 0} row${body.totalRows === 1 ? '' : 's'}.`)
    } catch (err) {
      setPreviewRows([])
      setError(err instanceof Error ? err.message : 'Failed to preview batch upload.')
    } finally {
      setIsPreviewing(false)
    }
  }

  const handleFileChange = async (file: File | null) => {
    setSelectedFile(file)
    if (file) await previewFile(file)
  }

  const updateRow = (index: number, patch: Partial<PreviewRow>) => {
    setPreviewRows(prev => prev.map((row, rowIndex) => {
      if (rowIndex !== index) return row
      const next = { ...row, ...patch }
      const errors = next.ideaDetails.trim() ? [] : ['ideaDetails is required.']
      const warnings = [
        ...(next.title.trim() ? [] : ['Title is blank; a fallback title will be used.']),
        ...(next.noveltyDetails?.trim() ? [] : ['Novelty details are blank.']),
      ]
      return { ...next, errors, warnings }
    }))
  }

  const createBatch = async () => {
    if (!previewRows.length || hasBlockingErrors) return
    try {
      setIsCreating(true)
      setError(null)
      setNotice(null)
      const ideas = previewRows.map(row => ({
        title: row.title,
        ideaDetails: row.ideaDetails,
        noveltyDetails: row.noveltyDetails || '',
        literatureReviewInstructions: row.literatureReviewInstructions || '',
        literatureReviewContent: row.literatureReviewContent || '',
        figureRemarks: row.figureRemarks || '',
        draftingRemarks: row.draftingRemarks || '',
        jurisdictions: row.jurisdictions,
        filingType: row.filingType,
        claimsText: row.claimsText || '',
        claimsHandling: row.claimsHandling,
        claimsNotes: row.claimsNotes || '',
        priorArtHandling: row.priorArtHandling,
        illustrativeData: row.illustrativeData || '',
      }))
      const res = await authFetch('/api/auto-patent-drafting/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: batchName,
          projectId,
          ideas,
          ...defaults,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Failed to create patent drafting batch.')
      setNotice(`Batch queued with ${body.totalItems || ideas.length} patent draft${(body.totalItems || ideas.length) === 1 ? '' : 's'}.`)
      setSelectedFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setPreviewRows([])
      await loadBatches()
      const detailRes = await authFetch(`/api/auto-patent-drafting/batches/${body.batchId}`, { cache: 'no-store' })
      if (detailRes.ok) {
        const detail = await detailRes.json()
        setSelectedBatch(detail.batch)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create patent drafting batch.')
    } finally {
      setIsCreating(false)
    }
  }

  const downloadBatch = async (batch: BatchSummary) => {
    const url = batch.downloadUrl || `/api/auto-patent-drafting/batches/${batch.id}/download`
    try {
      setError(null)
      const res = await authFetch(url)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to download batch ZIP.')
      }
      const blob = await res.blob()
      downloadBlob(blob, filenameFromDisposition(res.headers.get('content-disposition'), `${batch.name || 'patent-drafting-batch'}.zip`))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download batch ZIP.')
    }
  }

  if (authLoading || isLoadingData) {
    return <PageLoadingBird message="Loading batch drafting workspace..." />
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-slate-50">
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm text-slate-500">
              <Link href="/dashboard" className="hover:text-slate-900">Dashboard</Link>
              <span>/</span>
              <Link href="/patents/draft/new" className="hover:text-slate-900">Patent Drafting</Link>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Batch Patent Drafting</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Upload a filled template, review every patent row, then queue automated drafting in the background.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleTemplateDownload('xlsx')}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              <Download className="h-4 w-4" />
              XLSX template
            </button>
            <button
              type="button"
              onClick={() => handleTemplateDownload('csv')}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              <Download className="h-4 w-4" />
              CSV template
            </button>
          </div>
        </div>

        {error ? (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
            <span>{error}</span>
          </div>
        ) : null}

        {notice ? (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" />
            <span>{notice}</span>
          </div>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <section className="space-y-6">
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-blue-600" />
                <h2 className="text-lg font-semibold text-slate-950">Batch Settings</h2>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Batch name</span>
                  <input
                    value={batchName}
                    onChange={(event) => setBatchName(event.target.value)}
                    placeholder="June disclosure batch"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Project</span>
                  <select
                    value={projectId}
                    onChange={(event) => setProjectId(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="">No project</option>
                    {projects.map(project => (
                      <option key={project.id} value={project.id}>{project.name}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Default jurisdictions</span>
                  <input
                    value={defaultJurisdictions}
                    onChange={(event) => setDefaultJurisdictions(event.target.value)}
                    placeholder="IN,US,EP"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Default filing type</span>
                  <select
                    value={defaultFilingType}
                    onChange={(event) => setDefaultFilingType(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="utility">Utility</option>
                    <option value="provisional">Provisional</option>
                    <option value="design">Design</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Default claims handling</span>
                  <select
                    value={defaultClaimsHandling}
                    onChange={(event) => setDefaultClaimsHandling(event.target.value as ClaimsHandling)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="draft from brief">Draft from brief</option>
                    <option value="use as is">Use as is</option>
                    <option value="improve">Improve</option>
                    <option value="auto">Auto</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Default prior-art handling</span>
                  <select
                    value={defaultPriorArtHandling}
                    onChange={(event) => setDefaultPriorArtHandling(event.target.value as PriorArtHandling)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="auto">Auto</option>
                    <option value="use only">Use only</option>
                    <option value="expand with search">Expand with search</option>
                  </select>
                </label>
                <label className="block md:col-span-2">
                  <span className="text-sm font-medium text-slate-700">Default drafting remarks</span>
                  <textarea
                    value={defaultDraftingRemarks}
                    onChange={(event) => setDefaultDraftingRemarks(event.target.value)}
                    rows={3}
                    placeholder="Optional remarks applied only to rows with blank drafting remarks."
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </label>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <Upload className="h-5 w-5 text-blue-600" />
                  <h2 className="text-lg font-semibold text-slate-950">Upload and Preview</h2>
                </div>
                {selectedFile ? <span className="text-xs text-slate-500">{selectedFile.name}</span> : null}
              </div>

              <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center hover:bg-slate-100">
                {isPreviewing ? <Loader2 className="mb-3 h-6 w-6 animate-spin text-blue-600" /> : <Upload className="mb-3 h-6 w-6 text-slate-500" />}
                <span className="text-sm font-medium text-slate-900">Upload a completed batch file</span>
                <span className="mt-1 text-xs text-slate-500">Supported: {FILE_TYPES}. Upload previews rows but does not start drafting.</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={FILE_TYPES}
                  className="hidden"
                  onChange={(event) => handleFileChange(event.target.files?.[0] || null)}
                />
              </label>

              {previewRows.length ? (
                <div className="mt-5">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm text-slate-600">
                      {previewRows.length} row{previewRows.length === 1 ? '' : 's'} previewed, {previewRows.filter(row => row.errors.length > 0).length} with blocking errors.
                    </div>
                    <button
                      type="button"
                      onClick={createBatch}
                      disabled={hasBlockingErrors || isCreating}
                      className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
                      Create batch
                    </button>
                  </div>

                  <div className="overflow-hidden rounded-lg border border-slate-200">
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                          <tr>
                            <th className="px-3 py-2">Row</th>
                            <th className="min-w-60 px-3 py-2">Title</th>
                            <th className="min-w-96 px-3 py-2">Idea details</th>
                            <th className="min-w-44 px-3 py-2">Jurisdictions</th>
                            <th className="min-w-44 px-3 py-2">Status</th>
                            <th className="px-3 py-2"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 bg-white">
                          {previewRows.map((row, index) => (
                            <tr key={row.rowNo} className={row.errors.length ? 'bg-rose-50/40' : ''}>
                              <td className="px-3 py-3 align-top font-medium text-slate-700">{row.rowNo}</td>
                              <td className="px-3 py-3 align-top">
                                <input
                                  value={row.title}
                                  onChange={(event) => updateRow(index, { title: event.target.value })}
                                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                                />
                              </td>
                              <td className="px-3 py-3 align-top">
                                <textarea
                                  value={row.ideaDetails}
                                  onChange={(event) => updateRow(index, { ideaDetails: event.target.value })}
                                  rows={2}
                                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                                />
                              </td>
                              <td className="px-3 py-3 align-top">
                                <input
                                  value={row.jurisdictions.join(',')}
                                  onChange={(event) => updateRow(index, { jurisdictions: normalizeJurisdictionText(event.target.value).split(',').filter(Boolean) })}
                                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm uppercase"
                                />
                              </td>
                              <td className="px-3 py-3 align-top">
                                {row.errors.length ? (
                                  <div className="text-xs font-medium text-rose-700">{row.errors.join(' ')}</div>
                                ) : row.warnings.length ? (
                                  <div className="text-xs font-medium text-amber-700">{row.warnings.join(' ')}</div>
                                ) : (
                                  <div className="text-xs font-medium text-emerald-700">Ready</div>
                                )}
                              </td>
                              <td className="px-3 py-3 align-top">
                                <button
                                  type="button"
                                  onClick={() => setExpandedRows(prev => ({ ...prev, [row.rowNo]: !prev[row.rowNo] }))}
                                  className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                >
                                  {expandedRows[row.rowNo] ? 'Hide' : 'Details'}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {previewRows.map((row, index) => expandedRows[row.rowNo] ? (
                      <div key={`details-${row.rowNo}`} className="border-t border-slate-200 bg-slate-50 p-4">
                        <div className="mb-2 text-sm font-semibold text-slate-800">Row {row.rowNo} advanced fields</div>
                        <div className="grid gap-3 md:grid-cols-2">
                          {[
                            ['noveltyDetails', 'Novelty details'],
                            ['literatureReviewInstructions', 'Literature review instructions'],
                            ['literatureReviewContent', 'Literature review content'],
                            ['figureRemarks', 'Figure remarks'],
                            ['draftingRemarks', 'Drafting remarks'],
                            ['claimsText', 'Claims text'],
                            ['claimsNotes', 'Claims notes'],
                            ['illustrativeData', 'Illustrative data'],
                          ].map(([key, label]) => (
                            <label key={key} className="block">
                              <span className="text-xs font-medium text-slate-600">{label}</span>
                              <textarea
                                value={String(row[key as keyof PreviewRow] || '')}
                                onChange={(event) => updateRow(index, { [key]: event.target.value } as Partial<PreviewRow>)}
                                rows={2}
                                className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                              />
                            </label>
                          ))}
                          <label className="block">
                            <span className="text-xs font-medium text-slate-600">Claims handling</span>
                            <select
                              value={row.claimsHandling}
                              onChange={(event) => updateRow(index, { claimsHandling: event.target.value as ClaimsHandling })}
                              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                            >
                              <option value="draft from brief">Draft from brief</option>
                              <option value="use as is">Use as is</option>
                              <option value="improve">Improve</option>
                              <option value="auto">Auto</option>
                            </select>
                          </label>
                          <label className="block">
                            <span className="text-xs font-medium text-slate-600">Prior-art handling</span>
                            <select
                              value={row.priorArtHandling}
                              onChange={(event) => updateRow(index, { priorArtHandling: event.target.value as PriorArtHandling })}
                              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                            >
                              <option value="auto">Auto</option>
                              <option value="use only">Use only</option>
                              <option value="expand with search">Expand with search</option>
                            </select>
                          </label>
                        </div>
                      </div>
                    ) : null)}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <aside className="space-y-6">
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <History className="h-5 w-5 text-blue-600" />
                  <h2 className="text-lg font-semibold text-slate-950">Recent Batches</h2>
                </div>
                <button
                  type="button"
                  onClick={() => loadBatches().catch(err => setError(err instanceof Error ? err.message : 'Failed to refresh batches.'))}
                  className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-50"
                  aria-label="Refresh batches"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-3">
                {batches.length ? batches.map(batch => (
                  <button
                    key={batch.id}
                    type="button"
                    onClick={() => setSelectedBatch(batch)}
                    className={`w-full rounded-lg border p-3 text-left transition hover:border-blue-300 ${selectedBatch?.id === batch.id ? 'border-blue-300 bg-blue-50/50' : 'border-slate-200 bg-white'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">{batch.name}</div>
                        <div className="mt-1 text-xs text-slate-500">{new Date(batch.createdAt).toLocaleString()}</div>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusClasses(batch.status)}`}>
                        {batch.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-blue-600"
                        style={{ width: `${batch.totalItems ? Math.round(((batch.completedItems + batch.failedItems) / batch.totalItems) * 100) : 0}%` }}
                      />
                    </div>
                    <div className="mt-2 text-xs text-slate-600">
                      {batch.completedItems}/{batch.totalItems} completed
                      {batch.failedItems ? `, ${batch.failedItems} failed` : ''}
                      {batch.warningItems ? `, ${batch.warningItems} warnings` : ''}
                    </div>
                  </button>
                )) : (
                  <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                    No patent drafting batches yet.
                  </div>
                )}
              </div>
            </div>

            {selectedBatch ? (
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">{selectedBatch.name}</h2>
                    <p className="mt-1 text-xs text-slate-500">{selectedBatch.sourceFilename || 'Created from edited preview rows'}</p>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusClasses(selectedBatch.status)}`}>
                    {selectedBatch.status.replace(/_/g, ' ')}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="text-lg font-semibold text-slate-900">{selectedBatch.totalItems}</div>
                    <div className="text-xs text-slate-500">Items</div>
                  </div>
                  <div className="rounded-lg bg-emerald-50 p-3">
                    <div className="text-lg font-semibold text-emerald-700">{selectedBatch.completedItems}</div>
                    <div className="text-xs text-emerald-700">Completed</div>
                  </div>
                  <div className="rounded-lg bg-rose-50 p-3">
                    <div className="text-lg font-semibold text-rose-700">{selectedBatch.failedItems}</div>
                    <div className="text-xs text-rose-700">Failed</div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => downloadBatch(selectedBatch)}
                  disabled={!selectedBatch.downloadUrl && selectedBatch.status !== 'COMPLETED' && selectedBatch.status !== 'COMPLETED_WITH_ERRORS'}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <Download className="h-4 w-4" />
                  Download ZIP
                </button>

                <div className="mt-5 space-y-2">
                  {(selectedBatch.itemSummaries || []).length ? selectedBatch.itemSummaries!.map((item, index) => (
                    <div key={`${item.requestId || index}`} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-slate-900">
                            {String(item.itemNo || index + 1).padStart(2, '0')}. {item.title || 'Untitled draft'}
                          </div>
                          {item.error ? <div className="mt-1 text-xs text-rose-700">{item.error}</div> : null}
                        </div>
                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusClasses(item.status || 'QUEUED')}`}>
                          {item.status || 'QUEUED'}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        {item.requestId ? <Link className="font-medium text-blue-700 hover:underline" href={`/email-drafting/requests/${item.requestId}`}>Request</Link> : null}
                        {item.patentId ? <Link className="font-medium text-blue-700 hover:underline" href={`/patents/${item.patentId}/draft`}>Patent</Link> : null}
                      </div>
                    </div>
                  )) : (
                    <div className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
                      Item details will appear after the worker picks up the batch.
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      </main>
    </div>
  )
}
