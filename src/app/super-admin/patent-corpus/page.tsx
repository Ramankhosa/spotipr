'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Database, Download, Eye, FileText, MoreVertical, Play, RefreshCw, Search, Trash2, Upload } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'

type BreakdownMap = Record<string, number>

type ImportFile = {
  id: string
  originalName: string
  fileHash?: string
  status: string
  totalPages: number
  patentPages: number
  patentsCreated: number
  patentsUpdated: number
  ignoredPages: number
  lowConfidencePages: number
  warningCount: number
  warningBreakdown?: BreakdownMap | null
  ignoredPageBreakdown?: BreakdownMap | null
  embeddingCounts?: BreakdownMap | null
  errorMessage?: string | null
  storedFileExists?: boolean
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

type PatentEmbedding = {
  id: string
  model: string
  status: string
  errorMessage?: string | null
  embeddedAt?: string | null
}

type ExtractedPatent = {
  id: number
  publicationNumber: string
  applicationNumberRaw?: string | null
  title: string
  abstract?: string | null
  sourcePageNumber?: number | null
  extractionConfidence?: number | null
  extractionWarnings?: string[] | BreakdownMap | null
  embeddings?: PatentEmbedding[]
}

type FileDetail = {
  file: ImportFile
  patents: ExtractedPatent[]
  embeddingCounts: BreakdownMap
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
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
  processedJournalFiles?: number
  processedFiles: number
  processedEmbeddings: number
}

type CorpusCoverage = {
  embeddingModel: string
  totalPatents: number
  titleOnlyPatents: number
  enrichedPatents: number
  patentsWithCompletedEmbedding: number
  patentsWithoutCompletedEmbedding: number
  patentsWithQueuedEmbedding: number
  patentsWithFailedEmbedding: number
  coveragePercent: number
  embeddingCounts?: BreakdownMap
  importFileCounts?: BreakdownMap
}

type UploadProgressState = {
  phase: 'uploading' | 'finalizing'
  chunkIndex: number
  chunkCount: number
  currentChunkFileCount: number
  fileCount: number
  uploadedBytes: number
  totalBytes: number
  percent: number
}

type PatentCorpusUploadResponse = {
  batch?: ImportBatch
  runner?: RunnerState
  limits?: { maxPdfsPerBatch?: number }
}

type IpIndiaJournalImportItem = {
  id: string
  fileName: string
  status: string
  journalNo: string
  publicationDate: string
  availabilityDate: string
  part: number
  label: string
  sizeBytes?: number
  downloadedBytes?: number
  expectedBytes?: number
  sha256?: string
  importFileId?: string
  existingBatchId?: string
  error?: string
}

type IpIndiaJournalImportJob = {
  id: string
  status: string
  createdAt: string
  updatedAt: string
  completedAt?: string | null
  error?: string | null
  batchId?: string | null
  runner?: RunnerState
  parsedRows: number
  selectedRows: number
  totalPdfCount: number
  downloadedCount?: number
  importedCount?: number
  skippedExistingCount?: number
  failedCount?: number
  items: IpIndiaJournalImportItem[]
}

type IpIndiaJournalImportResponse = {
  job?: IpIndiaJournalImportJob
  jobs?: IpIndiaJournalImportJob[]
  limits?: { maxPdfsPerBatch?: number }
  error?: string
}

type UploadRequestError = Error & { status?: number }

const statusClass: Record<string, string> = {
  QUEUED: 'bg-slate-100 text-slate-700',
  PROCESSING: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  COMPLETED_WITH_WARNINGS: 'bg-amber-100 text-amber-800',
  FAILED: 'bg-red-100 text-red-700',
  FETCHING_LIST: 'bg-blue-100 text-blue-700',
  DOWNLOADING: 'bg-blue-100 text-blue-700',
  IMPORTING: 'bg-violet-100 text-violet-700',
  PLANNED: 'bg-slate-100 text-slate-700',
  DOWNLOADED: 'bg-cyan-100 text-cyan-800',
  SKIPPED_EXISTING: 'bg-amber-100 text-amber-800',
  IMPORTED: 'bg-emerald-100 text-emerald-700',
}

const breakdownLabels: Record<string, string> = {
  applicationPublication: 'Application pages',
  frontMatter: 'Front matter',
  weeklyFer: 'FER/notices',
  grantList: 'Grant lists',
  designPublication: 'Designs',
  corrigendum: 'Corrigenda',
  continuedMarker: 'Continuation pages',
  otherNotice: 'Other notices',
  unknown: 'Unknown',
}

const BYTES_PER_MB = 1024 * 1024
const PATENT_CORPUS_MAX_FILE_MB = 50
const PATENT_CORPUS_SAFE_REQUEST_MB = 45
const PATENT_CORPUS_MAX_FILE_BYTES = PATENT_CORPUS_MAX_FILE_MB * BYTES_PER_MB
const PATENT_CORPUS_SAFE_REQUEST_BYTES = PATENT_CORPUS_SAFE_REQUEST_MB * BYTES_PER_MB

function formatFileSize(bytes: number) {
  return `${(Math.max(0, bytes) / BYTES_PER_MB).toFixed(1)}MB`
}

function createUploadChunks(files: File[]) {
  const chunks: File[][] = []
  let current: File[] = []
  let currentBytes = 0

  const flush = () => {
    if (!current.length) return
    chunks.push(current)
    current = []
    currentBytes = 0
  }

  for (const file of files) {
    const size = Math.max(0, file.size || 0)
    if (current.length && currentBytes + size > PATENT_CORPUS_SAFE_REQUEST_BYTES) {
      flush()
    }
    current.push(file)
    currentBytes += size
  }
  flush()

  return chunks
}

function getTotalFileBytes(files: File[]) {
  return files.reduce((sum, file) => sum + Math.max(0, file.size || 0), 0)
}

function percentFromBytes(uploadedBytes: number, totalBytes: number) {
  if (totalBytes <= 0) return 100
  return Math.min(100, Math.max(0, Math.round((uploadedBytes / totalBytes) * 100)))
}

function isActiveJournalJob(job?: IpIndiaJournalImportJob | null) {
  return Boolean(job && ['QUEUED', 'FETCHING_LIST', 'DOWNLOADING', 'IMPORTING'].includes(job.status))
}

function journalJobProgress(job: IpIndiaJournalImportJob) {
  if (job.status === 'COMPLETED') return 100
  if (job.status === 'FAILED') return job.totalPdfCount > 0 ? Math.round(((job.downloadedCount || 0) / job.totalPdfCount) * 100) : 100
  if (job.status === 'FETCHING_LIST') return 10
  if (job.status === 'IMPORTING') return 90
  if (job.totalPdfCount <= 0) return 5
  const finished = (job.importedCount || 0) + (job.skippedExistingCount || 0) + (job.failedCount || 0)
  const downloaded = job.downloadedCount || 0
  return Math.min(89, Math.max(10, Math.round(((downloaded + finished) / (job.totalPdfCount * 2)) * 80) + 10))
}

function parseUploadResponse(xhr: XMLHttpRequest) {
  try {
    return JSON.parse(xhr.responseText || '{}') as PatentCorpusUploadResponse & { error?: string }
  } catch {
    return {} as PatentCorpusUploadResponse & { error?: string }
  }
}

function isCancelledBatchMessage(message?: string | null) {
  return Boolean(message && message.startsWith('Cancelled by user'))
}

function formatBreakdownKey(key: string) {
  return breakdownLabels[key] || key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, value => value.toUpperCase())
}

