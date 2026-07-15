import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import AdmZip from 'adm-zip'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { normalizePatentNumberKey } from '@/lib/patent-number'
import {
  ExtractedPatentRecord,
  PATENT_CORPUS_EXTRACTION_VERSION,
  extractPatentRecordsFromPdf,
} from '@/lib/patent-corpus-extractor'
import type { NormalizedPatentResult } from '@/lib/patent-search/types'

export const PATENT_CORPUS_UPLOAD_ROOT = path.join(process.cwd(), 'uploads', 'patent-corpus')
export const PATENT_CORPUS_EMBEDDING_MODEL = process.env.PATENT_CORPUS_EMBEDDING_MODEL || 'text-embedding-3-small'
// Voyage models (voyage-3-lite / voyage-3.5-lite) are served from api.voyageai.com;
// OpenAI text-embedding-3-* default to 1536. Two compression axes stack (Voyage):
//   - MRL / output_dimension: 2048 / 1024 (native 3.5-lite) / 512 / 256
//   - quantization / output_dtype: float -> int8 -> binary
// For a ~100M-row corpus on a small-RAM box, MRL 512 + binary => bit(512) @ 64 B/vec.
export const PATENT_CORPUS_EMBEDDING_PROVIDER: 'voyage' | 'openai' =
  PATENT_CORPUS_EMBEDDING_MODEL.toLowerCase().startsWith('voyage') ? 'voyage' : 'openai'
export const PATENT_CORPUS_EMBEDDING_DIMENSIONS = Math.max(64, Number(
  process.env.PATENT_CORPUS_EMBEDDING_DIMENSIONS ||
  (PATENT_CORPUS_EMBEDDING_PROVIDER === 'voyage' ? 512 : 1536)
) || (PATENT_CORPUS_EMBEDDING_PROVIDER === 'voyage' ? 512 : 1536))
// 'binary' quantizes to bits (pgvector bit type, Hamming distance); 'float' keeps
// real-valued vectors (pgvector vector/halfvec, cosine distance). Default binary for
// Voyage (memory-compressed corpus), float for OpenAI (legacy Indian corpus).
export const PATENT_CORPUS_EMBEDDING_DTYPE: 'float' | 'binary' =
  (process.env.PATENT_CORPUS_EMBEDDING_DTYPE || (PATENT_CORPUS_EMBEDDING_PROVIDER === 'voyage' ? 'binary' : 'float'))
    .toLowerCase() === 'binary' ? 'binary' : 'float'
// Physical storage column + operator on local_patent_embeddings:
//   float 1536 -> "embedding" vector(1536), cosine   (legacy OpenAI)
//   float !1536 -> "embeddingHalf" halfvec,   cosine
//   binary     -> "embeddingBinary" bit,       hamming (compressed Google corpus)
export const PATENT_CORPUS_EMBEDDING_COLUMN: 'embedding' | 'embeddingHalf' | 'embeddingBinary' =
  PATENT_CORPUS_EMBEDDING_DTYPE === 'binary' ? 'embeddingBinary'
    : PATENT_CORPUS_EMBEDDING_DIMENSIONS === 1536 ? 'embedding' : 'embeddingHalf'
export const PATENT_CORPUS_EMBEDDING_SQL_TYPE: 'vector' | 'halfvec' | 'bit' =
  PATENT_CORPUS_EMBEDDING_COLUMN === 'embedding' ? 'vector'
    : PATENT_CORPUS_EMBEDDING_COLUMN === 'embeddingHalf' ? 'halfvec' : 'bit'
// Distance operator: cosine (<=>) for real vectors, Hamming (<~>) for bit vectors.
export const PATENT_CORPUS_EMBEDDING_DISTANCE_OP = PATENT_CORPUS_EMBEDDING_DTYPE === 'binary' ? '<~>' : '<=>'
export const PATENT_CORPUS_SOURCE_INDIAN = 'indian-corpus'
export const PATENT_CORPUS_SOURCE_PQAI = 'pqai'
export const PATENT_CORPUS_SOURCE_EPO = 'epo-ops'
export const PATENT_CORPUS_SOURCE_GOOGLE = 'google-patents-corpus'
export const PATENT_CORPUS_MAX_PDFS_PER_BATCH = Math.max(
  1,
  Number(process.env.PATENT_CORPUS_MAX_PDFS_PER_BATCH || '100') || 100
)

const STALE_LOCK_MINUTES = 20
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024
const DEFERRED_UPLOAD_DELAY_MS = 60 * 60 * 1000
const PATENT_CORPUS_CANCELLED_PREFIX = 'Cancelled by user'
const IMPORT_SAVE_CANCEL_CHECK_INTERVAL = 25
const MAX_JOB_ATTEMPTS = Math.max(1, Number(process.env.PATENT_CORPUS_MAX_JOB_ATTEMPTS || '5') || 5)
const OPENAI_EMBEDDING_MAX_ATTEMPTS = Math.max(1, Number(process.env.PATENT_CORPUS_OPENAI_MAX_ATTEMPTS || '3') || 3)
const OPENAI_SEARCH_EMBEDDING_MAX_ATTEMPTS = Math.max(1, Number(process.env.PATENT_SEARCH_OPENAI_MAX_ATTEMPTS || '2') || 2)
const OPENAI_SEARCH_EMBEDDING_TIMEOUT_MS = Math.max(1000, Number(process.env.PATENT_SEARCH_EMBEDDING_TIMEOUT_MS || '15000') || 15_000)
const OPENAI_CORPUS_EMBEDDING_TIMEOUT_MS = Math.max(1000, Number(process.env.PATENT_CORPUS_EMBEDDING_TIMEOUT_MS || '60000') || 60_000)
const PATENT_SEARCH_DEBUG = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.PATENT_SEARCH_DEBUG || '').trim().toLowerCase()
)
export const PATENT_CORPUS_EMBEDDING_API_BATCH_SIZE = Math.max(1, Number(process.env.PATENT_CORPUS_EMBEDDING_API_BATCH || '32') || 32)
const JOB_BACKOFF_BASE_MS = 2 * 60 * 1000
const JOB_BACKOFF_MAX_MS = 60 * 60 * 1000
const OPENAI_BACKOFF_BASE_MS = 750
const OPENAI_BACKOFF_MAX_MS = 15_000
const COVERAGE_STATS_CACHE_MS = Math.max(0, Number(process.env.PATENT_CORPUS_COVERAGE_STATS_CACHE_MS || '30000') || 30_000)

type UploadInput = {
  fileName: string
  mimeType?: string
  buffer: Buffer
}

type StoredPdf = {
  originalName: string
  storedPath: string
  mimeType?: string
  fileHash: string
  fileSizeBytes: number
}

export type StoredPatentCorpusPdf = StoredPdf

type QueueOptions = {
  deferProcessing?: boolean
}

class PatentCorpusCancelledError extends Error {
  constructor(message = `${PATENT_CORPUS_CANCELLED_PREFIX}.`) {
    super(message)
    this.name = 'PatentCorpusCancelledError'
  }
}

type PatentEmbeddingJob = any & {
  patent?: {
    embeddingText?: string | null
    ragText?: string | null
    abstract?: string | null
    title?: string | null
  } | null
}

type PatentEmbeddingWorkItem = {
  embedding: PatentEmbeddingJob
  text: string
}

type PatentCorpusCoverageStats = {
  embeddingModel: string
  totalPatents: number
  titleOnlyPatents: number
  enrichedPatents: number
  patentsWithCompletedEmbedding: number
  patentsWithoutCompletedEmbedding: number
  patentsWithQueuedEmbedding: number
  patentsWithFailedEmbedding: number
  coveragePercent: number
  embeddingCounts: Record<string, number>
  importFileCounts: Record<string, number>
  sourceCoverage: Record<string, {
    totalPatents: number
    patentsWithCompletedEmbedding: number
    patentsWithoutCompletedEmbedding: number
    coveragePercent: number
  }>
}

let coverageStatsCache: { value: PatentCorpusCoverageStats; expiresAt: number } | null = null
let coverageStatsInFlight: Promise<PatentCorpusCoverageStats> | null = null

function sha256(input: Buffer | string) {
  return crypto.createHash('sha256').update(input).digest('hex')
}

function sanitizePostgresText<T>(value: T): T {
  if (typeof value === 'string') return value.replace(/\u0000/g, '') as T
  if (Array.isArray(value)) return value.map(item => sanitizePostgresText(item)) as T
  if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, sanitizePostgresText(item)])
    ) as T
  }
  return value
}

function compactPatentText(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function asStringList(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map(item => compactPatentText(item)).filter(Boolean)
}

function uniqueStringList(values: unknown[]) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const text = compactPatentText(value)
    if (!text) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(text)
  }
  return result
}

export function mergeCorpusSources(...sources: unknown[]) {
  return uniqueStringList(sources.flatMap(source => Array.isArray(source) ? source : [source]))
}

function parsePatentDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const text = compactPatentText(value)
  if (!text) return null
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function inferPatentCountry(publicationNumber: string, fallback?: unknown) {
  const supplied = compactPatentText(fallback).toUpperCase()
  if (supplied) return supplied.slice(0, 12)
  const match = compactPatentText(publicationNumber).toUpperCase().match(/^([A-Z]{2})/)
  return match?.[1] || null
}

function externalPatentText(result: NormalizedPatentResult) {
  return compactPatentText([
    result.title,
    result.abstract || result.snippet,
    asStringList(result.classifications).join(' '),
    asStringList(result.cpcCodes).join(' '),
    asStringList(result.ipcCodes).join(' '),
  ].filter(Boolean).join('\n'))
}

function hasValue(value: unknown) {
  if (value === undefined || value === null) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'string') return value.trim().length > 0
  return true
}

function keepExistingIfValuable(existing: any, field: string, nextValue: unknown) {
  if (hasValue(existing?.[field])) return existing[field]
  return nextValue
}

function canonicalPatentNumber(value: unknown) {
  return compactPatentText(value).toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/[A-Z]\d*$/, '')
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function jitter(ms: number) {
  return Math.round(ms * (0.75 + Math.random() * 0.5))
}

function retryAfterMs(response: Response) {
  const value = response.headers.get('retry-after')
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = new Date(value)
  if (!Number.isNaN(date.getTime())) return Math.max(0, date.getTime() - Date.now())
  return null
}

function openAiBackoffMs(attemptIndex: number, response?: Response) {
  const retryAfter = response ? retryAfterMs(response) : null
  if (retryAfter !== null) return Math.min(retryAfter, OPENAI_BACKOFF_MAX_MS)
  return jitter(Math.min(OPENAI_BACKOFF_MAX_MS, OPENAI_BACKOFF_BASE_MS * 2 ** attemptIndex))
}

function shouldRetryOpenAIEmbedding(status: number) {
  return status === 429 || status === 408 || status >= 500
}

