import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeRaw: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $executeRaw: mocks.executeRaw,
    $queryRaw: mocks.queryRaw,
    $transaction: mocks.transaction,
  },
}))

import {
  fetchLocalPatentClaimEvidence,
  fetchLocalPatentClaims,
} from './local-patent-claims-service'

describe('local patent claims lookup', () => {
  beforeEach(() => {
    mocks.executeRaw.mockReset().mockResolvedValue(0)
    mocks.queryRaw.mockReset()
    mocks.transaction.mockReset().mockImplementation(async (operations: Promise<unknown>[]) => Promise.all(operations))
  })

  test('returns normalized completeness, provenance, and a stable content hash', async () => {
    mocks.queryRaw.mockResolvedValue([
      {
        publicationNumber: 'EP123A1',
        claimsText: '1. A controller coupled to a sensor.',
        claimsAvailability: 'FULL_EPO',
        claimsSource: 'epo-ep-fulltext',
      },
      {
        publicationNumber: 'US456A1',
        claimsText: '1. A first independent claim.',
        claimsAvailability: 'FIRST_CLAIM_ONLY',
        claimsSource: 'legacy-local-corpus',
      },
    ])

    const result = await fetchLocalPatentClaimEvidence(['EP123A1', 'US456A1', 'IN789A1'])

    expect(result.status).toBe('complete')
    expect(result.checked).toBe(3)
    expect(result.records.get('EP123')).toMatchObject({ completeness: 'FULL', source: 'epo-ep-fulltext' })
    expect(result.records.get('US456')).toMatchObject({ completeness: 'FIRST_CLAIM_ONLY' })
    expect(result.records.get('EP123')?.contentHash).toMatch(/^[a-f0-9]{64}$/)
  })

  test('keeps the legacy string-only API compatible', async () => {
    mocks.queryRaw.mockResolvedValue([{
      publicationNumber: 'US456A1',
      claimsText: '1. A first independent claim.',
      claimsAvailability: 'FIRST_CLAIM_ONLY',
      claimsSource: 'legacy-local-corpus',
    }])

    const claims = await fetchLocalPatentClaims(['US456A1'])
    expect(claims.get('US456')).toBe('1. A first independent claim.')
  })

  test('reports lookup failure without throwing', async () => {
    mocks.queryRaw.mockRejectedValue(new Error('database timeout'))

    const result = await fetchLocalPatentClaimEvidence(['US456A1'])
    expect(result).toMatchObject({ status: 'failed', checked: 1, error: 'database timeout' })
    expect(result.records.size).toBe(0)
  })
})
