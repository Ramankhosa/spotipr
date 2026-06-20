import './load-env'
import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { Prisma } from '@prisma/client'
import {
  PATENT_CORPUS_EMBEDDING_DIMENSIONS,
  PATENT_CORPUS_EMBEDDING_MODEL,
  setEmbeddingVector,
} from '../src/lib/patent-corpus-service'
import { prisma } from '../src/lib/prisma'

type BatchJobState = {
  localJobId: string
  openaiBatchId?: string
  inputFileId?: string
  outputFileId?: string | null
  errorFileId?: string | null
  status: string
  lockBy: string
  jsonlPath: string
  rowCount: number
  submittedAt: string
  completedAt?: string
  processedAt?: string
  lastError?: string
}

type BatchState = {
  jobs: BatchJobState[]
}

type ClaimedEmbeddingRow = {
  id: string
  embeddingText: string | null
  ragText: string | null
  abstract: string | null
  title: string | null
}

const DEFAULT_STATE_FILE = path.join(process.cwd(), 'scripts', '.batch-embed-state.json')
const DEFAULT_BATCH_DIR = path.join(process.cwd(), 'scripts', '.patent-corpus-batches')
const OPENAI_BATCH_INPUT_LIMIT = Math.max(1, Number(process.env.PATENT_CORPUS_OPENAI_BATCH_INPUT_LIMIT || '50000') || 50000)
const BATCH_LOCK_MS = Math.max(60 * 60 * 1000, Number(process.env.PATENT_CORPUS_OPENAI_BATCH_LOCK_HOURS || '30') * 60 * 60 * 1000)
const WATCH_INTERVAL_MS = Math.max(60_000, Number(process.env.PATENT_CORPUS_OPENAI_BATCH_WATCH_INTERVAL_MS || '300000') || 300_000)
const BATCH_MAX_ATTEMPTS = Math.max(1, Number(process.env.PATENT_CORPUS_OPENAI_BATCH_MAX_ATTEMPTS || '10') || 10)
const OPENAI_DOWNLOAD_MAX_ATTEMPTS = Math.max(1, Number(process.env.PATENT_CORPUS_OPENAI_FILE_DOWNLOAD_ATTEMPTS || '5') || 5)
const OPENAI_ERROR_SNIPPET_CHARS = Math.max(500, Number(process.env.PATENT_CORPUS_OPENAI_ERROR_SNIPPET_CHARS || '2000') || 2000)
const OPENAI_ACTIVE_BATCH_STATUSES = new Set(['validating', 'in_progress', 'finalizing', 'cancelling'])
const OPENAI_LOCAL_TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'failed', 'expired', 'processed'])

function envBoolean(name: string, fallback: boolean) {
  const value = process.env[name]
  if (value === undefined || value === '') return fallback
  return !['0', 'false', 'no', 'off'].includes(value.toLowerCase())
}

function argValue(name: string) {
  const prefix = `${name}=`
  const found = process.argv.find(arg => arg.startsWith(prefix))
  return found ? found.slice(prefix.length) : null
}

