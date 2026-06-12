import {
  getNextPatentCorpusQueueAttemptAt,
  processPendingPatentEmbeddings,
  processPendingPatentImportFiles,
} from '@/lib/patent-corpus-service'

type PatentCorpusRunnerState = {
  enabled: boolean
  active: boolean
  workerId: string | null
  lastReason: string | null
  lastStartedAt: string | null
  lastRunAt: string | null
  lastStoppedAt: string | null
  lastError: string | null
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

const EMBEDDINGS_PER_TICK = Math.max(0, envNumber('PATENT_CORPUS_AUTO_EMBEDDING_BATCH', 4))

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
      const processedFiles = await processPendingPatentImportFiles(workerId, 1)
      const fileCount = processedFiles.filter(Boolean).length
      state.processedFiles += fileCount

      let embeddingCount = 0
      if (fileCount === 0 && EMBEDDINGS_PER_TICK > 0 && process.env.OPENAI_API_KEY) {
        const processedEmbeddings = await processPendingPatentEmbeddings(workerId, EMBEDDINGS_PER_TICK)
        embeddingCount = processedEmbeddings.filter(Boolean).length
        state.processedEmbeddings += embeddingCount
      }

      state.lastRunAt = new Date().toISOString()
      state.lastError = null

      if (fileCount === 0 && embeddingCount === 0) {
        const nextAttemptAt = await getNextPatentCorpusQueueAttemptAt()
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
        return
      }
    }
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error)
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

  void runPatentCorpusQueue(state)
  return getPatentCorpusRunnerState()
}
