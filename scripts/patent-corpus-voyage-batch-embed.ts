import './load-env'
import fs from 'fs/promises'
import path from 'path'
import { Prisma } from '@prisma/client'
import {
  PATENT_CORPUS_EMBEDDING_DIMENSIONS,
  PATENT_CORPUS_EMBEDDING_DTYPE,
  PATENT_CORPUS_EMBEDDING_MODEL,
  setEmbeddingVector,
} from '../src/lib/patent-corpus-service'
import { prisma } from '../src/lib/prisma'

// Voyage Batch API embedding driver (33% cheaper than realtime; 12h completion window).
// Flow per the Voyage docs:
//   1. claim QUEUED rows (long lock) -> write JSONL (custom_id = embedding id)
//   2. POST /v1/files (purpose=batch)          -> input_file_id
//   3. POST /v1/batches                        -> batch id
//   4. GET  /v1/batches/{id} (poll)            -> completed
//   5. GET  /v1/files/{output_file_id}/content -> vectors -> setEmbeddingVector
// State is persisted to a JSON file so runs resume; safe to run under a scheduler.
//
//   PATENT_CORPUS_EMBEDDING_MODEL=voyage-3.5-lite PATENT_CORPUS_EMBEDDING_DTYPE=binary \
//   npx tsx scripts/patent-corpus-voyage-batch-embed.ts --watch

const API = 'https://api.voyageai.com/v1'
const STATE_FILE = process.env.VOYAGE_BATCH_STATE_FILE || path.join(process.cwd(), 'scripts', '.voyage-batch-state.json')
const BATCH_DIR = path.join(process.cwd(), 'scripts', '.voyage-batches')
// Voyage caps 100K inputs/batch and 1B tokens across in-flight batches. ~50K rows/batch
// (~15M tokens) lets ~60 batches run before the token cap; well under the 100-batch cap.
const INPUTS_PER_BATCH = Math.max(1, Math.min(100_000, Number(process.env.VOYAGE_BATCH_INPUTS || '50000') || 50000))
const MAX_INFLIGHT = Math.max(1, Number(process.env.VOYAGE_BATCH_MAX_INFLIGHT || '20') || 20)
const LOCK_MS = Math.max(60 * 60 * 1000, Number(process.env.VOYAGE_BATCH_LOCK_HOURS || '18') * 60 * 60 * 1000)
const POLL_MS = Math.max(60_000, Number(process.env.VOYAGE_BATCH_POLL_MS || '300000') || 300_000)
const ACTIVE = new Set(['validating', 'in_progress', 'finalizing', 'cancelling'])

type Job = {
  lockBy: string
  inputFileId?: string
  batchId?: string
  outputFileId?: string | null
  status: string
  rowCount: number
  jsonlPath: string
  submittedAt: string
  processedAt?: string
  lastError?: string
}
type State = { jobs: Job[] }

function apiKey() {
  const key = process.env.VOYAGE_API_KEY
  if (!key) throw new Error('VOYAGE_API_KEY is not configured.')
  return key
}

function outputDtype() {
  return PATENT_CORPUS_EMBEDDING_DTYPE === 'binary' ? 'ubinary' : 'float'
}

async function loadState(): Promise<State> {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, 'utf8')) as State
  } catch {
    return { jobs: [] }
  }
}

async function saveState(state: State) {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true })
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2))
}

