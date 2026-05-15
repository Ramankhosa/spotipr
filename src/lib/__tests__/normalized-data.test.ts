import { describe, expect, test } from 'vitest'
import { isLegacyExtractionFailure, migrateNormalizedData } from '@/lib/normalized-data'

describe('normalized data migration', () => {
  test('marks legacy placeholder extraction failures explicitly', () => {
    const migrated = migrateNormalizedData({
      problem: 'Extraction failed - review source text',
      components: [],
      normalizationReviewWarnings: ['LLM response could not be parsed.'],
    })

    expect(isLegacyExtractionFailure(migrated)).toBe(true)
    expect(migrated.extractionFailed).toBe(true)
    expect(migrated.schemaVersion).toBe(2)
    expect(migrated.normalizationReviewWarnings).toContain('Normalization output is marked as failed. Regenerate Stage 0 before drafting.')
  })

  test('backfills v2 containers for older normalized records', () => {
    const migrated = migrateNormalizedData({
      problem: 'Pump controller',
      inventionType: 'mechanical+software',
      cpcCodes: 'G06F 1/00',
    })

    expect(migrated.schemaVersion).toBe(2)
    expect(migrated.inventionType).toEqual(['MECHANICAL', 'SOFTWARE'])
    expect(migrated.cpcCodes).toEqual(['G06F 1/00'])
    expect(migrated.components).toEqual([])
    expect(migrated.supportDataSources).toEqual([])
    expect(migrated.sourceFactLedger.numericValuesAndUnits).toEqual([])
  })
})
