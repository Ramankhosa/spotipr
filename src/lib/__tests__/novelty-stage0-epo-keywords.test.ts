import { describe, expect, test } from 'vitest'
import { NoveltySearchService } from '@/lib/novelty-search-service'

describe('novelty Stage 0 EPO keyword normalization', () => {
  test('normalizes approved EPO title, abstract, and combined keyword fields', () => {
    const service = new NoveltySearchService()

    const normalized = service.normalizeApprovedStage0({
      searchQuery: 'smart irrigation control system',
      inventionFeatures: ['soil moisture valve control'],
      epoTitleKeywords: [' irrigation controller ', 'irrigation controller', '', 'soil water scheduling device'],
      epoAbstractKeywords: ['soil moisture valve control', 'x '.repeat(80)],
      epoCombinedKeywords: ['water scheduling; valve actuation'],
    } as any, 'A smart irrigation controller uses soil moisture valve control.')

    expect(normalized.epoTitleKeywords).toEqual(['irrigation controller', 'soil water scheduling device'])
    expect(normalized.epoAbstractKeywords).toEqual(['soil moisture valve control'])
    expect(normalized.epoCombinedKeywords).toEqual(['water scheduling', 'valve actuation'])
  })
})
