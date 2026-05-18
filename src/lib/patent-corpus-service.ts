import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import AdmZip from 'adm-zip'
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

function sha256(input: Buffer | string) {
  return crypto.createHash('sha256').update(input).digest('hex')
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

export async function createPatentImportBatch(params: {
  uploadedBy: string
  uploads: UploadInput[]
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

  const byHash = new Map<string, StoredPdf>()
  for (const upload of params.uploads) {
    const pdfs = await expandUploadToPdfs(upload, targetDir)
    for (const pdf of pdfs) {
      if (!byHash.has(pdf.fileHash)) byHash.set(pdf.fileHash, pdf)
      if (byHash.size > PATENT_CORPUS_MAX_PDFS_PER_BATCH) {
        await (prisma as any).patentImportBatch.update({
          where: { id: batch.id },
          data: {
            status: 'FAILED',
            errorMessage: `A single patent corpus batch can contain at most ${PATENT_CORPUS_MAX_PDFS_PER_BATCH} PDFs. Split this upload into smaller batches.`,
            completedAt: new Date(),
          },
        })
        throw new Error(`A single patent corpus batch can contain at most ${PATENT_CORPUS_MAX_PDFS_PER_BATCH} PDFs. Split this upload into smaller batches.`)
      }
    }
  }

  if (byHash.size === 0) {
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

  for (const pdf of Array.from(byHash.values())) {
    await (prisma as any).patentImportFile.create({
      data: {
        batchId: batch.id,
        originalName: pdf.originalName,
        storedPath: pdf.storedPath,
        mimeType: pdf.mimeType,
        fileHash: pdf.fileHash,
        fileSizeBytes: pdf.fileSizeBytes,
        extractionVersion: PATENT_CORPUS_EXTRACTION_VERSION,
      },
    })
  }

  return (prisma as any).patentImportBatch.update({
    where: { id: batch.id },
    data: { totalFiles: byHash.size },
    include: { files: true },
  })
}

function localPatentData(record: ExtractedPatentRecord, file: any) {
  return {
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
    sourcePageNumber: record.sourcePageNumber,
    ragText: record.ragText,
    embeddingText: record.embeddingText,
    extractionVersion: record.extractionVersion,
    extractionConfidence: record.extractionConfidence,
    extractionWarnings: record.extractionWarnings as any,
  }
}

function embeddingTextHash(text: string) {
  return sha256(text)
}

export async function queueEmbeddingForPatent(localPatentId: number, embeddingText: string) {
  const textHash = embeddingTextHash(embeddingText)
  const model = PATENT_CORPUS_EMBEDDING_MODEL

  const existing = await (prisma as any).localPatentEmbedding.findUnique({
    where: {
      localPatentId_model_textHash: {
        localPatentId,
        model,
        textHash,
      },
    },
  })

  if (!existing) {
    await (prisma as any).localPatentEmbedding.create({
      data: {
        localPatentId,
        model,
        dimensions: PATENT_CORPUS_EMBEDDING_DIMENSIONS,
        textHash,
        status: 'QUEUED',
      },
    })
  } else if (existing.status !== 'COMPLETED') {
    await (prisma as any).localPatentEmbedding.update({
      where: { id: existing.id },
      data: {
        errorMessage: null,
        nextAttemptAt: new Date(),
        status: 'QUEUED',
      },
    })
  }

  await (prisma as any).localPatentEmbedding.deleteMany({
    where: {
      localPatentId,
      model,
      textHash: { not: textHash },
    },
  })
}

async function upsertExtractedPatent(record: ExtractedPatentRecord, file: any) {
  const existing = await (prisma as any).localPatent.findUnique({
    where: { publicationNumber: record.publicationNumber },
    select: { id: true },
  })
  const data = localPatentData(record, file)
  const patent = existing
    ? await (prisma as any).localPatent.update({ where: { id: existing.id }, data })
    : await (prisma as any).localPatent.create({ data })

  if (record.embeddingText) {
    await queueEmbeddingForPatent(patent.id, record.embeddingText)
  }

  return { created: !existing, patent }
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
      ...(['COMPLETED', 'COMPLETED_WITH_WARNINGS', 'FAILED'].includes(status) ? { completedAt: new Date() } : {}),
    },
  })
}

