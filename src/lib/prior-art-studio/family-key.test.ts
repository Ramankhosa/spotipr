import { describe, expect, it } from 'vitest'
import {
  canonicalStudioFamilyKey,
  mergeCanonicalFamilyStates,
  studioFamilyAliasMap,
} from './family-key'
import type { StudioResultFamily } from './types'

describe('Studio family identity', () => {
  it('preserves corpus family ids and removes publication kind codes', () => {
    expect(canonicalStudioFamilyKey('DOCDB-123', 'US1234567B2')).toBe('DOCDB-123')
    expect(canonicalStudioFamilyKey('US1234567B2', 'US1234567B2')).toBe('US1234567')
  })

  it('uses the application identity when familyId is missing', () => {
    expect(canonicalStudioFamilyKey(null, 'US20240123456A1', 'US18/123,456')).toBe('application:US18123456')
    expect(canonicalStudioFamilyKey(null, 'US12345678B2', 'US18/123,456')).toBe('application:US18123456')
  })

  it('merges legacy publication states into the latest result family and keeps the newest state', () => {
    const family: StudioResultFamily = {
      familyKey: 'application:US18123456',
      publicationNumber: 'US20240123456A1',
      title: 'Example',
      members: [
        { publicationNumber: 'US20240123456A1' },
        { publicationNumber: 'US12345678B2' },
      ],
      lane: 'both',
    }
    const rows = [
      {
        familyKey: 'US20240123456A1',
        publicationNumber: 'US20240123456A1',
        tag: 'MAYBE',
        updatedAt: new Date('2026-07-01T00:00:00Z'),
      },
      {
        familyKey: 'US12345678B2',
        publicationNumber: 'US12345678B2',
        tag: 'RELEVANT',
        updatedAt: new Date('2026-07-02T00:00:00Z'),
      },
    ]

    const merged = mergeCanonicalFamilyStates(rows, studioFamilyAliasMap([family]))
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ familyKey: 'application:US18123456', tag: 'RELEVANT' })
  })
})
