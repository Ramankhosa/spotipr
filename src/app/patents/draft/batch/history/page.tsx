'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { PageLoadingBird } from '@/components/ui/loading-bird'
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Eye,
  History,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Search,
  Upload,
  XCircle,
} from 'lucide-react'

type BatchStatus = 'QUEUED' | 'PROCESSING' | 'PAUSED' | 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'FAILED' | 'CANCELLED'

type BatchSummary = {
  id: string
  name: string
  sourceFilename?: string | null
  status: BatchStatus
  totalItems: number
  completedItems: number
  failedItems: number
  warningItems: number
  downloadUrl?: string | null
  createdAt: string
  completedAt?: string | null
}

type BatchListResponse = {
  batches?: BatchSummary[]
  nextCursor?: string | null
  hasMore?: boolean
  totalCount?: number
  statusCounts?: Record<string, number>
  error?: string
}

const STATUS_OPTIONS = [
  'ALL',
  'QUEUED',
  'PROCESSING',
  'PAUSED',
  'COMPLETED',
  'COMPLETED_WITH_ERRORS',
  'FAILED',
  'CANCELLED',
] as const

const POLLING_BATCH_STATUSES = new Set(['QUEUED', 'PROCESSING'])

function statusClasses(status: string) {
  if (status === 'COMPLETED') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'COMPLETED_WITH_ERRORS') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (status === 'FAILED' || status === 'CANCELLED') return 'border-rose-200 bg-rose-50 text-rose-700'
  if (status === 'PAUSED') return 'border-violet-200 bg-violet-50 text-violet-700'
  if (status === 'PROCESSING') return 'border-blue-200 bg-blue-50 text-blue-700'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function progressPct(batch: BatchSummary) {
  return batch.totalItems ? Math.round(((batch.completedItems + batch.failedItems) / batch.totalItems) * 100) : 0
}

