'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Database, Download, FileText, Play, RefreshCw, Search, Upload } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'

type ImportFile = {
  id: string
  originalName: string
  status: string
  totalPages: number
  patentPages: number
  patentsCreated: number
  patentsUpdated: number
  ignoredPages: number
  lowConfidencePages: number
  warningCount: number
  errorMessage?: string | null
}

type ImportBatch = {
  id: string
  status: string
  originalFileCount: number
  totalFiles: number
  processedFiles: number
  failedFiles: number
  totalPages: number
  patentPages: number
  patentsCreated: number
  patentsUpdated: number
  lowConfidencePages: number
  warningCount: number
  errorMessage?: string | null
  createdAt: string
  completedAt?: string | null
  uploader?: { email?: string | null; name?: string | null }
  files?: ImportFile[]
}

type SearchResult = {
  publicationNumber: string
  applicationNumberRaw?: string | null
  title: string
  abstract?: string | null
  sourcePdfName?: string | null
  sourcePageNumber?: number | null
  hybridScore?: number
  vectorRank?: number
  textRank?: number
}

type RunnerState = {
  enabled: boolean
  active: boolean
  workerId?: string | null
  lastReason?: string | null
  lastStartedAt?: string | null
  lastRunAt?: string | null
  lastStoppedAt?: string | null
  lastError?: string | null
  processedFiles: number
  processedEmbeddings: number
}

const statusClass: Record<string, string> = {
  QUEUED: 'bg-slate-100 text-slate-700',
  PROCESSING: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  COMPLETED_WITH_WARNINGS: 'bg-amber-100 text-amber-800',
  FAILED: 'bg-red-100 text-red-700',
}

