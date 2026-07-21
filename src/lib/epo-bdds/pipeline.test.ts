import { describe, expect, it, vi } from 'vitest'
import { DiskSpaceError } from './disk-guard'
import { runOverlappedPipeline, type PipelineItem } from './pipeline'

const items = (n: number, sizeBytes = 10): Array<PipelineItem<number>> =>
  Array.from({ length: n }, (_, i) => ({ id: `f${i}`, payload: i, sizeBytes }))

const tick = (ms = 1) => new Promise(resolve => setTimeout(resolve, ms))

describe('runOverlappedPipeline', () => {
  it('processes every item exactly once, in order', async () => {
    const processed: number[] = []
    const result = await runOverlappedPipeline(items(4), {
      download: async item => item.payload,
      process: async payload => { processed.push(payload) },
      cleanup: async () => {},
    })
    expect(processed).toEqual([0, 1, 2, 3])
    expect(result.processed).toBe(4)
    expect(result.failed).toBe(0)
  })

  it('overlaps: the next download starts before the current process finishes', async () => {
    const events: string[] = []
    await runOverlappedPipeline(items(3), {
      download: async item => { events.push(`dl-start:${item.id}`); await tick(); events.push(`dl-end:${item.id}`); return item.payload },
      process: async (_p, item) => { events.push(`proc-start:${item.id}`); await tick(5); events.push(`proc-end:${item.id}`) },
      cleanup: async () => {},
    })
    // f1's download must begin before f0 finishes processing — that overlap is
    // the entire point of this module.
    expect(events.indexOf('dl-start:f1')).toBeLessThan(events.indexOf('proc-end:f0'))
    expect(events.indexOf('dl-start:f2')).toBeLessThan(events.indexOf('proc-end:f1'))
  })

  it('never has more than two archives in flight', async () => {
    let concurrent = 0
    let peak = 0
    await runOverlappedPipeline(items(5), {
      download: async item => { concurrent++; peak = Math.max(peak, concurrent); await tick(2); return item.payload },
      process: async () => { await tick(2) },
      cleanup: async () => { concurrent-- },
    })
    expect(peak).toBeLessThanOrEqual(2)
  })

  it('reserves the processing archive\'s bytes for the next download\'s headroom check', async () => {
    const reservations: number[] = []
    await runOverlappedPipeline(items(3, 10), {
      download: async (item, reserved) => { reservations.push(reserved); return item.payload },
      process: async () => { await tick(2) },
      cleanup: async () => {},
    })
    // The first download is alone; every later one overlaps a 10-byte archive.
    expect(reservations[0]).toBe(0)
    expect(reservations.slice(1)).toEqual([10, 10])
  })

  it('always cleans up, even when processing throws', async () => {
    const cleaned: string[] = []
    const result = await runOverlappedPipeline(items(3), {
      download: async item => item.payload,
      process: async (_p, item) => { if (item.id === 'f1') throw new Error('bad archive') },
      cleanup: async (_d, item) => { cleaned.push(item.id) },
    })
    expect(cleaned).toEqual(['f0', 'f1', 'f2'])
    expect(result.processed).toBe(2)
    expect(result.failed).toBe(1)
    expect(result.failures[0]).toMatchObject({ id: 'f1', phase: 'process' })
  })

  it('skips a failed download and keeps going', async () => {
    const processed: number[] = []
    const result = await runOverlappedPipeline(items(3), {
      download: async item => { if (item.id === 'f0') throw new Error('404'); return item.payload },
      process: async payload => { processed.push(payload) },
      cleanup: async () => {},
    })
    expect(processed).toEqual([1, 2])
    expect(result.failures[0]).toMatchObject({ id: 'f0', phase: 'download' })
    expect(result.abortedEarly).toBe(false)
  })

  it('ABORTS the whole run when the disk floor is breached', async () => {
    const processed: number[] = []
    const result = await runOverlappedPipeline(items(5), {
      download: async item => {
        if (item.id === 'f2') throw new DiskSpaceError(1, 2, '/data', 'test')
        return item.payload
      },
      process: async payload => { processed.push(payload) },
      cleanup: async () => {},
    })
    expect(result.abortedEarly).toBe(true)
    // f0 and f1 completed; nothing after the breach was attempted.
    expect(processed).toEqual([0, 1])
    expect(result.failures.at(-1)?.message).toMatch(/Disk headroom breached/)
  })

  it('aborts when processing hits a fatal error, and still cleans up', async () => {
    const cleanup = vi.fn(async () => {})
    const result = await runOverlappedPipeline(items(4), {
      download: async item => item.payload,
      process: async (_p, item) => { if (item.id === 'f1') throw new DiskSpaceError(1, 2, '/data') },
      cleanup,
    })
    expect(result.abortedEarly).toBe(true)
    expect(result.processed).toBe(1)
    expect(cleanup).toHaveBeenCalledTimes(2) // f0 and the failed f1
  })

  it('handles an empty work list without touching the handlers', async () => {
    const download = vi.fn()
    const result = await runOverlappedPipeline([], { download, process: vi.fn(), cleanup: vi.fn() })
    expect(result).toMatchObject({ processed: 0, failed: 0, abortedEarly: false })
    expect(download).not.toHaveBeenCalled()
  })
})
