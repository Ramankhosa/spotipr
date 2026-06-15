'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowLeft, CirclePause, Database, Download, Play, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'

type Counts = Record<string, number>

type ArchiveControl = {
  downloadsPaused: boolean
  pausedAt?: string | null
  pausedBy?: string | null
  resumedAt?: string | null
  resumedBy?: string | null
}

type ArchiveFile = {
  id: string
  journalKey: string
  journalNo: string
  publicationDateRaw?: string | null
  availabilityDateRaw?: string | null
  availabilityDate?: string | null
  part: number
  label?: string | null
  fileName: string
  outputFile?: string | null
  storedPath?: string | null
  fileHash?: string | null
  fileSizeBytes?: number | null
  downloadedBytes?: number | null
  expectedBytes?: number | null
  status: string
  errorMessage?: string | null
  attemptCount: number
  downloadedAt?: string | null
  importedAt?: string | null
  extractedAt?: string | null
  embeddedAt?: string | null
  patentImportBatchId?: string | null
  patentImportFileId?: string | null
  extractedPatentCount?: number
  embeddingCounts?: Counts
  patentImportBatch?: {
    id: string
    status: string
    totalFiles: number
    processedFiles: number
    patentPages: number
    patentsCreated: number
    patentsUpdated: number
  } | null
  patentImportFile?: {
    id: string
    batchId: string
    status: string
    totalPages: number
    patentPages: number
    patentsCreated: number
    patentsUpdated: number
    warningCount: number
    lowConfidencePages: number
    errorMessage?: string | null
    completedAt?: string | null
  } | null
}

type ArchiveResponse = {
  files?: ArchiveFile[]
  pagination?: {
    take: number
    skip: number
    total: number
  }
  summary?: {
    total: number
    statusCounts?: Counts
    downloadRoot?: string
    pdfsPerImportBatch?: number
  }
  control?: ArchiveControl
  settings?: {
    downloadRoot: string
    timeoutSeconds: number
    retries: number
    latestCheckLimit: number
    dailyCheckIntervalMs: number
    journalWorkerDelayMs: number
    maxAttempts: number
    pdfsPerImportBatch: number
    embeddingApiBatchSize: number
    embeddingWorkerClaim: number
    embeddingWorkerClaimMax: number
  }
  error?: string
}

const statusClass: Record<string, string> = {
  DISCOVERED: 'bg-slate-100 text-slate-700',
  QUEUED: 'bg-slate-100 text-slate-700',
  DOWNLOADING: 'bg-blue-100 text-blue-700',
  DOWNLOADED: 'bg-cyan-100 text-cyan-800',
  IMPORTED: 'bg-violet-100 text-violet-700',
  EXTRACTED: 'bg-amber-100 text-amber-800',
  EMBEDDED: 'bg-emerald-100 text-emerald-700',
  SKIPPED: 'bg-slate-100 text-slate-700',
  FAILED: 'bg-red-100 text-red-700',
  PROCESSING: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  COMPLETED_WITH_WARNINGS: 'bg-amber-100 text-amber-800',
}

const statuses = ['ALL', 'DISCOVERED', 'QUEUED', 'DOWNLOADING', 'DOWNLOADED', 'IMPORTED', 'EXTRACTED', 'EMBEDDED', 'FAILED']
const BYTES_PER_MB = 1024 * 1024

function formatFileSize(bytes?: number | null) {
  if (!bytes) return '-'
  return `${(bytes / BYTES_PER_MB).toFixed(1)}MB`
}

