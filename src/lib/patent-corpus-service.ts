import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import AdmZip from 'adm-zip'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  ExtractedPatentRecord,
  PATENT_CORPUS_EXTRACTION_VERSION,
  extractPatentRecordsFromPdf,
} from '@/lib/patent-corpus-extractor'

export const PATENT_CORPUS_UPLOAD_ROOT = path.join(process.cwd(), 'uploads', 'patent-corpus')
export const PATENT_CORPUS_EMBEDDING_MODEL = process.env.PATENT_CORPUS_EMBEDDING_MODEL || 'text-embedding-3-small'
export const PATENT_CORPUS_EMBEDDING_DIMENSIONS = 1536
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
  })
}

export function mergeLocalPatentDataForImport(record: ExtractedPatentRecord, file: any, existing?: any) {
  const data = localPatentData(record, file) as any
  if (existing?.ipIndiaCapturedAt) {
    data.claimsText = existing.claimsText
    data.descriptionText = existing.descriptionText
    data.ipIndiaDetails = existing.ipIndiaDetails
    data.ipIndiaCapturedAt = existing.ipIndiaCapturedAt
    data.ragText = existing.ragText || data.ragText
    data.embeddingText = existing.embeddingText || data.embeddingText
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

export async function requestOpenAIEmbeddings(texts: string[]) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.')

  const inputs = texts.map(text => String(text || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
  if (!inputs.length) return []

  let lastError: Error | null = null
  for (let attempt = 0; attempt < OPENAI_EMBEDDING_MAX_ATTEMPTS; attempt += 1) {
    let response: Response | null = null
    try {
      response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
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

      if (!response.ok) {
        const body = await response.text()
        const message = `OpenAI embedding request failed: ${response.status} ${body}`
        lastError = Object.assign(new Error(message), { retryable: shouldRetryOpenAIEmbedding(response.status) })
        if (attempt < OPENAI_EMBEDDING_MAX_ATTEMPTS - 1 && shouldRetryOpenAIEmbedding(response.status)) {
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
      return embeddings as number[][]
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt < OPENAI_EMBEDDING_MAX_ATTEMPTS - 1 && (lastError as any).retryable !== false) {
        await sleep(openAiBackoffMs(attempt, response || undefined))
        continue
      }
      throw lastError
    }
  }

  throw lastError || new Error('OpenAI embedding request failed.')
}

export async function requestOpenAIEmbedding(text: string) {
  const [embedding] = await requestOpenAIEmbeddings([text])
  if (!embedding) throw new Error('OpenAI embedding response did not contain the expected vector.')
  return embedding
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

export async function setEmbeddingVector(embeddingId: string, vector: number[]) {
  const vectorLiteral = `[${vector.map(value => Number(value).toFixed(8)).join(',')}]`
  const updated = await prisma.$queryRaw<any[]>`
    UPDATE "local_patent_embeddings"
    SET "embedding" = ${vectorLiteral}::vector,
        "status" = 'COMPLETED'::"PatentEmbeddingStatus",
        "embeddedAt" = now(),
        "errorMessage" = NULL,
        "lockedBy" = NULL,
        "lockedUntil" = NULL,
        "heartbeatAt" = NULL,
        "updatedAt" = now()
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
    const vector = await requestOpenAIEmbedding(text)
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
      const vectors = await requestOpenAIEmbeddings(chunk.map((item: PatentEmbeddingWorkItem) => item.text))
      for (let index = 0; index < chunk.length; index += 1) {
        const vector = vectors[index]
        if (!vector) {
          processed.push(await failPatentEmbedding(chunk[index].embedding, new Error('OpenAI embedding response did not contain the expected vector.')))
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

  if (process.env.OPENAI_API_KEY) {
    try {
      const vector = await requestOpenAIEmbedding(query)
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