function hasArg(name: string) {
  return process.argv.includes(name)
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function jitter(ms: number) {
  return Math.round(ms * (0.75 + Math.random() * 0.5))
}

function compactText(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function truncateText(value: unknown, limit = OPENAI_ERROR_SNIPPET_CHARS) {
  const text = String(value || '')
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}... [truncated ${text.length - limit} chars]`
}

function errorMessage(error: unknown) {
  return truncateText(error instanceof Error ? error.message : String(error))
}

function textForEmbedding(row: ClaimedEmbeddingRow) {
  return compactText(row.embeddingText || row.ragText || row.abstract || row.title)
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
  if (retryAfter !== null) return Math.min(retryAfter, 60_000)
  return jitter(Math.min(60_000, 1000 * 2 ** attemptIndex))
}

function shouldRetryOpenAIStatus(status: number) {
  return status === 408 || status === 409 || status === 429 || status >= 500
}

async function readResponseSnippet(response: Response, limit = OPENAI_ERROR_SNIPPET_CHARS) {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  try {
    while (text.length < limit) {
      const { done, value } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
      if (text.length >= limit) {
        await reader.cancel().catch(() => undefined)
        break
      }
    }
    text += decoder.decode()
  } catch (error) {
    return `${truncateText(text, limit)} [failed reading error body: ${errorMessage(error)}]`
  }
  return truncateText(text, limit)
}

function isOpenAIActiveJobStatus(status?: string) {
  if (!status) return true
  const normalized = status.toLowerCase()
  if (OPENAI_ACTIVE_BATCH_STATUSES.has(normalized)) return true
  if (OPENAI_LOCAL_TERMINAL_STATUSES.has(normalized)) return false
  return true
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw error
  }
}

async function writeJsonFile(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

async function loadState(stateFile: string): Promise<BatchState> {
  const state = await readJsonFile<BatchState>(stateFile, { jobs: [] })
  if (!Array.isArray(state.jobs)) state.jobs = []
  return state
}

async function saveState(stateFile: string, state: BatchState) {
  await writeJsonFile(stateFile, state)
}

async function openaiJson<T>(pathName: string, init: RequestInit = {}): Promise<T> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.')
  const response = await fetch(`https://api.openai.com/v1${pathName}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(init.headers || {}),
    },
  })
  if (!response.ok) {
    const body = await readResponseSnippet(response)
    throw new Error(`OpenAI request failed: ${response.status} ${body}`)
  }
  return response.json() as Promise<T>
}

async function uploadBatchJsonl(jsonlPath: string) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.')
  const formData = new FormData()
  const buffer = await fs.readFile(jsonlPath)
  formData.append('purpose', 'batch')
  formData.append('file', new Blob([Uint8Array.from(buffer)], { type: 'application/jsonl' }), path.basename(jsonlPath))

  const response = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  })
  if (!response.ok) {
    const body = await readResponseSnippet(response)
    throw new Error(`OpenAI file upload failed: ${response.status} ${body}`)
  }
  return response.json() as Promise<{ id: string }>
}

async function fetchOpenAIFile(fileId: string) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.')

  let lastError: Error | null = null
  for (let attempt = 0; attempt < OPENAI_DOWNLOAD_MAX_ATTEMPTS; attempt += 1) {
    let response: Response | null = null
    try {
      response = await fetch(`https://api.openai.com/v1/files/${fileId}/content`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (response.ok) return response

      const body = await readResponseSnippet(response)
      lastError = new Error(`OpenAI file download failed: ${response.status} ${body}`)
      if (attempt < OPENAI_DOWNLOAD_MAX_ATTEMPTS - 1 && shouldRetryOpenAIStatus(response.status)) {
        await sleep(openAiBackoffMs(attempt, response))
        continue
      }
      throw lastError
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt < OPENAI_DOWNLOAD_MAX_ATTEMPTS - 1 && (!response || shouldRetryOpenAIStatus(response.status))) {
        await sleep(openAiBackoffMs(attempt, response || undefined))
        continue
      }
      throw lastError
    }
  }

  throw lastError || new Error(`OpenAI file download failed for ${fileId}.`)
}

async function processOpenAIFileLines(fileId: string, onLine: (line: string, lineNumber: number) => Promise<void>) {
  const response = await fetchOpenAIFile(fileId)
  if (!response.body) throw new Error(`OpenAI file download failed for ${fileId}: empty response body.`)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let lineNumber = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, '')
      buffer = buffer.slice(newlineIndex + 1)
      lineNumber += 1
      await onLine(line, lineNumber)
      newlineIndex = buffer.indexOf('\n')
    }
  }

  buffer += decoder.decode()
  if (buffer.trim()) {
    lineNumber += 1
    await onLine(buffer.replace(/\r$/, ''), lineNumber)
  }
}