function jobBackoffMs(attemptCount: number) {
  const exponent = Math.max(0, attemptCount - 1)
  return jitter(Math.min(JOB_BACKOFF_MAX_MS, JOB_BACKOFF_BASE_MS * 2 ** exponent))
}

function nextJobAttemptAt(attemptCount: number) {
  return new Date(Date.now() + jobBackoffMs(attemptCount))
}

function cancelledMessage() {
  return `${PATENT_CORPUS_CANCELLED_PREFIX} at ${new Date().toISOString()}.`
}

function isCancellationError(error: unknown) {
  return error instanceof PatentCorpusCancelledError
}

function isCancelledMessage(message?: string | null) {
  return Boolean(message && message.startsWith(PATENT_CORPUS_CANCELLED_PREFIX))
}

function isCancelledBatch(batch?: { errorMessage?: string | null } | null) {
  return isCancelledMessage(batch?.errorMessage)
}

async function ensureBatchIsNotCancelled(batchId: string) {
  const batch = await (prisma as any).patentImportBatch.findUnique({
    where: { id: batchId },
    select: { errorMessage: true },
  })
  if (isCancelledBatch(batch)) throw new PatentCorpusCancelledError()
}

function sanitizeFileName(fileName: string) {
  const parsed = path.parse(fileName)
  const base = parsed.name.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120) || 'patent-file'
  const ext = parsed.ext.toLowerCase() === '.pdf' ? '.pdf' : parsed.ext.toLowerCase()
  return `${base}${ext}`
}

function isPdfName(fileName: string) {
  return fileName.toLowerCase().endsWith('.pdf')
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true })
}

async function expandUploadToPdfs(input: UploadInput, targetDir: string): Promise<StoredPdf[]> {
  const lowerName = input.fileName.toLowerCase()
  if (input.buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error(`${input.fileName} exceeds the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB limit`)
  }

  if (lowerName.endsWith('.zip')) {
    const zip = new AdmZip(input.buffer)
    const files: StoredPdf[] = []
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory || !isPdfName(entry.entryName)) continue
      const data = entry.getData()
      const hash = sha256(data)
      const safeName = sanitizeFileName(path.basename(entry.entryName))
      const storedName = `${hash.slice(0, 12)}-${safeName}`
      const storedPath = path.join(targetDir, storedName)
      await fs.writeFile(storedPath, data)
      files.push({
        originalName: `${input.fileName}/${entry.entryName}`,
        storedPath,
        mimeType: 'application/pdf',
        fileHash: hash,
        fileSizeBytes: data.length,
      })
    }
    return files
  }

  if (!isPdfName(input.fileName) && input.mimeType !== 'application/pdf') {
    return []
  }

  const hash = sha256(input.buffer)
  const storedName = `${hash.slice(0, 12)}-${sanitizeFileName(input.fileName)}`
  const storedPath = path.join(targetDir, storedName)
  await fs.writeFile(storedPath, input.buffer)
  return [{
    originalName: input.fileName,
    storedPath,
    mimeType: input.mimeType || 'application/pdf',
    fileHash: hash,
    fileSizeBytes: input.buffer.length,
  }]
}

function nextAttemptAtForUpload(options?: QueueOptions) {
  return options?.deferProcessing ? new Date(Date.now() + DEFERRED_UPLOAD_DELAY_MS) : new Date()
}

async function collectUniqueStoredPdfs(params: {
  uploads: UploadInput[]
  targetDir: string
  existingHashes?: Set<string>
  existingCount?: number
  onLimitExceeded?: () => Promise<void>
}) {
  const byHash = new Map<string, StoredPdf>()
  const existingHashes = params.existingHashes || new Set<string>()
  const existingCount = params.existingCount || 0

  for (const upload of params.uploads) {
    const pdfs = await expandUploadToPdfs(upload, params.targetDir)
    for (const pdf of pdfs) {
      if (existingHashes.has(pdf.fileHash) || byHash.has(pdf.fileHash)) continue
      byHash.set(pdf.fileHash, pdf)
      if (existingCount + byHash.size > PATENT_CORPUS_MAX_PDFS_PER_BATCH) {
        await params.onLimitExceeded?.()
        throw new Error(`A single patent corpus batch can contain at most ${PATENT_CORPUS_MAX_PDFS_PER_BATCH} PDFs. Split this upload into smaller batches.`)
      }
    }
  }

  return Array.from(byHash.values())
}

function collectUniqueStoredPdfRecords(params: {
  pdfs: StoredPdf[]
  existingHashes?: Set<string>
  existingCount?: number
}) {
  const byHash = new Map<string, StoredPdf>()
  const existingHashes = params.existingHashes || new Set<string>()
  const existingCount = params.existingCount || 0

  for (const pdf of params.pdfs) {
    if (!pdf.storedPath || !pdf.fileHash || pdf.fileSizeBytes < 1) continue
    if (existingHashes.has(pdf.fileHash) || byHash.has(pdf.fileHash)) continue
    byHash.set(pdf.fileHash, {
      ...pdf,
      mimeType: pdf.mimeType || 'application/pdf',
    })
    if (existingCount + byHash.size > PATENT_CORPUS_MAX_PDFS_PER_BATCH) {
      throw new Error(`A single patent corpus batch can contain at most ${PATENT_CORPUS_MAX_PDFS_PER_BATCH} PDFs. Start another batch for the remaining files.`)
    }
  }

  return Array.from(byHash.values())
}

async function createPatentImportFileRecords(batchId: string, pdfs: StoredPdf[], options?: QueueOptions) {
  const nextAttemptAt = nextAttemptAtForUpload(options)
  for (const pdf of pdfs) {
    await (prisma as any).patentImportFile.create({
      data: {
        batchId,
        originalName: pdf.originalName,
        storedPath: pdf.storedPath,
        mimeType: pdf.mimeType,
        fileHash: pdf.fileHash,
        fileSizeBytes: pdf.fileSizeBytes,
        extractionVersion: PATENT_CORPUS_EXTRACTION_VERSION,
        nextAttemptAt,
      },
    })
  }
}

export async function createPatentImportBatch(params: {
  uploadedBy: string
  uploads: UploadInput[]
  deferProcessing?: boolean
}) {
  const batch = await (prisma as any).patentImportBatch.create({
    data: {
      uploadedBy: params.uploadedBy,
      originalFileCount: params.uploads.length,
      status: 'QUEUED',
    },
  })

  const targetDir = path.join(PATENT_CORPUS_UPLOAD_ROOT, batch.id)
  await ensureDir(targetDir)

  const pdfs = await collectUniqueStoredPdfs({
    uploads: params.uploads,
    targetDir,
    onLimitExceeded: async () => {
      await (prisma as any).patentImportBatch.update({
        where: { id: batch.id },
        data: {
          status: 'FAILED',
          errorMessage: `A single patent corpus batch can contain at most ${PATENT_CORPUS_MAX_PDFS_PER_BATCH} PDFs. Split this upload into smaller batches.`,
          completedAt: new Date(),
        },
      })
    },
  })

  if (pdfs.length === 0) {
    await (prisma as any).patentImportBatch.update({
      where: { id: batch.id },
      data: {
        status: 'FAILED',
        errorMessage: 'No PDF files were found in the upload.',
        completedAt: new Date(),
      },
    })
    throw new Error('No PDF files were found in the upload.')
  }

  await createPatentImportFileRecords(batch.id, pdfs, { deferProcessing: params.deferProcessing })

  return (prisma as any).patentImportBatch.update({
    where: { id: batch.id },
    data: { totalFiles: pdfs.length },
    include: { files: true },
  })
}

export async function createPatentImportBatchFromStoredPdfs(params: {
  uploadedBy: string
  pdfs: StoredPatentCorpusPdf[]
  deferProcessing?: boolean
}) {
  const batch = await (prisma as any).patentImportBatch.create({
    data: {
      uploadedBy: params.uploadedBy,
      originalFileCount: params.pdfs.length,
      status: 'QUEUED',
    },
  })

  try {
    const pdfs = collectUniqueStoredPdfRecords({ pdfs: params.pdfs })
    if (pdfs.length === 0) {
      throw new Error('No stored PDF files were supplied.')
    }

    await createPatentImportFileRecords(batch.id, pdfs, { deferProcessing: params.deferProcessing })
    return (prisma as any).patentImportBatch.update({
      where: { id: batch.id },
      data: { totalFiles: pdfs.length },
      include: { files: true },
    })
  } catch (error) {
    await (prisma as any).patentImportBatch.update({
      where: { id: batch.id },
      data: {
        status: 'FAILED',
        errorMessage: error instanceof Error ? error.message : String(error),
        completedAt: new Date(),
      },
    }).catch(() => undefined)
    throw error
  }
}

export async function appendPatentImportBatchFiles(params: {
  batchId: string
  uploads: UploadInput[]
  deferProcessing?: boolean
}) {
  const batch = await (prisma as any).patentImportBatch.findUnique({
    where: { id: params.batchId },
    include: {
      files: {
        select: { fileHash: true },
      },
    },
  })
  if (!batch) throw new Error('Import batch not found.')
  if (isCancelledBatch(batch)) {
    throw new Error('This import batch has been cancelled. Retry it before adding more PDFs.')
  }
  if (batch.status === 'PROCESSING') {
    throw new Error('This import batch is currently processing and cannot accept more PDFs.')
  }

  const existingFiles = batch.files || []
  const existingHashes = new Set<string>(
    existingFiles
      .map((file: any) => String(file.fileHash || ''))
      .filter((hash: string) => Boolean(hash))
  )
  const targetDir = path.join(PATENT_CORPUS_UPLOAD_ROOT, batch.id)
  await ensureDir(targetDir)

  const pdfs = await collectUniqueStoredPdfs({
    uploads: params.uploads,
    targetDir,
    existingHashes,
    existingCount: existingFiles.length,
  })
  if (!pdfs.length) {
    throw new Error('No new PDF files were found in the upload.')
  }

  await createPatentImportFileRecords(batch.id, pdfs, { deferProcessing: params.deferProcessing })
  await (prisma as any).patentImportBatch.update({
    where: { id: batch.id },
    data: {
      originalFileCount: { increment: params.uploads.length },
      status: 'QUEUED',
      completedAt: null,
      errorMessage: null,
    },
  })

  return refreshPatentImportBatchStatus(batch.id)
}