// Claim QUEUED/FAILED rows for the configured model with a long batch lock, returning
// the id + the text to embed (joined from local_patents).
async function claimRows(lockBy: string, limit: number): Promise<Array<{ id: string; text: string }>> {
  const lockedUntil = new Date(Date.now() + LOCK_MS)
  const rows = await prisma.$queryRaw<Array<{ id: string; text: string | null }>>(Prisma.sql`
    WITH claimed AS (
      SELECT e."id"
      FROM "local_patent_embeddings" e
      WHERE e."model" = ${PATENT_CORPUS_EMBEDDING_MODEL}
        AND e."status" IN ('QUEUED','FAILED')
        AND e."nextAttemptAt" <= now()
        AND (e."lockedUntil" IS NULL OR e."lockedUntil" < now())
      ORDER BY e."nextAttemptAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "local_patent_embeddings" e
    SET "lockedBy" = ${lockBy}, "lockedUntil" = ${lockedUntil}, "heartbeatAt" = now(), "updatedAt" = now()
    FROM claimed c
    JOIN "local_patents" p ON TRUE
    WHERE e."id" = c."id" AND p."id" = e."localPatentId"
    RETURNING e."id", COALESCE(p."embeddingText", p."ragText", p."abstract", p."title") AS text
  `)
  return rows
    .map(row => ({ id: row.id, text: String(row.text || '').replace(/\s+/g, ' ').trim() }))
    .filter(row => row.text)
}

async function releaseRows(ids: string[], error: string) {
  if (!ids.length) return
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "local_patent_embeddings"
    SET "status" = 'FAILED', "errorMessage" = ${error.slice(0, 500)},
        "lockedBy" = NULL, "lockedUntil" = NULL, "heartbeatAt" = NULL,
        "attemptCount" = "attemptCount" + 1,
        "nextAttemptAt" = now() + interval '15 minutes', "updatedAt" = now()
    WHERE "id" IN (${Prisma.join(ids)})
  `)
}

async function submitJob(state: State) {
  const inflight = state.jobs.filter(job => !job.processedAt).length
  if (inflight >= MAX_INFLIGHT) return false

  const lockBy = `voyage-batch-${process.pid}-${state.jobs.length + 1}`
  const rows = await claimRows(lockBy, INPUTS_PER_BATCH)
  if (!rows.length) return false

  await fs.mkdir(BATCH_DIR, { recursive: true })
  const jsonlPath = path.join(BATCH_DIR, `${lockBy}.jsonl`)
  const jsonl = rows.map(row => JSON.stringify({ custom_id: row.id, body: { input: [row.text] } })).join('\n')
  await fs.writeFile(jsonlPath, jsonl)

  // 1. upload file
  const form = new FormData()
  form.append('purpose', 'batch')
  form.append('file', new Blob([jsonl], { type: 'application/jsonl' }), `${lockBy}.jsonl`)
  const fileRes = await fetch(`${API}/files`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey()}` }, body: form })
  if (!fileRes.ok) {
    await releaseRows(rows.map(r => r.id), `file upload failed: ${fileRes.status}`)
    throw new Error(`Voyage file upload failed: ${fileRes.status} ${await fileRes.text()}`)
  }
  const inputFileId = (await fileRes.json())?.id
  if (!inputFileId) {
    await releaseRows(rows.map(r => r.id), 'file upload returned no id')
    throw new Error('Voyage file upload returned no id.')
  }

  // 2. create batch
  const requestParams: Record<string, unknown> = {
    model: PATENT_CORPUS_EMBEDDING_MODEL,
    input_type: 'document',
    output_dtype: outputDtype(),
    output_dimension: PATENT_CORPUS_EMBEDDING_DIMENSIONS,
  }
  const batchRes = await fetch(`${API}/batches`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: '/v1/embeddings', completion_window: '12h', request_params: requestParams, input_file_id: inputFileId }),
  })
  if (!batchRes.ok) {
    await releaseRows(rows.map(r => r.id), `batch create failed: ${batchRes.status}`)
    throw new Error(`Voyage batch create failed: ${batchRes.status} ${await batchRes.text()}`)
  }
  const batchId = (await batchRes.json())?.id

  state.jobs.push({ lockBy, inputFileId, batchId, status: 'in_progress', rowCount: rows.length, jsonlPath, submittedAt: new Date().toISOString() })
  await saveState(state)
  console.log(`[VoyageBatch] Submitted ${rows.length} rows as ${batchId}`)
  return true
}

