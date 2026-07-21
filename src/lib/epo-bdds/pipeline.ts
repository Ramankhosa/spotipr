// Overlapped download/process pipeline.
//
// Downloading is network-bound and extraction is CPU/disk-bound, so running them
// in lockstep wastes roughly half the wall clock. This keeps ONE download in
// flight while the PREVIOUS archive is being extracted and loaded:
//
//   time ──►
//   download   [ file 1 ][ file 2 ][ file 3 ]
//   process             [ file 1 ][ file 2 ][ file 3 ]
//                       ^ overlap
//
// Depth is deliberately 2, not N. Each EP full-text archive is ~10 GB, so a
// deeper queue would multiply peak disk for no extra throughput — the network
// is already saturated by one transfer.
//
// DISK ACCOUNTING: at peak, two archives coexist (one downloading, one being
// processed). The reservation below tracks bytes held by the file still being
// processed so the guard's headroom check accounts for both, rather than each
// download believing it is alone on the disk.

import { DiskGuard, type DiskSnapshot } from './disk-guard'

export interface PipelineItem<T> {
  /** Stable identity for logging and the ledger. */
  id: string
  payload: T
  /** Announced size, used for the disk reservation. */
  sizeBytes: number
}

export interface PipelineHandlers<T, D> {
  /** Fetch the item to disk. Receives the bytes currently reserved by the
   *  item still being processed, so it can include them in its headroom check. */
  download: (item: PipelineItem<T>, reservedBytes: number) => Promise<D>
  /** Extract, parse and load. Runs while the NEXT download is in flight. */
  process: (downloaded: D, item: PipelineItem<T>) => Promise<void>
  /** Always invoked after process, success or failure — delete the archive. */
  cleanup: (downloaded: D, item: PipelineItem<T>) => Promise<void>
  onError?: (item: PipelineItem<T>, phase: 'download' | 'process', error: unknown) => void
}

export interface PipelineResult {
  processed: number
  failed: number
  failures: Array<{ id: string; phase: 'download' | 'process'; message: string }>
  /** True when the run stopped early because a handler threw a fatal error. */
  abortedEarly: boolean
}

/** Errors that must stop the whole run rather than skip one item. */
function isFatal(error: unknown): boolean {
  const name = (error as { name?: string })?.name
  return name === 'DiskSpaceError' || name === 'BddsAuthError'
}

/**
 * Run items through download → process with a one-item overlap.
 *
 * A failure on a single item is recorded and the run continues, EXCEPT for
 * fatal errors (disk floor breached, auth revoked) which abort immediately —
 * continuing would just produce a long tail of identical failures.
 */
export async function runOverlappedPipeline<T, D>(
  items: Array<PipelineItem<T>>,
  handlers: PipelineHandlers<T, D>
): Promise<PipelineResult> {
  const result: PipelineResult = { processed: 0, failed: 0, failures: [], abortedEarly: false }
  if (!items.length) return result

  // Bytes held on disk by the archive currently being processed. The next
  // download adds this to its own size when checking headroom.
  let reservedBytes = 0

  const startDownload = (index: number): Promise<D> | null => {
    if (index >= items.length) return null
    return handlers.download(items[index], reservedBytes)
  }

  let inFlight = startDownload(0)
  let inFlightIndex = 0

  while (inFlight) {
    const item = items[inFlightIndex]
    let downloaded: D
    try {
      downloaded = await inFlight
    } catch (error) {
      result.failed++
      result.failures.push({ id: item.id, phase: 'download', message: messageOf(error) })
      handlers.onError?.(item, 'download', error)
      if (isFatal(error)) { result.abortedEarly = true; break }
      inFlightIndex++
      inFlight = startDownload(inFlightIndex)
      continue
    }

    // This archive now occupies disk for the duration of processing, so the
    // next download must account for it.
    reservedBytes = item.sizeBytes
    const nextIndex = inFlightIndex + 1
    const nextDownload = startDownload(nextIndex)

    let fatal: unknown = null
    try {
      await handlers.process(downloaded, item)
      result.processed++
    } catch (error) {
      result.failed++
      result.failures.push({ id: item.id, phase: 'process', message: messageOf(error) })
      handlers.onError?.(item, 'process', error)
      if (isFatal(error)) fatal = error
    } finally {
      await handlers.cleanup(downloaded, item).catch(() => {})
      reservedBytes = 0
    }

    if (fatal) {
      result.abortedEarly = true
      // Let the in-flight download settle so it cannot delete files or reject
      // after we have returned.
      await nextDownload?.catch(() => undefined)
      break
    }

    inFlight = nextDownload
    inFlightIndex = nextIndex
  }

  return result
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Headroom needed before starting a download in the overlapped pipeline:
 * this file, plus whatever the concurrently-processing file still holds.
 */
export async function assertPipelineHeadroom(
  guard: DiskGuard,
  fileBytes: number,
  reservedBytes: number,
  context: string
): Promise<DiskSnapshot> {
  return guard.assertHeadroom(fileBytes + reservedBytes, context)
}