function getBreakdownEntries(value?: BreakdownMap | null) {
  return Object.entries(value || {})
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
}

function BreakdownPreview({ breakdown, tone = 'slate' }: { breakdown?: BreakdownMap | null; tone?: 'slate' | 'amber' }) {
  const entries = getBreakdownEntries(breakdown)
  if (!entries.length) return null
  const visible = entries.slice(0, 3)
  const extra = entries.length - visible.length
  const toneClass = tone === 'amber' ? 'text-amber-800' : 'text-slate-500'
  return (
    <div className={`mt-1 space-y-0.5 text-[11px] leading-4 ${toneClass}`}>
      {visible.map(([key, count]) => (
        <div key={key}>{formatBreakdownKey(key)}: {count}</div>
      ))}
      {extra > 0 && <div>+{extra} more</div>}
    </div>
  )
}

function EmbeddingCounts({ counts }: { counts?: BreakdownMap | null }) {
  const total = Object.values(counts || {}).reduce((sum, count) => sum + Number(count || 0), 0)
  if (!total) return <span className="text-xs text-slate-500">None</span>
  const items = [
    ['COMPLETED', 'Done'],
    ['QUEUED', 'Queued'],
    ['PROCESSING', 'Running'],
    ['FAILED', 'Failed'],
  ] as const
  return (
    <div className="flex flex-wrap gap-1">
      {items.map(([key, label]) => Number(counts?.[key] || 0) > 0 && (
        <span key={key} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusClass[key] || 'bg-slate-100 text-slate-700'}`}>
          {label}: {counts?.[key]}
        </span>
      ))}
    </div>
  )
}

function warningText(value?: string[] | BreakdownMap | null) {
  if (!value) return ''
  if (Array.isArray(value)) return value.join(', ')
  return Object.entries(value)
    .filter(([, count]) => Number(count) > 0)
    .map(([key, count]) => `${formatBreakdownKey(key)}: ${count}`)
    .join(', ')
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
  const [runner, setRunner] = useState<RunnerState | null>(null)
  const [coverage, setCoverage] = useState<CorpusCoverage | null>(null)
  const [maxPdfsPerBatch, setMaxPdfsPerBatch] = useState(100)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [selectedFileDetail, setSelectedFileDetail] = useState<FileDetail | null>(null)
  const [loadingFileDetail, setLoadingFileDetail] = useState(false)
  const [fileAction, setFileAction] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState | null>(null)
  const [journalDownloading, setJournalDownloading] = useState(false)
  const [journalJobs, setJournalJobs] = useState<IpIndiaJournalImportJob[]>([])
  const [activeJournalJobId, setActiveJournalJobId] = useState<string | null>(null)

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

  const uploadFormData = useCallback((url: string, formData: FormData, onProgress: (loadedBytes: number, totalBytes: number) => void) => {
    return new Promise<PatentCorpusUploadResponse>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', url)
      xhr.responseType = 'text'

      Object.entries(authHeaders()).forEach(([key, value]) => {
        xhr.setRequestHeader(key, value)
      })

      xhr.upload.onprogress = event => {
        if (!event.lengthComputable) return
        onProgress(event.loaded, event.total)
      }

      xhr.onload = () => {
        const body = parseUploadResponse(xhr)
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(body)
          return
        }

        const message = xhr.status === 413
          ? `Upload request was rejected as too large. The app allows ${PATENT_CORPUS_MAX_FILE_MB}MB files and chunks batch uploads around ${PATENT_CORPUS_SAFE_REQUEST_MB}MB, so production proxy/server body size must be above ${PATENT_CORPUS_MAX_FILE_MB}MB.`
          : body.error || `Upload failed with status ${xhr.status}`
        const error = new Error(message) as UploadRequestError
        error.status = xhr.status
        reject(error)
      }

      xhr.onerror = () => reject(new Error('Upload failed. Check the network connection and production proxy logs.'))
      xhr.onabort = () => reject(new Error('Upload was cancelled.'))
      xhr.send(formData)
    })
  }, [authHeaders])

  const fetchBatches = useCallback(async () => {
    if (!user || !canAccess) return
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

  const [loadingCoverage, setLoadingCoverage] = useState(false)

  const fetchCoverage = useCallback(async () => {
    if (!user || !canAccess) return
    setLoadingCoverage(true)
    try {
      const response = await fetch('/api/super-admin/patent-corpus/imports?includeCoverage=1&take=0', {
        headers: authHeaders(),
      })
      if (!response.ok) return
      const body = await response.json()
      if (body.coverage) setCoverage(body.coverage)
    } finally {
      setLoadingCoverage(false)
    }
  }, [authHeaders, canAccess, user])

  const fetchJournalJobs = useCallback(async (_jobId?: string | null): Promise<IpIndiaJournalImportJob[]> => {
    return []
  }, [])

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
    return body.batch as ImportBatch
  }, [authHeaders])

  const fetchFileDetail = useCallback(async (batchId: string, fileId: string, page = 1) => {
    setLoadingFileDetail(true)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '25' })
      const response = await fetch(`/api/super-admin/patent-corpus/imports/${batchId}/files/${fileId}?${params.toString()}`, {
        headers: authHeaders(),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to load PDF details')
      }
      const body = await response.json()
      setSelectedFileDetail(body)
      return body as FileDetail
    } finally {
      setLoadingFileDetail(false)
    }
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
      if (selectedBatch?.id && selectedFileDetail?.file?.id && ['QUEUED', 'PROCESSING'].includes(selectedFileDetail.file.status)) {
        fetchFileDetail(selectedBatch.id, selectedFileDetail.file.id, selectedFileDetail.pagination.page).catch(() => undefined)
      }
    }, 5000)
    return () => window.clearInterval(interval)
  }, [canAccess, fetchBatchDetail, fetchBatches, fetchFileDetail, selectedBatch?.id, selectedBatch?.status, selectedFileDetail?.file?.id, selectedFileDetail?.file?.status, selectedFileDetail?.pagination.page, user])

  useEffect(() => {
    if (!user || !canAccess) return
    const activeJob = journalJobs.find(job => job.id === activeJournalJobId) || journalJobs.find(isActiveJournalJob)
    if (!activeJob) return

    const refresh = async () => {
      try {
        const [job] = await fetchJournalJobs(activeJob.id)
        if (!job) return
        if (!isActiveJournalJob(job)) {
          setJournalDownloading(false)
          setActiveJournalJobId(null)
          if (job.status === 'COMPLETED') {
            if (job.batchId) {
              await fetchBatches()
              await fetchBatchDetail(job.batchId).catch(() => undefined)
            }
            setSuccess(
              job.importedCount && job.importedCount > 0
                ? `IPO journal download finished. Queued ${job.importedCount} PDF(s) for extraction and embeddings.`
                : `IPO journal download finished. ${job.skippedExistingCount || 0} PDF(s) were already imported.`
            )
          } else if (job.status === 'FAILED') {
            setError(job.error || 'IPO journal download failed.')
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to refresh IPO journal download status')
      }
    }

    refresh()
    const interval = window.setInterval(refresh, 2000)
    return () => window.clearInterval(interval)
  }, [activeJournalJobId, canAccess, fetchBatchDetail, fetchBatches, fetchJournalJobs, journalJobs, user])

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length || isViewer) return
    const selectedFiles = Array.from(files)
    const selectedPdfCount = selectedFiles.filter(file => file.name.toLowerCase().endsWith('.pdf')).length
    if (selectedPdfCount > maxPdfsPerBatch) {
      setError(`Select at most ${maxPdfsPerBatch} PDFs per batch. Split the upload into multiple batches.`)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    const oversizedFiles = selectedFiles.filter(file => file.size > PATENT_CORPUS_MAX_FILE_BYTES)
    if (oversizedFiles.length) {
      const visibleNames = oversizedFiles
        .slice(0, 3)
        .map(file => `${file.name} (${formatFileSize(file.size)})`)
        .join(', ')
      const extraCount = oversizedFiles.length - 3
      setError(`Each selected PDF or ZIP must be ${PATENT_CORPUS_MAX_FILE_MB}MB or less. ${visibleNames}${extraCount > 0 ? ` and ${extraCount} more` : ''} exceed the limit.`)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    setUploading(true)
    setError(null)
    setSuccess(null)
    setUploadProgress(null)
    try {
      const chunks = createUploadChunks(selectedFiles)
      const totalUploadBytes = getTotalFileBytes(selectedFiles)
      let uploadedBeforeCurrentChunk = 0
      let batch: ImportBatch | null = null

      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index]
        const chunkBytes = getTotalFileBytes(chunk)
        setUploadProgress({
          phase: 'uploading',
          chunkIndex: index + 1,
          chunkCount: chunks.length,
          currentChunkFileCount: chunk.length,
          fileCount: selectedFiles.length,
          uploadedBytes: uploadedBeforeCurrentChunk,
          totalBytes: totalUploadBytes,
          percent: percentFromBytes(uploadedBeforeCurrentChunk, totalUploadBytes),
        })

        const formData = new FormData()
        chunk.forEach((file: File) => formData.append('files', file))
        const body = await uploadFormData(
          index === 0
            ? '/api/super-admin/patent-corpus/imports?deferProcessing=1'
            : `/api/super-admin/patent-corpus/imports/${batch?.id}/files?deferProcessing=1`,
          formData,
          (loadedBytes, requestBytes) => {
            const loadedRatio = loadedBytes > 0 && requestBytes > 0
              ? Math.min(1, loadedBytes / requestBytes)
              : 0
            const uploadedBytes = uploadedBeforeCurrentChunk + Math.round(chunkBytes * loadedRatio)
            setUploadProgress({
              phase: 'uploading',
              chunkIndex: index + 1,
              chunkCount: chunks.length,
              currentChunkFileCount: chunk.length,
              fileCount: selectedFiles.length,
              uploadedBytes: Math.min(totalUploadBytes, uploadedBytes),
              totalBytes: totalUploadBytes,
              percent: percentFromBytes(uploadedBytes, totalUploadBytes),
            })
          }
        )
        if (body.limits?.maxPdfsPerBatch) setMaxPdfsPerBatch(body.limits.maxPdfsPerBatch)
        if (body.batch) batch = body.batch
        uploadedBeforeCurrentChunk += chunkBytes
      }

      if (!batch) throw new Error('Upload failed')
      setUploadProgress({
        phase: 'finalizing',
        chunkIndex: chunks.length,
        chunkCount: chunks.length,
        currentChunkFileCount: chunks[chunks.length - 1]?.length || 0,
        fileCount: selectedFiles.length,
        uploadedBytes: totalUploadBytes,
        totalBytes: totalUploadBytes,
        percent: 100,
      })

      const finalizeResponse = await fetch(`/api/super-admin/patent-corpus/imports/${batch.id}/finalize`, {
        method: 'POST',
        headers: authHeaders(),
      })
      if (!finalizeResponse.ok) {
        const body = await finalizeResponse.json().catch(() => ({}))
        throw new Error(body.error || 'Upload finalization failed')
      }
      const finalBody = (await finalizeResponse.json()) as {
        batch?: ImportBatch
        runner?: RunnerState
        limits?: { maxPdfsPerBatch?: number }
      }
      if (finalBody.runner) setRunner(finalBody.runner)
      if (finalBody.limits?.maxPdfsPerBatch) setMaxPdfsPerBatch(finalBody.limits.maxPdfsPerBatch)
      const queuedBatch = finalBody.batch || batch
      setSuccess(`Import batch queued with ${queuedBatch.totalFiles || selectedPdfCount || selectedFiles.length} PDF(s). Automatic processing has started.`)
      setSelectedBatch(queuedBatch)
      setSelectedFileDetail(null)
      await fetchBatches()
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      setUploadProgress(null)
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

  const cancelBatch = async (batchId: string) => {
    if (isViewer) return
    const confirmed = window.confirm('Stop extraction and embedding creation for this batch? Queued work will be cancelled. A PDF already processing may finish its current step before stopping.')
    if (!confirmed) return

    setError(null)
    const response = await fetch(`/api/super-admin/patent-corpus/imports/${batchId}/cancel`, {
      method: 'POST',
      headers: authHeaders(),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      setError(body.error || 'Cancel failed')
      return
    }
    if (body.runner) setRunner(body.runner)
    setSuccess(`Batch cancelled. Stopped ${body.cancelledFiles || 0} queued file(s) and ${body.cancelledEmbeddings || 0} embedding job(s).`)
    await fetchBatches()
    await fetchBatchDetail(batchId)
    if (selectedBatch?.id === batchId && selectedFileDetail?.file?.id) {
      await fetchFileDetail(batchId, selectedFileDetail.file.id, selectedFileDetail.pagination.page)
    }
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

  const downloadLatestIpIndiaJournal = async () => {
    if (isViewer) return
    window.location.href = '/super-admin/patent-corpus/ipindia'
  }

  const downloadExport = async (format: 'jsonl' | 'json' | 'csv', batchId?: string, fileId?: string) => {
    const key = `${fileId || batchId || 'all'}-${format}`
    setDownloading(key)
    setError(null)
    try {
      const params = new URLSearchParams({ format })
      if (batchId) params.set('batchId', batchId)
      if (fileId) params.set('fileId', fileId)
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
      const fileName = match?.[1] || `patent-corpus-${fileId || batchId || 'all'}.${format}`
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

  const downloadStoredPdf = async (batchId: string, fileId: string, fallbackName = 'patent-journal.pdf') => {
    const key = `${fileId}-pdf`
    setDownloading(key)
    setError(null)
    try {
      const response = await fetch(`/api/super-admin/patent-corpus/imports/${batchId}/files/${fileId}/stored-file`, {
        headers: authHeaders(),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || 'PDF download failed')
      }
      const blob = await response.blob()
      const disposition = response.headers.get('Content-Disposition') || ''
      const match = disposition.match(/filename="([^"]+)"/)
      const fileName = match?.[1] || fallbackName
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = fileName
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PDF download failed')
    } finally {
      setDownloading(null)
    }
  }

  const refreshSelectedBatchAndFile = async (file?: ImportFile | null) => {
    if (!selectedBatch) return
    await fetchBatches()
    await fetchBatchDetail(selectedBatch.id)
    if (file) {
      await fetchFileDetail(selectedBatch.id, file.id, selectedFileDetail?.pagination.page || 1)
    }
  }

  const retryFileExtraction = async (file: ImportFile) => {
    if (!selectedBatch || isViewer) return
    const key = `${file.id}-retry-extraction`
    setFileAction(key)
    setError(null)
    try {
      const response = await fetch(`/api/super-admin/patent-corpus/imports/${selectedBatch.id}/files/${file.id}/retry-extraction`, {
        method: 'POST',
        headers: authHeaders(),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Failed to retry PDF extraction')
      if (body.runner) setRunner(body.runner)
      setSuccess('PDF extraction queued again. Automatic processing has started.')
      await refreshSelectedBatchAndFile(file)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry PDF extraction')
    } finally {
      setFileAction(null)
    }
  }

  const retryFileEmbeddings = async (file: ImportFile) => {
    if (!selectedBatch || isViewer) return
    const key = `${file.id}-retry-embeddings`
    setFileAction(key)
    setError(null)
    try {
      const response = await fetch(`/api/super-admin/patent-corpus/imports/${selectedBatch.id}/files/${file.id}/retry-embeddings`, {
        method: 'POST',
        headers: authHeaders(),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Failed to retry PDF embeddings')
      if (body.runner) setRunner(body.runner)
      setSuccess(`Queued ${body.requeuedEmbeddings || 0} embedding job(s) for this PDF.`)
      await refreshSelectedBatchAndFile(file)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry PDF embeddings')
    } finally {
      setFileAction(null)
    }
  }

  const deleteFileExtractions = async (file: ImportFile) => {
    if (!selectedBatch || isViewer) return
    const confirmed = window.confirm(`Delete extracted patent records and embeddings for "${file.originalName}"? The uploaded PDF remains available for a later rerun.`)
    if (!confirmed) return

    const key = `${file.id}-delete-extractions`
    setFileAction(key)
    setError(null)
    try {
      const response = await fetch(`/api/super-admin/patent-corpus/imports/${selectedBatch.id}/files/${file.id}/extractions`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Failed to delete PDF extractions')
      setSuccess(`Deleted ${body.deletedPatents || 0} extracted patent record(s) and their embeddings.`)
      await refreshSelectedBatchAndFile(file)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete PDF extractions')
    } finally {
      setFileAction(null)
    }
  }

  const deleteStoredPdfFile = async (file: ImportFile) => {
    if (!selectedBatch || isViewer) return
    const confirmed = window.confirm(`Delete only the uploaded PDF file for "${file.originalName}"? Extracted patent records and embeddings stay, but extraction cannot be rerun unless the PDF is uploaded again.`)
    if (!confirmed) return

    const key = `${file.id}-delete-stored-file`
    setFileAction(key)
    setError(null)
    try {
      const response = await fetch(`/api/super-admin/patent-corpus/imports/${selectedBatch.id}/files/${file.id}/stored-file`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Failed to delete uploaded PDF file')
      setSuccess(body.deletedStoredFile ? 'Uploaded PDF file deleted. Extracted records were kept.' : 'Uploaded PDF file was already missing. Extracted records were kept.')
      await refreshSelectedBatchAndFile(file)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete uploaded PDF file')
    } finally {
      setFileAction(null)
    }
  }

  if (!user || loading) {
    return <div className="min-h-screen bg-slate-50 p-8 text-slate-600">Loading patent corpus...</div>
  }

  if (!canAccess) {
    return <div className="min-h-screen bg-slate-50 p-8 text-red-700">Access denied.</div>
  }

  const selectedBatchCancelled = isCancelledBatchMessage(selectedBatch?.errorMessage)
  const selectedBatchHasQueuedEmbeddings = (selectedBatch?.files || []).some(file => {
    const counts = file.embeddingCounts || {}
    return Number(counts.QUEUED || 0) > 0 || Number(counts.PROCESSING || 0) > 0
  })
  const canCancelSelectedBatch = Boolean(
    !isViewer &&
    selectedBatch &&
    !selectedBatchCancelled &&
    (['QUEUED', 'PROCESSING'].includes(selectedBatch.status) || selectedBatchHasQueuedEmbeddings)
  )
  const activeJournalJob = journalJobs.find(job => job.id === activeJournalJobId) || journalJobs.find(isActiveJournalJob)
  const visibleJournalJob = activeJournalJob || journalJobs[0]
  const hasActiveJournalJob = journalDownloading || Boolean(activeJournalJob)

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">Patent Corpus</h1>
            <p className="mt-1 text-sm text-slate-600">Upload Indian patent journal PDFs, extract patent records, and queue RAG embeddings.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.zip,application/pdf,application/zip"
              disabled={uploading || isViewer}
              onChange={event => uploadFiles(event.target.files)}
              className="hidden"
            />
            {!isViewer && (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || hasActiveJournalJob}
                title={`Upload up to ${maxPdfsPerBatch} PDFs per batch, ${PATENT_CORPUS_MAX_FILE_MB}MB each`}
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                <Upload className="h-4 w-4" />
                {uploadProgress ? `Uploading ${uploadProgress.percent}%` : uploading ? 'Uploading' : 'Upload'}
              </button>
            )}
            {!isViewer && (
              <a
                href="/super-admin/patent-corpus/ipindia"
                title="Open persistent IP India Patent Journal archive"
                className="inline-flex items-center gap-2 rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                IP India Archive
              </a>
            )}
            <a
              href="/super-admin/patent-corpus/search"
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              <Search className="h-4 w-4" />
              Search
            </a>
            <a
              href="/super-admin/patent-api"
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              API Access
            </a>
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

        {uploadProgress && (
          <div className="mb-4 rounded-lg border border-blue-200 bg-white p-4 text-sm">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium text-slate-900">
                  {uploadProgress.phase === 'finalizing' ? 'Finalizing upload' : `Uploading ${uploadProgress.fileCount} file${uploadProgress.fileCount === 1 ? '' : 's'}`}
                </div>
                <div className="text-xs text-slate-500">
                  {uploadProgress.phase === 'finalizing'
                    ? 'Creating the batch and starting queue processing'
                    : `Chunk ${uploadProgress.chunkIndex} of ${uploadProgress.chunkCount} (${uploadProgress.currentChunkFileCount} file${uploadProgress.currentChunkFileCount === 1 ? '' : 's'})`}
                </div>
              </div>
              <div className="text-right">
                <div className="font-semibold text-blue-700">{uploadProgress.percent}%</div>
                <div className="text-xs text-slate-500">
                  {formatFileSize(uploadProgress.uploadedBytes)} / {formatFileSize(uploadProgress.totalBytes)}
                </div>
              </div>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-blue-600 transition-all duration-150"
                style={{ width: `${uploadProgress.percent}%` }}
              />
            </div>
          </div>
        )}

        {visibleJournalJob && (
          <section className="mb-4 rounded-lg border border-blue-200 bg-white text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-100 px-4 py-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-slate-900">IPO Journal Downloads</h2>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass[visibleJournalJob.status] || 'bg-slate-100 text-slate-700'}`}>
                    {visibleJournalJob.status}
                  </span>
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  Job {visibleJournalJob.id.slice(0, 8)} · started {new Date(visibleJournalJob.createdAt).toLocaleString()}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {visibleJournalJob.batchId && (
                  <button
                    onClick={() => fetchBatchDetail(visibleJournalJob.batchId!).catch(err => setError(err instanceof Error ? err.message : 'Failed to load IPO journal batch'))}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    View batch
                  </button>
                )}
                <button
                  onClick={() => fetchJournalJobs(visibleJournalJob.id).catch(err => setError(err instanceof Error ? err.message : 'Failed to refresh IPO journal download'))}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh
                </button>
              </div>
            </div>
            <div className="border-b border-blue-100 p-4">
              <div className="mb-2 flex items-center justify-between text-xs text-slate-600">
                <span>
                  {visibleJournalJob.status === 'FETCHING_LIST'
                    ? 'Fetching journal list'
                    : visibleJournalJob.status === 'IMPORTING'
                      ? 'Passing PDFs to extractor'
                      : `${visibleJournalJob.downloadedCount || 0} of ${visibleJournalJob.totalPdfCount || 0} PDF(s) downloaded`}
                </span>
                <span className="font-medium text-blue-700">{journalJobProgress(visibleJournalJob)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-blue-600 transition-all duration-300"
                  style={{ width: `${journalJobProgress(visibleJournalJob)}%` }}
                />
              </div>
              <div className="mt-3 grid gap-3 text-xs sm:grid-cols-5">
                <div><span className="text-slate-500">Rows parsed</span><div className="font-medium">{visibleJournalJob.parsedRows}</div></div>
                <div><span className="text-slate-500">PDFs</span><div className="font-medium">{visibleJournalJob.totalPdfCount}</div></div>
                <div><span className="text-slate-500">Imported</span><div className="font-medium">{visibleJournalJob.importedCount || 0}</div></div>
                <div><span className="text-slate-500">Already present</span><div className="font-medium">{visibleJournalJob.skippedExistingCount || 0}</div></div>
                <div><span className="text-slate-500">Failed</span><div className="font-medium">{visibleJournalJob.failedCount || 0}</div></div>
              </div>
              {visibleJournalJob.error && (
                <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">{visibleJournalJob.error}</div>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-2">PDF</th>
                    <th className="px-4 py-2">Journal</th>
                    <th className="px-4 py-2">Part</th>
                    <th className="px-4 py-2">Size</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleJournalJob.items.map(item => {
                    const itemBatchId = item.existingBatchId || (item.status === 'IMPORTED' ? visibleJournalJob.batchId || undefined : undefined)
                    return (
                      <tr key={item.id} className="border-t border-slate-100 align-top">
                        <td className="max-w-lg px-4 py-2">
                          <div className="truncate font-medium text-slate-800">{item.fileName}</div>
                          {item.sha256 && <div className="mt-0.5 truncate font-mono text-[11px] text-slate-500">{item.sha256}</div>}
                          {item.error && <div className="mt-1 text-[11px] text-red-700">{item.error}</div>}
                        </td>
                        <td className="px-4 py-2">{item.journalNo}<div className="text-[11px] text-slate-500">{item.availabilityDate}</div></td>
                        <td className="px-4 py-2">{item.part}</td>
                        <td className="px-4 py-2">
                          {item.sizeBytes
                            ? formatFileSize(item.sizeBytes)
                            : item.downloadedBytes
                              ? `${formatFileSize(item.downloadedBytes)}${item.expectedBytes ? ` / ${formatFileSize(item.expectedBytes)}` : ''}`
                              : '-'}
                        </td>
                        <td className="px-4 py-2">
                          <span className={`rounded-full px-2 py-0.5 font-medium ${statusClass[item.status] || 'bg-slate-100 text-slate-700'}`}>
                            {item.status}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right">
                          {item.importFileId && itemBatchId ? (
                            <button
                              onClick={() => downloadStoredPdf(itemBatchId, item.importFileId!, item.fileName)}
                              disabled={downloading === `${item.importFileId}-pdf`}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                              <Download className="h-3.5 w-3.5" />
                              PDF
                            </button>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {!visibleJournalJob.items.length && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                        Waiting for the journal list from IP India.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {runner && (
          <div className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm sm:grid-cols-5">
            <div>
              <span className="text-slate-500">Queue runner</span>
              <div className="font-medium">{runner.enabled ? (runner.active ? 'Running' : 'Idle') : 'Disabled'}</div>
            </div>
            <div>
              <span className="text-slate-500">Journal PDFs</span>
              <div className="font-medium">{runner.processedJournalFiles || 0}</div>
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

        {coverage ? (
          <div className="mb-4 rounded-lg border border-slate-200 bg-white p-3 text-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium">Corpus coverage</div>
                <div className="text-xs text-slate-500">{coverage.embeddingModel}</div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => fetchCoverage()}
                  disabled={loadingCoverage}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
                <div className="text-right">
                  <div className="text-lg font-semibold">{coverage.coveragePercent}%</div>
                  <div className="text-xs text-slate-500">vector searchable</div>
                </div>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-7">
              <div><span className="text-slate-500">Patents</span><div className="font-medium">{coverage.totalPatents}</div></div>
              <div><span className="text-slate-500">Embedded</span><div className="font-medium">{coverage.patentsWithCompletedEmbedding}</div></div>
              <div><span className="text-slate-500">Missing vectors</span><div className="font-medium">{coverage.patentsWithoutCompletedEmbedding}</div></div>
              <div><span className="text-slate-500">Queued</span><div className="font-medium">{coverage.patentsWithQueuedEmbedding}</div></div>
              <div><span className="text-slate-500">Failed</span><div className="font-medium">{coverage.patentsWithFailedEmbedding}</div></div>
              <div><span className="text-slate-500">Title-only</span><div className="font-medium">{coverage.titleOnlyPatents}</div></div>
              <div><span className="text-slate-500">IP India enriched</span><div className="font-medium">{coverage.enrichedPatents}</div></div>
            </div>
          </div>
        ) : (
          <div className="mb-4 rounded-lg border border-slate-200 bg-white p-3 text-sm">
            <div className="flex items-center justify-between">
              <div className="font-medium text-slate-700">Corpus coverage</div>
              <button
                onClick={() => fetchCoverage()}
                disabled={loadingCoverage}
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <Database className="h-3.5 w-3.5" />
                {loadingCoverage ? 'Loading...' : 'Load Stats'}
              </button>
            </div>
          </div>
        )}

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
                            onClick={() => {
                              setSelectedFileDetail(null)
                              fetchBatchDetail(batch.id).catch(err => setError(err instanceof Error ? err.message : 'Failed to load batch'))
                            }}
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
                    {canCancelSelectedBatch && (
                      <button
                        onClick={() => cancelBatch(selectedBatch.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                      >
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Cancel
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
                {selectedBatch.errorMessage && (
                  <div className="flex items-start gap-2 border-b border-slate-100 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    <AlertTriangle className="mt-0.5 h-4 w-4" />
                    <span>{selectedBatch.errorMessage}</span>
                  </div>
                )}
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
                        <th className="px-4 py-3">Embeddings</th>
                        <th className="px-4 py-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedBatch.files || []).map(file => (
                        <tr key={file.id} className="border-t border-slate-100 align-top">
                          <td className="max-w-md px-4 py-3">
                            <div className="truncate font-medium">{file.originalName}</div>
                            {file.errorMessage && <div className="mt-1 text-xs text-red-700">{file.errorMessage}</div>}
                            {file.storedFileExists === false && (
                              <div className="mt-1 text-xs text-amber-800">Uploaded PDF file deleted</div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusClass[file.status] || 'bg-slate-100 text-slate-700'}`}>
                              {file.status}
                            </span>
                          </td>
                          <td className="px-4 py-3">{file.totalPages}</td>
                          <td className="px-4 py-3">{file.patentPages}</td>
                          <td className="px-4 py-3">
                            <div>{file.ignoredPages}</div>
                            <BreakdownPreview breakdown={file.ignoredPageBreakdown} />
                          </td>
                          <td className="px-4 py-3">
                            <div>{file.warningCount + file.lowConfidencePages}</div>
                            <BreakdownPreview breakdown={file.warningBreakdown} tone="amber" />
                            {file.lowConfidencePages > 0 && (
                              <div className="mt-1 text-[11px] leading-4 text-amber-800">Low confidence: {file.lowConfidencePages}</div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <EmbeddingCounts counts={file.embeddingCounts} />
                          </td>
                          <td className="px-4 py-3">
                            <details className="group relative ml-auto w-fit">
                              <summary
                                title="PDF actions"
                                className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 [&::-webkit-details-marker]:hidden"
                              >
                                <MoreVertical className="h-4 w-4" />
                              </summary>
                              <div className="absolute right-0 z-30 mt-1 w-44 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                                <button
                                  title="View extracted patent records"
                                  onClick={() => selectedBatch && fetchFileDetail(selectedBatch.id, file.id).catch(err => setError(err instanceof Error ? err.message : 'Failed to load PDF details'))}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50"
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                  View
                                </button>
                                <button
                                  title="Download stored PDF file"
                                  onClick={() => selectedBatch && downloadStoredPdf(selectedBatch.id, file.id, file.originalName)}
                                  disabled={file.storedFileExists === false || downloading === `${file.id}-pdf`}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                >
                                  <Download className="h-3.5 w-3.5" />
                                  PDF
                                </button>
                                <button
                                  title="Download PDF-level CSV extraction"
                                  onClick={() => downloadExport('csv', undefined, file.id)}
                                  disabled={downloading === `${file.id}-csv`}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                >
                                  <Download className="h-3.5 w-3.5" />
                                  CSV
                                </button>
                                <button
                                  title="Download PDF-level JSON extraction"
                                  onClick={() => downloadExport('json', undefined, file.id)}
                                  disabled={downloading === `${file.id}-json`}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                >
                                  <Download className="h-3.5 w-3.5" />
                                  JSON
                                </button>
                                <button
                                  title="Download PDF-level JSONL extraction"
                                  onClick={() => downloadExport('jsonl', undefined, file.id)}
                                  disabled={downloading === `${file.id}-jsonl`}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                >
                                  <Download className="h-3.5 w-3.5" />
                                  JSONL
                                </button>
                                {!isViewer && (
                                  <>
                                    <div className="my-1 border-t border-slate-100" />
                                    <button
                                      title="Rerun extraction for this PDF"
                                      onClick={() => retryFileExtraction(file)}
                                      disabled={file.status === 'PROCESSING' || file.storedFileExists === false || fileAction === `${file.id}-retry-extraction`}
                                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                    >
                                      <RefreshCw className="h-3.5 w-3.5" />
                                      Extract
                                    </button>
                                    <button
                                      title="Rerun embeddings for extracted records from this PDF"
                                      onClick={() => retryFileEmbeddings(file)}
                                      disabled={fileAction === `${file.id}-retry-embeddings` || file.patentPages === 0}
                                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                    >
                                      <Play className="h-3.5 w-3.5" />
                                      Embed
                                    </button>
                                    <button
                                      title="Delete extracted records and embeddings for this PDF"
                                      onClick={() => deleteFileExtractions(file)}
                                      disabled={file.status === 'PROCESSING' || fileAction === `${file.id}-delete-extractions` || file.patentPages === 0}
                                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                      Records
                                    </button>
                                    <button
                                      title="Delete only the uploaded PDF file; extracted records stay"
                                      onClick={() => deleteStoredPdfFile(file)}
                                      disabled={file.status === 'PROCESSING' || file.storedFileExists === false || fileAction === `${file.id}-delete-stored-file`}
                                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                      PDF file
                                    </button>
                                  </>
                                )}
                              </div>
                            </details>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {selectedFileDetail && (
              <section className="rounded-lg border border-slate-200 bg-white">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-slate-500" />
                      <h2 className="text-sm font-semibold">PDF Extractions</h2>
                    </div>
                    <div className="mt-1 max-w-3xl truncate text-xs text-slate-500">{selectedFileDetail.file.originalName}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <EmbeddingCounts counts={selectedFileDetail.embeddingCounts} />
                    <button
                      onClick={() => selectedBatch && fetchFileDetail(selectedBatch.id, selectedFileDetail.file.id, selectedFileDetail.pagination.page).catch(err => setError(err instanceof Error ? err.message : 'Failed to refresh PDF details'))}
                      disabled={loadingFileDetail}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Refresh
                    </button>
                  </div>
                </div>
                <div className="grid gap-3 border-b border-slate-100 p-4 text-sm sm:grid-cols-4">
                  <div><span className="text-slate-500">Records</span><div className="font-medium">{selectedFileDetail.pagination.total}</div></div>
                  <div><span className="text-slate-500">Pages</span><div className="font-medium">{selectedFileDetail.file.totalPages}</div></div>
                  <div><span className="text-slate-500">Status</span><div className="font-medium">{selectedFileDetail.file.status}</div></div>
                  <div>
                    <span className="text-slate-500">Stored PDF</span>
                    <div className="font-medium">{selectedFileDetail.file.storedFileExists === false ? 'Deleted' : 'Available'}</div>
                    <div className="truncate font-mono text-xs text-slate-500">{selectedFileDetail.file.fileHash || 'n/a'}</div>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Publication</th>
                        <th className="px-4 py-3">Title</th>
                        <th className="px-4 py-3">Page</th>
                        <th className="px-4 py-3">Confidence</th>
                        <th className="px-4 py-3">Warnings</th>
                        <th className="px-4 py-3">Embeddings</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedFileDetail.patents.map(patent => {
                        const warnings = warningText(patent.extractionWarnings)
                        return (
                          <tr key={patent.id} className="border-t border-slate-100 align-top">
                            <td className="px-4 py-3">
                              <div className="font-mono text-xs font-medium">{patent.publicationNumber}</div>
                              {patent.applicationNumberRaw && <div className="mt-1 text-xs text-slate-500">{patent.applicationNumberRaw}</div>}
                            </td>
                            <td className="max-w-lg px-4 py-3">
                              <div className="font-medium leading-5">{patent.title}</div>
                              {patent.abstract && <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{patent.abstract}</p>}
                            </td>
                            <td className="px-4 py-3">{patent.sourcePageNumber || '-'}</td>
                            <td className="px-4 py-3">
                              {typeof patent.extractionConfidence === 'number' ? `${Math.round(patent.extractionConfidence * 100)}%` : '-'}
                            </td>
                            <td className="max-w-xs px-4 py-3 text-xs text-amber-800">{warnings || '-'}</td>
                            <td className="px-4 py-3">
                              {patent.embeddings?.length ? (
                                <div className="space-y-1">
                                  {patent.embeddings.map(embedding => (
                                    <div key={embedding.id} className="flex flex-wrap items-center gap-1">
                                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusClass[embedding.status] || 'bg-slate-100 text-slate-700'}`}>
                                        {embedding.status}
                                      </span>
                                      <span className="text-[11px] text-slate-500">{embedding.model}</span>
                                      {embedding.errorMessage && <span className="text-[11px] text-red-700">{embedding.errorMessage}</span>}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-xs text-slate-500">None</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                      {!selectedFileDetail.patents.length && (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                            No extracted patent records for this PDF.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {selectedFileDetail.pagination.totalPages > 1 && selectedBatch && (
                  <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-600">
                    <span>Page {selectedFileDetail.pagination.page} of {selectedFileDetail.pagination.totalPages}</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => fetchFileDetail(selectedBatch.id, selectedFileDetail.file.id, selectedFileDetail.pagination.page - 1).catch(err => setError(err instanceof Error ? err.message : 'Failed to load previous page'))}
                        disabled={selectedFileDetail.pagination.page <= 1 || loadingFileDetail}
                        className="rounded-md border border-slate-300 px-2 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Previous
                      </button>
                      <button
                        onClick={() => fetchFileDetail(selectedBatch.id, selectedFileDetail.file.id, selectedFileDetail.pagination.page + 1).catch(err => setError(err instanceof Error ? err.message : 'Failed to load next page'))}
                        disabled={selectedFileDetail.pagination.page >= selectedFileDetail.pagination.totalPages || loadingFileDetail}
                        className="rounded-md border border-slate-300 px-2 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </section>
            )}
        </main>
      </div>
    </div>
  )
}