export async function appendStoredPdfsToPatentImportBatch(params: {
  batchId: string
  pdfs: StoredPatentCorpusPdf[]
  deferProcessing?: boolean
  allowProcessing?: boolean
}) {
  const batch = await (prisma as any).patentImportBatch.findUnique({
    where: { id: params.batchId },
    include: {
      files: {
        select: { fileHash: true },
      },
    },
  })
  if (!batch) throw new Error('Import batch not found.')
  if (isCancelledBatch(batch)) {
    throw new Error('This import batch has been cancelled. Retry it before adding more PDFs.')
  }
  if (batch.status === 'PROCESSING' && !params.allowProcessing) {
    throw new Error('This import batch is currently processing and cannot accept more PDFs.')
  }

  const existingFiles = batch.files || []
  const existingHashes = new Set<string>(
    existingFiles
      .map((file: any) => String(file.fileHash || ''))
      .filter((hash: string) => Boolean(hash))
  )
  const pdfs = collectUniqueStoredPdfRecords({
    pdfs: params.pdfs,
    existingHashes,
    existingCount: existingFiles.length,
  })
  if (!pdfs.length) {
    return refreshPatentImportBatchStatus(batch.id)
  }

  await createPatentImportFileRecords(batch.id, pdfs, { deferProcessing: params.deferProcessing })
  await (prisma as any).patentImportBatch.update({
    where: { id: batch.id },
    data: {
      originalFileCount: { increment: pdfs.length },
      status: 'QUEUED',
      completedAt: null,
      errorMessage: null,
    },
  })

  return refreshPatentImportBatchStatus(batch.id)
}

export async function releasePatentImportBatchFiles(batchId: string) {
  const batch = await (prisma as any).patentImportBatch.findUnique({ where: { id: batchId } })
  if (!batch) throw new Error('Import batch not found.')

  await (prisma as any).patentImportFile.updateMany({
    where: {
      batchId,
      status: 'QUEUED',
    },
    data: {
      nextAttemptAt: new Date(),
      lockedBy: null,
      lockedUntil: null,
      heartbeatAt: null,
    },
  })

  return refreshPatentImportBatchStatus(batchId)
}

export async function cancelPatentImportBatch(batchId: string) {
  const batch = await (prisma as any).patentImportBatch.findUnique({ where: { id: batchId } })
  if (!batch) throw new Error('Import batch not found.')

  const message = cancelledMessage()
  const now = new Date()
  const files = await (prisma as any).patentImportFile.findMany({
    where: { batchId },
    select: { id: true, status: true },
  })
  const fileIds = files.map((file: any) => file.id).filter(Boolean)
  const hasProcessing = files.some((file: any) => file.status === 'PROCESSING')

  const cancelledFiles = await (prisma as any).patentImportFile.updateMany({
    where: {
      batchId,
      status: { in: ['QUEUED', 'FAILED'] },
    },
    data: {
      status: 'FAILED',
      errorMessage: message,
      attemptCount: MAX_JOB_ATTEMPTS,
      lockedBy: null,
      lockedUntil: null,
      heartbeatAt: null,
      nextAttemptAt: now,
      completedAt: now,
    },
  })

  const cancelledEmbeddings = fileIds.length
    ? await (prisma as any).localPatentEmbedding.updateMany({
        where: {
          status: { in: ['QUEUED', 'FAILED'] },
          patent: {
            sourceImportFileId: { in: fileIds },
          },
        },
        data: {
          status: 'FAILED',
          errorMessage: message,
          attemptCount: MAX_JOB_ATTEMPTS,
          lockedBy: null,
          lockedUntil: null,
          heartbeatAt: null,
          nextAttemptAt: now,
        },
      })
    : { count: 0 }

  await (prisma as any).patentImportBatch.update({
    where: { id: batchId },
    data: {
      status: hasProcessing ? 'PROCESSING' : 'FAILED',
      errorMessage: message,
      completedAt: hasProcessing ? null : now,
    },
  })

  const updatedBatch = await refreshPatentImportBatchStatus(batchId)
  return {
    batch: updatedBatch,
    cancelledFiles: cancelledFiles.count || 0,
    cancelledEmbeddings: cancelledEmbeddings.count || 0,
    message,
  }
}

function localPatentData(record: ExtractedPatentRecord, file: any) {
  return sanitizePostgresText({
    publicationNumber: record.publicationNumber,
    publicationNumberKey: normalizePatentNumberKey(record.publicationNumber),
    applicationNumberRaw: record.applicationNumberRaw,
    kind: record.kind,
    country: record.country,
    filingDate: record.filingDate,
    publicationDate: record.publicationDate,
    title: record.title,
    abstract: record.abstract,
    abstractOriginal: record.abstractOriginal,
    applicants: record.applicants as any,
    inventors: record.inventors,
    classifications: record.classifications,
    rawApplicantBlock: record.rawApplicantBlock,
    rawInventorBlock: record.rawInventorBlock,
    rawClassificationBlock: record.rawClassificationBlock,
    rawText: record.rawText,
    numberOfPages: record.numberOfPages,
    numberOfClaims: record.numberOfClaims,
    sourcePdfName: file.originalName,
    sourceFileHash: file.fileHash,
    sourceImportFileId: file.id,
    sourcePageNumber: record.sourcePageNumber,
    ragText: record.ragText,
    embeddingText: record.embeddingText,
    extractionVersion: record.extractionVersion,
    extractionConfidence: record.extractionConfidence,
    extractionWarnings: record.extractionWarnings as any,
    corpusSources: [PATENT_CORPUS_SOURCE_INDIAN],
  })
}

export function mergeLocalPatentDataForImport(record: ExtractedPatentRecord, file: any, existing?: any) {
  const data = localPatentData(record, file) as any
  data.corpusSources = mergeCorpusSources(existing?.corpusSources, data.corpusSources, PATENT_CORPUS_SOURCE_INDIAN)
  if (existing?.ipIndiaCapturedAt) {
    data.claimsText = existing.claimsText
    data.descriptionText = existing.descriptionText
    data.ipIndiaDetails = existing.ipIndiaDetails
    data.ipIndiaCapturedAt = existing.ipIndiaCapturedAt
    data.ragText = existing.ragText || data.ragText
    data.embeddingText = existing.embeddingText || data.embeddingText
    data.pqaiDetails = existing.pqaiDetails
    data.pqaiFetchedAt = existing.pqaiFetchedAt
  }
  return sanitizePostgresText(data)
}

function embeddingTextHash(text: string) {
  return sha256(text)
}

export async function queueEmbeddingForPatent(localPatentId: number, embeddingText: string, db: any = prisma) {
  const textHash = embeddingTextHash(embeddingText)
  const model = PATENT_CORPUS_EMBEDDING_MODEL

  const existing = await db.localPatentEmbedding.findUnique({
    where: {
      localPatentId_model_textHash: {
        localPatentId,
        model,
        textHash,
      },
    },
  })

  if (!existing) {
    await db.localPatentEmbedding.create({
      data: {
        localPatentId,
        model,
        dimensions: PATENT_CORPUS_EMBEDDING_DIMENSIONS,
        textHash,
        status: 'QUEUED',
      },
    })
  } else if (existing.status !== 'COMPLETED') {
    await db.localPatentEmbedding.update({
      where: { id: existing.id },
      data: {
        attemptCount: 0,
        errorMessage: null,
        nextAttemptAt: new Date(),
        status: 'QUEUED',
      },
    })
  }

  await db.localPatentEmbedding.deleteMany({
    where: {
      localPatentId,
      model,
      textHash: { not: textHash },
      status: { in: ['QUEUED', 'FAILED'] },
    },
  })
}

async function upsertExtractedPatent(record: ExtractedPatentRecord, file: any, db: any = prisma) {
  const existing = await db.localPatent.findUnique({
    where: { publicationNumber: record.publicationNumber },
    select: {
      id: true,
      claimsText: true,
      descriptionText: true,
      ipIndiaDetails: true,
      ipIndiaCapturedAt: true,
      ragText: true,
      embeddingText: true,
      corpusSources: true,
      pqaiDetails: true,
      pqaiFetchedAt: true,
    },
  })
  const data = mergeLocalPatentDataForImport(record, file, existing)
  const patent = existing
    ? await db.localPatent.update({ where: { id: existing.id }, data })
    : await db.localPatent.create({ data })

  if (patent.embeddingText) {
    await queueEmbeddingForPatent(patent.id, patent.embeddingText, db)
  }

  return { created: !existing, patent }
}

const LOCAL_PATENT_PQAI_SELECT = {
  id: true,
  publicationNumber: true,
  title: true,
  abstract: true,
  applicationNumberRaw: true,
  kind: true,
  country: true,
  filingDate: true,
  publicationDate: true,
  applicants: true,
  inventors: true,
  classifications: true,
  claimsText: true,
  descriptionText: true,
  ipIndiaDetails: true,
  ipIndiaCapturedAt: true,
  ragText: true,
  embeddingText: true,
  corpusSources: true,
  pqaiDetails: true,
  pqaiFetchedAt: true,
}

async function findLocalPatentForPqai(publicationNumber: string, db: any = prisma) {
  const exact = await db.localPatent.findUnique({
    where: { publicationNumber },
    select: LOCAL_PATENT_PQAI_SELECT,
  })
  if (exact) return exact

  const canonical = canonicalPatentNumber(publicationNumber)
  if (!canonical || typeof db.$queryRaw !== 'function') return null

  const rows = await db.$queryRaw<Array<{ id: number }>>`
    SELECT "id"
    FROM "local_patents"
    WHERE regexp_replace(regexp_replace(upper("publicationNumber"), '[^A-Z0-9]', '', 'g'), '[A-Z][0-9]*$', '') = ${canonical}
    ORDER BY "id" ASC
    LIMIT 1
  `
  const id = rows[0]?.id
  if (!id) return null
  return db.localPatent.findUnique({
    where: { id },
    select: LOCAL_PATENT_PQAI_SELECT,
  })
}