function formatDate(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

function formatDateTime(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function progressPercent(file: ArchiveFile) {
  if (file.status === 'EMBEDDED') return 100
  if (file.status === 'EXTRACTED') return 80
  if (file.status === 'IMPORTED') return 60
  if (file.status === 'DOWNLOADED') return 45
  if (file.status === 'DOWNLOADING') {
    const total = Number(file.expectedBytes || file.fileSizeBytes || 0)
    const done = Number(file.downloadedBytes || 0)
    return total > 0 ? Math.min(40, Math.max(5, Math.round((done / total) * 40))) : 15
  }
  if (file.status === 'QUEUED') return 3
  if (file.status === 'FAILED') return 100
  return 0
}

function shortErrorMessage(value?: string | null) {
  if (!value) return ''
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length > 360 ? `${compact.slice(0, 360)}...` : compact
}

function EmbeddingCounts({ counts }: { counts?: Counts }) {
  const total = Object.values(counts || {}).reduce((sum, count) => sum + Number(count || 0), 0)
  if (!total) return <span className="text-xs text-slate-500">None</span>
  return (
    <div className="flex flex-wrap gap-1">
      {(['COMPLETED', 'QUEUED', 'PROCESSING', 'FAILED'] as const).map(status => Number(counts?.[status] || 0) > 0 && (
        <span key={status} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusClass[status] || 'bg-slate-100 text-slate-700'}`}>
          {status}: {counts?.[status]}
        </span>
      ))}
    </div>
  )
}

export default function IpIndiaPatentArchivePage() {
  const { user } = useAuth()
  const [files, setFiles] = useState<ArchiveFile[]>([])
  const [summary, setSummary] = useState<ArchiveResponse['summary'] | null>(null)
  const [control, setControl] = useState<ArchiveControl | null>(null)
  const [settings, setSettings] = useState<ArchiveResponse['settings'] | null>(null)
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')
  const [status, setStatus] = useState('ALL')
  const [part, setPart] = useState('ALL')
  const [skip, setSkip] = useState(0)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [actioning, setActioning] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const roles = user?.roles || []
  const isViewer = roles.includes('SUPER_ADMIN_VIEWER') && !roles.includes('SUPER_ADMIN')
  const canAccess = roles.includes('SUPER_ADMIN') || roles.includes('SUPER_ADMIN_VIEWER')
  const take = 50

  const authHeaders = useCallback(() => ({
    Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`,
  }), [])

  const queryParams = useCallback((nextSkip: number) => {
    const params = new URLSearchParams({ take: String(take), skip: String(nextSkip) })
    if (since) params.set('since', since)
    if (until) params.set('until', until)
    if (status !== 'ALL') params.set('status', status)
    if (part !== 'ALL') params.set('part', part)
    return params
  }, [part, since, status, until])

  const fetchArchive = useCallback(async (nextSkip: number) => {
    if (!user || !canAccess) return
    const response = await fetch(`/api/super-admin/patent-corpus/ipindia-archive?${queryParams(nextSkip).toString()}`, {
      headers: authHeaders(),
    })
    const body = (await response.json().catch(() => ({}))) as ArchiveResponse
    if (!response.ok) throw new Error(body.error || 'Failed to load IP India archive')
    setFiles(body.files || [])
    setSummary(body.summary || null)
    setControl(body.control || null)
    setSettings(body.settings || null)
    setTotal(body.pagination?.total || 0)
    setSkip(body.pagination?.skip ?? nextSkip)
  }, [authHeaders, canAccess, queryParams, user])

  useEffect(() => {
    if (!user) return
    if (!canAccess) {
      window.location.href = '/dashboard'
      return
    }
    fetchArchive(0)
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load IP India archive'))
      .finally(() => setLoading(false))
  }, [canAccess, fetchArchive, user])

  useEffect(() => {
    if (!user || !canAccess) return
    const interval = window.setInterval(() => {
      fetchArchive(skip).catch(() => undefined)
    }, 5000)
    return () => window.clearInterval(interval)
  }, [canAccess, fetchArchive, skip, user])

  const runAction = async (action: 'sync' | 'queue' | 'check-latest' | 'historical' | 'process-one' | 'refresh-status' | 'pause' | 'resume') => {
    if (isViewer) return
    setActioning(action)
    setError(null)
    setSuccess(null)
    try {
      const response = await fetch('/api/super-admin/patent-corpus/ipindia-archive', {
        method: 'POST',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action,
          since: since || undefined,
          until: until || undefined,
          part: part !== 'ALL' ? Number(part) : undefined,
          retryFailed: action === 'queue' || action === 'historical' || action === 'check-latest',
          limit: settings?.latestCheckLimit || 1,
        }),
      })
      const body = (await response.json().catch(() => ({}))) as ArchiveResponse & { result?: { queued?: number; sync?: { synced?: number } }; sync?: { synced?: number } }
      if (!response.ok) throw new Error(body.error || 'IP India archive action failed')
      setFiles(body.files || [])
      setSummary(body.summary || null)
      setControl(body.control || null)
      if (body.settings) setSettings(body.settings)
      setTotal(body.pagination?.total || 0)
      const synced = body.sync?.synced ?? body.result?.sync?.synced
      const queued = body.result?.queued
      setSuccess(
        action === 'pause'
          ? 'Historical PDF downloading paused. The current in-flight file may finish before the queue stops.'
        : action === 'resume'
          ? 'Historical PDF downloading restarted.'
        : action === 'sync'
          ? `Synced ${synced || 0} journal PDF record(s).`
          : action === 'check-latest'
            ? `Latest check queued ${queued || 0} new PDF(s).`
          : action === 'historical'
            ? `Historical download queued ${queued || 0} PDF(s).`
          : action === 'queue'
            ? `Queued ${queued || 0} journal PDF(s).`
            : action === 'process-one'
              ? 'Processed one queued journal PDF.'
              : 'Refreshed extractor and embedding status.'
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'IP India archive action failed')
    } finally {
      setActioning(null)
      fetchArchive(skip).catch(() => undefined)
    }
  }

  const applyFilters = () => {
    setSkip(0)
    setError(null)
    fetchArchive(0).catch(err => setError(err instanceof Error ? err.message : 'Failed to apply filters'))
  }

  const downloadStoredPdf = async (file: ArchiveFile) => {
    if (!file.storedPath && !file.outputFile && !file.patentImportFileId) return
    const key = `${file.id}-pdf`
    setDownloading(key)
    setError(null)
    try {
      const response = await fetch(`/api/super-admin/patent-corpus/ipindia-archive/${file.id}/stored-file`, {
        headers: authHeaders(),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to download stored PDF')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = file.fileName
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download stored PDF')
    } finally {
      setDownloading(null)
    }
  }

  const statusCounts = summary?.statusCounts || {}
  const pageEnd = Math.min(skip + take, total)
  const pendingCount = Number(statusCounts.DISCOVERED || 0) + Number(statusCounts.QUEUED || 0)
  const inProcessCount = Number(statusCounts.DOWNLOADING || 0) + Number(statusCounts.IMPORTED || 0) + Number(statusCounts.EXTRACTED || 0)
  const downloadedCount = Number(statusCounts.DOWNLOADED || 0) + Number(statusCounts.IMPORTED || 0) + Number(statusCounts.EXTRACTED || 0) + Number(statusCounts.EMBEDDED || 0)
  const downloadsPaused = Boolean(control?.downloadsPaused)

  if (loading) {
    return <div className="min-h-screen bg-slate-50 p-8 text-sm text-slate-600">Loading IP India archive...</div>
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="mb-2">
              <Link href="/super-admin/patent-corpus" className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900">
                <ArrowLeft className="h-4 w-4" />
                Patent Corpus
              </Link>
            </div>
            <h1 className="text-2xl font-semibold tracking-normal">IP India Journal Archive</h1>
            <p className="mt-1 text-sm text-slate-600">Persistent download, extraction, and embedding status for IPO Patent Journal PDFs.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!isViewer && (
              <>
                <button
                  onClick={() => runAction('check-latest')}
                  disabled={Boolean(actioning)}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                >
                  <RefreshCw className="h-4 w-4" />
                  {actioning === 'check-latest' ? 'Checking' : 'Check Latest'}
                </button>
                <button
                  onClick={() => runAction('historical')}
                  disabled={Boolean(actioning)}
                  className="inline-flex items-center gap-2 rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                >
                  <Download className="h-4 w-4" />
                  {actioning === 'historical' ? 'Queueing' : 'Download Historical PDFs'}
                </button>
                <button
                  onClick={() => runAction(downloadsPaused ? 'resume' : 'pause')}
                  disabled={Boolean(actioning)}
                  className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-50 ${
                    downloadsPaused
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                      : 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100'
                  }`}
                >
                  {downloadsPaused ? <Play className="h-4 w-4" /> : <CirclePause className="h-4 w-4" />}
                  {actioning === 'pause'
                    ? 'Stopping'
                    : actioning === 'resume'
                      ? 'Restarting'
                      : downloadsPaused
                        ? 'Restart Downloads'
                        : 'Stop Downloads'}
                </button>
                <button
                  onClick={() => runAction('sync')}
                  disabled={Boolean(actioning)}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                >
                  <RefreshCw className="h-4 w-4" />
                  {actioning === 'sync' ? 'Syncing' : 'Sync List'}
                </button>
                <button
                  onClick={() => runAction('process-one')}
                  disabled={Boolean(actioning)}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                >
                  <Play className="h-4 w-4" />
                  {actioning === 'process-one' ? 'Running' : 'Run One'}
                </button>
              </>
            )}
            <button
              onClick={() => fetchArchive(skip).catch(err => setError(err instanceof Error ? err.message : 'Refresh failed'))}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            {success}
          </div>
        )}

        <section className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
          <div className="grid gap-3 md:grid-cols-5">
            <label className="text-xs font-medium text-slate-600">
              Since
              <input
                type="date"
                value={since}
                onChange={event => setSince(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              Until
              <input
                type="date"
                value={until}
                onChange={event => setUntil(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              Status
              <select
                value={status}
                onChange={event => setStatus(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {statuses.map(item => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              Part
              <select
                value={part}
                onChange={event => setPart(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="ALL">ALL</option>
                <option value="1">I</option>
                <option value="2">II</option>
                <option value="3">III</option>
              </select>
            </label>
            <div className="flex items-end">
              <button
                onClick={applyFilters}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Apply
              </button>
            </div>
          </div>
        </section>

        <section className="mb-4 grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-8">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <span className="text-slate-500">Pending</span>
            <div className="mt-1 text-lg font-semibold">{pendingCount}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <span className="text-slate-500">In process</span>
            <div className="mt-1 text-lg font-semibold">{inProcessCount}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <span className="text-slate-500">Downloaded</span>
            <div className="mt-1 text-lg font-semibold">{downloadedCount}</div>
          </div>
          {['QUEUED', 'DOWNLOADING', 'DOWNLOADED', 'IMPORTED', 'EXTRACTED', 'EMBEDDED', 'FAILED'].map(item => (
            <div key={item} className="rounded-lg border border-slate-200 bg-white p-3">
              <span className="text-slate-500">{item}</span>
              <div className="mt-1 text-lg font-semibold">{statusCounts[item] || 0}</div>
            </div>
          ))}
        </section>

        {settings && (
          <div className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm sm:grid-cols-4 lg:grid-cols-8">
            <div>
              <span className="text-slate-500">Download control</span>
              <div className={`font-medium ${downloadsPaused ? 'text-red-700' : 'text-emerald-700'}`}>
                {downloadsPaused ? 'Paused' : 'Running'}
              </div>
              <div className="truncate text-xs text-slate-500">
                {downloadsPaused ? formatDateTime(control?.pausedAt) : formatDateTime(control?.resumedAt)}
              </div>
            </div>
            <div><span className="text-slate-500">Download root</span><div className="truncate font-mono text-xs">{settings.downloadRoot}</div></div>
            <div><span className="text-slate-500">PDF batch cap</span><div className="font-medium">{settings.pdfsPerImportBatch}</div></div>
            <div><span className="text-slate-500">Daily latest</span><div className="font-medium">Every {Math.round(settings.dailyCheckIntervalMs / 60 / 60 / 1000)}h</div></div>
            <div><span className="text-slate-500">PDF pace</span><div className="font-medium">{Math.round(settings.journalWorkerDelayMs / 1000)}s</div></div>
            <div><span className="text-slate-500">Embed claim</span><div className="font-medium">{settings.embeddingWorkerClaim}</div></div>
            <div><span className="text-slate-500">OpenAI chunk</span><div className="font-medium">{settings.embeddingApiBatchSize}</div></div>
            <div><span className="text-slate-500">Download timeout</span><div className="font-medium">{settings.timeoutSeconds}s</div></div>
            <div><span className="text-slate-500">Retries</span><div className="font-medium">{settings.retries}</div></div>
          </div>
        )}

        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-slate-500" />
              <h2 className="text-sm font-semibold">Journal PDFs</h2>
            </div>
            <div className="text-xs text-slate-500">
              {total > 0 ? `${skip + 1}-${pageEnd} of ${total}` : '0 records'}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">PDF</th>
                  <th className="px-4 py-3">Journal</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Progress</th>
                  <th className="px-4 py-3">Extraction</th>
                  <th className="px-4 py-3">Embeddings</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {files.map(file => (
                  <tr key={file.id} className="border-t border-slate-100 align-top">
                    <td className="max-w-md px-4 py-3">
                      <div className="truncate font-medium">{file.fileName}</div>
                      <div className="mt-1 truncate font-mono text-xs text-slate-500">{file.fileHash || file.journalKey}</div>
                      {file.errorMessage && <div className="mt-1 text-xs text-red-700">{shortErrorMessage(file.errorMessage)}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{file.journalNo}</div>
                      <div className="text-xs text-slate-500">{file.availabilityDateRaw || formatDate(file.availabilityDate)}</div>
                      <div className="text-xs text-slate-500">Part {file.part}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusClass[file.status] || 'bg-slate-100 text-slate-700'}`}>
                        {file.status}
                      </span>
                      <div className="mt-1 text-xs text-slate-500">{formatFileSize(file.fileSizeBytes || file.downloadedBytes)}</div>
                    </td>
                    <td className="min-w-44 px-4 py-3">
                      <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                        <span>{file.status === 'DOWNLOADING' ? formatFileSize(file.downloadedBytes) : `${progressPercent(file)}%`}</span>
                        {file.expectedBytes && file.status === 'DOWNLOADING' && <span>{formatFileSize(file.expectedBytes)}</span>}
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-blue-600" style={{ width: `${progressPercent(file)}%` }} />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{file.patentImportFile?.status || '-'}</div>
                      <div className="text-xs text-slate-500">Patents: {file.patentImportFile?.patentPages ?? file.extractedPatentCount ?? 0}</div>
                      <div className="text-xs text-slate-500">Pages: {file.patentImportFile?.totalPages ?? 0}</div>
                    </td>
                    <td className="px-4 py-3">
                      <EmbeddingCounts counts={file.embeddingCounts || {}} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {(file.storedPath || file.outputFile || file.patentImportFileId) ? (
                        <button
                          onClick={() => downloadStoredPdf(file)}
                          disabled={downloading === `${file.id}-pdf`}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          <Download className="h-3.5 w-3.5" />
                          PDF
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">-</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!files.length && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                      No journal PDF records match the selected filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-600">
            <button
              onClick={() => fetchArchive(Math.max(0, skip - take)).catch(err => setError(err instanceof Error ? err.message : 'Failed to load previous page'))}
              disabled={skip <= 0}
              className="rounded-md border border-slate-300 px-2 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Previous
            </button>
            <span>{total > 0 ? `${skip + 1}-${pageEnd} of ${total}` : '0 records'}</span>
            <button
              onClick={() => fetchArchive(skip + take).catch(err => setError(err instanceof Error ? err.message : 'Failed to load next page'))}
              disabled={skip + take >= total}
              className="rounded-md border border-slate-300 px-2 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