async function claimEmbeddingRows(limit: number, lockBy: string, retryFailed: boolean) {
  const now = new Date()
  const lockedUntil = new Date(now.getTime() + BATCH_LOCK_MS)
  const claimableStatuses = retryFailed ? Prisma.sql`('QUEUED'::"PatentEmbeddingStatus", 'FAILED'::"PatentEmbeddingStatus")` : Prisma.sql`('QUEUED'::"PatentEmbeddingStatus")`
  const candidates = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT e."id"
    FROM "local_patent_embeddings" e
    JOIN "local_patents" p ON p."id" = e."localPatentId"
    WHERE e."status" IN ${claimableStatuses}
      AND e."model" = ${PATENT_CORPUS_EMBEDDING_MODEL}
      AND e."nextAttemptAt" <= now()
      AND e."attemptCount" < ${BATCH_MAX_ATTEMPTS}
      AND (
        e."lockedUntil" IS NULL
        OR e."lockedUntil" < now()
      )
      AND coalesce(p."embeddingText", p."ragText", p."abstract", p."title") IS NOT NULL
    ORDER BY e."createdAt" ASC
    LIMIT ${limit}
  `
  const ids = candidates.map(row => row.id)
  if (!ids.length) return []

  await (prisma as any).localPatentEmbedding.updateMany({
    where: {
      id: { in: ids },
      status: { in: retryFailed ? ['QUEUED', 'FAILED'] : ['QUEUED'] },
    },
    data: {
      status: 'PROCESSING',
      lockedBy: lockBy,
      lockedUntil,
      heartbeatAt: now,
      attemptCount: { increment: 1 },
      errorMessage: null,
    },
  })

  return prisma.$queryRaw<ClaimedEmbeddingRow[]>`
    SELECT
      e."id",
      p."embeddingText",
      p."ragText",
      p."abstract",
      p."title"
    FROM "local_patent_embeddings" e
    JOIN "local_patents" p ON p."id" = e."localPatentId"
    WHERE e."lockedBy" = ${lockBy}
    ORDER BY e."updatedAt" ASC
  `
}

async function countQueuedEmbeddingRows(retryFailed: boolean) {
  const claimableStatuses = retryFailed ? Prisma.sql`('QUEUED'::"PatentEmbeddingStatus", 'FAILED'::"PatentEmbeddingStatus")` : Prisma.sql`('QUEUED'::"PatentEmbeddingStatus")`
  const rows = await prisma.$queryRaw<Array<{ count: bigint | number | string }>>`
    SELECT COUNT(*) AS "count"
    FROM "local_patent_embeddings" e
    JOIN "local_patents" p ON p."id" = e."localPatentId"
    WHERE e."status" IN ${claimableStatuses}
      AND e."model" = ${PATENT_CORPUS_EMBEDDING_MODEL}
      AND e."nextAttemptAt" <= now()
      AND e."attemptCount" < ${BATCH_MAX_ATTEMPTS}
      AND (
        e."lockedUntil" IS NULL
        OR e."lockedUntil" < now()
      )
      AND coalesce(p."embeddingText", p."ragText", p."abstract", p."title") IS NOT NULL
  `
  return Number(rows[0]?.count || 0)
}

async function hasActiveImportWork() {
  const activeFiles = await (prisma as any).patentImportFile.count({
    where: {
      status: { in: ['QUEUED', 'PROCESSING'] },
    },
  }).catch(() => 0)
  return activeFiles > 0
}

async function writeBatchJsonl(rows: ClaimedEmbeddingRow[], filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const lines = rows
    .map(row => {
      const input = textForEmbedding(row)
      if (!input) return ''
      return JSON.stringify({
        custom_id: row.id,
        method: 'POST',
        url: '/v1/embeddings',
        body: {
          model: PATENT_CORPUS_EMBEDDING_MODEL,
          input,
          dimensions: PATENT_CORPUS_EMBEDDING_DIMENSIONS,
        },
      })
    })
    .filter(Boolean)
  await fs.writeFile(filePath, `${lines.join('\n')}\n`)
  return lines.length
}

async function createOpenAIBatch(inputFileId: string) {
  return openaiJson<{ id: string; status: string }>('/batches', {
    method: 'POST',
    body: JSON.stringify({
      input_file_id: inputFileId,
      endpoint: '/v1/embeddings',
      completion_window: '24h',
    }),
  })
}

async function submitOneBatch(state: BatchState, stateFile: string, batchDir: string, limit: number, retryFailed: boolean) {
  const localJobId = crypto.randomUUID()
  const localLockBy = `openai-batch:${localJobId}`
  const jsonlPath = path.join(batchDir, `${localJobId}.jsonl`)
  const rows = await claimEmbeddingRows(limit, localLockBy, retryFailed)
  if (!rows.length) {
    console.log('[PatentCorpusBatchEmbed] No queued embedding rows found.')
    return null
  }

  const rowCount = await writeBatchJsonl(rows, jsonlPath)
  if (!rowCount) {
    await releaseLockedRows(localLockBy, 'No embedding text available for batch input.')
    console.log('[PatentCorpusBatchEmbed] Claimed rows had no embedding text; released them.')
    return null
  }

  try {
    const inputFile = await uploadBatchJsonl(jsonlPath)
    const batch = await createOpenAIBatch(inputFile.id)
    const openaiLockBy = `openai-batch:${batch.id}`
    await (prisma as any).localPatentEmbedding.updateMany({
      where: { lockedBy: localLockBy },
      data: {
        lockedBy: openaiLockBy,
        lockedUntil: new Date(Date.now() + BATCH_LOCK_MS),
        heartbeatAt: new Date(),
      },
    })

    const job: BatchJobState = {
      localJobId,
      openaiBatchId: batch.id,
      inputFileId: inputFile.id,
      status: batch.status,
      lockBy: openaiLockBy,
      jsonlPath,
      rowCount,
      submittedAt: new Date().toISOString(),
    }
    state.jobs.push(job)
    await saveState(stateFile, state)
    console.log('[PatentCorpusBatchEmbed] Submitted batch:', {
      openaiBatchId: batch.id,
      inputFileId: inputFile.id,
      rowCount,
    })
    return job
  } catch (error) {
    await releaseLockedRows(localLockBy, errorMessage(error))
    throw error
  }
}

async function releaseLockedRows(lockBy: string, errorMessage?: string) {
  return (prisma as any).localPatentEmbedding.updateMany({
    where: {
      lockedBy: lockBy,
      status: 'PROCESSING',
    },
    data: {
      status: 'QUEUED',
      errorMessage: errorMessage || null,
      lockedBy: null,
      lockedUntil: null,
      heartbeatAt: null,
      nextAttemptAt: new Date(),
    },
  })
}

async function requeueEmbedding(embeddingId: string, lockBy: string, errorMessage: string) {
  await (prisma as any).localPatentEmbedding.updateMany({
    where: {
      id: embeddingId,
      lockedBy: lockBy,
    },
    data: {
      status: 'QUEUED',
      errorMessage: errorMessage.slice(0, 2000),
      lockedBy: null,
      lockedUntil: null,
      heartbeatAt: null,
      nextAttemptAt: new Date(),
    },
  })
}

async function processBatchOutput(job: BatchJobState, fileId: string) {
  let completed = 0
  let failed = 0
  await processOpenAIFileLines(fileId, async (line, lineNumber) => {
    if (!line.trim()) return
    let item: any
    try {
      item = JSON.parse(line)
    } catch (error) {
      throw new Error(`Invalid JSON in OpenAI batch output file ${fileId} at line ${lineNumber}: ${errorMessage(error)}`)
    }
    const embeddingId = String(item.custom_id || '')
    if (!embeddingId) return
    const embedding = item.response?.body?.data?.[0]?.embedding
    if (item.error || item.response?.status_code !== 200 || !Array.isArray(embedding)) {
      failed += 1
      await requeueEmbedding(embeddingId, job.lockBy, item.error?.message || `Batch line failed with status ${item.response?.status_code || 'unknown'}`)
      return
    }
    await setEmbeddingVector(embeddingId, embedding)
    completed += 1
  })
  return {
    completed,
    failed,
    releasedMissing: 0,
  }
}

async function processBatchErrorFile(job: BatchJobState, fileId: string) {
  let failed = 0
  await processOpenAIFileLines(fileId, async (line, lineNumber) => {
    if (!line.trim()) return
    let item: any
    try {
      item = JSON.parse(line)
    } catch (error) {
      throw new Error(`Invalid JSON in OpenAI batch error file ${fileId} at line ${lineNumber}: ${errorMessage(error)}`)
    }
    const embeddingId = String(item.custom_id || '')
    if (!embeddingId) return
    failed += 1
    await requeueEmbedding(embeddingId, job.lockBy, item.error?.message || 'OpenAI batch line failed.')
  })
  return failed
}

async function pollKnownJobs(state: BatchState, stateFile: string) {
  const pendingJobs = state.jobs.filter(job => job.openaiBatchId && !job.processedAt)
  if (!pendingJobs.length) {
    console.log('[PatentCorpusBatchEmbed] No pending batch jobs in state.')
    return
  }

  for (const job of pendingJobs) {
    try {
      const batch = await openaiJson<{
        id: string
        status: string
        output_file_id?: string | null
        error_file_id?: string | null
      }>(`/batches/${job.openaiBatchId}`)
      job.status = batch.status
      job.outputFileId = batch.output_file_id || null
      job.errorFileId = batch.error_file_id || null

      if (batch.status === 'completed') {
        let outputStats = { completed: 0, failed: 0, releasedMissing: 0 }
        let errorFailures = 0
        if (batch.output_file_id) {
          outputStats = await processBatchOutput(job, batch.output_file_id)
        }
        if (batch.error_file_id) {
          errorFailures = await processBatchErrorFile(job, batch.error_file_id)
        }
        const released = await releaseLockedRows(job.lockBy, 'OpenAI batch completed without an output line for this embedding.')
        job.status = 'processed'
        job.completedAt = new Date().toISOString()
        job.processedAt = new Date().toISOString()
        console.log('[PatentCorpusBatchEmbed] Processed completed batch:', {
          openaiBatchId: job.openaiBatchId,
          completed: outputStats.completed,
          failed: outputStats.failed + errorFailures + Number(released.count || 0),
          releasedMissing: outputStats.releasedMissing + Number(released.count || 0),
        })
      } else if (['cancelled', 'failed', 'expired'].includes(batch.status)) {
        const released = await releaseLockedRows(job.lockBy, `OpenAI batch ${batch.status}.`)
        job.lastError = `OpenAI batch ${batch.status}; released ${released.count || 0} rows.`
        job.completedAt = new Date().toISOString()
        job.processedAt = new Date().toISOString()
        console.warn('[PatentCorpusBatchEmbed] Batch ended without completion:', {
          openaiBatchId: job.openaiBatchId,
          status: batch.status,
          released: released.count || 0,
        })
      } else {
        console.log('[PatentCorpusBatchEmbed] Batch still active:', {
          openaiBatchId: job.openaiBatchId,
          status: batch.status,
        })
      }
    } catch (error) {
      job.lastError = errorMessage(error)
      console.error('[PatentCorpusBatchEmbed] Poll/process failed:', {
        openaiBatchId: job.openaiBatchId,
        error: job.lastError,
      })
    }
    await saveState(stateFile, state)
  }
}

function isActiveJob(job: BatchJobState) {
  return Boolean(
    job.openaiBatchId &&
    !job.processedAt &&
    isOpenAIActiveJobStatus(job.status)
  )
}

async function submitAvailableBatches(params: {
  state: BatchState
  stateFile: string
  batchDir: string
  limit: number
  maxJobs: number
  maxActiveJobs: number
  minRows: number
  enforceMinRows: boolean
  retryFailed: boolean
}) {
  let submitted = 0
  for (let index = 0; index < params.maxJobs; index += 1) {
    const activeCount = params.state.jobs.filter(isActiveJob).length
    if (activeCount >= params.maxActiveJobs) {
      console.log('[PatentCorpusBatchEmbed] Active batch job limit reached:', {
        activeJobs: activeCount,
        maxActiveJobs: params.maxActiveJobs,
      })
      break
    }

    if (params.enforceMinRows) {
      const queuedRows = await countQueuedEmbeddingRows(params.retryFailed)
      const activeImportWork = await hasActiveImportWork()
      if (queuedRows === 0) {
        console.log('[PatentCorpusBatchEmbed] No queued embedding rows found.')
        break
      }
      if (activeImportWork && queuedRows < params.minRows) {
        console.log('[PatentCorpusBatchEmbed] Waiting for a fuller OpenAI batch:', {
          queuedRows,
          minRows: params.minRows,
        })
        break
      }
    }

    const job = await submitOneBatch(params.state, params.stateFile, params.batchDir, params.limit, params.retryFailed)
    if (!job) break
    submitted += 1
  }
  return submitted
}

type BatchEmbedOptions = {
  stateFile: string
  batchDir: string
  limit: number
  maxJobs: number
  maxActiveJobs: number
  minRows: number
  shouldSubmit: boolean
  shouldPoll: boolean
  watch: boolean
  watchIntervalMs: number
  retryFailed: boolean
}

function parseOptions(): BatchEmbedOptions {
  const limit = Math.min(
    OPENAI_BATCH_INPUT_LIMIT,
    Math.max(1, Number(argValue('--batch-size') || argValue('--limit') || OPENAI_BATCH_INPUT_LIMIT) || OPENAI_BATCH_INPUT_LIMIT)
  )
  const maxJobs = Math.max(1, Number(argValue('--max-jobs') || process.env.PATENT_CORPUS_OPENAI_BATCH_MAX_JOBS || '1') || 1)
  const maxActiveJobs = Math.max(
    1,
    Number(argValue('--max-active-jobs') || process.env.PATENT_CORPUS_OPENAI_BATCH_MAX_ACTIVE_JOBS || maxJobs) || maxJobs
  )
  return {
    stateFile: argValue('--state') || process.env.PATENT_CORPUS_OPENAI_BATCH_STATE || DEFAULT_STATE_FILE,
    batchDir: argValue('--dir') || process.env.PATENT_CORPUS_OPENAI_BATCH_DIR || DEFAULT_BATCH_DIR,
    limit,
    maxJobs,
    maxActiveJobs,
    minRows: Math.min(
      limit,
      Math.max(1, Number(argValue('--min-rows') || process.env.PATENT_CORPUS_OPENAI_BATCH_MIN_ROWS || limit) || limit)
    ),
    shouldSubmit: hasArg('--watch') || hasArg('--auto') || hasArg('--submit') || hasArg('--run') || (!hasArg('--poll') && !hasArg('--process')),
    shouldPoll: hasArg('--watch') || hasArg('--auto') || hasArg('--poll') || hasArg('--process') || hasArg('--run') || (!hasArg('--submit')),
    watch: hasArg('--watch') || hasArg('--auto'),
    retryFailed: hasArg('--retry-failed') || envBoolean('PATENT_CORPUS_OPENAI_BATCH_RETRY_FAILED', true),
    watchIntervalMs: Math.max(
      60_000,
      Number(argValue('--watch-interval-ms') || argValue('--interval-ms') || WATCH_INTERVAL_MS) || WATCH_INTERVAL_MS
    ),
  }
}

async function runOnce(options: BatchEmbedOptions) {
  const state = await loadState(options.stateFile)
  if (options.shouldPoll) await pollKnownJobs(state, options.stateFile)
  if (options.shouldSubmit) {
    await submitAvailableBatches({
      state,
      stateFile: options.stateFile,
      batchDir: options.batchDir,
      limit: options.limit,
      maxJobs: options.maxJobs,
      maxActiveJobs: options.maxActiveJobs,
      minRows: options.minRows,
      enforceMinRows: options.watch,
      retryFailed: options.retryFailed,
    })
  }
}

async function main() {
  const options = parseOptions()
  const embeddingMode = String(process.env.PATENT_CORPUS_EMBEDDING_MODE || 'realtime').trim().toLowerCase()
  const allowBatchSubmissions = embeddingMode === 'batch' ||
    hasArg('--force-submit') ||
    envBoolean('PATENT_CORPUS_OPENAI_BATCH_SUBMIT_ENABLED', false)

  if (options.shouldSubmit && !allowBatchSubmissions) {
    options.shouldSubmit = false
    console.warn('[PatentCorpusBatchEmbed] New OpenAI batch submissions are disabled in realtime embedding mode. Existing batch jobs will only be polled. Set PATENT_CORPUS_EMBEDDING_MODE=batch or pass --force-submit for an intentional historical backfill.')
  }

  if (!options.watch) {
    await runOnce(options)
    return
  }

  console.log('[PatentCorpusBatchEmbed] Watch mode started:', {
    batchSize: options.limit,
    minRows: options.minRows,
    maxJobsPerTick: options.maxJobs,
    maxActiveJobs: options.maxActiveJobs,
    retryFailed: options.retryFailed,
    watchIntervalMs: options.watchIntervalMs,
    stateFile: options.stateFile,
  })

  while (true) {
    try {
      await runOnce(options)
    } catch (error) {
      console.error('[PatentCorpusBatchEmbed] Watch tick failed:', error)
    }
    await sleep(options.watchIntervalMs)
  }
}

main()
  .catch(error => {
    console.error('[PatentCorpusBatchEmbed] Fatal:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