function buildExternalPatentData(
  result: NormalizedPatentResult,
  existing: any,
  fetchedAt: Date,
  context: { query?: string; providerId?: string; corpusSource?: string } = {}
) {
  const publicationNumber = compactPatentText(result.publicationNumber || result.pn || result.publication_number)
  const title = compactPatentText(result.title) || publicationNumber || 'Untitled Patent'
  const abstract = compactPatentText(result.abstract || result.snippet) || null
  const classifications = uniqueStringList([
    ...asStringList(result.classifications),
    ...asStringList(result.cpcCodes),
    ...asStringList(result.ipcCodes),
  ])
  const inventors = uniqueStringList(asStringList(result.inventors))
  const embeddingText = externalPatentText(result) || title
  const existingHasRicherCapture = Boolean(existing?.ipIndiaCapturedAt || existing?.claimsText || existing?.descriptionText)
  const raw = (result.raw && typeof result.raw === 'object') ? result.raw : null
  const providerId = context.providerId || String(result.providerId || result.sourceProvider || 'pqai')
  const corpusSource = context.corpusSource || PATENT_CORPUS_SOURCE_PQAI

  const data: Record<string, any> = {
    publicationNumber: existing?.publicationNumber || publicationNumber,
    publicationNumberKey: normalizePatentNumberKey(existing?.publicationNumber || publicationNumber),
    applicationNumberRaw: keepExistingIfValuable(existing, 'applicationNumberRaw', result.applicationNumberRaw || result.applicationNumber || null),
    country: keepExistingIfValuable(existing, 'country', inferPatentCountry(publicationNumber, result.jurisdiction)),
    filingDate: keepExistingIfValuable(existing, 'filingDate', parsePatentDate(result.filingDate)),
    publicationDate: keepExistingIfValuable(existing, 'publicationDate', parsePatentDate(result.publicationDate)),
    title: existingHasRicherCapture ? (existing?.title || title) : (title || existing?.title || publicationNumber),
    abstract: existingHasRicherCapture ? (existing?.abstract || abstract) : (abstract || existing?.abstract || null),
    applicants: keepExistingIfValuable(existing, 'applicants', result.applicants as any),
    inventors: existing?.inventors?.length ? existing.inventors : inventors,
    classifications: existing?.classifications?.length ? mergeCorpusSources(existing.classifications, classifications) : classifications,
    ragText: existingHasRicherCapture ? (existing?.ragText || embeddingText) : (embeddingText || existing?.ragText || null),
    embeddingText: existingHasRicherCapture ? (existing?.embeddingText || embeddingText) : (embeddingText || existing?.embeddingText || null),
    corpusSources: mergeCorpusSources(existing?.corpusSources, corpusSource),
    pqaiDetails: {
      provider: providerId,
      fetchedAt: fetchedAt.toISOString(),
      query: context?.query || null,
      link: result.link || result.sourceUrl || null,
      sourceUrl: result.sourceUrl || result.link || null,
      score: result.relevanceScore ?? result.hybridScore ?? null,
      sourceProviders: result.sourceProviders || [result.sourceProvider || result.providerId || providerId],
      normalized: {
        publicationNumber,
        applicationNumber: result.applicationNumber || result.applicationNumberRaw || null,
        title,
        abstract,
        jurisdiction: result.jurisdiction || null,
        filingDate: result.filingDate || null,
        publicationDate: result.publicationDate || null,
        inventors,
        classifications,
      },
      raw,
    },
    pqaiFetchedAt: fetchedAt,
  }

  if (existingHasRicherCapture) {
    data.claimsText = existing.claimsText
    data.descriptionText = existing.descriptionText
    data.ipIndiaDetails = existing.ipIndiaDetails
    data.ipIndiaCapturedAt = existing.ipIndiaCapturedAt
  }

  return sanitizePostgresText(data)
}

export async function persistPatentResultsToCorpus(
  results: NormalizedPatentResult[],
  context: { query?: string; fetchedAt?: Date; providerId?: string; corpusSource?: string } = {},
  db: any = prisma
) {
  const fetchedAt = context.fetchedAt || new Date()
  const patents = Array.isArray(results) ? results : []
  let created = 0
  let updated = 0
  let queuedEmbeddings = 0
  let skipped = 0

  for (const result of patents) {
    const publicationNumber = compactPatentText(result?.publicationNumber || result?.pn || result?.publication_number)
    if (!publicationNumber || publicationNumber.toLowerCase() === 'unknown') {
      skipped += 1
      continue
    }

    const existing = await findLocalPatentForPqai(publicationNumber, db)
    const data = buildExternalPatentData(result, existing, fetchedAt, context)
    const patent = existing
      ? await db.localPatent.update({ where: { id: existing.id }, data })
      : await db.localPatent.create({ data })

    if (existing) updated += 1
    else created += 1

    const text = patent.embeddingText || data.embeddingText || patent.ragText || patent.abstract || patent.title
    if (text) {
      await queueEmbeddingForPatent(patent.id, text, db)
      queuedEmbeddings += 1
    }
  }

  return { created, updated, queuedEmbeddings, skipped }
}

export async function persistPqaiPatentResults(
  results: NormalizedPatentResult[],
  context: { query?: string; fetchedAt?: Date } = {},
  db: any = prisma
) {
  return persistPatentResultsToCorpus(results, {
    ...context,
    providerId: 'pqai',
    corpusSource: PATENT_CORPUS_SOURCE_PQAI,
  }, db)
}

export function patentWhereForImportFile(file: { id: string; fileHash?: string | null; originalName?: string | null }) {
  const fallback: any = {
    sourceImportFileId: null,
    sourceFileHash: file.fileHash || '__no_hash__',
  }
  if (file.originalName) fallback.sourcePdfName = file.originalName

  return {
    OR: [
      { sourceImportFileId: file.id },
      fallback,
    ],
  }
}

async function replaceExtractedPatentsForFile(file: any, records: ExtractedPatentRecord[]) {
  let patentsCreated = 0
  let patentsUpdated = 0
  const publicationNumbers = new Set<string>()

  for (let index = 0; index < records.length; index += 1) {
    if (index % IMPORT_SAVE_CANCEL_CHECK_INTERVAL === 0) {
      await ensureBatchIsNotCancelled(file.batchId)
    }
    const record = records[index]
    publicationNumbers.add(record.publicationNumber)
    const result = await upsertExtractedPatent(record, file)
    if (result.created) patentsCreated += 1
    else patentsUpdated += 1
  }

  await ensureBatchIsNotCancelled(file.batchId)

  const staleWhere = {
    AND: [
      patentWhereForImportFile(file),
      publicationNumbers.size > 0
        ? { publicationNumber: { notIn: Array.from(publicationNumbers) } }
        : {},
    ],
  }

  await (prisma as any).localPatent.updateMany({
    where: {
      ...staleWhere,
      ipIndiaCapturedAt: { not: null },
    },
    data: {
      sourceImportFileId: null,
      sourceFileHash: null,
    },
  })

  await (prisma as any).localPatent.deleteMany({
    where: {
      ...staleWhere,
      ipIndiaCapturedAt: null,
    },
  })

  return { patentsCreated, patentsUpdated }
}

export async function refreshPatentImportBatchStatus(batchId: string) {
  const files = await (prisma as any).patentImportFile.findMany({ where: { batchId } })
  const totalFiles = files.length
  const processedFiles = files.filter((file: any) => ['COMPLETED', 'COMPLETED_WITH_WARNINGS'].includes(file.status)).length
  const failedFiles = files.filter((file: any) => file.status === 'FAILED').length
  const hasProcessing = files.some((file: any) => file.status === 'PROCESSING')
  const hasQueued = files.some((file: any) => file.status === 'QUEUED')
  const hasWarnings = files.some((file: any) => file.status === 'COMPLETED_WITH_WARNINGS' || file.warningCount > 0 || file.lowConfidencePages > 0)

  let status = 'QUEUED'
  if (hasProcessing) status = 'PROCESSING'
  else if (hasQueued) status = processedFiles > 0 || failedFiles > 0 ? 'PROCESSING' : 'QUEUED'
  else if (failedFiles > 0 && processedFiles === 0) status = 'FAILED'
  else if (failedFiles > 0 || hasWarnings) status = 'COMPLETED_WITH_WARNINGS'
  else status = 'COMPLETED'

  return (prisma as any).patentImportBatch.update({
    where: { id: batchId },
    data: {
      status,
      totalFiles,
      processedFiles,
      failedFiles,
      totalPages: files.reduce((sum: number, file: any) => sum + file.totalPages, 0),
      patentPages: files.reduce((sum: number, file: any) => sum + file.patentPages, 0),
      patentsCreated: files.reduce((sum: number, file: any) => sum + file.patentsCreated, 0),
      patentsUpdated: files.reduce((sum: number, file: any) => sum + file.patentsUpdated, 0),
      lowConfidencePages: files.reduce((sum: number, file: any) => sum + file.lowConfidencePages, 0),
      warningCount: files.reduce((sum: number, file: any) => sum + file.warningCount, 0),
      ...(status === 'PROCESSING' ? { startedAt: new Date() } : {}),
      ...(['QUEUED', 'PROCESSING'].includes(status) ? { completedAt: null } : {}),
      ...(['COMPLETED', 'COMPLETED_WITH_WARNINGS', 'FAILED'].includes(status) ? { completedAt: new Date() } : {}),
    },
  })
}

export async function claimNextPatentImportFile(workerId: string) {
  const now = new Date()
  const staleBefore = new Date(now.getTime() - STALE_LOCK_MINUTES * 60 * 1000)
  const candidates = await (prisma as any).patentImportFile.findMany({
    where: {
      status: { in: ['QUEUED', 'FAILED'] },
      nextAttemptAt: { lte: now },
      attemptCount: { lt: MAX_JOB_ATTEMPTS },
      OR: [
        { lockedUntil: null },
        { lockedUntil: { lt: now } },
        { heartbeatAt: { lt: staleBefore } },
      ],
    },
    orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
    take: 10,
    include: {
      batch: { select: { errorMessage: true } },
    },
  })

  for (const candidate of candidates) {
    if (isCancelledBatch(candidate.batch)) {
      await (prisma as any).patentImportFile.updateMany({
        where: {
          id: candidate.id,
          status: { in: ['QUEUED', 'FAILED'] },
        },
        data: {
          status: 'FAILED',
          errorMessage: candidate.batch?.errorMessage || `${PATENT_CORPUS_CANCELLED_PREFIX}.`,
          attemptCount: MAX_JOB_ATTEMPTS,
          lockedBy: null,
          lockedUntil: null,
          heartbeatAt: null,
          completedAt: new Date(),
        },
      })
      await refreshPatentImportBatchStatus(candidate.batchId)
      continue
    }

    const updated = await (prisma as any).patentImportFile.updateMany({
      where: {
        id: candidate.id,
        status: { in: ['QUEUED', 'FAILED'] },
        nextAttemptAt: { lte: now },
        attemptCount: { lt: MAX_JOB_ATTEMPTS },
        OR: [
          { lockedUntil: null },
          { lockedUntil: { lt: now } },
          { heartbeatAt: { lt: staleBefore } },
        ],
      },
      data: {
        status: 'PROCESSING',
        lockedBy: workerId,
        lockedUntil: new Date(now.getTime() + STALE_LOCK_MINUTES * 60 * 1000),
        heartbeatAt: now,
        attemptCount: { increment: 1 },
        startedAt: now,
      },
    })
    if (updated.count === 1) {
      await refreshPatentImportBatchStatus(candidate.batchId)
      return (prisma as any).patentImportFile.findUnique({ where: { id: candidate.id } })
    }
  }

  return null
}

async function heartbeatImportFile(fileId: string, workerId: string) {
  await (prisma as any).patentImportFile.updateMany({
    where: { id: fileId, lockedBy: workerId },
    data: {
      heartbeatAt: new Date(),
      lockedUntil: new Date(Date.now() + STALE_LOCK_MINUTES * 60 * 1000),
    },
  })
}

