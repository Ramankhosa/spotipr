import { describe, expect, test } from 'vitest'
import { resolveProviderIds } from './provider-registry'

describe('patent search provider registry', () => {
  test('resolves PQAI-only mode to stored PQAI corpus plus live PQAI', () => {
    expect(resolveProviderIds({ sourceMode: 'PQAI_ONLY' })).toEqual(['pqai-corpus', 'pqai'])
  })

  test('resolves mixed mode to Indian corpus, stored PQAI corpus, and live PQAI', () => {
    expect(resolveProviderIds({ sourceMode: 'PQAI_PLUS_INDIAN' })).toEqual(['indian-corpus', 'pqai-corpus', 'pqai'])
  })

  test('keeps India-only mode isolated from PQAI corpus records', () => {
    expect(resolveProviderIds({ sourceMode: 'INDIAN_ONLY' })).toEqual(['indian-corpus'])
    expect(resolveProviderIds({ jurisdictions: ['IN'] })).toEqual(['indian-corpus'])
  })
})
