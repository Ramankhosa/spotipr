import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DiskGuard,
  DiskSpaceError,
  defaultMinFreeBytes,
  describeSnapshot,
  diskUsage,
} from './disk-guard'

const GB = 1024 ** 3

afterEach(() => { delete process.env.EPO_MIN_FREE_DISK_GB })

describe('defaultMinFreeBytes', () => {
  it('defaults to the 100 GB operating floor', () => {
    expect(defaultMinFreeBytes()).toBe(100 * GB)
  })

  it('honours EPO_MIN_FREE_DISK_GB', () => {
    process.env.EPO_MIN_FREE_DISK_GB = '250'
    expect(defaultMinFreeBytes()).toBe(250 * GB)
  })

  it('ignores nonsense values rather than dropping the floor to zero', () => {
    process.env.EPO_MIN_FREE_DISK_GB = 'plenty'
    expect(defaultMinFreeBytes()).toBe(100 * GB)
    process.env.EPO_MIN_FREE_DISK_GB = '-5'
    expect(defaultMinFreeBytes()).toBe(100 * GB)
  })
})

describe('diskUsage', () => {
  it('reports real free/total bytes for a real path', async () => {
    const usage = await diskUsage(tmpdir())
    expect(usage.totalBytes).toBeGreaterThan(0)
    expect(usage.freeBytes).toBeGreaterThan(0)
    expect(usage.freeBytes).toBeLessThanOrEqual(usage.totalBytes)
  })
})

/** A guard with a stubbed filesystem, so the tests do not depend on real disk. */
function guardWithFree(freeGb: number, floorGb = 100) {
  const guard = new DiskGuard('/data', floorGb * GB)
  vi.spyOn(guard, 'snapshot').mockImplementation(async () => ({
    path: '/data',
    freeBytes: freeGb * GB,
    totalBytes: 500 * GB,
    usedBytes: (500 - freeGb) * GB,
    minFreeBytes: floorGb * GB,
    headroomBytes: (freeGb - floorGb) * GB,
  }))
  return guard
}

describe('DiskGuard.assertHeadroom', () => {
  it('passes when the floor still holds after the write', async () => {
    const guard = guardWithFree(247) // the production VM's current free space
    await expect(guard.assertHeadroom(10 * GB)).resolves.toBeDefined()
  })

  it('refuses a download that would breach the floor, BEFORE any bytes are written', async () => {
    const guard = guardWithFree(105)
    // 105 GB free, 100 GB floor: a 10 GB archive would leave 95 GB.
    await expect(guard.assertHeadroom(10 * GB)).rejects.toBeInstanceOf(DiskSpaceError)
  })

  it('refuses when already below the floor, even with nothing to write', async () => {
    const guard = guardWithFree(80)
    await expect(guard.assertHeadroom(0)).rejects.toBeInstanceOf(DiskSpaceError)
  })

  it('accounts for a concurrently-processing archive via the reservation', async () => {
    const guard = guardWithFree(115)
    // One 10 GB archive alone is fine (115 - 10 = 105 >= 100)...
    await expect(guard.assertHeadroom(10 * GB)).resolves.toBeDefined()
    // ...but not while another 10 GB archive is still being processed.
    await expect(guard.assertHeadroom(20 * GB)).rejects.toBeInstanceOf(DiskSpaceError)
  })

  it('explains how to recover, and that stopping loses nothing', async () => {
    const guard = guardWithFree(80)
    await expect(guard.assertHeadroom(0)).rejects.toThrow(/ledger resumes where it stopped/)
  })
})

describe('DiskGuard.createProgressGuard', () => {
  it('throttles: many calls in quick succession check once', async () => {
    const guard = guardWithFree(247)
    const check = guard.createProgressGuard(10_000)
    for (let i = 0; i < 50; i++) await check()
    expect(guard.snapshot).toHaveBeenCalledTimes(1)
  })

  it('throws mid-download once the floor is breached', async () => {
    const guard = guardWithFree(80)
    const check = guard.createProgressGuard(0)
    await expect(check()).rejects.toBeInstanceOf(DiskSpaceError)
  })
})

describe('describeSnapshot', () => {
  it('renders a one-line operator summary', async () => {
    const guard = guardWithFree(247)
    const text = describeSnapshot(await guard.snapshot())
    expect(text).toContain('247.0 GB free of 500.0 GB')
    expect(text).toContain('floor 100.0 GB')
    expect(text).toContain('headroom 147.0 GB')
  })
})
