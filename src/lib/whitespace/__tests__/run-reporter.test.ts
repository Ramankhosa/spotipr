/**
 * The run reporter's contract with the panel and the lease.
 *
 * Everything the panel shows comes from these writes, so the tests pin the
 * honesty rules (skipped is never done, null before measured, plain JSON)
 * and the safety rules (throttle, serialisation, lease loss is fatal and
 * surfaces from synchronous calls, nothing writes after close).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RunReporter, type HeartbeatWriter } from '../run-reporter'
import { isLeaseLost, WhitespaceLeaseLostError } from '../run-lease'
import type { WhitespaceRunProgress } from '../types'

function makeReporter(overrides: Partial<ConstructorParameters<typeof RunReporter>[0]> = {}) {
  const writes: WhitespaceRunProgress[] = []
  const heartbeat = vi.fn(async (_runId: string, _workerId: string, progress?: WhitespaceRunProgress) => {
    if (progress) writes.push(JSON.parse(JSON.stringify(progress)))
    return true
  })
  const reporter = new RunReporter({
    runId: 'run-1',
    workerId: 'worker-a',
    stage: 'DIMENSION_MAP',
    attempt: 1,
    heartbeat,
    ...overrides,
  })
  return { reporter, heartbeat, writes }
}

const PLAN = [
  { key: 'precheck', label: 'Sizing the field' },
  { key: 'sample', label: 'Drawing a sample of the field' },
  { key: 'discover', label: 'Discovering the viewpoints' },
  { key: 'census', label: 'Counting every value across the field' },
]

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-02T10:40:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('RunReporter — declaring and moving through steps', () => {
  it('plan() writes once with every step pending and the v1 fields present', async () => {
    const { reporter, writes } = makeReporter()
    await reporter.plan(PLAN, [{ key: 'families', label: 'Families in the field' }])

    expect(writes).toHaveLength(1)
    const snapshot = writes[0]
    expect(snapshot.v).toBe(2)
    expect(snapshot.stage).toBe('DIMENSION_MAP')
    expect(snapshot.attempt).toBe(1)
    expect(snapshot.steps?.every(step => step.state === 'pending')).toBe(true)
    expect(snapshot.phase).toBe('precheck')
    expect(snapshot.detail).toBe('Sizing the field')
    // Null before measured — never a fabricated zero.
    expect(snapshot.counters?.[0]).toEqual({ key: 'families', label: 'Families in the field', value: null })
    expect(typeof snapshot.startedAt).toBe('number')
    await reporter.close()
  })

  it('a key change writes immediately; the same key again only updates detail and is throttled', async () => {
    const { reporter, writes } = makeReporter()
    await reporter.plan(PLAN)
    await reporter.step('precheck', 'Sizing the field')
    expect(writes).toHaveLength(2)
    expect(writes[1].steps?.[0].state).toBe('active')

    await reporter.step('precheck', 'Still sizing', { n: 2, total: 5 })
    // Same key: no immediate write.
    expect(writes).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1_500)
    expect(writes).toHaveLength(3)
    expect(writes[2].steps?.[0]).toMatchObject({ state: 'active', detail: 'Still sizing', n: 2, total: 5 })
    expect(writes[2].phase).toBe('precheck')
    expect(writes[2].detail).toBe('Still sizing')
    await reporter.close()
  })

  it('stepping past a pending step marks it SKIPPED, never done', async () => {
    const { reporter, writes } = makeReporter()
    await reporter.plan(PLAN)
    await reporter.step('precheck')
    await reporter.step('discover', 'Round 1', { round: 1 })

    const last = writes[writes.length - 1]
    expect(last.steps?.map(step => step.state)).toEqual(['done', 'skipped', 'active', 'pending'])
    expect(last.steps?.[1].detail).toBe('not run')
    expect(last.round).toBe(1)
    await reporter.close()
  })

  it('skip() and fail() record the reason and write immediately', async () => {
    const { reporter, writes } = makeReporter()
    await reporter.plan(PLAN)
    await reporter.step('precheck')
    await reporter.skip('sample', 'no readable claims')
    await reporter.fail('discover', 'names unavailable — areas keep their numbers')

    const last = writes[writes.length - 1]
    expect(last.steps?.[1]).toMatchObject({ state: 'skipped', detail: 'no readable claims' })
    expect(last.steps?.[2]).toMatchObject({ state: 'failed', detail: 'names unavailable — areas keep their numbers' })
    await reporter.close()
  })

  it('done() marks the active step done without writing', async () => {
    const { reporter, writes } = makeReporter()
    await reporter.plan(PLAN)
    await reporter.step('census')
    const before = writes.length
    reporter.done()
    expect(writes).toHaveLength(before)
    expect(reporter.snapshot().steps?.[3].state).toBe('done')
    await reporter.close()
  })
})

describe('RunReporter — counters and events', () => {
  it('throttles a burst of events into one write carrying all of them, with monotonic seq', async () => {
    const { reporter, writes } = makeReporter()
    await reporter.plan(PLAN)
    for (let i = 1; i <= 5; i++) reporter.event('read', `IN${i} — title ${i}`)
    expect(writes).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1_500)
    expect(writes).toHaveLength(2)
    expect(writes[1].recent?.map(event => event.seq)).toEqual([1, 2, 3, 4, 5])
    expect(writes[1].seq).toBe(5)
    await reporter.close()
  })

  it('keeps only the newest 20 events but the seq keeps counting', async () => {
    const { reporter, writes } = makeReporter()
    await reporter.plan(PLAN)
    for (let i = 1; i <= 25; i++) reporter.event('count', `event ${i}`)
    await vi.advanceTimersByTimeAsync(1_500)
    const last = writes[writes.length - 1]
    expect(last.recent).toHaveLength(20)
    expect(last.recent?.[0].seq).toBe(6)
    expect(last.recent?.[19].seq).toBe(25)
    expect(last.seq).toBe(25)
    await reporter.close()
  })

  it('upserts counters by key, keeps the planned label, and treats a non-finite value as unmeasured', async () => {
    const { reporter } = makeReporter()
    await reporter.plan(PLAN, [{ key: 'matched', label: 'Values counted', total: 7 }])
    reporter.count('matched', 3)
    reporter.count('matched', 4, 7)
    reporter.count('gaps', Number.NaN, undefined, 'Candidate gaps')
    const snapshot = reporter.snapshot()
    expect(snapshot.counters).toEqual([
      { key: 'matched', label: 'Values counted', value: 4, total: 7 },
      { key: 'gaps', label: 'Candidate gaps', value: null },
    ])
    await reporter.close()
  })

  it('collapses whitespace and caps event text at 160 characters', async () => {
    const { reporter } = makeReporter()
    await reporter.plan(PLAN)
    reporter.event('note', `  padded\n\n  text   ${'x'.repeat(300)}`)
    const text = reporter.snapshot().recent?.[0].text ?? ''
    expect(text.startsWith('padded text x')).toBe(true)
    expect(text.length).toBe(160)
    expect(text.endsWith('…')).toBe(true)
    await reporter.close()
  })

  it('produces plain JSON — the snapshot survives a round trip unchanged', async () => {
    const { reporter } = makeReporter()
    await reporter.plan(PLAN, [{ key: 'families', label: 'Families' }])
    await reporter.step('discover', 'Round 1', { round: 1, n: 1, total: 3 })
    reporter.count('families', 462)
    reporter.event('read', 'IN1 — title')
    const snapshot = reporter.snapshot()
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
    await reporter.close()
  })
})

describe('RunReporter — writes, backoff, keepalive', () => {
  it('serialises writes: a step change during an in-flight write waits for it', async () => {
    let release: (() => void) | null = null
    const calls: string[] = []
    const heartbeat: HeartbeatWriter = vi.fn(async (_r, _w, progress) => {
      calls.push(progress?.phase ?? '')
      if (calls.length === 1) await new Promise<void>(resolve => (release = resolve))
      return true
    })
    const { reporter } = makeReporter({ heartbeat })
    const first = reporter.plan(PLAN)
    const second = reporter.step('precheck')
    await Promise.resolve()
    expect(calls).toEqual(['precheck'])
    release!()
    await first
    await second
    expect(calls).toHaveLength(2)
    await reporter.close()
  })

  it('backs off after a blipped write and counts it, then recovers', async () => {
    const results = [true, false, false, true]
    const heartbeat: HeartbeatWriter = vi.fn(async () => results.shift() ?? true)
    const { reporter } = makeReporter({ heartbeat })
    await reporter.plan(PLAN) // true
    reporter.event('note', 'a')
    await vi.advanceTimersByTimeAsync(1_500) // false → backoff 3 s
    expect(heartbeat).toHaveBeenCalledTimes(2)
    reporter.event('note', 'b')
    await vi.advanceTimersByTimeAsync(1_500)
    expect(heartbeat).toHaveBeenCalledTimes(2) // not yet — backing off
    await vi.advanceTimersByTimeAsync(1_500) // 3 s reached → false → backoff 6 s
    expect(heartbeat).toHaveBeenCalledTimes(3)
    expect(reporter.snapshot().writeFailures).toBe(2)
    reporter.event('note', 'c')
    await vi.advanceTimersByTimeAsync(6_000) // true → backoff resets
    expect(heartbeat).toHaveBeenCalledTimes(4)
    await reporter.close()
  })

  it('keeps the lease alive while idle: a keepalive write fires with nothing dirty', async () => {
    const { reporter, heartbeat } = makeReporter({ keepaliveMs: 30_000 })
    await reporter.plan(PLAN)
    expect(heartbeat).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(heartbeat).toHaveBeenCalledTimes(2)
    await reporter.close()
  })

  it('an awaited heartbeat() always writes, extending the lease', async () => {
    const { reporter, heartbeat } = makeReporter()
    await reporter.plan(PLAN)
    await reporter.heartbeat()
    await reporter.heartbeat()
    expect(heartbeat).toHaveBeenCalledTimes(3)
    await reporter.close()
  })
})

describe('RunReporter — lease loss and close', () => {
  it('an awaited step() rejects with lease-lost when the fence misses', async () => {
    const heartbeat: HeartbeatWriter = vi.fn(async () => {
      throw new WhitespaceLeaseLostError('run-1')
    })
    const { reporter } = makeReporter({ heartbeat })
    await expect(reporter.plan(PLAN)).rejects.toSatisfy(isLeaseLost)
    expect(isLeaseLost(reporter.fatal)).toBe(true)
  })

  it('a timer flush that loses the lease is stored as fatal, never an unhandled rejection, and surfaces from the next SYNCHRONOUS call', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      let calls = 0
      const heartbeat: HeartbeatWriter = vi.fn(async () => {
        calls += 1
        if (calls >= 2) throw new WhitespaceLeaseLostError('run-1')
        return true
      })
      const { reporter } = makeReporter({ heartbeat })
      await reporter.plan(PLAN)
      reporter.event('read', 'IN1 — title')
      await vi.advanceTimersByTimeAsync(1_500)
      expect(isLeaseLost(reporter.fatal)).toBe(true)
      expect(() => reporter.count('families', 1)).toThrow()
      expect(() => reporter.event('note', 'x')).toThrow()
      await expect(reporter.heartbeat()).rejects.toSatisfy(isLeaseLost)
      // No further writes are attempted once fatal.
      expect(heartbeat).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(heartbeat).toHaveBeenCalledTimes(2)
      await Promise.resolve()
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('close() cancels pending writes, waits for one in flight, and makes later calls no-ops', async () => {
    let release: (() => void) | null = null
    let calls = 0
    const heartbeat: HeartbeatWriter = vi.fn(async () => {
      calls += 1
      // The second write (the step change) is the one held in flight.
      if (calls === 2) await new Promise<void>(resolve => (release = resolve))
      return true
    })
    const { reporter } = makeReporter({ heartbeat })
    await reporter.plan(PLAN)
    const stepping = reporter.step('precheck')
    await Promise.resolve()
    reporter.event('note', 'buffered')
    const closing = reporter.close()
    release!()
    await stepping
    await closing
    expect(reporter.isClosed).toBe(true)
    const writesAtClose = (heartbeat as ReturnType<typeof vi.fn>).mock.calls.length
    reporter.event('note', 'after close')
    reporter.count('families', 1)
    await reporter.step('census')
    await reporter.heartbeat()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(heartbeat).toHaveBeenCalledTimes(writesAtClose)
    await reporter.close() // idempotent
  })

  it('a fence miss on a write that was already in flight when close() ran is swallowed by close()', async () => {
    let reject: ((error: unknown) => void) | null = null
    let calls = 0
    const heartbeat: HeartbeatWriter = vi.fn(async () => {
      calls += 1
      if (calls === 2) {
        return new Promise<boolean>((_resolve, rej) => {
          reject = rej
        })
      }
      return true
    })
    const { reporter } = makeReporter({ heartbeat })
    await reporter.plan(PLAN)
    const stepping = reporter.step('precheck').catch(() => 'rejected')
    await Promise.resolve()
    const closing = reporter.close()
    reject!(new WhitespaceLeaseLostError('run-1'))
    await expect(closing).resolves.toBeUndefined()
    expect(await stepping).toBe('rejected')
  })
})
