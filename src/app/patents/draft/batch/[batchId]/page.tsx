'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { PageLoadingBird } from '@/components/ui/loading-bird'
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileText,
  FolderOpen,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  XCircle,
} from 'lucide-react'

type BatchStatus = 'QUEUED' | 'PROCESSING' | 'PAUSED' | 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'FAILED' | 'CANCELLED'
type ReviewStatus = 'NEEDS_REVIEW' | 'REVIEWED' | 'ACCEPTED' | 'REJECTED'

type Artifact = {
  id: string
  filename: string
  category: 'drafts' | 'png' | 'svg' | 'other'
  mimeType?: string | null
  sizeBytes?: number | null
  downloadUrl: string
}

type BatchItem = {
  itemId: string
  itemNo: number
  title: string
  generatedTitle?: string
  jurisdictions?: string[]
  status: string
  currentStep?: string | null
  reviewStatus: ReviewStatus
  attorneyNotes?: string
  warnings?: string[]
  error?: string
  patentId?: string | null
  sessionId?: string | null
  priorArtAudit?: any
  artifactGroups: {
    drafts: Artifact[]
    png: Artifact[]
    svg: Artifact[]
    other: Artifact[]
  }
}

type Batch = {
  id: string
  name: string
  sourceFilename?: string | null
  status: BatchStatus
  totalItems: number
  completedItems: number
  failedItems: number
  warningItems: number
  createdAt: string
  completedAt?: string | null
  downloadUrl?: string | null
}

const REVIEW_OPTIONS: ReviewStatus[] = ['NEEDS_REVIEW', 'REVIEWED', 'ACCEPTED', 'REJECTED']

