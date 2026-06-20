import {
  getNextPatentCorpusQueueAttemptAt,
  hasCorpusEmbeddingApiKey,
  processPendingPatentEmbeddings,
  processPendingPatentImportFiles,
} from '@/lib/patent-corpus-service'
import {
  getNextIpIndiaJournalQueueAttemptAt,
  processPendingIpIndiaJournalArchive,
} from '@/lib/ipindia-journal-archive-service'

type PatentCorpusRunnerState = {
  enabled: boolean
  active: boolean
  workerId: string | null
  lastReason: string | null
  lastStartedAt: string | null
  lastRunAt: string | null
  lastStoppedAt: string | null
  lastError: string | null
  processedJournalFiles: number
  processedFiles: number
  processedEmbeddings: number
}

const STATE_KEY = '__patentCorpusAutoRunner'
const AUTO_RUNNER_ENABLED = process.env.PATENT_CORPUS_AUTO_WORKER !== 'false'
const ERROR_BACKOFF_MS = 10_000
const MAX_WAKE_DELAY_MS = 60 * 60 * 1000

function envNumber(name: string, fallback: number) {
  const value = process.env[name]
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function envBoolean(name: string, fallback: boolean) {
  const value = process.env[name]
  if (value === undefined || value === '') return fallback
  return !['0', 'false', 'no', 'off'].includes(value.toLowerCase())
}

function realtimeEmbeddingsEnabled() {
  const mode = String(process.env.PATENT_CORPUS_EMBEDDING_MODE || '').trim().toLowerCase()
  if (mode) return !['batch', 'off', 'disabled', 'false', '0'].includes(mode)
  return envBoolean('PATENT_CORPUS_REALTIME_EMBEDDINGS', true)
}

const JOURNALS_PER_TICK = Math.max(0, envNumber('IPINDIA_JOURNAL_AUTO_WORKER_BATCH', 1))
const EMBEDDING_CLAIM_MAX = Math.max(1, envNumber('PATENT_CORPUS_AUTO_EMBEDDING_CLAIM_MAX', 256))
const REALTIME_EMBEDDINGS_ENABLED = realtimeEmbeddingsEnabled()
const EMBEDDINGS_PER_TICK = REALTIME_EMBEDDINGS_ENABLED
  ? Math.max(0, Math.min(envNumber('PATENT_CORPUS_AUTO_EMBEDDING_BATCH', 32), EMBEDDING_CLAIM_MAX))
  : 0
const PATENT_SEARCH_DEBUG = envBoolean('PATENT_SEARCH_DEBUG', false)

function logRunnerEvent(level: 'info' | 'warn' | 'error', event: string, details: Record<string, unknown> = {}) {
  console[level](`[PatentCorpusWorker] ${JSON.stringify({ event, ...details })}`)
}

function getMutableState(): PatentCorpusRunnerState {
  const globalStore = globalThis as any
  if (!globalStore[STATE_KEY]) {
    globalStore[STATE_KEY] = {
      enabled: AUTO_RUNNER_ENABLED,
      active: false,
      workerId: null,
      lastReason: null,
      lastStartedAt: null,
      lastRunAt: null,
      lastStoppedAt: null,
      lastError: null,
      processedJournalFiles: 0,
      processedFiles: 0,
      processedEmbeddings: 0,
    } satisfies PatentCorpusRunnerState
  }
  globalStore[STATE_KEY].enabled = AUTO_RUNNER_ENABLED
  return globalStore[STATE_KEY]
}

export function getPatentCorpusRunnerState(): PatentCorpusRunnerState {
  return { ...getMutableState() }
}

async function runPatentCorpusQueue(state: PatentCorpusRunnerState) {
  const workerId = state.workerId || `patent-corpus-auto-${process.pid}`

  try {
    while (state.active) {
      const processedJournals = JOURNALS_PER_TICK > 0
        ? await processPendingIpIndiaJournalArchive(workerId, JOURNALS_PER_TICK)
        : []
      const journalCount = processedJournals.filter(Boolean).length
      state.processedJournalFiles += journalCount

      const processedFiles = await processPendingPatentImportFiles(workerId, 1)
      const fileCount = processedFiles.filter(Boolean).length
      state.processedFiles += fileCount

      let embeddingCount = 0
      if (EMBEDDINGS_PER_TICK > 0 && hasCorpusEmbeddingApiKey()) {
        const processedEmbeddings = await processPendingPatentEmbeddings(workerId, EMBEDDINGS_PER_TICK)
        embeddingCount = processedEmbeddings.filter(Boolean).length
        state.processedEmbeddings += embeddingCount
        if (embeddingCount > 0) {
          const completed = processedEmbeddings.filter((embedding: any) => embedding?.status === 'COMPLETED').length
          const failedRows = processedEmbeddings.filter((embedding: any) => embedding?.status === 'FAILED')
          logRunnerEvent(failedRows.length ? 'warn' : 'info', 'embedding_batch_processed', {
            workerId,
            processed: embeddingCount,
            completed,
            failed: failedRows.length,
            failedSamples: failedRows.slice(0, 3).map((embedding: any) => ({
              id: embedding.id,
              attemptCount: embedding.attemptCount,
              errorMessage: String(embedding.errorMessage || '').slice(0, 500),
              nextAttemptAt: embedding.nextAttemptAt,
            })),
          })
        }
      }

      state.lastRunAt = new Date().toISOString()
      state.lastError = null

      if (journalCount === 0 && fileCount === 0 && embeddingCount === 0) {
        const [nextPatentAttemptAt, nextJournalAttemptAt] = await Promise.all([
          getNextPatentCorpusQueueAttemptAt(),
          getNextIpIndiaJournalQueueAttemptAt(),
        ])
        const nextAttemptAt = [nextPatentAttemptAt, nextJournalAttemptAt]
          .filter((value): value is Date => value instanceof Date)
          .sort((a, b) => a.getTime() - b.getTime())[0] || null
        if (nextAttemptAt) {
          const delay = Math.min(MAX_WAKE_DELAY_MS, Math.max(1000, nextAttemptAt.getTime() - Date.now()))
          setTimeout(() => {
            if (!getMutableState().active && AUTO_RUNNER_ENABLED) {
              kickPatentCorpusRunner('scheduled-retry')
            }
          }, delay).unref?.()
        }
        state.active = false
        state.lastStoppedAt = new Date().toISOString()
        state.workerId = null
        if (PATENT_SEARCH_DEBUG) {
          logRunnerEvent('info', 'runner_idle', {
            workerId,
            nextAttemptAt: nextAttemptAt?.toISOString() || null,
            processedJournalFiles: state.processedJournalFiles,
            processedFiles: state.processedFiles,
            processedEmbeddings: state.processedEmbeddings,
          })
        }
        return
      }
    }
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error)
    logRunnerEvent('error', 'runner_failed', {
      workerId,
      errorName: error instanceof Error ? error.name : undefined,
      errorMessage: state.lastError,
    })
    setTimeout(() => {
      if (!state.active && AUTO_RUNNER_ENABLED) {
        kickPatentCorpusRunner('error-retry')
      }
    }, ERROR_BACKOFF_MS).unref?.()
  } finally {
    if (state.active && state.lastError) {
      state.active = false
      state.lastStoppedAt = new Date().toISOString()
      state.workerId = null
    }
  }
}