async function pollAndIngest(job: Job) {
  if (!job.batchId) return
  const res = await fetch(`${API}/batches/${job.batchId}`, { headers: { Authorization: `Bearer ${apiKey()}` } })
  if (!res.ok) { job.lastError = `poll failed: ${res.status}`; return }
  const body = await res.json()
  job.status = String(body?.status || job.status)
  job.outputFileId = body?.output_file_id || job.outputFileId

  if (ACTIVE.has(job.status)) return
  if (job.status === 'failed' || job.status === 'cancelled') {
    await recoverJobRows(job, `batch ${job.status}`)
    job.processedAt = new Date().toISOString()
    return
  }
  if (job.status !== 'completed' || !job.outputFileId) return

  const out = await fetch(`${API}/files/${job.outputFileId}/content`, { headers: { Authorization: `Bearer ${apiKey()}` } })
  if (!out.ok) { job.lastError = `output download failed: ${out.status}`; return }
  const text = await out.text()
  let ok = 0
  const failedIds: string[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const record = JSON.parse(line)
      const id = record?.custom_id
      const embedding = record?.response?.body?.data?.[0]?.embedding
      if (record?.error || record?.response?.status_code !== 200 || !Array.isArray(embedding)) { if (id) failedIds.push(id); continue }
      await setEmbeddingVector(id, embedding)
      ok += 1
    } catch { /* skip malformed line */ }
  }
  if (failedIds.length) await releaseRows(failedIds, 'batch line error or missing embedding')
  job.processedAt = new Date().toISOString()
  console.log(`[VoyageBatch] ${job.batchId} completed: ${ok} embedded, ${failedIds.length} failed.`)
}

// Rows whose batch failed: their locks expire naturally, but release them promptly so
// the next run re-queues them.
async function recoverJobRows(job: Job, reason: string) {
  try {
    const jsonl = await fs.readFile(job.jsonlPath, 'utf8')
    const ids = jsonl.split('\n').filter(Boolean).map(line => JSON.parse(line)?.custom_id).filter(Boolean)
    await releaseRows(ids, reason)
    console.warn(`[VoyageBatch] ${job.batchId} ${reason}; released ${ids.length} rows.`)
  } catch (error) {
    console.warn(`[VoyageBatch] Could not recover rows for ${job.batchId}:`, error instanceof Error ? error.message : error)
  }
}

async function tick() {
  const state = await loadState()
  // Submit new work until the in-flight cap or the queue is empty.
  while (await submitJob(state)) { /* keep filling */ }
  // Poll active jobs.
  for (const job of state.jobs) {
    if (job.processedAt) continue
    try { await pollAndIngest(job) } catch (error) { job.lastError = error instanceof Error ? error.message : String(error) }
  }
  await saveState(state)
  const pending = state.jobs.filter(job => !job.processedAt).length
  const remaining = await prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
    SELECT count(*) AS n FROM "local_patent_embeddings"
    WHERE "model" = ${PATENT_CORPUS_EMBEDDING_MODEL} AND "status" IN ('QUEUED','FAILED')
  `)
  return { pendingJobs: pending, queuedRows: Number(remaining[0]?.n || 0) }
}

async function main() {
  if (!PATENT_CORPUS_EMBEDDING_MODEL.toLowerCase().startsWith('voyage')) {
    console.error(`[VoyageBatch] PATENT_CORPUS_EMBEDDING_MODEL must be a voyage-* model; got ${PATENT_CORPUS_EMBEDDING_MODEL}.`)
    process.exit(1)
  }
  const watch = process.argv.includes('--watch')
  do {
    const { pendingJobs, queuedRows } = await tick()
    console.log(`[VoyageBatch] tick: ${pendingJobs} batch(es) in flight, ${queuedRows} rows queued.`)
    if (!watch) break
    if (pendingJobs === 0 && queuedRows === 0) { console.log('[VoyageBatch] All work complete.'); break }
    await new Promise(resolve => setTimeout(resolve, POLL_MS))
  } while (true)
}

main().catch(error => { console.error('[VoyageBatch] Fatal:', error); process.exit(1) }).finally(() => prisma.$disconnect())