export async function processPatentImportFileById(fileId: string, workerId = `patent-corpus-${process.pid}`) {
  const file = await (prisma as any).patentImportFile.findUnique({
    where: { id: fileId },
    include: { batch: { select: { errorMessage: true } } },
  })
  if (!file) return null

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  try {
    if (isCancelledBatch(file.batch)) throw new PatentCorpusCancelledError(file.batch?.errorMessage || undefined)

    await heartbeatImportFile(fileId, workerId)
    heartbeatTimer = setInterval(() => {
      heartbeatImportFile(fileId, workerId).catch(error => {
        console.warn('[PatentCorpus] Failed to heartbeat import file:', error)
      })
    }, HEARTBEAT_INTERVAL_MS)
    ;(heartbeatTimer as any)?.unref?.()

    const buffer = await fs.readFile(file.storedPath)
    const actualHash = sha256(buffer)
    if (actualHash !== file.fileHash) {
      throw new Error('Stored file hash does not match the upload hash.')
    }

    const extraction = await extractPatentRecordsFromPdf(buffer, file.fileHash)
    await ensureBatchIsNotCancelled(file.batchId)
    const { patentsCreated, patentsUpdated } = await replaceExtractedPatentsForFile(file, extraction.records)
    await ensureBatchIsNotCancelled(file.batchId)

    const status = extraction.warningCount > 0 || extraction.lowConfidencePages > 0
      ? 'COMPLETED_WITH_WARNINGS'
      : 'COMPLETED'

    const updatedFile = await (prisma as any).patentImportFile.update({
      where: { id: fileId },
      data: {
        status,
        totalPages: extraction.totalPages,
        patentPages: extraction.records.length,
        patentsCreated,
        patentsUpdated,
        ignoredPages: extraction.ignoredPages,
        lowConfidencePages: extraction.lowConfidencePages,
        warningCount: extraction.warningCount,
        warningBreakdown: extraction.warningBreakdown,
        ignoredPageBreakdown: extraction.ignoredPageBreakdown,
        extractionVersion: PATENT_CORPUS_EXTRACTION_VERSION,
        errorMessage: null,
        lockedBy: null,
        lockedUntil: null,
        completedAt: new Date(),
      },
    })
    await refreshPatentImportBatchStatus(file.batchId)
    return updatedFile
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const cancelled = isCancellationError(error) || isCancelledMessage(message)
    if (cancelled) {
      await (prisma as any).localPatentEmbedding.updateMany({
        where: {
          status: { in: ['QUEUED', 'FAILED'] },
          patent: {
            sourceImportFileId: file.id,
          },
        },
        data: {
          status: 'FAILED',
          errorMessage: message,
          attemptCount: MAX_JOB_ATTEMPTS,
          lockedBy: null,
          lockedUntil: null,
          heartbeatAt: null,
          nextAttemptAt: new Date(),
        },
      })
    }
    const failedFile = await (prisma as any).patentImportFile.update({
      where: { id: fileId },
      data: {
        status: 'FAILED',
        errorMessage: message,
        lockedBy: null,
        lockedUntil: null,
        heartbeatAt: null,
        attemptCount: cancelled ? MAX_JOB_ATTEMPTS : undefined,
        nextAttemptAt: cancelled ? new Date() : nextJobAttemptAt(Math.max(1, file.attemptCount || 1)),
        completedAt: new Date(),
      },
    })
    await refreshPatentImportBatchStatus(file.batchId)
    return failedFile
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
  }
}

export async function processPendingPatentImportFiles(workerId = `patent-corpus-${process.pid}`, limit = 1) {
  const processed: any[] = []
  for (let index = 0; index < limit; index += 1) {
    const file = await claimNextPatentImportFile(workerId)
    if (!file) break
    processed.push(await processPatentImportFileById(file.id, workerId))
  }
  return processed
}

export async function retryPatentImportBatch(batchId: string) {
  const files = await (prisma as any).patentImportFile.findMany({
    where: { batchId },
    select: { id: true },
  })
  const fileIds = files.map((file: any) => file.id).filter(Boolean)

  await (prisma as any).patentImportBatch.update({
    where: { id: batchId },
    data: {
      errorMessage: null,
      completedAt: null,
    },
  })
  await (prisma as any).patentImportFile.updateMany({
    where: {
      batchId,
      status: { in: ['FAILED', 'COMPLETED_WITH_WARNINGS'] },
    },
    data: {
      status: 'QUEUED',
      attemptCount: 0,
      errorMessage: null,
      lockedBy: null,
      lockedUntil: null,
      nextAttemptAt: new Date(),
      completedAt: null,
      warningBreakdown: {},
      ignoredPageBreakdown: {},
    },
  })
  if (fileIds.length) {
    await (prisma as any).localPatentEmbedding.updateMany({
      where: {
        status: 'FAILED',
        errorMessage: { startsWith: PATENT_CORPUS_CANCELLED_PREFIX },
        patent: {
          sourceImportFileId: { in: fileIds },
        },
      },
      data: {
        status: 'QUEUED',
        attemptCount: 0,
        errorMessage: null,
        lockedBy: null,
        lockedUntil: null,
        heartbeatAt: null,
        nextAttemptAt: new Date(),
        embeddedAt: null,
      },
    })
  }
  return refreshPatentImportBatchStatus(batchId)
}

export async function retryPatentImportFileExtraction(batchId: string, fileId: string) {
  const file = await (prisma as any).patentImportFile.findFirst({
    where: { id: fileId, batchId },
  })
  if (!file) throw new Error('Import file not found.')
  if (file.status === 'PROCESSING') {
    throw new Error('This PDF is currently processing and cannot be requeued.')
  }
  if (!(await patentImportFileStoredFileExists(file))) {
    throw new Error('The uploaded PDF file has been deleted. Re-upload it before rerunning extraction.')
  }

  const updatedFile = await (prisma as any).patentImportFile.update({
    where: { id: fileId },
    data: {
      status: 'QUEUED',
      attemptCount: 0,
      errorMessage: null,
      lockedBy: null,
      lockedUntil: null,
      heartbeatAt: null,
      nextAttemptAt: new Date(),
      startedAt: null,
      completedAt: null,
      warningBreakdown: {},
      ignoredPageBreakdown: {},
    },
  })
  await refreshPatentImportBatchStatus(batchId)
  return updatedFile
}

export async function requeuePatentImportFileEmbeddings(batchId: string, fileId: string) {
  const file = await (prisma as any).patentImportFile.findFirst({
    where: { id: fileId, batchId },
  })
  if (!file) throw new Error('Import file not found.')

  const patents = await (prisma as any).localPatent.findMany({
    where: patentWhereForImportFile(file),
    select: {
      id: true,
      embeddingText: true,
      ragText: true,
      abstract: true,
      title: true,
    },
  })

  for (const patent of patents) {
    const text = patent.embeddingText || patent.ragText || patent.abstract || patent.title
    if (text) await queueEmbeddingForPatent(patent.id, text)
  }

  let requeuedEmbeddings = 0
  for (const patent of patents) {
    const text = patent.embeddingText || patent.ragText || patent.abstract || patent.title
    if (!text) continue
    const result = await (prisma as any).localPatentEmbedding.updateMany({
      where: {
        localPatentId: patent.id,
        model: PATENT_CORPUS_EMBEDDING_MODEL,
        textHash: embeddingTextHash(text),
      },
      data: {
        status: 'QUEUED',
        attemptCount: 0,
        errorMessage: null,
        lockedBy: null,
        lockedUntil: null,
        heartbeatAt: null,
        nextAttemptAt: new Date(),
        embeddedAt: null,
      },
    })
    requeuedEmbeddings += result.count || 0
  }

  return {
    file,
    patentCount: patents.length,
    requeuedEmbeddings,
  }
}

async function computePatentCorpusCoverageStats(): Promise<PatentCorpusCoverageStats> {
  const patentRows = await prisma.$queryRaw<any[]>`
    SELECT
      COUNT(*)::int AS "totalPatents",
      COUNT(*) FILTER (
        WHERE p."abstract" IS NULL OR btrim(p."abstract") = ''
      )::int AS "titleOnlyPatents",
      COUNT(*) FILTER (
        WHERE p."ipIndiaCapturedAt" IS NOT NULL
      )::int AS "enrichedPatents",
      COUNT(*) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM "local_patent_embeddings" e
          WHERE e."localPatentId" = p."id"
            AND e."model" = ${PATENT_CORPUS_EMBEDDING_MODEL}
            AND e."status" = 'COMPLETED'::"PatentEmbeddingStatus"
            AND e."embedding" IS NOT NULL
        )
      )::int AS "patentsWithCompletedEmbedding",
      COUNT(*) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM "local_patent_embeddings" e
          WHERE e."localPatentId" = p."id"
            AND e."model" = ${PATENT_CORPUS_EMBEDDING_MODEL}
            AND e."status" = 'QUEUED'::"PatentEmbeddingStatus"
        )
      )::int AS "patentsWithQueuedEmbedding",
      COUNT(*) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM "local_patent_embeddings" e
          WHERE e."localPatentId" = p."id"
            AND e."model" = ${PATENT_CORPUS_EMBEDDING_MODEL}
            AND e."status" = 'FAILED'::"PatentEmbeddingStatus"
        )
      )::int AS "patentsWithFailedEmbedding"
    FROM "local_patents" p
  `
  const embeddingRows = await (prisma as any).localPatentEmbedding.groupBy({
    by: ['status'],
    where: { model: PATENT_CORPUS_EMBEDDING_MODEL },
    _count: { id: true },
  }).catch(() => [])
  const importRows = await (prisma as any).patentImportFile.groupBy({
    by: ['status'],
    _count: { id: true },
  }).catch(() => [])
  const sourceRows = await prisma.$queryRaw<any[]>`
    WITH patent_sources AS (
      SELECT
        p."id",
        unnest(
          CASE
            WHEN cardinality(p."corpusSources") > 0 THEN p."corpusSources"
            ELSE ARRAY[${PATENT_CORPUS_SOURCE_INDIAN}]::TEXT[]
          END
        ) AS "source",
        EXISTS (
          SELECT 1 FROM "local_patent_embeddings" e
          WHERE e."localPatentId" = p."id"
            AND e."model" = ${PATENT_CORPUS_EMBEDDING_MODEL}
            AND e."status" = 'COMPLETED'::"PatentEmbeddingStatus"
            AND e."embedding" IS NOT NULL
        ) AS "hasCompletedEmbedding"
      FROM "local_patents" p
    )
    SELECT
      "source",
      COUNT(*)::int AS "totalPatents",
      COUNT(*) FILTER (WHERE "hasCompletedEmbedding")::int AS "patentsWithCompletedEmbedding"
    FROM patent_sources
    GROUP BY "source"
  `.catch(() => [])

  const patentStats = patentRows[0] || {}
  const embeddingCounts = embeddingRows.reduce((acc: Record<string, number>, row: any) => {
    acc[row.status] = row._count?.id || 0
    return acc
  }, {})
  const importFileCounts = importRows.reduce((acc: Record<string, number>, row: any) => {
    acc[row.status] = row._count?.id || 0
    return acc
  }, {})
  const totalPatents = Number(patentStats.totalPatents || 0)
  const patentsWithCompletedEmbedding = Number(patentStats.patentsWithCompletedEmbedding || 0)
  const sourceCoverage = sourceRows.reduce((acc: PatentCorpusCoverageStats['sourceCoverage'], row: any) => {
    const source = String(row.source || '').trim()
    if (!source) return acc
    const sourceTotal = Number(row.totalPatents || 0)
    const sourceCompleted = Number(row.patentsWithCompletedEmbedding || 0)
    acc[source] = {
      totalPatents: sourceTotal,
      patentsWithCompletedEmbedding: sourceCompleted,
      patentsWithoutCompletedEmbedding: Math.max(0, sourceTotal - sourceCompleted),
      coveragePercent: sourceTotal > 0
        ? Number(((sourceCompleted / sourceTotal) * 100).toFixed(1))
        : 0,
    }
    return acc
  }, {})

  return {
    embeddingModel: PATENT_CORPUS_EMBEDDING_MODEL,
    totalPatents,
    titleOnlyPatents: Number(patentStats.titleOnlyPatents || 0),
    enrichedPatents: Number(patentStats.enrichedPatents || 0),
    patentsWithCompletedEmbedding,
    patentsWithoutCompletedEmbedding: Math.max(0, totalPatents - patentsWithCompletedEmbedding),
    patentsWithQueuedEmbedding: Number(patentStats.patentsWithQueuedEmbedding || 0),
    patentsWithFailedEmbedding: Number(patentStats.patentsWithFailedEmbedding || 0),
    coveragePercent: totalPatents > 0
      ? Number(((patentsWithCompletedEmbedding / totalPatents) * 100).toFixed(1))
      : 0,
    embeddingCounts,
    importFileCounts,
    sourceCoverage,
  }
}

