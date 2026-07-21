import { describe, expect, it } from 'vitest'
import {
  classifyFileSet,
  formatBytes,
  parseFileSize,
  productsForLane,
  resolveProducts,
  summarizeProduct,
} from './catalog'
import type { BddsProduct, BddsProductWithDeliveries } from './types'

describe('parseFileSize', () => {
  it('parses binary (1024-based) units as the BDDS feed emits them', () => {
    expect(parseFileSize('1.5 GB')).toBe(Math.round(1.5 * 1024 ** 3))
    expect(parseFileSize('450.1 kB')).toBe(Math.round(450.1 * 1024))
    expect(parseFileSize('12 B')).toBe(12)
    expect(parseFileSize('2 TB')).toBe(2 * 1024 ** 4)
  })

  it('tolerates thousands separators and odd spacing', () => {
    expect(parseFileSize('1,024 MB')).toBe(1024 * 1024 ** 2)
    expect(parseFileSize('  3GB ')).toBe(3 * 1024 ** 3)
  })

  it('returns null rather than guessing when unparseable', () => {
    expect(parseFileSize('')).toBeNull()
    expect(parseFileSize(null)).toBeNull()
    expect(parseFileSize('unknown')).toBeNull()
    expect(parseFileSize('12 parsecs')).toBeNull()
  })
})

describe('classifyFileSet', () => {
  it('distinguishes front from back file products', () => {
    expect(classifyFileSet('EP DocDB back file')).toBe('back')
    expect(classifyFileSet('EP full-text data - front file')).toBe('front')
    expect(classifyFileSet('PATSTAT Global')).toBe('unknown')
  })
})

describe('resolveProducts', () => {
  const products: BddsProduct[] = [
    { id: 3, name: 'EP DocDB front file' },
    { id: 14, name: 'EP DocDB back file' },
    { id: 4, name: 'EP full-text data - front file' },
    { id: 5, name: 'EP full-text data - back file' },
    { id: 9, name: 'EPO worldwide legal event data (INPADOC) - back file' },
    { id: 17, name: 'PATSTAT Global' },
    { id: 21, name: 'National full-text data' },
  ]

  it('assigns each product to a lane by name', () => {
    const resolved = resolveProducts(products)
    const byId = new Map(resolved.map(p => [p.id, p]))
    expect(byId.get(3)?.lane).toBe('docdb')
    expect(byId.get(14)?.lane).toBe('docdb')
    expect(byId.get(4)?.lane).toBe('ep-fulltext')
    expect(byId.get(5)?.lane).toBe('ep-fulltext')
    expect(byId.get(9)?.lane).toBe('inpadoc')
  })

  it('omits products that belong to no lane', () => {
    const resolved = resolveProducts(products)
    expect(resolved.find(p => p.id === 17)).toBeUndefined()
  })

  it('excludes national full-text, which is a different product from EP full-text', () => {
    const resolved = resolveProducts(products)
    expect(resolved.find(p => p.id === 21)).toBeUndefined()
  })

  it('orders a lane back-file first, which is the backfill order', () => {
    const resolved = resolveProducts(products)
    expect(productsForLane(resolved, 'ep-fulltext').map(p => p.id)).toEqual([5, 4])
  })
})

describe('summarizeProduct', () => {
  const product: BddsProductWithDeliveries = {
    id: 4,
    name: 'EP full-text data - front file',
    deliveries: [
      {
        deliveryId: 100,
        deliveryName: 'w01',
        deliveryPublicationDatetime: '2025-01-08T00:00:00Z',
        files: [
          { fileId: 1, fileName: 'a.zip', fileSize: '1 GB', fileChecksum: 'x' },
          { fileId: 2, fileName: 'b.zip', fileSize: '512 MB', fileChecksum: 'y' },
        ],
      },
      {
        deliveryId: 101,
        deliveryName: 'w02',
        deliveryPublicationDatetime: '2025-01-01T00:00:00Z',
        files: [{ fileId: 3, fileName: 'c.zip', fileSize: 'mystery', fileChecksum: 'z' }],
      },
    ],
  }

  it('totals only the sizes it could parse, and counts the rest', () => {
    const summary = summarizeProduct(product)
    expect(summary.deliveryCount).toBe(2)
    expect(summary.fileCount).toBe(3)
    expect(summary.totalBytes).toBe(1024 ** 3 + 512 * 1024 ** 2)
    expect(summary.unparsedSizes).toBe(1)
  })

  it('reports the delivery date range in chronological order', () => {
    const summary = summarizeProduct(product)
    expect(summary.earliestDelivery).toBe('2025-01-01T00:00:00Z')
    expect(summary.latestDelivery).toBe('2025-01-08T00:00:00Z')
  })
})

describe('formatBytes', () => {
  it('renders human sizes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(999)).toBe('999 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1024 ** 3 * 1.5)).toBe('1.5 GB')
  })
})
