// Disk headroom guard.
//
// The production VM has a ~500 GB disk that already holds a 166 GB database, and
// the operating rule is to keep 100 GB free at all times. A bulk import is the
// most likely thing to breach that, so the floor is enforced in three places:
//
//   1. BEFORE a run starts        — refuse to begin without headroom
//   2. BEFORE each file download  — including the file's own size, so we never
//                                   start a 10 GB transfer that would breach it
//   3. DURING each download       — polled, so a long transfer aborts partway
//                                   rather than filling the disk
//
// Breaching aborts the run with a clear error. Since the ledger records progress
// per (product, delivery, file), the run is resumable once space is freed —
// nothing is lost by stopping.

import { statfs } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

/** statfs the nearest existing ancestor of `path`. */
async function statfsNearest(path: string) {
  let current = resolve(path)
  for (;;) {
    try {
      return await statfs(current)
    } catch (error) {
      const parent = dirname(current)
      // At the filesystem root the parent stops changing; re-throw rather than loop.
      if (parent === current) throw error
      current = parent
    }
  }
}

export class DiskSpaceError extends Error {
  constructor(
    readonly freeBytes: number,
    readonly requiredBytes: number,
    readonly path: string,
    context?: string
  ) {
    super(
      `Disk headroom breached${context ? ` ${context}` : ''}: ` +
      `${formatGb(freeBytes)} free on ${path}, need at least ${formatGb(requiredBytes)}. ` +
      `Free space and re-run — the ledger resumes where it stopped.`
    )
    this.name = 'DiskSpaceError'
  }
}

const GB = 1024 ** 3
const formatGb = (bytes: number) => `${(bytes / GB).toFixed(1)} GB`

/** Default floor: keep 100 GB free. Override with EPO_MIN_FREE_DISK_GB. */
export function defaultMinFreeBytes(): number {
  const configured = Number(process.env.EPO_MIN_FREE_DISK_GB)
  const gb = Number.isFinite(configured) && configured > 0 ? configured : 100
  return gb * GB
}

export interface DiskSnapshot {
  path: string
  freeBytes: number
  totalBytes: number
  usedBytes: number
  minFreeBytes: number
  /** Bytes available above the floor; negative means already breached. */
  headroomBytes: number
}

/**
 * Free/total bytes for the filesystem containing `path`.
 *
 * The path need not exist yet — a scratch directory is usually created only
 * once the first download starts. We walk up to the nearest existing ancestor,
 * which sits on the same filesystem and therefore reports the same figures.
 */
export async function diskUsage(path: string): Promise<{ freeBytes: number; totalBytes: number }> {
  const stats = await statfsNearest(path)
  // bavail is space available to an unprivileged process — the honest number,
  // since bfree includes root-reserved blocks we cannot actually use.
  return {
    freeBytes: Number(stats.bavail) * Number(stats.bsize),
    totalBytes: Number(stats.blocks) * Number(stats.bsize),
  }
}

export class DiskGuard {
  readonly path: string
  readonly minFreeBytes: number

  constructor(path: string, minFreeBytes: number = defaultMinFreeBytes()) {
    this.path = path
    this.minFreeBytes = minFreeBytes
  }

  async snapshot(): Promise<DiskSnapshot> {
    const { freeBytes, totalBytes } = await diskUsage(this.path)
    return {
      path: this.path,
      freeBytes,
      totalBytes,
      usedBytes: totalBytes - freeBytes,
      minFreeBytes: this.minFreeBytes,
      headroomBytes: freeBytes - this.minFreeBytes,
    }
  }

  /**
   * Throw unless the floor would still hold after writing `additionalBytes`.
   * Pass a file's size before downloading it so an oversized transfer is
   * refused up front rather than aborted halfway.
   */
  async assertHeadroom(additionalBytes = 0, context?: string): Promise<DiskSnapshot> {
    const snapshot = await this.snapshot()
    if (snapshot.freeBytes - additionalBytes < this.minFreeBytes) {
      throw new DiskSpaceError(
        snapshot.freeBytes,
        this.minFreeBytes + additionalBytes,
        this.path,
        context
      )
    }
    return snapshot
  }

  /**
   * A throttled callback for use during a long write. Checks at most once per
   * `intervalMs`; the returned function throws DiskSpaceError when the floor is
   * breached, which aborts the download and removes the partial file.
   */
  createProgressGuard(intervalMs = 10_000): () => Promise<void> {
    let nextCheckAt = 0
    let inFlight: Promise<void> | null = null
    return async () => {
      const now = Date.now()
      if (now < nextCheckAt) return inFlight ?? undefined
      nextCheckAt = now + intervalMs
      inFlight = this.assertHeadroom(0, 'mid-download').then(() => undefined)
      return inFlight
    }
  }
}

export function describeSnapshot(snapshot: DiskSnapshot): string {
  const pct = snapshot.totalBytes ? (snapshot.usedBytes / snapshot.totalBytes) * 100 : 0
  const base =
    `${snapshot.path}: ${formatGb(snapshot.freeBytes)} free of ${formatGb(snapshot.totalBytes)} ` +
    `(${pct.toFixed(0)}% used), floor ${formatGb(snapshot.minFreeBytes)}, ` +
    `headroom ${formatGb(snapshot.headroomBytes)}`

  // A filesystem SMALLER than the floor is not a full disk — it is the wrong
  // disk. Almost always /tmp on a tmpfs, where a multi-GB archive would be
  // written into RAM. Say so, rather than leaving a confusing negative headroom.
  if (snapshot.totalBytes < snapshot.minFreeBytes) {
    return base + `
    ^ this filesystem is smaller than the floor — it is probably a tmpfs ` +
      `(RAM-backed).
      Point --data-dir or EPO_DATA_DIR at the main data disk.`
  }
  return base
}
