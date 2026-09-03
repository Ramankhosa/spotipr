/**
 * The activity reducer is pure so the panel's honesty rules can be pinned
 * without a DOM: server state is copied not inferred, events dedupe by seq,
 * a retry restarts the sequence behind a divider, and settling never turns
 * a skipped step into a done one.
 */
import { describe, expect, it } from 'vitest'
import { runActivityReducer, type RunActivityMap } from '../useRunActivity'
import type { RunPayload, RunProgress } from '../api'

function v2(overrides: Partial<RunProgress> = {}): RunProgress {
  return {
    phase: 'discover',
    detail: 'Round 1',
    v: 2,
    stage: 'DIMENSION_MAP',
    attempt: 1,
    steps: [
      { key: 'precheck', label: 'Sizing the field', state: 'done' },
      { key: 'discover', label: 'Discovering the viewpoints', state: 'active', n: 1, total: 3 },
      { key: 'census', label: 'Counting every value across the field', state: 'pending' },
    ],
    counters: [{ key: 'families', label: 'Families', value: 462 }],
    recent: [],
    seq: 0,
    startedAt: 1_000,
    updatedAt: 2_000,
    ...overrides,
  }
}

function events(from: number, to: number) {
  return Array.from({ length: to - from + 1 }, (_, i) => ({ seq: from + i, t: 0, kind: 'read' as const, text: `e${from + i}` }))
}

function tick(state: RunActivityMap, payload: Partial<RunPayload> & { status?: string }, now = 10): RunActivityMap {
  return runActivityReducer(state, {
    type: 'tick',
    runId: 'run-1',
    payload: { status: 'PROCESSING', results: null, progress: null, error: null, ...payload },
    now,
    wall: 5_000,
  })
}

describe('runActivityReducer — copying server state', () => {
  it('copies v2 steps and counters wholesale and tracks the active key', () => {
    const state = tick({}, { progress: v2(), attempt: 1, serverNow: '2026-09-02T10:41:20Z', heartbeatAt: '2026-09-02T10:41:19Z', elapsedMs: 62_000 })
    const entry = state['run-1']
    expect(entry.steps.map(step => step.state)).toEqual(['done', 'active', 'pending'])
    expect(entry.counters[0].value).toBe(462)
    expect(entry.activeKey).toBe('discover')
    expect(entry.attempt).toBe(1)
    expect(entry.elapsedMs).toBe(62_000)
    expect(entry.serverNow).toBe(Date.parse('2026-09-02T10:41:20Z'))
    expect(entry.v1).toBe(false)
  })

  it('synthesises a single active step from a v1 payload, and treats v1 "done" as settling', () => {
    let state = tick({}, { progress: { phase: 'census', detail: 'Counting 7 values' } })
    expect(state['run-1'].v1).toBe(true)
    expect(state['run-1'].steps).toEqual([{ key: 'census', label: 'Counting 7 values', state: 'active' }])
    state = tick(state, { progress: { phase: 'done', detail: '3 viewpoints' } })
    // The rail is kept; no step named "done" appears.
    expect(state['run-1'].steps.map(step => step.key)).toEqual(['census'])
  })

  it('a QUEUED tick with no narration records status and retry info without inventing steps', () => {
    const state = tick({}, { status: 'QUEUED', attempt: 1, maxAttempts: 3, nextAttemptAt: '2026-09-02T11:03:00Z', error: 'The worker stopped' })
    const entry = state['run-1']
    expect(entry.status).toBe('QUEUED')
    expect(entry.steps).toEqual([])
    expect(entry.nextAttemptAt).toBe(Date.parse('2026-09-02T11:03:00Z'))
    expect(entry.error).toBe('The worker stopped')
  })
})