export async function getPatentCorpusCoverageStats(options: { forceRefresh?: boolean } = {}) {
  const now = Date.now()
  if (!options.forceRefresh && coverageStatsCache && coverageStatsCache.expiresAt > now) {
    return coverageStatsCache.value
  }
  if (!options.forceRefresh && coverageStatsInFlight) {
    return coverageStatsInFlight
  }

  coverageStatsInFlight = computePatentCorpusCoverageStats()
    .then(stats => {
      coverageStatsCache = { value: stats, expiresAt: Date.now() + COVERAGE_STATS_CACHE_MS }
      return stats
    })
    .finally(() => {
      coverageStatsInFlight = null
    })

  return coverageStatsInFlight
}

export async function getNextPatentCorpusQueueAttemptAt() {
  const now = new Date()
  const [file, embedding] = await Promise.all([
    (prisma as any).patentImportFile.findFirst({
      where: {
        status: { in: ['QUEUED', 'FAILED'] },
        attemptCount: { lt: MAX_JOB_ATTEMPTS },
        nextAttemptAt: { gt: now },
      },
      orderBy: { nextAttemptAt: 'asc' },
      select: { nextAttemptAt: true },
    }).catch(() => null),
    (prisma as any).localPatentEmbedding.findFirst({
      where: {
        status: { in: ['QUEUED', 'FAILED'] },
        attemptCount: { lt: MAX_JOB_ATTEMPTS },
        nextAttemptAt: { gt: now },
      },
      orderBy: { nextAttemptAt: 'asc' },
      select: { nextAttemptAt: true },
    }).catch(() => null),
  ])
  const dates = [file?.nextAttemptAt, embedding?.nextAttemptAt]
    .filter((value): value is Date => value instanceof Date)
    .sort((a, b) => a.getTime() - b.getTime())
  return dates[0] || null
}

export async function patentImportFileStoredFileExists(file: { storedPath?: string | null }) {
  if (!file.storedPath) return false
  try {
    await fs.access(file.storedPath)
    return true
  } catch {
    return false
  }
}

