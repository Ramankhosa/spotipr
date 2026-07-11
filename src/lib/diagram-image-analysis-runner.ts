import {
  getNextDiagramImageAnalysisAttemptAt,
  processPendingDiagramImageAnalysisJobs,
} from '@/lib/diagram-image-analysis-job-service'

type DiagramImageAnalysisRunnerState = {
  enabled: boolean
  active: boolean
  workerId: string | null
  lastReason: string | null
  lastStartedAt: string | null
  lastRunAt: string | null
  lastStoppedAt: string | null
  lastError: string | null
  processedJobs: number
}

const STATE_KEY = '__diagramImageAnalysisAutoRunner'
const AUTO_RUNNER_ENABLED = process.env.DIAGRAM_IMAGE_ANALYSIS_AUTO_WORKER !== 'false'
const ERROR_BACKOFF_MS = 10_000
const MAX_WAKE_DELAY_MS = 60 * 60 * 1000

function envNumber(name: string, fallback: number) {
  const value = process.env[name]
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const JOBS_PER_TICK = Math.max(1, envNumber('DIAGRAM_IMAGE_ANALYSIS_AUTO_WORKER_BATCH', 1))

function getMutableState(): DiagramImageAnalysisRunnerState {
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
      processedJobs: 0,
    } satisfies DiagramImageAnalysisRunnerState
  }
  globalStore[STATE_KEY].enabled = AUTO_RUNNER_ENABLED
  return globalStore[STATE_KEY]
}

export function getDiagramImageAnalysisRunnerState(): DiagramImageAnalysisRunnerState {
  return { ...getMutableState() }
}

async function runDiagramImageAnalysisQueue(state: DiagramImageAnalysisRunnerState) {
  const workerId = state.workerId || `diagram-image-analysis-auto-${process.pid}`
  try {
    while (state.active) {
      const processed = await processPendingDiagramImageAnalysisJobs(workerId, JOBS_PER_TICK)
      const count = processed.filter(Boolean).length
      state.processedJobs += count
      state.lastRunAt = new Date().toISOString()
      state.lastError = null

      if (count === 0) {
        const nextAttemptAt = await getNextDiagramImageAnalysisAttemptAt()
        if (nextAttemptAt) {
          const delay = Math.min(MAX_WAKE_DELAY_MS, Math.max(1000, nextAttemptAt.getTime() - Date.now()))
          setTimeout(() => {
            if (!getMutableState().active && AUTO_RUNNER_ENABLED) {
              kickDiagramImageAnalysisRunner('scheduled-retry')
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
    console.error('[DiagramImageAnalysisWorker] Runner failed:', error)
    setTimeout(() => {
      if (!state.active && AUTO_RUNNER_ENABLED) {
        kickDiagramImageAnalysisRunner('error-retry')
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

export function kickDiagramImageAnalysisRunner(reason = 'manual') {
  const state = getMutableState()
  if (!AUTO_RUNNER_ENABLED) return getDiagramImageAnalysisRunnerState()
  if (state.active) {
    state.lastReason = reason
    return getDiagramImageAnalysisRunnerState()
  }

  state.active = true
  state.workerId = `diagram-image-analysis-auto-${process.pid}-${Date.now()}`
  state.lastReason = reason
  state.lastStartedAt = new Date().toISOString()
  state.lastStoppedAt = null
  state.lastError = null

  void runDiagramImageAnalysisQueue(state)
  return getDiagramImageAnalysisRunnerState()
}