export default function PatentCorpusPage() {
  const { user } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [batches, setBatches] = useState<ImportBatch[]>([])
  const [selectedBatch, setSelectedBatch] = useState<ImportBatch | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [runner, setRunner] = useState<RunnerState | null>(null)
  const [maxPdfsPerBatch, setMaxPdfsPerBatch] = useState(100)
  const [downloading, setDownloading] = useState<string | null>(null)

  const isViewer = useMemo(() => {
    const roles = user?.roles || []
    return roles.includes('SUPER_ADMIN_VIEWER') && !roles.includes('SUPER_ADMIN')
  }, [user])

  const canAccess = useMemo(() => {
    const roles = user?.roles || []
    return roles.includes('SUPER_ADMIN') || roles.includes('SUPER_ADMIN_VIEWER')
  }, [user])

  const authHeaders = useCallback(() => ({
    Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`,
  }), [])

  const fetchBatches = useCallback(async () => {
    if (!user || !canAccess) return
    setError(null)
    const response = await fetch('/api/super-admin/patent-corpus/imports', {
      headers: authHeaders(),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.error || 'Failed to load patent imports')
    }
    const body = await response.json()
    setBatches(body.batches || [])
    if (body.runner) setRunner(body.runner)
    if (body.limits?.maxPdfsPerBatch) setMaxPdfsPerBatch(body.limits.maxPdfsPerBatch)
  }, [authHeaders, canAccess, user])

  const fetchBatchDetail = useCallback(async (batchId: string) => {
    const response = await fetch(`/api/super-admin/patent-corpus/imports/${batchId}`, {
      headers: authHeaders(),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.error || 'Failed to load batch details')
    }
    const body = await response.json()
    setSelectedBatch(body.batch)
  }, [authHeaders])

  useEffect(() => {
    if (!user) return
    if (!canAccess) {
      window.location.href = '/dashboard'
      return
    }
    fetchBatches()
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load patent imports'))
      .finally(() => setLoading(false))
  }, [canAccess, fetchBatches, user])

  useEffect(() => {
    if (!user || !canAccess) return
    const interval = window.setInterval(() => {
      fetchBatches().catch(() => undefined)
      if (selectedBatch?.id && ['QUEUED', 'PROCESSING'].includes(selectedBatch.status)) {
        fetchBatchDetail(selectedBatch.id).catch(() => undefined)
      }
    }, 5000)
    return () => window.clearInterval(interval)
  }, [canAccess, fetchBatchDetail, fetchBatches, selectedBatch?.id, selectedBatch?.status, user])

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length || isViewer) return
    const selectedFiles = Array.from(files)
    const selectedPdfCount = selectedFiles.filter(file => file.name.toLowerCase().endsWith('.pdf')).length
    if (selectedPdfCount > maxPdfsPerBatch) {
      setError(`Select at most ${maxPdfsPerBatch} PDFs per batch. Split the upload into multiple batches.`)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    setUploading(true)
    setError(null)
    setSuccess(null)
    try {
      const formData = new FormData()
      selectedFiles.forEach(file => formData.append('files', file))
      const response = await fetch('/api/super-admin/patent-corpus/imports', {
        method: 'POST',
        headers: authHeaders(),
        body: formData,
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || 'Upload failed')
      }
      const body = await response.json()
      if (body.runner) setRunner(body.runner)
      setSuccess('Import batch queued. Automatic processing has started.')
      setSelectedBatch(body.batch)
      await fetchBatches()
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const retryBatch = async (batchId: string) => {
    setError(null)
    const response = await fetch(`/api/super-admin/patent-corpus/imports/${batchId}/retry`, {
      method: 'POST',
      headers: authHeaders(),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      setError(body.error || 'Retry failed')
      return
    }
    const body = await response.json().catch(() => ({}))
    if (body.runner) setRunner(body.runner)
    setSuccess('Batch queued again. Automatic processing has started.')
    await fetchBatches()
    await fetchBatchDetail(batchId)
  }

  const startWorker = async () => {
    if (isViewer) return
    setError(null)
    const response = await fetch('/api/super-admin/patent-corpus/worker', {
      method: 'POST',
      headers: authHeaders(),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      setError(body.error || 'Failed to start patent corpus worker')
      return
    }
    setRunner(body.runner)
    setSuccess('Patent corpus queue runner started.')
    await fetchBatches()
  }

  const downloadExport = async (format: 'jsonl' | 'json' | 'csv', batchId?: string) => {
    const key = `${batchId || 'all'}-${format}`
    setDownloading(key)
    setError(null)
    try {
      const params = new URLSearchParams({ format })
      if (batchId) params.set('batchId', batchId)
      const response = await fetch(`/api/super-admin/patent-corpus/export?${params.toString()}`, {
        headers: authHeaders(),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || 'Export failed')
      }
      const blob = await response.blob()
      const disposition = response.headers.get('Content-Disposition') || ''
      const match = disposition.match(/filename="([^"]+)"/)
      const fileName = match?.[1] || `patent-corpus-${batchId || 'all'}.${format}`
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = fileName
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setDownloading(null)
    }
  }

  const runSearch = async () => {
    if (!query.trim()) return
    setSearching(true)
    setError(null)
    try {
      const response = await fetch('/api/patent-corpus/search', {
        method: 'POST',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, limit: 10 }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || 'Search failed')
      }
      const body = await response.json()
      setSearchResults(body.results || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  if (!user || loading) {
    return <div className="min-h-screen bg-slate-50 p-8 text-slate-600">Loading patent corpus...</div>
  }

  if (!canAccess) {
    return <div className="min-h-screen bg-slate-50 p-8 text-red-700">Access denied.</div>
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">Patent Corpus</h1>
            <p className="mt-1 text-sm text-slate-600">Upload Indian patent journal PDFs, extract patent records, and queue RAG embeddings.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => downloadExport('jsonl')}
              disabled={downloading === 'all-jsonl'}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              Export All
            </button>
            {!isViewer && (
              <button
                onClick={startWorker}
                disabled={runner?.active}
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                <Play className="h-4 w-4" />
                {runner?.active ? 'Running' : 'Start Queue'}
              </button>
            )}
            <button
              onClick={() => fetchBatches().catch(err => setError(err instanceof Error ? err.message : 'Refresh failed'))}
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

        {runner && (
          <div className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm sm:grid-cols-4">
            <div>
              <span className="text-slate-500">Queue runner</span>
              <div className="font-medium">{runner.enabled ? (runner.active ? 'Running' : 'Idle') : 'Disabled'}</div>
            </div>
            <div>
              <span className="text-slate-500">Files processed</span>
              <div className="font-medium">{runner.processedFiles}</div>
            </div>
            <div>
              <span className="text-slate-500">Embeddings processed</span>
              <div className="font-medium">{runner.processedEmbeddings}</div>
            </div>
            <div>
              <span className="text-slate-500">Last run</span>
              <div className="font-medium">{runner.lastRunAt ? new Date(runner.lastRunAt).toLocaleString() : 'Not yet'}</div>
            </div>
            {runner.lastError && <div className="sm:col-span-4 text-red-700">{runner.lastError}</div>}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <aside className="space-y-6">
            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center gap-2">
                <Upload className="h-4 w-4 text-slate-500" />
                <h2 className="text-sm font-semibold">Upload Batch</h2>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.zip,application/pdf,application/zip"
                disabled={uploading || isViewer}
                onChange={event => uploadFiles(event.target.files)}
                className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white disabled:opacity-50"
              />
              <p className="mt-3 text-xs leading-5 text-slate-500">
                Upload up to {maxPdfsPerBatch} PDFs per batch. ZIP uploads are expanded server-side, deduplicated by file hash, and processed one PDF at a time automatically.
              </p>
              {isViewer && <p className="mt-2 text-xs text-amber-700">Viewer role cannot upload or retry imports.</p>}
              {uploading && <p className="mt-2 text-sm text-blue-700">Uploading...</p>}
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center gap-2">
                <Search className="h-4 w-4 text-slate-500" />
                <h2 className="text-sm font-semibold">Corpus Search</h2>
              </div>
              <div className="flex gap-2">
                <input
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder="Search abstracts and titles"
                  className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                />
                <button
                  onClick={runSearch}
                  disabled={searching || !query.trim()}
                  className="inline-flex items-center justify-center rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  <Search className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4 space-y-3">
                {searchResults.map(result => (
                  <div key={result.publicationNumber} className="border-t border-slate-100 pt-3">
                    <div className="text-xs font-medium text-slate-500">{result.publicationNumber}</div>
                    <div className="mt-1 text-sm font-medium leading-5">{result.title}</div>
                    {result.abstract && <p className="mt-1 line-clamp-3 text-xs leading-5 text-slate-600">{result.abstract}</p>}
                  </div>
                ))}
              </div>
            </section>
          </aside>

          <main className="space-y-6">
            <section className="rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
                <Database className="h-4 w-4 text-slate-500" />
                <h2 className="text-sm font-semibold">Import Batches</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Batch</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Files</th>
                      <th className="px-4 py-3">Patents</th>
                      <th className="px-4 py-3">Warnings</th>
                      <th className="px-4 py-3">Created</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map(batch => (
                      <tr key={batch.id} className="border-t border-slate-100">
                        <td className="px-4 py-3 font-mono text-xs">{batch.id}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusClass[batch.status] || 'bg-slate-100 text-slate-700'}`}>
                            {batch.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">{batch.processedFiles}/{batch.totalFiles}</td>
                        <td className="px-4 py-3">{batch.patentsCreated + batch.patentsUpdated}</td>
                        <td className="px-4 py-3">{batch.warningCount + batch.lowConfidencePages}</td>
                        <td className="px-4 py-3">{new Date(batch.createdAt).toLocaleString()}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => fetchBatchDetail(batch.id).catch(err => setError(err instanceof Error ? err.message : 'Failed to load batch'))}
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Details
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!batches.length && (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">No patent corpus imports yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {selectedBatch && (
              <section className="rounded-lg border border-slate-200 bg-white">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-slate-500" />
                    <h2 className="text-sm font-semibold">Batch Details</h2>
                    <span className="font-mono text-xs text-slate-500">{selectedBatch.id}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => downloadExport('jsonl', selectedBatch.id)}
                      disabled={downloading === `${selectedBatch.id}-jsonl`}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <Download className="h-3.5 w-3.5" />
                      JSONL
                    </button>
                    <button
                      onClick={() => downloadExport('csv', selectedBatch.id)}
                      disabled={downloading === `${selectedBatch.id}-csv`}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <Download className="h-3.5 w-3.5" />
                      CSV
                    </button>
                    {!isViewer && ['FAILED', 'COMPLETED_WITH_WARNINGS'].includes(selectedBatch.status) && (
                      <button
                        onClick={() => retryBatch(selectedBatch.id)}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                </div>
                <div className="grid gap-3 border-b border-slate-100 p-4 text-sm sm:grid-cols-4">
                  <div><span className="text-slate-500">Pages</span><div className="font-medium">{selectedBatch.totalPages}</div></div>
                  <div><span className="text-slate-500">Patent records</span><div className="font-medium">{selectedBatch.patentPages}</div></div>
                  <div><span className="text-slate-500">Created</span><div className="font-medium">{selectedBatch.patentsCreated}</div></div>
                  <div><span className="text-slate-500">Updated</span><div className="font-medium">{selectedBatch.patentsUpdated}</div></div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-3">File</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Pages</th>
                        <th className="px-4 py-3">Patents</th>
                        <th className="px-4 py-3">Ignored</th>
                        <th className="px-4 py-3">Warnings</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedBatch.files || []).map(file => (
                        <tr key={file.id} className="border-t border-slate-100 align-top">
                          <td className="max-w-md px-4 py-3">
                            <div className="truncate font-medium">{file.originalName}</div>
                            {file.errorMessage && <div className="mt-1 text-xs text-red-700">{file.errorMessage}</div>}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusClass[file.status] || 'bg-slate-100 text-slate-700'}`}>
                              {file.status}
                            </span>
                          </td>
                          <td className="px-4 py-3">{file.totalPages}</td>
                          <td className="px-4 py-3">{file.patentPages}</td>
                          <td className="px-4 py-3">{file.ignoredPages}</td>
                          <td className="px-4 py-3">{file.warningCount + file.lowConfidencePages}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}