export function kickPatentCorpusRunner(reason = 'manual') {
  const state = getMutableState()
  if (!AUTO_RUNNER_ENABLED) return getPatentCorpusRunnerState()
  if (state.active) {
    state.lastReason = reason
    return getPatentCorpusRunnerState()
  }

  state.active = true
  state.workerId = `patent-corpus-auto-${process.pid}-${Date.now()}`
  state.lastReason = reason
  state.lastStartedAt = new Date().toISOString()
  state.lastStoppedAt = null
  state.lastError = null

  logRunnerEvent('info', 'runner_started', {
    workerId: state.workerId,
    reason,
    autoRunnerEnabled: AUTO_RUNNER_ENABLED,
    realtimeEmbeddingsEnabled: REALTIME_EMBEDDINGS_ENABLED,
    embeddingsPerTick: EMBEDDINGS_PER_TICK,
    hasOpenAIKey: hasCorpusEmbeddingApiKey(),
    hasDedicatedCorpusOpenAIKey: Boolean(process.env.OPENAI_CORPUS_API_KEY),
  })
  if (!hasCorpusEmbeddingApiKey()) {
    logRunnerEvent('warn', 'embedding_processing_disabled', {
      workerId: state.workerId,
      reason: 'missing_corpus_openai_api_key',
    })
  } else if (EMBEDDINGS_PER_TICK === 0) {
    logRunnerEvent('warn', 'embedding_processing_disabled', {
      workerId: state.workerId,
      reason: REALTIME_EMBEDDINGS_ENABLED ? 'zero_batch_size' : 'embedding_mode_disabled',
    })
  }

  void runPatentCorpusQueue(state)
  return getPatentCorpusRunnerState()
}
