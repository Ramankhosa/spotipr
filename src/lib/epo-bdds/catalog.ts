// BDDS catalog: list products, fetch a product's deliveries, and resolve the
// products we care about BY NAME at runtime.
//
// CONTRACT SOURCE (confirmed, not guessed) — cross-checked between
// patent-dev/epo-bdds (openapi.yaml) and go-epo-bdds (pkg/epo_bbds):
//   GET {base}/products/
//   GET {base}/products/{productId}
//   GET {base}/products/{productId}/delivery/{deliveryId}/file/{fileId}/download
// all with `Authorization: Bearer <token>`.
//
// WHY RESOLVE BY NAME: only five product IDs are published anywhere (below).
// The EP full-text BACK file id and the INPADOC id are NOT among them, so
// hardcoding would be a guess. We resolve from the live catalog and treat the
// known ids purely as a sanity assertion.

import { EPO_BDDS_BASE_URL } from './auth'
import { BddsAuthError, BddsNotFoundError, classifyStatus, withRetry, type RetryOptions } from './http'
import type { BddsLane, BddsProduct, BddsProductWithDeliveries } from './types'

/**
 * Product ids published by the reference clients. Used ONLY to sanity-check
 * what the live catalog returns — never as the source of truth.
 */
export const KNOWN_PRODUCT_IDS = {
  docdbFront: 3,
  epFullTextFront: 4,
  docdbBack: 14,
  patstatGlobal: 17,
  patstatEpRegister: 18,
} as const

interface LaneMatcher {
  lane: BddsLane
  /** Product name must match this to belong to the lane. */
  test: RegExp
  /** Names that look similar but are a different product entirely. */
  exclude?: RegExp
}

const LANE_MATCHERS: LaneMatcher[] = [
  { lane: 'ep-fulltext', test: /full[\s-]*text/i, exclude: /national|sequence/i },
  { lane: 'docdb', test: /docdb|worldwide\s+bibliographic/i },
  { lane: 'inpadoc', test: /inpadoc|legal\s+(event|status)/i },
]

export type FileSetKind = 'front' | 'back' | 'unknown'

export interface ResolvedProduct extends BddsProduct {
  lane: BddsLane
  fileSet: FileSetKind
}

/**
 * `token` may be an empty string: the reference client documents credentials as
 * "optional for free/public products", and all three of our lanes are in the
 * free area. We omit the Authorization header entirely in that case rather than
 * sending an empty one, and let a 401 tell us an account is genuinely required.
 */
async function bddsGet<T>(path: string, token: string, retry: RetryOptions = {}): Promise<T> {
  return withRetry(async () => {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (token) headers.Authorization = token
    const response = await fetch(`${EPO_BDDS_BASE_URL}${path}`, { headers })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw classifyStatus(response.status, body, response.headers.get('retry-after'))
    }

    // An unauthenticated request is 302'd to the Okta login page, which fetch
    // follows and returns as 200 text/html. Without this check that surfaces as
    // an opaque `Unexpected token '<'` JSON parse error.
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('json')) {
      throw new BddsAuthError(
        'BDDS returned an HTML login page instead of JSON — this endpoint requires an ' +
        'authenticated EPO account (the free/public area still authenticates the API).'
      )
    }

    return (await response.json()) as T
  }, retry)
}

/** GET /products/ — every product visible to these credentials. */
export async function listProducts(token: string, retry?: RetryOptions): Promise<BddsProduct[]> {
  const payload = await bddsGet<BddsProduct[] | { products?: BddsProduct[] }>('/products/', token, retry)
  // The endpoint returns a bare array; tolerate a wrapped shape defensively.
  const products = Array.isArray(payload) ? payload : payload?.products
  if (!Array.isArray(products)) {
    throw new BddsNotFoundError('product list', '/products/')
  }
  return products
}

/** GET /products/{id} — the product plus all of its deliveries and files. */
export async function getProduct(
  token: string,
  productId: number,
  retry?: RetryOptions
): Promise<BddsProductWithDeliveries> {
  const product = await bddsGet<BddsProductWithDeliveries>(`/products/${productId}`, token, retry)
  if (!product?.id) throw new BddsNotFoundError('product', productId)
  return { ...product, deliveries: product.deliveries ?? [] }
}

/** "… - back file" / "… front file" → which half of the dataset this is. */
export function classifyFileSet(name: string): FileSetKind {
  if (/back[\s-]*file/i.test(name)) return 'back'
  if (/front[\s-]*file/i.test(name)) return 'front'
  return 'unknown'
}

/**
 * Tag every product with the lane it belongs to, if any. Products matching no
 * lane (PATSTAT, Register, sequence listings…) are omitted.
 */
export function resolveProducts(products: BddsProduct[]): ResolvedProduct[] {
  const resolved: ResolvedProduct[] = []
  for (const product of products) {
    const name = product.name || ''
    for (const matcher of LANE_MATCHERS) {
      if (!matcher.test.test(name)) continue
      if (matcher.exclude?.test(name)) continue
      resolved.push({ ...product, lane: matcher.lane, fileSet: classifyFileSet(name) })
      break
    }
  }
  return resolved
}

/** Products for one lane, back file first (backfill order). */
export function productsForLane(resolved: ResolvedProduct[], lane: BddsLane): ResolvedProduct[] {
  const order: Record<FileSetKind, number> = { back: 0, front: 1, unknown: 2 }
  return resolved.filter(p => p.lane === lane).sort((a, b) => order[a.fileSet] - order[b.fileSet])
}

const SIZE_UNITS: Record<string, number> = {
  B: 1,
  KB: 1024,
  MB: 1024 ** 2,
  GB: 1024 ** 3,
  TB: 1024 ** 4,
}

/**
 * Parse the human-readable `fileSize` string ("1.5 GB", "450.1 kB") into bytes.
 * Binary (1024-based) per the patent-dev/bulk-file-loader documentation.
 *
 * ESTIMATES ONLY — this is what the API reports, not a verified byte count.
 * Downloads verify against Content-Length and the actual bytes written.
 */
export function parseFileSize(value: string | null | undefined): number | null {
  if (!value) return null
  const match = String(value).trim().match(/^([\d.,]+)\s*([A-Za-z]+)$/)
  if (!match) return null
  const amount = Number(match[1].replace(/,/g, ''))
  const unit = SIZE_UNITS[match[2].toUpperCase()]
  if (!Number.isFinite(amount) || !unit) return null
  return Math.round(amount * unit)
}

export interface ProductSummary {
  deliveryCount: number
  fileCount: number
  totalBytes: number
  unparsedSizes: number
  earliestDelivery: string | null
  latestDelivery: string | null
}

/** Aggregate a product's deliveries for the dry-run / catalog report. */
export function summarizeProduct(product: BddsProductWithDeliveries): ProductSummary {
  let fileCount = 0
  let totalBytes = 0
  let unparsedSizes = 0
  const dates: string[] = []

  for (const delivery of product.deliveries ?? []) {
    if (delivery.deliveryPublicationDatetime) dates.push(delivery.deliveryPublicationDatetime)
    for (const file of delivery.files ?? []) {
      fileCount++
      const bytes = parseFileSize(file.fileSize)
      if (bytes === null) unparsedSizes++
      else totalBytes += bytes
    }
  }

  dates.sort()
  return {
    deliveryCount: product.deliveries?.length ?? 0,
    fileCount,
    totalBytes,
    unparsedSizes,
    earliestDelivery: dates[0] ?? null,
    latestDelivery: dates[dates.length - 1] ?? null,
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`
}
