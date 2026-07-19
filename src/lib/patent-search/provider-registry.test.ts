import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { LOCAL_CORPUS_PROVIDER_IDS, resolveFallbackProviderIds, resolveProviderIds } from './provider-registry'

describe('patent search provider registry', () => {
  const clearEnv = () => {
    delete process.env.PATENTSVIEW_API_KEY
    delete process.env.USPTO_PATENTSVIEW_API_KEY
    delete process.env.IP_AUSTRALIA_CLIENT_ID
    delete process.env.IP_AUSTRALIA_CLIENT_SECRET
    delete process.env.EPO_KEY
    delete process.env.EPO_SECRET
    delete process.env.EPO_OPS_CONSUMER_KEY
    delete process.env.EPO_OPS_CONSUMER_SECRET
    delete process.env.Serp_API_KEY
    delete process.env.SERP_API_KEY
    delete process.env.SERPAPI_API_KEY
    delete process.env.GOOGLE_CLOUD_PROJECT
    delete process.env.GOOGLE_PROJECT_ID
    delete process.env.GCP_PROJECT_ID
    delete process.env.BIGQUERY_PROJECT_ID
    delete process.env.GOOGLE_CLOUD_PROJECT_ID
    delete process.env.GCLOUD_PROJECT
    delete process.env.BIGQUERY_BILLING_PROJECT
    delete process.env.GOOGLE_PATENTS_BQ_MAX_BYTES_BILLED
    delete process.env.GOOGLE_PATENTS_BIGQUERY_MAX_BYTES_BILLED
    delete process.env.GOOGLE_BIGQUERY_MAX_BYTES_BILLED
    delete process.env.BIGQUERY_MAX_BYTES_BILLED
  }

  beforeEach(clearEnv)
  afterEach(clearEnv)

  describe('primary lane', () => {
    test('defaults to the local corpus rather than any live provider', () => {
      expect(resolveProviderIds({})).toEqual(['google-patents-corpus', 'indian-corpus'])
      expect(resolveProviderIds({})).toEqual(LOCAL_CORPUS_PROVIDER_IDS)
    })

    test('keeps the local corpus default even when every live credential is present', () => {
      process.env.Serp_API_KEY = 'test-serp'
      process.env.EPO_KEY = 'test-key'
      process.env.EPO_SECRET = 'test-secret'
      process.env.GOOGLE_CLOUD_PROJECT = 'test-project'
      process.env.GOOGLE_PATENTS_BQ_MAX_BYTES_BILLED = '1000000000'
      expect(resolveProviderIds({ jurisdictions: ['US', 'EP'] })).toEqual(['google-patents-corpus', 'indian-corpus'])
    })

    test('keeps explicit India-only mode isolated to the Indian corpus', () => {
      expect(resolveProviderIds({ sourceMode: 'INDIAN_ONLY' })).toEqual(['indian-corpus'])
    })

    test('resolves EPO-only mode to the stored European corpus, adding live OPS when credentials exist', () => {
      expect(resolveProviderIds({ sourceMode: 'EPO_ONLY' })).toEqual(['epo-ops-corpus'])
      process.env.EPO_KEY = 'test-key'
      process.env.EPO_SECRET = 'test-secret'
      expect(resolveProviderIds({ sourceMode: 'EPO_ONLY' })).toEqual(['epo-ops', 'epo-ops-corpus'])
    })

    test('falls back to the local corpus for Australia-only mode without credentials', () => {
      expect(resolveProviderIds({ sourceMode: 'AUSTRALIA_ONLY' })).toEqual(['google-patents-corpus', 'indian-corpus'])
      process.env.IP_AUSTRALIA_CLIENT_ID = 'test-client'
      process.env.IP_AUSTRALIA_CLIENT_SECRET = 'test-secret'
      expect(resolveProviderIds({ sourceMode: 'AUSTRALIA_ONLY' })).toEqual(['ip-australia'])
    })

    test('honors explicit provider ids for checkbox source selection', () => {
      process.env.Serp_API_KEY = 'test-serp'
      expect(resolveProviderIds({ providerIds: ['indian-corpus', 'google-patents'] }))
        .toEqual(['indian-corpus', 'google-patents'])
    })

    test('links explicit European corpus selection to live OPS when credentials exist', () => {
      process.env.EPO_KEY = 'test-key'
      process.env.EPO_SECRET = 'test-secret'
      expect(resolveProviderIds({ providerIds: ['epo-ops-corpus'], sourceMode: 'EPO_ONLY' }))
        .toEqual(['epo-ops', 'epo-ops-corpus'])
    })

    test('can keep explicit European corpus selection stored-only for batch drafting', () => {
      process.env.EPO_KEY = 'test-key'
      process.env.EPO_SECRET = 'test-secret'
      expect(resolveProviderIds({
        providerIds: ['epo-ops-corpus', 'indian-corpus'],
        disableLinkedProviderExpansion: true,
      })).toEqual(['epo-ops-corpus', 'indian-corpus'])
    })

    test('uses stored European corpus when explicit OPS selection has no credentials', () => {
      expect(resolveProviderIds({ providerIds: ['epo-ops'], sourceMode: 'EPO_ONLY' }))
        .toEqual(['epo-ops-corpus'])
    })
  })

  describe('PQAI is disabled', () => {
    test('never resolves PQAI providers from a legacy source mode', () => {
      for (const sourceMode of [
        'PQAI_ONLY',
        'PQAI_PLUS_INDIAN',
        'PQAI_PLUS_AUSTRALIA',
        'PQAI_PLUS_EPO',
        'PQAI_PLUS_INDIAN_EPO',
      ]) {
        const resolved = resolveProviderIds({ sourceMode })
        expect(resolved).not.toContain('pqai')
        expect(resolved).not.toContain('pqai-corpus')
      }
    })

    test('strips PQAI out of an explicit saved provider selection', () => {
      expect(resolveProviderIds({ providerIds: ['pqai-corpus', 'indian-corpus', 'pqai'] }))
        .toEqual(['indian-corpus'])
    })

    test('falls back to the local corpus when a saved selection contains only PQAI', () => {
      expect(resolveProviderIds({ providerIds: ['pqai', 'pqai-corpus'] }))
        .toEqual(['google-patents-corpus', 'indian-corpus'])
    })

    test('never offers PQAI as a fallback provider', () => {
      const fallbacks = resolveFallbackProviderIds({})
      expect(fallbacks).not.toContain('pqai')
      expect(fallbacks).not.toContain('pqai-corpus')
    })
  })

  describe('fallback lane', () => {
    test('offers nothing when no live credentials are configured', () => {
      expect(resolveFallbackProviderIds({ jurisdictions: ['EP'] })).toEqual([])
    })

    test('offers Google Patents once SerpApi is configured', () => {
      process.env.Serp_API_KEY = 'test-serp'
      expect(resolveFallbackProviderIds({ jurisdictions: ['EP'] })).toEqual(['google-patents'])
    })

    test('scopes jurisdiction-specific providers to the requested jurisdictions', () => {
      process.env.EPO_KEY = 'test-key'
      process.env.EPO_SECRET = 'test-secret'
      process.env.IP_AUSTRALIA_CLIENT_ID = 'test-client'
      process.env.IP_AUSTRALIA_CLIENT_SECRET = 'test-secret'

      expect(resolveFallbackProviderIds({ jurisdictions: ['EP'] })).toEqual(['epo-ops'])
      expect(resolveFallbackProviderIds({ jurisdictions: ['AU'] })).toEqual(['ip-australia'])
      expect(resolveFallbackProviderIds({ jurisdictions: ['US'] })).toEqual(['patentsview'])
    })

    test('offers every credentialed provider when no jurisdiction narrows the search', () => {
      process.env.EPO_KEY = 'test-key'
      process.env.EPO_SECRET = 'test-secret'
      expect(resolveFallbackProviderIds({})).toEqual(['epo-ops', 'patentsview'])
    })

    test('does not re-dispatch a provider the primary lane already searched', () => {
      process.env.EPO_KEY = 'test-key'
      process.env.EPO_SECRET = 'test-secret'
      expect(resolveFallbackProviderIds({ jurisdictions: ['EP'], alreadySearched: ['epo-ops'] }))
        .toEqual([])
    })
  })
})

