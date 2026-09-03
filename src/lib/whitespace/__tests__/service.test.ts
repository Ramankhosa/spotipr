/**
 * Run-orchestration guards.
 *
 * resolveStaleRun acts on a SNAPSHOT: by the time it decides a run is dead, the
 * run may have completed, failed, or been reclaimed by a live worker. Its write
 * must therefore be fenced, never blind — a blind update flipped just-COMPLETED
 * runs back to QUEUED (double execution, double model spend) or to FAILED
 * (results buried). And the dedupe must respect the scope version: after a
 * scope edit, "run" silently attached the user to the OLD scope's run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WhitespaceScope } from '../types'

const HOUR = 60 * 60 * 1000

function staleProcessingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    studyId: 'study-1',
    stage: 'FIELD_MAP',
    status: 'PROCESSING',
    createdAt: new Date(Date.now() - 2 * HOUR),
    heartbeatAt: new Date(Date.now() - HOUR),
    lockedUntil: new Date(Date.now() - HOUR),
    attemptCount: 1,
    maxAttempts: 3,
    params: null,
    scopeVersion: 3,
    ...overrides,
  }
}

function runnableScope(): WhitespaceScope {
  return {
    title: 'Solar drying',
    summary: '',
    concepts: [{ id: 'c1', label: 'solar dryer', synonyms: [], required: true, origin: 'user' }],
    classifications: [],
    exclusions: [],
    assumptions: [],
    filters: { yearFrom: 2000, yearTo: 2026, jurisdictions: [], assignees: [] },
  }
}

const prismaMock = {
  whitespaceRun: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  whitespaceHypothesis: { updateMany: vi.fn() },
  whitespaceTrailEntry: { create: vi.fn() },
  $queryRaw: vi.fn(),
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  // Benign defaults so the background inline drain (kicked by a run start)
  // settles quietly: no dead runs to sweep, nothing to claim.
  prismaMock.whitespaceRun.findMany.mockResolvedValue([])
  prismaMock.whitespaceRun.findUnique.mockResolvedValue(null)
  prismaMock.whitespaceRun.updateMany.mockResolvedValue({ count: 0 })
  prismaMock.whitespaceRun.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'run-new',
    ...data,
  }))
  prismaMock.whitespaceHypothesis.updateMany.mockResolvedValue({ count: 0 })
  prismaMock.whitespaceTrailEntry.create.mockResolvedValue({})
  prismaMock.$queryRaw.mockResolvedValue([])
  vi.doMock('@/lib/prisma', () => ({ prisma: prismaMock }))
})

afterEach(() => {
  vi.doUnmock('@/lib/prisma')
})

describe('resolveStaleRun', () => {
  it('fences the write on current state and yields to whatever the row became', async () => {
    const row = staleProcessingRow()
    prismaMock.whitespaceRun.updateMany.mockResolvedValue({ count: 0 })
    prismaMock.whitespaceRun.findUnique.mockResolvedValue({ ...row, status: 'COMPLETED', lockedUntil: null })

    const { resolveStaleRun } = await import('../service')
    const resolved = await resolveStaleRun(row)

    expect(prismaMock.whitespaceRun.updateMany).toHaveBeenCalledTimes(1)
    const where = prismaMock.whitespaceRun.updateMany.mock.calls[0][0].where
    expect(where).toMatchObject({ id: 'run-1', status: 'PROCESSING' })
    expect(where.OR).toBeTruthy()
    // The completed run stays completed — nothing was overwritten.
    expect(resolved.status).toBe('COMPLETED')
    expect(prismaMock.whitespaceTrailEntry.create).not.toHaveBeenCalled()
    expect(prismaMock.whitespaceHypothesis.updateMany).not.toHaveBeenCalled()
  })

  it('requeues a stale run that still has attempts left', async () => {
    const row = staleProcessingRow({ attemptCount: 1, maxAttempts: 3 })
    prismaMock.whitespaceRun.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.whitespaceRun.findUnique.mockResolvedValue({ ...row, status: 'QUEUED', lockedUntil: null })

    const { resolveStaleRun } = await import('../service')
    const resolved = await resolveStaleRun(row)

    expect(prismaMock.whitespaceRun.updateMany.mock.calls[0][0].data.status).toBe('QUEUED')
    expect(resolved.status).toBe('QUEUED')
    // A pending retry is still testing — nothing to finalize yet.
    expect(prismaMock.whitespaceTrailEntry.create).not.toHaveBeenCalled()
  })

  it('finalizes a spent VALIDATE run: releases its hypothesis and writes the trail entry', async () => {
    const row = staleProcessingRow({
      stage: 'VALIDATE',
      attemptCount: 3,
      maxAttempts: 3,
      params: { hypothesisId: 'hyp-1' },
    })
    prismaMock.whitespaceRun.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.whitespaceRun.findUnique.mockResolvedValue({ ...row, status: 'FAILED', lockedUntil: null })

    const { resolveStaleRun } = await import('../service')
    const resolved = await resolveStaleRun(row)

    expect(prismaMock.whitespaceRun.updateMany.mock.calls[0][0].data.status).toBe('FAILED')
    expect(resolved.status).toBe('FAILED')
    expect(prismaMock.whitespaceHypothesis.updateMany).toHaveBeenCalledWith({
      where: { id: 'hyp-1', studyId: 'study-1', status: 'VALIDATING' },
      data: { status: 'INCONCLUSIVE' },
    })
    expect(prismaMock.whitespaceTrailEntry.create).toHaveBeenCalledTimes(1)
  })
})

describe('startWhitespaceRun dedupe', () => {
  it('attaches to a live run only when the scope version matches too', async () => {
    const live = staleProcessingRow({ status: 'QUEUED', scopeVersion: 3, params: null })
    prismaMock.whitespaceRun.findMany.mockImplementation(async (args: { where: Record<string, unknown> }) =>
      args.where.stage ? [live] : []
    )

    const { startWhitespaceRun } = await import('../service')

    const sameVersion = await startWhitespaceRun({
      studyId: 'study-1',
      stage: 'FIELD_MAP',
      scope: runnableScope(),
      scopeVersion: 3,
      requestHeaders: {},
    })
    expect(sameVersion).toEqual({ runId: 'run-1', existing: true })
    expect(prismaMock.whitespaceRun.create).not.toHaveBeenCalled()

    // The scope was edited since that run was queued: same stage, same params,
    // but the old-scope run is different work — a new run must start.
    const editedVersion = await startWhitespaceRun({
      studyId: 'study-1',
      stage: 'FIELD_MAP',
      scope: runnableScope(),
      scopeVersion: 4,
      requestHeaders: {},
    })
    expect(editedVersion.existing).toBe(false)
    expect(prismaMock.whitespaceRun.create).toHaveBeenCalledTimes(1)
  })
})

describe('recordRunFailure', () => {
  function claimedRun(overrides: Record<string, unknown> = {}) {
    return {
      id: 'run-1',
      studyId: 'study-1',
      stage: 'DIMENSION_MAP',
      scopeSnapshot: {},
      params: null,
      attemptCount: 1,
      maxAttempts: 3,
      ...overrides,
    }
  }

  it('is fenced on the lease: when another worker holds the run, nothing is recorded', async () => {
    prismaMock.whitespaceRun.updateMany.mockResolvedValue({ count: 0 })
    const { recordRunFailure } = await import('../service')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await recordRunFailure(claimedRun({ attemptCount: 3 }), new Error('LLM gateway 502'), 'worker-a')

    const call = prismaMock.whitespaceRun.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'run-1', lockedBy: 'worker-a', status: 'PROCESSING' })
    expect(prismaMock.whitespaceRun.update).not.toHaveBeenCalled()
    expect(prismaMock.whitespaceTrailEntry.create).not.toHaveBeenCalled()
    expect(prismaMock.whitespaceHypothesis.updateMany).not.toHaveBeenCalled()
    consoleError.mockRestore()
    consoleWarn.mockRestore()
  })

  it('requeues a transient failure with backoff while attempts remain', async () => {
    prismaMock.whitespaceRun.updateMany.mockResolvedValue({ count: 1 })
    const { recordRunFailure } = await import('../service')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await recordRunFailure(claimedRun({ attemptCount: 1 }), new Error('Connection terminated'), 'worker-a')

    const data = prismaMock.whitespaceRun.updateMany.mock.calls[0][0].data
    expect(data.status).toBe('QUEUED')
    expect(data.lastError).toBe('Connection terminated')
    expect(data.nextAttemptAt.getTime()).toBeGreaterThan(Date.now())
    expect(prismaMock.whitespaceTrailEntry.create).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('finalizes a spent failure: FAILED, trail entry, hypothesis released', async () => {
    prismaMock.whitespaceRun.updateMany.mockResolvedValue({ count: 1 })
    const { recordRunFailure } = await import('../service')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await recordRunFailure(
      claimedRun({ stage: 'VALIDATE', attemptCount: 3, params: { hypothesisId: 'hyp-1' } }),
      new Error('Connection terminated'),
      'worker-a'
    )

    expect(prismaMock.whitespaceRun.updateMany.mock.calls[0][0].data.status).toBe('FAILED')
    expect(prismaMock.whitespaceHypothesis.updateMany).toHaveBeenCalledWith({
      where: { id: 'hyp-1', studyId: 'study-1', status: 'VALIDATING' },
      data: { status: 'INCONCLUSIVE' },
    })
    expect(prismaMock.whitespaceTrailEntry.create).toHaveBeenCalledTimes(1)
    consoleError.mockRestore()
  })
})

describe('runPayload', () => {
  it('exposes attempt, retry timing, heartbeat and a server clock, and measures elapsed from the attempt start', async () => {
    const { runPayload } = await import('../service')
    const startedAt = Date.now() - 62_000
    const payload = runPayload({
      id: 'run-1',
      stage: 'DIMENSION_MAP',
      status: 'PROCESSING',
      results: { hidden: true },
      gateCounts: null,
      progress: { phase: 'discover', detail: 'Round 1', v: 2, startedAt },
      lastError: null,
      durationMs: null,
      createdAt: new Date(Date.now() - 10 * 60_000),
      completedAt: null,
      attemptCount: 2,
      maxAttempts: 3,
      nextAttemptAt: new Date(Date.now() - 60_000),
      heartbeatAt: new Date(Date.now() - 1_500),
    })
    expect(payload.results).toBeNull()
    expect(payload.progress).toMatchObject({ phase: 'discover', v: 2 })
    expect(payload.attempt).toBe(2)
    expect(payload.maxAttempts).toBe(3)
    expect(typeof payload.serverNow).toBe('string')
    expect(typeof payload.heartbeatAt).toBe('string')
    // From the attempt's own start, not the row's creation ten minutes ago.
    expect(payload.elapsedMs).toBeGreaterThanOrEqual(62_000)
    expect(payload.elapsedMs).toBeLessThan(70_000)
  })

  it('hides narration and elapsed for a run that is not processing, but keeps the retry info', async () => {
    const { runPayload } = await import('../service')
    const next = new Date(Date.now() + 30_000)
    const payload = runPayload({
      id: 'run-1',
      stage: 'FIELD_MAP',
      status: 'QUEUED',
      results: null,
      gateCounts: null,
      progress: { phase: 'stale', detail: 'from the last attempt' },
      lastError: 'The worker stopped',
      durationMs: null,
      createdAt: new Date(),
      completedAt: null,
      attemptCount: 1,
      maxAttempts: 3,
      nextAttemptAt: next,
      heartbeatAt: new Date(),
    })
    expect(payload.progress).toBeNull()
    expect(payload.elapsedMs).toBeNull()
    expect(payload.nextAttemptAt).toBe(next.toISOString())
    expect(payload.error).toBe('The worker stopped')
  })
})

describe('resolveStaleRun requeue', () => {
  it('kicks the inline drain so a retry does not sit in the queue with nobody coming back for it', async () => {
    const row = staleProcessingRow({ attemptCount: 1, maxAttempts: 3 })
    prismaMock.whitespaceRun.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.whitespaceRun.findUnique.mockResolvedValue({ ...row, status: 'QUEUED', lockedUntil: null })

    const { resolveStaleRun } = await import('../service')
    await resolveStaleRun(row)
    // The drain runs on a zero-delay timer: sweep (findMany), then a claim ($queryRaw).
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(prismaMock.$queryRaw).toHaveBeenCalled()
  })
})