export async function deletePatentImportFileStoredPdf(batchId: string, fileId: string) {
  const file = await (prisma as any).patentImportFile.findFirst({
    where: { id: fileId, batchId },
  })
  if (!file) throw new Error('Import file not found.')
  if (file.status === 'PROCESSING') {
    throw new Error('This PDF is currently processing and its uploaded file cannot be deleted.')
  }

  const existed = await patentImportFileStoredFileExists(file)
  if (existed && file.storedPath) {
    try {
      await fs.unlink(file.storedPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  return {
    file: {
      ...file,
      storedFileExists: false,
    },
    deletedStoredFile: existed,
  }
}

export async function deletePatentImportFileExtractions(batchId: string, fileId: string) {
  const file = await (prisma as any).patentImportFile.findFirst({
    where: { id: fileId, batchId },
  })
  if (!file) throw new Error('Import file not found.')
  if (file.status === 'PROCESSING') {
    throw new Error('This PDF is currently processing and its extracted records cannot be deleted.')
  }

  const deleted = await (prisma as any).localPatent.deleteMany({
    where: patentWhereForImportFile(file),
  })

  const updatedFile = await (prisma as any).patentImportFile.update({
    where: { id: fileId },
    data: {
      patentPages: 0,
      patentsCreated: 0,
      patentsUpdated: 0,
      errorMessage: null,
      lockedBy: null,
      lockedUntil: null,
      heartbeatAt: null,
    },
  })
  await refreshPatentImportBatchStatus(batchId)

  return {
    file: updatedFile,
    deletedPatents: deleted.count,
  }
}

type EmbeddingRequestPurpose = 'search-query' | 'corpus-indexing' | 'diagnostic'

type EmbeddingRequestOptions = {
  purpose?: EmbeddingRequestPurpose
  timeoutMs?: number
  maxAttempts?: number
  traceId?: string
}

function logOpenAISearchEmbedding(
  level: 'info' | 'warn' | 'error',
  event: string,
  details: Record<string, unknown>,
  force = false
) {
  if (!PATENT_SEARCH_DEBUG && !force) return
  console[level](`[OpenAIQueryEmbedding] ${JSON.stringify({ event, ...details })}`)
}

export function hasSearchEmbeddingApiKey() {
  if (PATENT_CORPUS_EMBEDDING_PROVIDER === 'voyage') return Boolean(process.env.VOYAGE_API_KEY)
  return Boolean(process.env.OPENAI_SEARCH_API_KEY || process.env.OPENAI_API_KEY)
}

export function hasCorpusEmbeddingApiKey() {
  if (PATENT_CORPUS_EMBEDDING_PROVIDER === 'voyage') return Boolean(process.env.VOYAGE_API_KEY)
  return Boolean(process.env.OPENAI_CORPUS_API_KEY || process.env.OPENAI_API_KEY)
}

function embeddingApiKey(purpose: EmbeddingRequestPurpose) {
  if (purpose === 'search-query' || purpose === 'diagnostic') {
    return process.env.OPENAI_SEARCH_API_KEY || process.env.OPENAI_API_KEY
  }
  return process.env.OPENAI_CORPUS_API_KEY || process.env.OPENAI_API_KEY
}

export async function requestOpenAIEmbeddings(texts: string[], options: EmbeddingRequestOptions = {}) {
  const purpose = options.purpose || 'corpus-indexing'
  const traceId = options.traceId || (purpose === 'search-query'
    ? `query-embedding-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    : undefined)
  const apiKey = embeddingApiKey(purpose)
  if (!apiKey) {
    const expectedKey = purpose === 'corpus-indexing'
      ? 'OPENAI_CORPUS_API_KEY or OPENAI_API_KEY'
      : 'OPENAI_SEARCH_API_KEY or OPENAI_API_KEY'
    throw new Error(`${expectedKey} is not configured.`)
  }

  const inputs = texts.map(text => String(text || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
  if (!inputs.length) return []

  const timeoutMs = Math.max(1000, options.timeoutMs || (
    purpose === 'corpus-indexing' ? OPENAI_CORPUS_EMBEDDING_TIMEOUT_MS : OPENAI_SEARCH_EMBEDDING_TIMEOUT_MS
  ))
  const maxAttempts = Math.max(1, options.maxAttempts || (
    purpose === 'corpus-indexing' ? OPENAI_EMBEDDING_MAX_ATTEMPTS : OPENAI_SEARCH_EMBEDDING_MAX_ATTEMPTS
  ))
  const inputFingerprints = purpose === 'search-query'
    ? inputs.map(input => crypto.createHash('sha256').update(input).digest('hex').slice(0, 12))
    : []
  let lastError: Error | null = null
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let response: Response | null = null
    const requestStartedAt = Date.now()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      if (purpose === 'search-query') {
        logOpenAISearchEmbedding('info', 'request_dispatched', {
          traceId,
          attempt: attempt + 1,
          maxAttempts,
          model: PATENT_CORPUS_EMBEDDING_MODEL,
          requestedDimensions: PATENT_CORPUS_EMBEDDING_DIMENSIONS,
          inputCount: inputs.length,
          inputLengths: inputs.map(input => input.length),
          inputFingerprints,
          timeoutMs,
          keySource: process.env.OPENAI_SEARCH_API_KEY ? 'OPENAI_SEARCH_API_KEY' : 'OPENAI_API_KEY',
        })
      }
      response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: PATENT_CORPUS_EMBEDDING_MODEL,
          input: inputs,
          dimensions: PATENT_CORPUS_EMBEDDING_DIMENSIONS,
        }),
      })

      if (purpose === 'search-query') {
        logOpenAISearchEmbedding(response.ok ? 'info' : 'warn', 'response_received', {
          traceId,
          attempt: attempt + 1,
          status: response.status,
          ok: response.ok,
          durationMs: Date.now() - requestStartedAt,
          openAIRequestId: response.headers.get('x-request-id'),
          openAIProcessingMs: response.headers.get('openai-processing-ms'),
        }, !response.ok)
      }

      if (!response.ok) {
        const body = await response.text()
        const message = `OpenAI embedding request failed: ${response.status} ${body}`
        lastError = Object.assign(new Error(message), { retryable: shouldRetryOpenAIEmbedding(response.status) })
        if (attempt < maxAttempts - 1 && shouldRetryOpenAIEmbedding(response.status)) {
          await sleep(openAiBackoffMs(attempt, response))
          continue
        }
        throw lastError
      }

      const json = await response.json()
      const rows = Array.isArray(json?.data) ? json.data : []
      const embeddings = rows
        .sort((a: any, b: any) => Number(a?.index || 0) - Number(b?.index || 0))
        .map((row: any) => row?.embedding)
      if (
        embeddings.length !== inputs.length ||
        embeddings.some((embedding: unknown) => !Array.isArray(embedding) || embedding.length !== PATENT_CORPUS_EMBEDDING_DIMENSIONS)
      ) {
        throw new Error('OpenAI embedding response did not contain the expected vectors.')
      }
      if (purpose === 'search-query') {
        logOpenAISearchEmbedding('info', 'vectors_received', {
          traceId,
          attempt: attempt + 1,
          vectorCount: embeddings.length,
          vectorDimensions: embeddings[0]?.length || 0,
          totalDurationMs: Date.now() - requestStartedAt,
          openAIRequestId: response.headers.get('x-request-id'),
        })
      }
      return embeddings as number[][]
    } catch (error) {
      lastError = controller.signal.aborted
        ? Object.assign(new Error(`OpenAI ${purpose} embedding request timed out after ${timeoutMs}ms.`), { retryable: true, code: 'ETIMEDOUT' })
        : error instanceof Error ? error : new Error(String(error))
      if (purpose === 'search-query') {
        logOpenAISearchEmbedding('error', 'request_failed', {
          traceId,
          attempt: attempt + 1,
          maxAttempts,
          durationMs: Date.now() - requestStartedAt,
          status: response?.status || null,
          errorName: lastError.name,
          errorMessage: lastError.message.slice(0, 500),
          errorCode: typeof (lastError as any).code === 'string' ? (lastError as any).code : undefined,
          willRetry: attempt < maxAttempts - 1 && (lastError as any).retryable !== false,
        }, true)
      }
      if (attempt < maxAttempts - 1 && (lastError as any).retryable !== false) {
        await sleep(openAiBackoffMs(attempt, response || undefined))
        continue
      }
      throw lastError
    } finally {
      clearTimeout(timeout)
    }
  }

  throw lastError || new Error('OpenAI embedding request failed.')
}

export async function requestOpenAIEmbedding(text: string, options: EmbeddingRequestOptions = {}) {
  const [embedding] = await requestOpenAIEmbeddings([text], options)
  if (!embedding) throw new Error('OpenAI embedding response did not contain the expected vector.')
  return embedding
}

const VOYAGE_EMBEDDING_TIMEOUT_MS = Math.max(2000, Number(process.env.VOYAGE_EMBEDDING_TIMEOUT_MS || '45000') || 45000)
const VOYAGE_EMBEDDING_MAX_ATTEMPTS = Math.max(1, Number(process.env.VOYAGE_EMBEDDING_MAX_ATTEMPTS || '4') || 4)
// voyage-3-lite is natively 512-dim; only send output_dimension when the configured
// dimensionality differs (supported by voyage-3.5 family Matryoshka models).
const VOYAGE_NATIVE_DIMENSIONS: Record<string, number> = {
  'voyage-3-lite': 512,
  'voyage-3.5-lite': 1024,
  'voyage-3.5': 1024,
  'voyage-3': 1024,
  'voyage-3-large': 1024,
}

function shouldRetryVoyageEmbedding(status: number) {
  return status === 408 || status === 409 || status === 429 || status >= 500
}

export async function requestVoyageEmbeddings(texts: string[], options: EmbeddingRequestOptions = {}) {
  const purpose = options.purpose || 'corpus-indexing'
  const apiKey = process.env.VOYAGE_API_KEY
  if (!apiKey) throw new Error('VOYAGE_API_KEY is not configured.')

  const inputs = texts.map(text => String(text || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
  if (!inputs.length) return []

  const nativeDimensions = VOYAGE_NATIVE_DIMENSIONS[PATENT_CORPUS_EMBEDDING_MODEL.toLowerCase()]
  const binary = PATENT_CORPUS_EMBEDDING_DTYPE === 'binary'
  const body: Record<string, unknown> = {
    model: PATENT_CORPUS_EMBEDDING_MODEL,
    input: inputs,
    // Voyage embeddings are asymmetric: corpus texts embed as documents, search
    // queries as queries. This measurably improves retrieval quality.
    input_type: purpose === 'search-query' || purpose === 'diagnostic' ? 'query' : 'document',
    // 'ubinary' returns dims/8 packed uint8 bytes (unsigned) that unpack cleanly to a
    // pgvector bit string; 'float' returns real-valued dims-length vectors.
    output_dtype: binary ? 'ubinary' : 'float',
  }
  if (!nativeDimensions || nativeDimensions !== PATENT_CORPUS_EMBEDDING_DIMENSIONS) {
    body.output_dimension = PATENT_CORPUS_EMBEDDING_DIMENSIONS
  }
  // Expected element length: real vectors are dims-long; ubinary is dims/8 bytes.
  const expectedLength = binary ? PATENT_CORPUS_EMBEDDING_DIMENSIONS / 8 : PATENT_CORPUS_EMBEDDING_DIMENSIONS

  const timeoutMs = Math.max(1000, options.timeoutMs || VOYAGE_EMBEDDING_TIMEOUT_MS)
  const maxAttempts = Math.max(1, options.maxAttempts || VOYAGE_EMBEDDING_MAX_ATTEMPTS)
  let lastError: Error | null = null
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const responseBody = await response.text()
        lastError = new Error(`Voyage embedding request failed: ${response.status} ${responseBody.slice(0, 500)}`)
        if (attempt < maxAttempts - 1 && shouldRetryVoyageEmbedding(response.status)) {
          const retryAfter = Number(response.headers.get('retry-after') || 0)
          await sleep(retryAfter > 0 ? retryAfter * 1000 : Math.min(30000, 1000 * 2 ** attempt))
          continue
        }
        throw lastError
      }
      const json = await response.json()
      const rows = Array.isArray(json?.data) ? json.data : []
      const embeddings = rows
        .sort((a: any, b: any) => Number(a?.index || 0) - Number(b?.index || 0))
        .map((row: any) => row?.embedding)
      if (
        embeddings.length !== inputs.length ||
        embeddings.some((embedding: unknown) => !Array.isArray(embedding) || embedding.length !== expectedLength)
      ) {
        throw new Error('Voyage embedding response did not contain the expected vectors.')
      }
      // For binary (ubinary) the elements are packed uint8 bytes; callers convert to a
      // pgvector bit string via corpusEmbeddingToLiteral(). For float they are vectors.
      return embeddings as number[][]
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt < maxAttempts - 1 && (lastError.name === 'AbortError' || /fetch failed|network/i.test(lastError.message))) {
        await sleep(Math.min(30000, 1000 * 2 ** attempt))
        continue
      }
      throw lastError
    } finally {
      clearTimeout(timeout)
    }
  }
  throw lastError || new Error('Voyage embedding request failed.')
}

// Provider-agnostic entry points: the configured PATENT_CORPUS_EMBEDDING_MODEL decides
// whether OpenAI or Voyage serves the request. Corpus writes and query embeddings MUST
// go through these so the two sides always use the same model and dimensionality.
export function requestCorpusEmbeddings(texts: string[], options: EmbeddingRequestOptions = {}) {
  if (PATENT_CORPUS_EMBEDDING_PROVIDER === 'voyage') return requestVoyageEmbeddings(texts, options)
  return requestOpenAIEmbeddings(texts, options)
}

export async function requestCorpusEmbedding(text: string, options: EmbeddingRequestOptions = {}) {
  const [embedding] = await requestCorpusEmbeddings([text], options)
  if (!embedding) throw new Error('Embedding response did not contain the expected vector.')
  return embedding
}

export function requestSearchQueryEmbeddings(texts: string[], context: { traceId?: string } = {}) {
  return requestCorpusEmbeddings(texts, { purpose: 'search-query', traceId: context.traceId })
}

export function requestSearchQueryEmbedding(text: string, context: { traceId?: string } = {}) {
  return requestCorpusEmbedding(text, { purpose: 'search-query', traceId: context.traceId })
}

export async function claimNextPatentEmbeddings(workerId: string, limit = 1) {
  const now = new Date()
  const staleBefore = new Date(now.getTime() - STALE_LOCK_MINUTES * 60 * 1000)
  const candidates = await (prisma as any).localPatentEmbedding.findMany({
    where: {
      status: { in: ['QUEUED', 'FAILED'] },
      nextAttemptAt: { lte: now },
      attemptCount: { lt: MAX_JOB_ATTEMPTS },
      OR: [
        { lockedUntil: null },
        { lockedUntil: { lt: now } },
        { heartbeatAt: { lt: staleBefore } },
      ],
    },
    orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
    take: Math.max(limit * 3, 10),
    include: {
      patent: {
        include: {
          sourceImportFile: {
            include: {
              batch: { select: { errorMessage: true } },
            },
          },
        },
      },
    },
  })

  const claimedIds: string[] = []
  for (const candidate of candidates) {
    if (claimedIds.length >= limit) break
    const batch = candidate.patent?.sourceImportFile?.batch
    if (isCancelledBatch(batch)) {
      await (prisma as any).localPatentEmbedding.updateMany({
        where: {
          id: candidate.id,
          status: { in: ['QUEUED', 'FAILED'] },
        },
        data: {
          status: 'FAILED',
          errorMessage: batch?.errorMessage || `${PATENT_CORPUS_CANCELLED_PREFIX}.`,
          attemptCount: MAX_JOB_ATTEMPTS,
          lockedBy: null,
          lockedUntil: null,
          heartbeatAt: null,
          nextAttemptAt: new Date(),
        },
      })
      continue
    }
    const updated = await (prisma as any).localPatentEmbedding.updateMany({
      where: {
        id: candidate.id,
        status: { in: ['QUEUED', 'FAILED'] },
        nextAttemptAt: { lte: now },
        attemptCount: { lt: MAX_JOB_ATTEMPTS },
        OR: [
          { lockedUntil: null },
          { lockedUntil: { lt: now } },
          { heartbeatAt: { lt: staleBefore } },
        ],
      },
      data: {
        status: 'PROCESSING',
        lockedBy: workerId,
        lockedUntil: new Date(now.getTime() + STALE_LOCK_MINUTES * 60 * 1000),
        heartbeatAt: now,
        attemptCount: { increment: 1 },
      },
    })
    if (updated.count === 1) {
      claimedIds.push(candidate.id)
    }
  }

  if (!claimedIds.length) return []
  return (prisma as any).localPatentEmbedding.findMany({
    where: { id: { in: claimedIds } },
    include: {
      patent: {
        include: {
          sourceImportFile: {
            include: {
              batch: { select: { errorMessage: true } },
            },
          },
        },
      },
    },
    orderBy: [{ updatedAt: 'asc' }],
  })
}

export async function claimNextPatentEmbedding(workerId: string) {
  const embeddings = await claimNextPatentEmbeddings(workerId, 1)
  return embeddings[0] || null
}

// Unpack Voyage ubinary bytes (uint8, MSB-first) into a pgvector bit string. The same
// ordering is used for corpus and query vectors, so Hamming distance stays consistent.
export function bytesToBitString(bytes: number[]): string {
  let bits = ''
  for (const byte of bytes) {
    const value = Number(byte) & 0xff
    for (let position = 7; position >= 0; position -= 1) {
      bits += (value >> position) & 1 ? '1' : '0'
    }
  }
  return bits
}

// Build the SQL literal for the configured dtype: a bracketed float list for
// vector/halfvec, or a bit string for bit.
export function corpusEmbeddingToLiteral(vector: number[]): string {
  if (PATENT_CORPUS_EMBEDDING_DTYPE === 'binary') return bytesToBitString(vector)
  return `[${vector.map(value => Number(value).toFixed(8)).join(',')}]`
}

export async function setEmbeddingVector(embeddingId: string, vector: number[]) {
  const literal = corpusEmbeddingToLiteral(vector)
  // Route to the physical column for the configured dtype:
  //   "embedding" vector(1536) | "embeddingHalf" halfvec | "embeddingBinary" bit.
  const updated = PATENT_CORPUS_EMBEDDING_COLUMN === 'embedding'
    ? await prisma.$queryRaw<any[]>`
      UPDATE "local_patent_embeddings"
      SET "embedding" = ${literal}::vector,
          "status" = 'COMPLETED'::"PatentEmbeddingStatus",
          "embeddedAt" = now(), "errorMessage" = NULL, "lockedBy" = NULL,
          "lockedUntil" = NULL, "heartbeatAt" = NULL, "updatedAt" = now()
      WHERE "id" = ${embeddingId}
      RETURNING "localPatentId", "model", "textHash"
    `
    : PATENT_CORPUS_EMBEDDING_COLUMN === 'embeddingHalf'
    ? await prisma.$queryRaw<any[]>`
      UPDATE "local_patent_embeddings"
      SET "embeddingHalf" = ${literal}::halfvec,
          "status" = 'COMPLETED'::"PatentEmbeddingStatus",
          "embeddedAt" = now(), "errorMessage" = NULL, "lockedBy" = NULL,
          "lockedUntil" = NULL, "heartbeatAt" = NULL, "updatedAt" = now()
      WHERE "id" = ${embeddingId}
      RETURNING "localPatentId", "model", "textHash"
    `
    : await prisma.$queryRaw<any[]>`
      UPDATE "local_patent_embeddings"
      SET "embeddingBinary" = ${literal}::bit(${Prisma.raw(String(PATENT_CORPUS_EMBEDDING_DIMENSIONS))}),
          "status" = 'COMPLETED'::"PatentEmbeddingStatus",
          "embeddedAt" = now(), "errorMessage" = NULL, "lockedBy" = NULL,
          "lockedUntil" = NULL, "heartbeatAt" = NULL, "updatedAt" = now()
      WHERE "id" = ${embeddingId}
      RETURNING "localPatentId", "model", "textHash"
    `
  const current = updated[0]
  if (current?.localPatentId && current?.model && current?.textHash) {
    await (prisma as any).localPatentEmbedding.deleteMany({
      where: {
        localPatentId: current.localPatentId,
        model: current.model,
        textHash: { not: current.textHash },
        status: { in: ['QUEUED', 'FAILED', 'COMPLETED'] },
      },
    })
  }
}

function patentTextForEmbedding(embedding: PatentEmbeddingJob) {
  return embedding.patent?.embeddingText || embedding.patent?.ragText || embedding.patent?.abstract || embedding.patent?.title || ''
}

async function failPatentEmbedding(embedding: PatentEmbeddingJob, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const cancelled = isCancellationError(error) || isCancelledMessage(message)
  return (prisma as any).localPatentEmbedding.update({
    where: { id: embedding.id },
    data: {
      status: 'FAILED',
      errorMessage: message,
      lockedBy: null,
      lockedUntil: null,
      heartbeatAt: null,
      attemptCount: cancelled ? MAX_JOB_ATTEMPTS : undefined,
      nextAttemptAt: cancelled ? new Date() : nextJobAttemptAt(Math.max(1, embedding.attemptCount || 1)),
    },
  })
}

export async function processPatentEmbeddingById(embeddingId: string, workerId = `patent-corpus-${process.pid}`) {
  const embedding = await (prisma as any).localPatentEmbedding.findUnique({
    where: { id: embeddingId },
    include: {
      patent: {
        include: {
          sourceImportFile: {
            include: {
              batch: { select: { errorMessage: true } },
            },
          },
        },
      },
    },
  })
  if (!embedding) return null

  try {
    const batch = embedding.patent?.sourceImportFile?.batch
    if (isCancelledBatch(batch)) throw new PatentCorpusCancelledError(batch?.errorMessage || undefined)
    const text = embedding.patent?.embeddingText || embedding.patent?.ragText || embedding.patent?.abstract || embedding.patent?.title
    if (!text) throw new Error('Patent has no text available for embedding.')
    const vector = await requestCorpusEmbedding(text, { purpose: 'corpus-indexing' })
    await setEmbeddingVector(embedding.id, vector)
    return (prisma as any).localPatentEmbedding.findUnique({ where: { id: embedding.id } })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return failPatentEmbedding(embedding, message)
  }
}

export async function processPatentEmbeddingBatch(workerId = `patent-corpus-${process.pid}`, limit = 4) {
  const claimed = await claimNextPatentEmbeddings(workerId, limit)
  if (!claimed.length) return []

  const processed: any[] = []
  const valid: PatentEmbeddingWorkItem[] = claimed
    .map((embedding: PatentEmbeddingJob) => ({ embedding, text: patentTextForEmbedding(embedding) }))
    .filter((item: PatentEmbeddingWorkItem) => {
      const batch = item.embedding.patent?.sourceImportFile?.batch
      if (isCancelledBatch(batch)) {
        processed.push(failPatentEmbedding(item.embedding, new PatentCorpusCancelledError(batch?.errorMessage || undefined)))
        return false
      }
      if (item.text) return true
      processed.push(failPatentEmbedding(item.embedding, new Error('Patent has no text available for embedding.')))
      return false
    })

  for (let start = 0; start < valid.length; start += PATENT_CORPUS_EMBEDDING_API_BATCH_SIZE) {
    const chunk = valid.slice(start, start + PATENT_CORPUS_EMBEDDING_API_BATCH_SIZE)
    try {
      const vectors = await requestCorpusEmbeddings(
        chunk.map((item: PatentEmbeddingWorkItem) => item.text),
        { purpose: 'corpus-indexing' }
      )
      for (let index = 0; index < chunk.length; index += 1) {
        const vector = vectors[index]
        if (!vector) {
          processed.push(await failPatentEmbedding(chunk[index].embedding, new Error('Embedding response did not contain the expected vector.')))
          continue
        }
        await setEmbeddingVector(chunk[index].embedding.id, vector)
        processed.push(await (prisma as any).localPatentEmbedding.findUnique({ where: { id: chunk[index].embedding.id } }))
      }
    } catch (error) {
      for (const item of chunk) {
        processed.push(await failPatentEmbedding(item.embedding, error))
      }
    }
  }

  return Promise.all(processed)
}

export async function processPendingPatentEmbeddings(workerId = `patent-corpus-${process.pid}`, limit = 4) {
  return processPatentEmbeddingBatch(workerId, limit)
}

export async function searchPatentCorpus(query: string, limit = 20) {
  const safeLimit = Math.min(Math.max(limit, 1), 100)
  const candidateLimit = Math.max(safeLimit * 4, 40)
  const rows = new Map<string, any>()
  const ranks = new Map<string, { vectorRank?: number; textRank?: number; score: number }>()

  function merge(row: any, kind: 'vectorRank' | 'textRank', rank: number, weight = 1) {
    const key = row.publicationNumber
    rows.set(key, { ...(rows.get(key) || {}), ...row })
    const current = ranks.get(key) || { score: 0 }
    current[kind] = rank
    current.score += weight / (60 + rank)
    ranks.set(key, current)
  }

  const textRows = await prisma.$queryRaw<any[]>`
    WITH q AS (SELECT websearch_to_tsquery('english'::regconfig, ${query}) AS query)
    SELECT
      p."id",
      p."publicationNumber",
      p."applicationNumberRaw",
      p."kind",
      p."country",
      p."filingDate",
      p."publicationDate",
      p."title",
      p."abstract",
      p."applicants",
      p."inventors",
      p."classifications",
      p."numberOfPages",
      p."numberOfClaims",
      p."sourcePdfName",
      p."sourcePageNumber",
      p."extractionConfidence",
      ts_rank_cd(
        to_tsvector(
          'english'::regconfig,
          coalesce(p."ragText", '') || ' ' ||
          coalesce(p."title", '') || ' ' ||
          coalesce(p."abstract", '') || ' ' ||
          coalesce(p."abstractOriginal", '')
        ),
        q.query
      ) AS "textScore"
    FROM "local_patents" p, q
    WHERE q.query @@ to_tsvector(
      'english'::regconfig,
      coalesce(p."ragText", '') || ' ' ||
      coalesce(p."title", '') || ' ' ||
      coalesce(p."abstract", '') || ' ' ||
      coalesce(p."abstractOriginal", '')
    )
    ORDER BY "textScore" DESC
    LIMIT ${candidateLimit}
  `

  textRows.forEach((row, index) => merge(row, 'textRank', index + 1, 1))

  if (hasSearchEmbeddingApiKey()) {
    try {
      const vector = await requestSearchQueryEmbedding(query)
      const vectorLiteral = `[${vector.map(value => Number(value).toFixed(8)).join(',')}]`
      const vectorRows = await prisma.$queryRaw<any[]>`
        SELECT
          p."id",
          p."publicationNumber",
          p."applicationNumberRaw",
          p."kind",
          p."country",
          p."filingDate",
          p."publicationDate",
          p."title",
          p."abstract",
          p."applicants",
          p."inventors",
          p."classifications",
          p."numberOfPages",
          p."numberOfClaims",
          p."sourcePdfName",
          p."sourcePageNumber",
          p."extractionConfidence",
          1 - (e."embedding" <=> ${vectorLiteral}::vector) AS "vectorScore"
        FROM "local_patents" p
        JOIN "local_patent_embeddings" e ON e."localPatentId" = p."id"
        WHERE e."status" = 'COMPLETED'::"PatentEmbeddingStatus"
          AND e."model" = ${PATENT_CORPUS_EMBEDDING_MODEL}
          AND e."embedding" IS NOT NULL
        ORDER BY e."embedding" <=> ${vectorLiteral}::vector
        LIMIT ${candidateLimit}
      `
      vectorRows.forEach((row, index) => merge(row, 'vectorRank', index + 1, 1.2))
    } catch (error) {
      console.warn('[PatentCorpus] Vector search skipped:', error)
    }
  }

  return Array.from(rows.values())
    .map(row => {
      const rank = ranks.get(row.publicationNumber) || { score: 0 }
      return {
        ...row,
        hybridScore: Number(rank.score.toFixed(6)),
        vectorRank: rank.vectorRank,
        textRank: rank.textRank,
      }
    })
    .sort((a, b) => b.hybridScore - a.hybridScore)
    .slice(0, safeLimit)
}
