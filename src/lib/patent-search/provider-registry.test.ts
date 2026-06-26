import { afterEach, describe, expect, test } from 'vitest'
import { resolveProviderIds } from './provider-registry'

describe('patent search provider registry', () => {
  afterEach(() => {
    delete process.env.PATENTSVIEW_API_KEY
    delete process.env.USPTO_PATENTSVIEW_API_KEY
    delete process.env.IP_AUSTRALIA_CLIENT_ID
    delete process.env.IP_AUSTRALIA_CLIENT_SECRET
    delete process.env.EPO_KEY
    delete process.env.EPO_SECRET
    delete process.env.EPO_OPS_CONSUMER_KEY
    delete process.env.EPO_OPS_CONSUMER_SECRET
  })

  test('resolves PQAI-only mode to stored PQAI corpus plus live PQAI', () => {
    expect(resolveProviderIds({ sourceMode: 'PQAI_ONLY' })).toEqual(['pqai-corpus', 'pqai'])
  })

  test('does not auto-add USPTO while PatentsView is temporarily disabled', () => {
    process.env.PATENTSVIEW_API_KEY = 'test-key'
    expect(resolveProviderIds({ sourceMode: 'PQAI_ONLY', jurisdictions: ['US'] })).toEqual(['pqai-corpus', 'pqai'])
  })

  test('adds IP Australia to AU PQAI searches when OAuth credentials are configured', () => {
    process.env.IP_AUSTRALIA_CLIENT_ID = 'test-client'
    process.env.IP_AUSTRALIA_CLIENT_SECRET = 'test-secret'
    expect(resolveProviderIds({ sourceMode: 'PQAI_ONLY', jurisdictions: ['AU'] })).toEqual(['ip-australia', 'pqai-corpus', 'pqai'])
  })

  test('resolves mixed mode to Indian corpus, stored PQAI corpus, and live PQAI', () => {
    expect(resolveProviderIds({ sourceMode: 'PQAI_PLUS_INDIAN' })).toEqual(['indian-corpus', 'pqai-corpus', 'pqai'])
  })

  test('keeps India-only mode isolated from PQAI corpus records', () => {
    expect(resolveProviderIds({ sourceMode: 'INDIAN_ONLY' })).toEqual(['indian-corpus'])
    expect(resolveProviderIds({ jurisdictions: ['IN'] })).toEqual(['indian-corpus'])
  })

  test('keeps Australia-only mode isolated to IP Australia', () => {
    expect(resolveProviderIds({ sourceMode: 'AUSTRALIA_ONLY' })).toEqual(['ip-australia'])
  })

  test('resolves EPO-only mode to stored European corpus and live OPS when credentials exist', () => {
    expect(resolveProviderIds({ sourceMode: 'EPO_ONLY' })).toEqual(['epo-ops-corpus'])
    process.env.EPO_KEY = 'test-key'
    process.env.EPO_SECRET = 'test-secret'
    expect(resolveProviderIds({ sourceMode: 'EPO_ONLY' })).toEqual(['epo-ops-corpus', 'epo-ops'])
  })

  test('adds EPO providers to EP jurisdiction searches', () => {
    process.env.EPO_KEY = 'test-key'
    process.env.EPO_SECRET = 'test-secret'
    expect(resolveProviderIds({ sourceMode: 'PQAI_ONLY', jurisdictions: ['EP'] })).toEqual(['epo-ops-corpus', 'epo-ops', 'pqai-corpus', 'pqai'])
  })
})