describe('super-admin provider gates', () => {
  const clearAll = () => {
    delete process.env.EPO_KEY
    delete process.env.EPO_SECRET
    delete process.env.Serp_API_KEY
    delete process.env.PATENTSVIEW_API_KEY
  }
  beforeEach(clearAll)
  afterEach(clearAll)

  test('a disabled provider is removed from the default corpus lane', () => {
    expect(resolveProviderIds({ adminDisabled: new Set(['google-patents-corpus' as any]) }))
      .toEqual(['indian-corpus'])
  })

  test('a disabled provider is removed from an explicit selection', () => {
    expect(resolveProviderIds({
      providerIds: ['indian-corpus', 'google-patents-corpus'],
      adminDisabled: new Set(['indian-corpus' as any]),
    })).toEqual(['google-patents-corpus'])
  })

  test('disabling every corpus provider yields an empty lane rather than a silent fallback', () => {
    // The caller must be able to see that admin config left nothing to search,
    // instead of the registry quietly substituting providers that were turned off.
    expect(resolveProviderIds({
      adminDisabled: new Set(['google-patents-corpus' as any, 'indian-corpus' as any]),
    })).toEqual([])
  })

  test('a disabled provider is removed from an expanded EPO selection', () => {
    process.env.EPO_KEY = 'k'
    process.env.EPO_SECRET = 's'
    expect(resolveProviderIds({
      providerIds: ['epo-ops-corpus'],
      adminDisabled: new Set(['epo-ops' as any]),
    })).toEqual(['epo-ops-corpus'])
  })

  test('fallbackBlocked keeps a provider out of the fallback lane', () => {
    process.env.Serp_API_KEY = 'k'
    expect(resolveFallbackProviderIds({})).toEqual(['google-patents', 'patentsview'])
    expect(resolveFallbackProviderIds({ fallbackBlocked: new Set(['google-patents' as any]) }))
      .toEqual(['patentsview'])
  })
})

describe('admin gates cannot be bypassed by the corpus substitute', () => {
  test('a retired-only selection does not reintroduce an admin-disabled corpus provider', () => {
    // PQAI-only selections fall back to the corpus lane. That substitute must respect
    // admin gating too, or turning a provider off would silently fail to take effect.
    expect(resolveProviderIds({
      providerIds: ['pqai', 'pqai-corpus'],
      adminDisabled: new Set(['indian-corpus' as any]),
    })).toEqual(['google-patents-corpus'])
  })
})