function statusClasses(status: string) {
  if (status === 'COMPLETED' || status === 'ACCEPTED') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'COMPLETED_WITH_ERRORS' || status === 'REVIEWED') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (status === 'FAILED' || status === 'CANCELLED' || status === 'REJECTED') return 'border-rose-200 bg-rose-50 text-rose-700'
  if (status === 'PAUSED') return 'border-violet-200 bg-violet-50 text-violet-700'
  if (status === 'PROCESSING') return 'border-ai-blue-200 bg-ai-blue-50 text-ai-blue-700'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function formatBytes(value?: number | null) {
  if (!value) return ''
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 102.4) / 10} KB`
  return `${Math.round(value / 1024 / 102.4) / 10} MB`
}

function filenameFromDisposition(disposition: string | null, fallback: string) {
  const match = disposition?.match(/filename="?([^"]+)"?/i)
  return match?.[1] || fallback
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

export default function PatentDraftBatchDetailPage() {
  const params = useParams<{ batchId: string }>()
  const router = useRouter()
  const { user, isLoading: authLoading, authFetch } = useAuth()
  const [batch, setBatch] = useState<Batch | null>(null)
  const [items, setItems] = useState<BatchItem[]>([])
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [warningOnly, setWarningOnly] = useState(false)
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({})
  const [reviewDraft, setReviewDraft] = useState<Record<string, ReviewStatus>>({})
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const batchId = params?.batchId

  const loadDetail = useCallback(async () => {
    if (!batchId) return
    setError(null)
    const [batchRes, artifactRes] = await Promise.all([
      authFetch(`/api/auto-patent-drafting/batches/${batchId}`, { cache: 'no-store' }),
      authFetch(`/api/auto-patent-drafting/batches/${batchId}/artifacts`, { cache: 'no-store' }),
    ])
    const batchBody = await batchRes.json().catch(() => ({}))
    if (!batchRes.ok) throw new Error(batchBody.error || 'Failed to load batch.')
    const artifactBody = await artifactRes.json().catch(() => ({}))
    if (!artifactRes.ok) throw new Error(artifactBody.error || 'Failed to load batch artifacts.')
    setBatch(batchBody.batch)
    setItems(artifactBody.items || [])
    setNotesDraft(Object.fromEntries((artifactBody.items || []).map((item: BatchItem) => [item.itemId, item.attorneyNotes || ''])))
    setReviewDraft(Object.fromEntries((artifactBody.items || []).map((item: BatchItem) => [item.itemId, item.reviewStatus || 'NEEDS_REVIEW'])))
  }, [authFetch, batchId])

  useEffect(() => {
    if (!authLoading && !user) router.push('/login')
  }, [authLoading, router, user])

  useEffect(() => {
    if (!authLoading && user) {
      setLoading(true)
      loadDetail()
        .catch(err => setError(err instanceof Error ? err.message : 'Failed to load batch.'))
        .finally(() => setLoading(false))
    }
  }, [authLoading, loadDetail, user])

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter(item => {
      const matchesQuery = !q ||
        `${item.generatedTitle || ''} ${item.title || ''} ${(item.jurisdictions || []).join(' ')}`.toLowerCase().includes(q)
      const matchesStatus = statusFilter === 'ALL' || item.status === statusFilter || item.reviewStatus === statusFilter
      const matchesWarning = !warningOnly || Boolean(item.error || item.warnings?.length)
      return matchesQuery && matchesStatus && matchesWarning
    })
  }, [items, query, statusFilter, warningOnly])

  const runBatchAction = async (kind: 'pause' | 'resume' | 'cancel') => {
    if (!batch) return
    if (kind === 'cancel' && !window.confirm('Cancel this batch? Queued and running items will be marked cancelled.')) return
    try {
      setAction(kind)
      setError(null)
      setNotice(null)
      const res = await authFetch(`/api/auto-patent-drafting/batches/${batch.id}/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: kind === 'cancel' ? JSON.stringify({ reason: 'Cancelled from batch detail page.' }) : undefined,
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Failed to ${kind} batch.`)
      await loadDetail()
      setNotice(kind === 'pause' ? 'Batch paused.' : kind === 'resume' ? 'Batch resumed.' : 'Batch cancelled.')
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${kind} batch.`)
    } finally {
      setAction(null)
    }
  }

  const downloadZip = async () => {
    if (!batch) return
    try {
      setAction('download')
      setError(null)
      const res = await authFetch(`/api/auto-patent-drafting/batches/${batch.id}/download`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to download ZIP.')
      }
      downloadBlob(await res.blob(), filenameFromDisposition(res.headers.get('content-disposition'), `${batch.name}.zip`))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download ZIP.')
    } finally {
      setAction(null)
    }
  }

  const rebuildZip = async () => {
    if (!batch) return
    try {
      setAction('rebuild')
      setError(null)
      setNotice(null)
      const res = await authFetch(`/api/auto-patent-drafting/batches/${batch.id}/download/rebuild`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Failed to rebuild ZIP.')
      await loadDetail()
      setNotice('Organized ZIP rebuilt.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rebuild ZIP.')
    } finally {
      setAction(null)
    }
  }

  const downloadArtifact = async (artifact: Artifact) => {
    try {
      setError(null)
      const res = await authFetch(artifact.downloadUrl)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to download file.')
      }
      downloadBlob(await res.blob(), filenameFromDisposition(res.headers.get('content-disposition'), artifact.filename))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download file.')
    }
  }

  const saveReview = async (item: BatchItem) => {
    try {
      setAction(`save:${item.itemId}`)
      setError(null)
      setNotice(null)
      const res = await authFetch(`/api/auto-patent-drafting/batches/${batchId}/items/${item.itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewStatus: reviewDraft[item.itemId] || item.reviewStatus,
          attorneyNotes: notesDraft[item.itemId] || '',
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Failed to save review metadata.')
      await loadDetail()
      setNotice('Review metadata saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save review metadata.')
    } finally {
      setAction(null)
    }
  }

  const retryItem = async (item: BatchItem) => {
    try {
      setAction(`retry:${item.itemId}`)
      setError(null)
      setNotice(null)
      const res = await authFetch(`/api/auto-patent-drafting/batches/${batchId}/items/${item.itemId}/retry`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Failed to retry item.')
      await loadDetail()
      setNotice('Item requeued.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry item.')
    } finally {
      setAction(null)
    }
  }

  const retryFailed = async () => {
    if (!batch) return
    try {
      setAction('retry-failed')
      setError(null)
      setNotice(null)
      const res = await authFetch(`/api/auto-patent-drafting/batches/${batch.id}/retry-failed`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Failed to retry failed items.')
      await loadDetail()
      setNotice(`${body.retried || 0} item${body.retried === 1 ? '' : 's'} requeued.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry failed items.')
    } finally {
      setAction(null)
    }
  }

  if (authLoading || loading) return <PageLoadingBird message="Loading batch..." />
  if (!user || !batch) return null

  const progressPct = batch.totalItems ? Math.round(((batch.completedItems + batch.failedItems) / batch.totalItems) * 100) : 0

  return (
    <div className="min-h-screen bg-slate-50">
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-sm text-slate-500">
              <Link href="/dashboard" className="hover:text-slate-900">Dashboard</Link>
              <span>/</span>
              <Link href="/patents/draft/batch" className="hover:text-slate-900">Batch Drafting</Link>
            </div>
            <h1 className="truncate text-3xl font-semibold tracking-tight text-slate-950">{batch.name}</h1>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
              <span>Created {new Date(batch.createdAt).toLocaleString()}</span>
              {batch.completedAt ? <span>Completed {new Date(batch.completedAt).toLocaleString()}</span> : null}
              {batch.sourceFilename ? <span>{batch.sourceFilename}</span> : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => loadDetail().catch(err => setError(err instanceof Error ? err.message : 'Failed to refresh batch.'))} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
            {['QUEUED', 'PROCESSING'].includes(batch.status) ? (
              <button onClick={() => runBatchAction('pause')} disabled={action === 'pause'} className="inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-60">
                {action === 'pause' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />} Pause
              </button>
            ) : null}
            {batch.status === 'PAUSED' ? (
              <button onClick={() => runBatchAction('resume')} disabled={action === 'resume'} className="inline-flex items-center gap-2 rounded-lg border border-ai-blue-200 bg-ai-blue-50 px-3 py-2 text-sm font-semibold text-ai-blue-700 hover:bg-ai-blue-100 disabled:opacity-60">
                {action === 'resume' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Resume
              </button>
            ) : null}
            {['QUEUED', 'PROCESSING', 'PAUSED'].includes(batch.status) ? (
              <button onClick={() => runBatchAction('cancel')} disabled={action === 'cancel'} className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60">
                {action === 'cancel' ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Cancel
              </button>
            ) : null}
            <button onClick={retryFailed} disabled={action === 'retry-failed'} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60">
              {action === 'retry-failed' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Retry Failed
            </button>
            <button onClick={rebuildZip} disabled={action === 'rebuild'} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60">
              {action === 'rebuild' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />} Rebuild ZIP
            </button>
            <button onClick={downloadZip} disabled={action === 'download'} className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
              {action === 'download' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download ZIP
            </button>
          </div>
        </div>

        {error ? <div className="mb-4 flex gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><AlertCircle className="h-4 w-4" />{error}</div> : null}
        {notice ? <div className="mb-4 flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />{notice}</div> : null}

        <section className="mb-5 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClasses(batch.status)}`}>{batch.status.replace(/_/g, ' ')}</span>
            <div className="text-sm text-slate-600">{batch.completedItems}/{batch.totalItems} completed, {batch.failedItems} failed, {batch.warningItems} warnings</div>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-ai-blue-600" style={{ width: `${progressPct}%` }} />
          </div>
        </section>

        <section className="mb-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_160px]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search title or jurisdiction" className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-ai-blue-500 focus:outline-none focus:ring-2 focus:ring-ai-blue-100" />
          </label>
          <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
            <option value="ALL">All statuses</option>
            {['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', ...REVIEW_OPTIONS].map(value => <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}
          </select>
          <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
            <input type="checkbox" checked={warningOnly} onChange={event => setWarningOnly(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            Needs attention
          </label>
        </section>

        <section className="space-y-4">
          {filteredItems.map(item => {
            const artifactGroups = [
              ['Drafts', item.artifactGroups.drafts],
              ['PNG', item.artifactGroups.png],
              ['SVG', item.artifactGroups.svg],
              ['Other', item.artifactGroups.other],
            ] as const
            return (
              <article key={item.itemId} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-base font-semibold text-slate-950">{String(item.itemNo).padStart(2, '0')}. {item.generatedTitle || item.title || 'Untitled draft'}</h2>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusClasses(item.status)}`}>{item.status}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusClasses(reviewDraft[item.itemId] || item.reviewStatus)}`}>{(reviewDraft[item.itemId] || item.reviewStatus).replace(/_/g, ' ')}</span>
                    </div>
                    {item.title && item.generatedTitle && item.title !== item.generatedTitle ? <p className="mt-1 text-xs text-slate-500">Input title: {item.title}</p> : null}
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                      {item.currentStep ? <span>{item.currentStep.replace(/_/g, ' ')}</span> : null}
                      {item.jurisdictions?.length ? <span>{item.jurisdictions.join(', ')}</span> : null}
                      {item.patentId ? <Link href={`/patents/${item.patentId}/draft`} className="font-medium text-ai-blue-700 hover:underline">Patent</Link> : null}
                    </div>
                    {item.warnings?.length ? <p className="mt-2 text-xs text-amber-700">{item.warnings.join('; ')}</p> : null}
                    {item.error ? <p className="mt-2 text-xs text-rose-700">{item.error}</p> : null}
                    {item.priorArtAudit ? (
                      <p className="mt-2 text-xs text-slate-600">
                        Prior art: {item.priorArtAudit.totalCandidates || 0} candidates, {item.priorArtAudit.selectedReferences?.length || 0} selected{item.priorArtAudit.googleFallbackUsed ? ', Google fallback used' : ''}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {['FAILED', 'CANCELLED'].includes(item.status) ? (
                      <button onClick={() => retryItem(item)} disabled={action === `retry:${item.itemId}`} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                        {action === `retry:${item.itemId}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Retry
                      </button>
                    ) : null}
                    <button onClick={() => saveReview(item)} disabled={action === `save:${item.itemId}`} className="inline-flex items-center gap-2 rounded-lg border border-ai-blue-200 bg-ai-blue-50 px-3 py-2 text-sm font-semibold text-ai-blue-700 hover:bg-ai-blue-100 disabled:opacity-60">
                      {action === `save:${item.itemId}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
                  <div className="space-y-3">
                    <label className="block">
                      <span className="text-xs font-medium text-slate-600">Review status</span>
                      <select value={reviewDraft[item.itemId] || item.reviewStatus} onChange={event => setReviewDraft(prev => ({ ...prev, [item.itemId]: event.target.value as ReviewStatus }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                        {REVIEW_OPTIONS.map(value => <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-slate-600">Attorney notes</span>
                      <textarea value={notesDraft[item.itemId] || ''} onChange={event => setNotesDraft(prev => ({ ...prev, [item.itemId]: event.target.value }))} rows={5} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    </label>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    {artifactGroups.map(([label, artifacts]) => (
                      <div key={label} className="rounded-lg border border-slate-200">
                        <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">{label}</div>
                        <div className="divide-y divide-slate-100">
                          {artifacts.length ? artifacts.map(artifact => (
                            <button key={artifact.id} type="button" onClick={() => downloadArtifact(artifact)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50">
                              <span className="flex min-w-0 items-center gap-2">
                                <FileText className="h-4 w-4 shrink-0 text-slate-500" />
                                <span className="truncate text-slate-800">{artifact.filename}</span>
                              </span>
                              <span className="shrink-0 text-xs text-slate-500">{formatBytes(artifact.sizeBytes)}</span>
                            </button>
                          )) : <div className="px-3 py-4 text-sm text-slate-500">No files</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            )
          })}
          {!filteredItems.length ? <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">No items match the current filters.</div> : null}
        </section>
      </main>
    </div>
  )
}