function dateRangeStart(range: string) {
  if (range === '7') return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  if (range === '30') return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  return ''
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

export default function BatchHistoryPage() {
  const router = useRouter()
  const { user, isLoading: authLoading, authFetch } = useAuth()
  const [batches, setBatches] = useState<BatchSummary[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [totalCount, setTotalCount] = useState(0)
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({})
  const [status, setStatus] = useState('ALL')
  const [query, setQuery] = useState('')
  const [dateRange, setDateRange] = useState('30')
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [action, setAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const hasActiveBatches = useMemo(
    () => batches.some(batch => POLLING_BATCH_STATUSES.has(batch.status)),
    [batches]
  )

  const buildUrl = useCallback((cursor?: string | null) => {
    const params = new URLSearchParams({ limit: '25' })
    if (cursor) params.set('cursor', cursor)
    if (status !== 'ALL') params.set('status', status)
    if (query.trim()) params.set('q', query.trim())
    const from = dateRangeStart(dateRange)
    if (from) params.set('from', from)
    if (attentionOnly) params.set('attentionOnly', 'true')
    return `/api/auto-patent-drafting/batches?${params.toString()}`
  }, [attentionOnly, dateRange, query, status])

  const loadBatches = useCallback(async (reset = true, cursor?: string | null) => {
    const res = await authFetch(buildUrl(reset ? null : cursor), { cache: 'no-store' })
    const body: BatchListResponse = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || 'Failed to load batch history.')
    setBatches(prev => reset ? body.batches || [] : [...prev, ...(body.batches || [])])
    setNextCursor(body.nextCursor || null)
    setHasMore(Boolean(body.hasMore))
    setTotalCount(body.totalCount || 0)
    setStatusCounts(body.statusCounts || {})
  }, [authFetch, buildUrl])

  useEffect(() => {
    if (!authLoading && !user) router.push('/login')
  }, [authLoading, router, user])

  useEffect(() => {
    if (!authLoading && user) {
      setLoading(true)
      loadBatches(true)
        .catch(err => setError(err instanceof Error ? err.message : 'Failed to load batch history.'))
        .finally(() => setLoading(false))
    }
  }, [authLoading, loadBatches, user])

  useEffect(() => {
    if (!user || !hasActiveBatches) return
    const timer = window.setInterval(() => {
      loadBatches(true).catch(() => undefined)
    }, 10000)
    return () => window.clearInterval(timer)
  }, [hasActiveBatches, loadBatches, user])

  const loadMore = async () => {
    if (!hasMore || !nextCursor) return
    try {
      setLoadingMore(true)
      setError(null)
      await loadBatches(false, nextCursor)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more batches.')
    } finally {
      setLoadingMore(false)
    }
  }

  const downloadBatch = async (batch: BatchSummary) => {
    try {
      setAction(`${batch.id}:download`)
      setError(null)
      const res = await authFetch(batch.downloadUrl || `/api/auto-patent-drafting/batches/${batch.id}/download`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to download batch ZIP.')
      }
      downloadBlob(await res.blob(), filenameFromDisposition(res.headers.get('content-disposition'), `${batch.name || 'patent-drafting-batch'}.zip`))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download batch ZIP.')
    } finally {
      setAction(null)
    }
  }

  const runBatchAction = async (batch: BatchSummary, kind: 'pause' | 'resume' | 'cancel') => {
    if (kind === 'cancel' && !window.confirm('Cancel this batch? Queued and running items will be marked cancelled.')) return
    try {
      setAction(`${batch.id}:${kind}`)
      setError(null)
      setNotice(null)
      const res = await authFetch(`/api/auto-patent-drafting/batches/${batch.id}/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: kind === 'cancel' ? JSON.stringify({ reason: 'Cancelled from batch history.' }) : undefined,
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Failed to ${kind} batch.`)
      await loadBatches(true)
      setNotice(kind === 'pause' ? 'Batch paused.' : kind === 'resume' ? 'Batch resumed.' : 'Batch cancelled.')
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${kind} batch.`)
    } finally {
      setAction(null)
    }
  }

  if (authLoading || loading) return <PageLoadingBird message="Loading batch history..." />
  if (!user) return null

  return (
    <div className="min-h-screen bg-slate-50">
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm text-slate-500">
              <Link href="/dashboard" className="hover:text-slate-900">Dashboard</Link>
              <span>/</span>
              <Link href="/patents/draft/batch" className="hover:text-slate-900">Batch Drafting</Link>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Batch History</h1>
            <p className="mt-2 text-sm text-slate-600">Browse, filter, and manage automated drafting batches.</p>
          </div>
          <Link href="/patents/draft/batch" className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            <Upload className="h-4 w-4" />
            New batch
          </Link>
        </div>

        {error ? <div className="mb-4 flex gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><AlertCircle className="h-4 w-4" />{error}</div> : null}
        {notice ? <div className="mb-4 flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />{notice}</div> : null}

        <section className="mb-5 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {STATUS_OPTIONS.map(option => (
              <button
                key={option}
                type="button"
                onClick={() => setStatus(option)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${status === option ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {option === 'ALL' ? `All (${totalCount})` : `${option.replace(/_/g, ' ')} (${statusCounts[option] || 0})`}
              </button>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px_150px]">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Search batch name or source file"
                className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <select value={dateRange} onChange={event => setDateRange(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="all">All time</option>
            </select>
            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
              <input type="checkbox" checked={attentionOnly} onChange={event => setAttentionOnly(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              Needs attention
            </label>
            <button type="button" onClick={() => loadBatches(true).catch(err => setError(err instanceof Error ? err.message : 'Failed to refresh batches.'))} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Batch</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Progress</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Completed</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {batches.map(batch => (
                  <tr key={batch.id} onClick={() => router.push(`/patents/draft/batch/${batch.id}`)} className="cursor-pointer hover:bg-slate-50">
                    <td className="max-w-sm px-4 py-3">
                      <div className="truncate font-semibold text-slate-900">{batch.name}</div>
                      <div className="mt-1 truncate text-xs text-slate-500">{batch.sourceFilename || 'Created from edited preview rows'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusClasses(batch.status)}`}>
                        {batch.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="min-w-52 px-4 py-3">
                      <div className="mb-1 text-xs text-slate-600">
                        {batch.completedItems}/{batch.totalItems} completed
                        {batch.failedItems ? `, ${batch.failedItems} failed` : ''}
                        {batch.warningItems ? `, ${batch.warningItems} warnings` : ''}
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-blue-600" style={{ width: `${progressPct(batch)}%` }} />
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{new Date(batch.createdAt).toLocaleString()}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{batch.completedAt ? new Date(batch.completedAt).toLocaleString() : '-'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2" onClick={event => event.stopPropagation()}>
                        <Link href={`/patents/draft/batch/${batch.id}`} className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                          <Eye className="h-3.5 w-3.5" /> Open
                        </Link>
                        <button type="button" onClick={() => downloadBatch(batch)} disabled={action === `${batch.id}:download` || (!batch.downloadUrl && batch.completedItems === 0)} className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
                          {action === `${batch.id}:download` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} ZIP
                        </button>
                        {['QUEUED', 'PROCESSING'].includes(batch.status) ? (
                          <button type="button" onClick={() => runBatchAction(batch, 'pause')} disabled={action === `${batch.id}:pause`} className="inline-flex items-center gap-1 rounded border border-violet-200 bg-violet-50 px-2 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50">
                            {action === `${batch.id}:pause` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-3.5 w-3.5" />} Pause
                          </button>
                        ) : null}
                        {batch.status === 'PAUSED' ? (
                          <button type="button" onClick={() => runBatchAction(batch, 'resume')} disabled={action === `${batch.id}:resume`} className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50">
                            {action === `${batch.id}:resume` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Resume
                          </button>
                        ) : null}
                        {['QUEUED', 'PROCESSING', 'PAUSED'].includes(batch.status) ? (
                          <button type="button" onClick={() => runBatchAction(batch, 'cancel')} disabled={action === `${batch.id}:cancel`} className="inline-flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50">
                            {action === `${batch.id}:cancel` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />} Cancel
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {!batches.length ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                      No batches match the current filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        {hasMore ? (
          <div className="mt-5 flex justify-center">
            <button type="button" onClick={loadMore} disabled={loadingMore} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60">
              {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
              Load more
            </button>
          </div>
        ) : null}
      </main>
    </div>
  )
}