export async function claimNextPatentImportFile(workerId: string) {
  const now = new Date()
  const staleBefore = new Date(now.getTime() - STALE_LOCK_MINUTES * 60 * 1000)
  const candidates = await (prisma as any).patentImportFile.findMany({
    where: {
      status: 'QUEUED',
      nextAttemptAt: { lte: now },
      OR: [
        { lockedUntil: null },
        { lockedUntil: { lt: now } },
        { heartbeatAt: { lt: staleBefore } },
      ],
    },
    orderBy: [{ createdAt: 'asc' }],
    take: 10,
  })

  for (const candidate of candidates) {
    const updated = await (prisma as any).patentImportFile.updateMany({
      where: {
        id: candidate.id,
        status: 'QUEUED',
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
  const file = await (prisma as any).patentImportFile.findUnique({ where: { id: fileId } })
  if (!file) return null

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  try {
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
    let patentsCreated = 0
    let patentsUpdated = 0

    for (const record of extraction.records) {
      const result = await upsertExtractedPatent(record, file)
      if (result.created) patentsCreated += 1
      else patentsUpdated += 1
    }

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
    const failedFile = await (prisma as any).patentImportFile.update({
      where: { id: fileId },
      data: {
        status: 'FAILED',
        errorMessage: message,
        lockedBy: null,
        lockedUntil: null,
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
  await (prisma as any).patentImportFile.updateMany({
    where: {
      batchId,
      status: { in: ['FAILED', 'COMPLETED_WITH_WARNINGS'] },
    },
    data: {
      status: 'QUEUED',
      errorMessage: null,
      lockedBy: null,
      lockedUntil: null,
      nextAttemptAt: new Date(),
      completedAt: null,
    },
  })
  return refreshPatentImportBatchStatus(batchId)
}

async function requestOpenAIEmbedding(text: string) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.')

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: PATENT_CORPUS_EMBEDDING_MODEL,
      input: text,
      dimensions: PATENT_CORPUS_EMBEDDING_DIMENSIONS,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`OpenAI embedding request failed: ${response.status} ${body}`)
  }

  const json = await response.json()
  const embedding = json?.data?.[0]?.embedding
  if (!Array.isArray(embedding) || embedding.length !== PATENT_CORPUS_EMBEDDING_DIMENSIONS) {
    throw new Error('OpenAI embedding response did not contain the expected vector.')
  }
  return embedding as number[]
}

export async function claimNextPatentEmbedding(workerId: string) {
  const now = new Date()
  const staleBefore = new Date(now.getTime() - STALE_LOCK_MINUTES * 60 * 1000)
  const candidates = await (prisma as any).localPatentEmbedding.findMany({
    where: {
      status: 'QUEUED',
      nextAttemptAt: { lte: now },
      OR: [
        { lockedUntil: null },
        { lockedUntil: { lt: now } },
        { heartbeatAt: { lt: staleBefore } },
      ],
    },
    orderBy: [{ createdAt: 'asc' }],
    take: 10,
  })

  for (const candidate of candidates) {
    const updated = await (prisma as any).localPatentEmbedding.updateMany({
      where: {
        id: candidate.id,
        status: 'QUEUED',
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
      return (prisma as any).localPatentEmbedding.findUnique({
        where: { id: candidate.id },
        include: { patent: true },
      })
    }
  }

  return null
}

async function setEmbeddingVector(embeddingId: string, vector: number[]) {
  const vectorLiteral = `[${vector.map(value => Number(value).toFixed(8)).join(',')}]`
  await prisma.$executeRaw`
    UPDATE "local_patent_embeddings"
    SET "embedding" = ${vectorLiteral}::vector,
        "status" = 'COMPLETED'::"PatentEmbeddingStatus",
        "embeddedAt" = now(),
        "errorMessage" = NULL,
        "lockedBy" = NULL,
        "lockedUntil" = NULL,
        "updatedAt" = now()
    WHERE "id" = ${embeddingId}
  `
}

export async function processPatentEmbeddingById(embeddingId: string, workerId = `patent-corpus-${process.pid}`) {
  const embedding = await (prisma as any).localPatentEmbedding.findUnique({
    where: { id: embeddingId },
    include: { patent: true },
  })
  if (!embedding) return null

  try {
    const text = embedding.patent?.embeddingText || embedding.patent?.ragText || embedding.patent?.abstract || embedding.patent?.title
    if (!text) throw new Error('Patent has no text available for embedding.')
    const vector = await requestOpenAIEmbedding(text)
    await setEmbeddingVector(embedding.id, vector)
    return (prisma as any).localPatentEmbedding.findUnique({ where: { id: embedding.id } })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return (prisma as any).localPatentEmbedding.update({
      where: { id: embedding.id },
      data: {
        status: 'FAILED',
        errorMessage: message,
        lockedBy: null,
        lockedUntil: null,
        nextAttemptAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    })
  }
}

export async function processPendingPatentEmbeddings(workerId = `patent-corpus-${process.pid}`, limit = 4) {
  const processed: any[] = []
  for (let index = 0; index < limit; index += 1) {
    const embedding = await claimNextPatentEmbedding(workerId)
    if (!embedding) break
    processed.push(await processPatentEmbeddingById(embedding.id, workerId))
  }
  return processed
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
