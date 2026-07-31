import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchLocalPatentClaimEvidence: vi.fn(),
}))

vi.mock('@/lib/local-patent-claims-service', () => ({
  fetchLocalPatentClaimEvidence: mocks.fetchLocalPatentClaimEvidence,
}))

vi.mock('./metering/gateway', () => ({
  llmGateway: { executeLLMOperation: vi.fn() },
}))

import { NoveltySearchService } from './novelty-search-service'

function service() {
  return new NoveltySearchService() as any
}

function candidates(count: number): any[] {
  return Array.from({ length: count }, (_, index) => ({
    canonicalPn: `P${index + 1}`,
    publicationNumber: `P${index + 1}A1`,
    title: `Patent ${index + 1}`,
    abstract: 'A usable abstract describing a controller and sensor.',
  }))
}

describe('claim-aware novelty batch enrichment', () => {
  beforeEach(() => {
    mocks.fetchLocalPatentClaimEvidence.mockReset()
  })

  test('enriches the available 20 percent including a patent beyond the former top-six cap', async () => {
    const batch = candidates(10)
    mocks.fetchLocalPatentClaimEvidence.mockResolvedValue({
      status: 'complete',
      checked: 10,
      records: new Map([
        ['P2', {
          publicationNumber: 'P2A1',
          text: '1. A controller coupled to a sensor.',
          completeness: 'FIRST_CLAIM_ONLY',
          source: 'local-test',
          contentHash: 'hash-p2',
        }],
        ['P9', {
          publicationNumber: 'P9A1',
          text: '1. An anomaly model triggers a maintenance alert.',
          completeness: 'FULL',
          source: 'local-test',
          contentHash: 'hash-p9',
        }],
      ]),
    })

    const diagnostics = await service().safelyHydrateClaimsForAnalysisBatch(batch, [
      'anomaly model triggers a maintenance alert',
    ])

    expect(diagnostics).toMatchObject({
      lookupStatus: 'complete',
      patentsChecked: 10,
      claimsFound: 2,
      claimsMissing: 8,
      fullClaims: 1,
      firstClaimOnly: 1,
      lookupFailures: 0,
    })
    expect(batch[8].claimsText).toContain('anomaly model triggers a maintenance alert')
    expect(batch.filter(item => item.claimsAvailability === 'NONE')).toHaveLength(8)
    expect(batch.filter(item => item.claimsText)).toHaveLength(2)
  })

  test('contains lookup failure and leaves every patent on the title/abstract path', async () => {
    const batch = candidates(5)
    mocks.fetchLocalPatentClaimEvidence.mockResolvedValue({
      status: 'failed',
      checked: 5,
      records: new Map(),
      error: 'database timeout',
    })

    const diagnostics = await service().safelyHydrateClaimsForAnalysisBatch(batch, ['controller'])

    expect(diagnostics.lookupStatus).toBe('partial_failure')
    expect(diagnostics.lookupFailures).toBe(5)
    expect(diagnostics.claimsFound).toBe(0)
    expect(batch.every(item => !item.claimsText && item.claimsAvailability === 'LOOKUP_FAILED')).toBe(true)
  })

  test('claims content and completeness participate in the legacy cache key', () => {
    const svc = service()
    const withoutClaims = candidates(1)
    withoutClaims[0].claimsAvailability = 'NONE'
    const withClaims = candidates(1)
    Object.assign(withClaims[0], {
      claimsText: '1. A controller coupled to a sensor.',
      claimsAvailability: 'FIRST_CLAIM_ONLY',
      claimsContentHash: 'claims-hash',
    })

    expect(svc.createBatchHash(withoutClaims, ['controller coupled to sensor']))
      .not.toBe(svc.createBatchHash(withClaims, ['controller coupled to sensor']))
    withClaims[0].claimsText = '1. A different controller arrangement.'
    expect(svc.createBatchHash(withoutClaims, ['controller coupled to sensor']))
      .not.toBe(svc.createBatchHash(withClaims, ['controller coupled to sensor']))
  })

  test('missing claims preserve explicit Absent mappings instead of creating Unknown', () => {
    const svc = service()
    const patent = candidates(1)[0]
    patent.claimsAvailability = 'NONE'
    const maps = svc.validateAndRepairFeatureMaps([{
      pn: 'P1',
      absent: [{ feature: 'temperature threshold control', reason: 'not taught' }],
    }], [patent], ['temperature threshold control'])

    expect(maps[0].feature_analysis[0].status).toBe('Absent')
    expect(maps[0].feature_analysis[0].claims_completeness).toBe('NONE')
  })

  test('normalizes model-supplied Unknown to Absent when the fallback record is usable', () => {
    const svc = service()
    const patent = candidates(1)[0]
    patent.claimsAvailability = 'NONE'
    const maps = svc.validateAndRepairFeatureMaps([{
      pn: 'P1',
      feature_analysis: [{
        feature: 'temperature threshold control',
        status: 'Unknown',
        reason: 'Claims were not available to confirm this feature.',
      }],
    }], [patent], ['temperature threshold control'])

    expect(maps[0].feature_analysis[0]).toMatchObject({
      status: 'Absent',
      claims_completeness: 'NONE',
      reason: 'The feature is not disclosed in the usable reviewed record.',
    })
  })

  test('preserves Unknown when feature mapping execution failed', () => {
    const svc = service()
    const patent = candidates(1)[0]
    patent.claimsAvailability = 'NONE'
    const fallback = svc.createUnknownFeatureMap([patent], ['temperature threshold control'])
    const maps = svc.validateAndRepairFeatureMaps(
      fallback.feature_map,
      [patent],
      ['temperature threshold control'],
    )

    expect(maps[0].feature_analysis[0]).toMatchObject({
      status: 'Unknown',
      qaDowngraded: true,
      reason: 'Feature-mapping execution failed.',
    })
  })
})