describe('runActivityReducer — events', () => {
  it('dedupes overlapping windows by seq and appends only what is new', () => {
    let state = tick({}, { progress: v2({ recent: events(1, 20), seq: 20 }) })
    state = tick(state, { progress: v2({ recent: events(15, 34), seq: 34 }) })
    const entry = state['run-1']
    expect(entry.pending.map(event => event.seq)).toEqual(Array.from({ length: 34 }, (_, i) => i + 1))
    expect(entry.lastSeq).toBe(34)
    expect(entry.skipped).toBe(0)
  })

  it('counts a gap as skipped instead of hiding it', () => {
    let state = tick({}, { progress: v2({ recent: events(1, 20), seq: 20 }) })
    state = tick(state, { progress: v2({ recent: events(41, 60), seq: 60 }) })
    expect(state['run-1'].skipped).toBe(20)
    expect(state['run-1'].lastSeq).toBe(60)
  })

  it('drips one event at a time, two when far behind, and everything on demand', () => {
    let state = tick({}, { progress: v2({ recent: events(1, 20), seq: 20 }) })
    state = runActivityReducer(state, { type: 'drip', runId: 'run-1' })
    expect(state['run-1'].feed).toHaveLength(2) // > 12 pending → two at a time
    expect(state['run-1'].pending).toHaveLength(18)
    state = tick(state, { progress: v2({ recent: events(1, 20), seq: 20 }) }) // same window: nothing new
    expect(state['run-1'].pending).toHaveLength(18)
    // 18 → 16 → 14 → 12 (two at a time while far behind), then 12 → 11 (one).
    for (let i = 0; i < 4; i++) state = runActivityReducer(state, { type: 'drip', runId: 'run-1' })
    expect(state['run-1'].pending).toHaveLength(11)
    state = runActivityReducer(state, { type: 'drip', runId: 'run-1' })
    expect(state['run-1'].pending).toHaveLength(10) // ≤ 12 → one at a time
    state = runActivityReducer(state, { type: 'drip', runId: 'run-1', all: true })
    expect(state['run-1'].pending).toHaveLength(0)
    expect(state['run-1'].feed.map(event => event.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
  })

  it('caps the visible feed at 60, evicting the oldest', () => {
    let state = tick({}, { progress: v2({ recent: events(1, 20), seq: 20 }) })
    state = runActivityReducer(state, { type: 'drip', runId: 'run-1', all: true })
    for (const [from, to] of [[21, 40], [41, 60], [61, 80]]) {
      state = tick(state, { progress: v2({ recent: events(from, to), seq: to }) })
      state = runActivityReducer(state, { type: 'drip', runId: 'run-1', all: true })
    }
    const feed = state['run-1'].feed
    expect(feed).toHaveLength(60)
    expect(feed[0].seq).toBe(21)
    expect(feed[59].seq).toBe(80)
  })
})

describe('runActivityReducer — attempts and settling', () => {
  it('a new attempt inserts a divider carrying the old error, restarts the sequence, and keeps history', () => {
    let state = tick({}, { progress: v2({ attempt: 1, recent: events(1, 5), seq: 5 }), attempt: 1 })
    state = runActivityReducer(state, { type: 'drip', runId: 'run-1', all: true })
    state = tick(state, { status: 'QUEUED', attempt: 1, error: 'LLM gateway 502' })
    state = tick(state, { progress: v2({ attempt: 2, recent: events(1, 3), seq: 3 }), attempt: 2 })
    const entry = state['run-1']
    expect(entry.attempt).toBe(2)
    const divider = entry.feed.find(item => item.divider)
    expect(divider?.text).toBe('Attempt 1 stopped — LLM gateway 502')
    expect(entry.feed.filter(item => !item.divider).map(item => item.seq)).toEqual([1, 2, 3, 4, 5])
    // Attempt 2's seq 1..3 are NOT dropped as "already seen".
    expect(entry.pending.map(event => event.seq)).toEqual([1, 2, 3])
    expect(entry.lastSeq).toBe(3)
  })

  it('settling a completed run marks active steps done but never touches skipped or failed', () => {
    let state = tick({}, {
      progress: v2({
        steps: [
          { key: 'a', label: 'A', state: 'done' },
          { key: 'b', label: 'B', state: 'skipped', detail: 'not run' },
          { key: 'c', label: 'C', state: 'failed', detail: 'names unavailable' },
          { key: 'd', label: 'D', state: 'active' },
        ],
        recent: events(1, 2),
        seq: 2,
      }),
    })
    state = runActivityReducer(state, {
      type: 'settle',
      runId: 'run-1',
      payload: { status: 'COMPLETED', results: {}, progress: null, error: null },
      now: 99,
    })
    const entry = state['run-1']
    expect(entry.status).toBe('COMPLETED')
    expect(entry.steps.map(step => step.state)).toEqual(['done', 'skipped', 'failed', 'done'])
    expect(entry.pending).toHaveLength(0)
    expect(entry.feed).toHaveLength(2)
    expect(entry.settledAt).toBe(99)
  })

  it('settling a failed run keeps the rail and records the error', () => {
    let state = tick({}, { progress: v2() })
    state = runActivityReducer(state, {
      type: 'settle',
      runId: 'run-1',
      payload: { status: 'FAILED', results: null, progress: null, error: 'The census timed out.' },
      now: 99,
    })
    expect(state['run-1'].status).toBe('FAILED')
    expect(state['run-1'].error).toBe('The census timed out.')
    expect(state['run-1'].steps[1].state).toBe('active')
  })

  it('does not create an entry for a run that never produced a live tick', () => {
    const state = runActivityReducer({}, {
      type: 'settle',
      runId: 'run-1',
      payload: { status: 'FAILED', results: null, progress: null, error: 'old failure' },
      now: 1,
    })
    expect(state).toEqual({})
  })

  it('forget removes, reset clears, and a connection flag toggles only when it changes', () => {
    let state = tick({}, { progress: v2() })
    const same = runActivityReducer(state, { type: 'connection', runId: 'run-1', lost: false })
    expect(same).toBe(state)
    state = runActivityReducer(state, { type: 'connection', runId: 'run-1', lost: true })
    expect(state['run-1'].connectionLost).toBe(true)
    expect(runActivityReducer(state, { type: 'forget', runId: 'run-1' })).toEqual({})
    expect(runActivityReducer(state, { type: 'reset' })).toEqual({})
  })
})
