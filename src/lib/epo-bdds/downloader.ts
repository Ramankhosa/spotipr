// Streamed download of a single BDDS delivery file.
//
// Archives run to multiple GB, so the response body is piped straight to disk —
// it is never buffered in memory, and never passed through Buffer.concat.

import { createWriteStream } from 'node:fs'
import { mkdir, rm, stat } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { EPO_BDDS_BASE_URL } from './auth'
import type { DiskGuard } from './disk-guard'
import { classifyStatus, withRetry, type RetryOptions } from './http'

export interface FileCoordinates {
  productId: number
  deliveryId: number
  fileId: number
}

export function buildDownloadUrl({ productId, deliveryId, fileId }: FileCoordinates): string {
  return `${EPO_BDDS_BASE_URL}/products/${productId}/delivery/${deliveryId}/file/${fileId}/download`
}

export interface DownloadResult {
  bytesWritten: number
  /** Content-Length when the server sent one — the authoritative expected size. */
  contentLength: number | null
  destinationPath: string
}

export interface DownloadOptions extends RetryOptions {
  onProgress?: (bytesWritten: number, totalBytes: number | null) => void
  signal?: AbortSignal
  /**
   * Enforces the free-disk floor. Checked once against the announced size
   * before any bytes are written, then polled during the transfer so a long
   * download aborts rather than filling the disk.
   */
  diskGuard?: DiskGuard
  /** Expected size when Content-Length is absent, for the pre-flight check. */
  expectedBytes?: number | null
}

/**
 * Download one file to `destinationPath`, streaming throughout.
 *
 * On any failure the partial file is removed, so a resumed run never mistakes a
 * truncated archive for a complete one. A short read (bytes < Content-Length) is
 * raised as retryable — that is the common signature of a dropped connection.
 */
export async function downloadFile(
  token: string,
  coordinates: FileCoordinates,
  destinationPath: string,
  options: DownloadOptions = {}
): Promise<DownloadResult> {
  const url = buildDownloadUrl(coordinates)
  await mkdir(dirname(destinationPath), { recursive: true })

  return withRetry(async () => {
    // Empty token => anonymous attempt (free/public products). See catalog.ts.
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = token
    const response = await fetch(url, { headers, signal: options.signal })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw classifyStatus(response.status, body, response.headers.get('retry-after'))
    }
    if (!response.body) {
      throw classifyStatus(502, 'BDDS download returned an empty body')
    }

    const header = response.headers.get('content-length')
    const contentLength = header && Number.isFinite(Number(header)) ? Number(header) : null

    // Refuse to start a transfer that would breach the floor on its own.
    const announced = contentLength ?? options.expectedBytes ?? 0
    await options.diskGuard?.assertHeadroom(announced, `before downloading ${basename(destinationPath)}`)
    const progressGuard = options.diskGuard?.createProgressGuard()

    let bytesWritten = 0
    let guardError: unknown = null
    const source = Readable.fromWeb(response.body as any)
    source.on('data', (chunk: Buffer) => {
      bytesWritten += chunk.length
      options.onProgress?.(bytesWritten, contentLength)
      // Polled, throttled. Destroying the source aborts the pipeline, whose
      // catch below removes the partial file.
      progressGuard?.().catch(error => {
        guardError = error
        source.destroy(error as Error)
      })
    })

    try {
      await pipeline(source, createWriteStream(destinationPath))
    } catch (error) {
      await rm(destinationPath, { force: true }).catch(() => {})
      // Surface the disk error rather than the generic stream-destroyed error.
      throw guardError ?? error
    }

    if (contentLength !== null && bytesWritten !== contentLength) {
      await rm(destinationPath, { force: true }).catch(() => {})
      throw classifyStatus(
        503,
        `truncated download: got ${bytesWritten} bytes, expected ${contentLength}`
      )
    }

    return { bytesWritten, contentLength, destinationPath }
  }, options)
}

/** Size of a file on disk, or null when it does not exist. */
export async function fileSizeOnDisk(filePath: string): Promise<number | null> {
  try {
    const stats = await stat(filePath)
    return stats.size
  } catch {
    return null
  }
}
