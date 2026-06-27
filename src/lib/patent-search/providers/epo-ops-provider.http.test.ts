import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const persistPatentResultsToCorpus = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('@/lib/patent-corpus-service', () => ({
  PATENT_CORPUS_SOURCE_EPO: 'epo-ops',
  persistPatentResultsToCorpus,
}))

import { EpoOpsProvider, resetEpoOpsTokenCacheForTests } from './epo-ops-provider'
import type { PatentProviderSearchRequest } from '../types'

const searchXml = `<?xml version="1.0" encoding="UTF-8"?>
<ops:world-patent-data xmlns:ops="http://ops.epo.org" xmlns="http://www.epo.org/exchange">
  <exchange-documents>
    <exchange-document country="EP" doc-number="1234567" kind="A1">
      <bibliographic-data>
        <publication-reference>
          <document-id document-id-type="epodoc">
            <doc-number>EP1234567</doc-number><kind>A1</kind><date>20240115</date>
          </document-id>
        </publication-reference>
        <application-reference>
          <document-id document-id-type="epodoc">
            <doc-number>EP2023000001</doc-number><date>20230110</date>
          </document-id>
        </application-reference>
        <invention-title lang="en">Wearable health monitor</invention-title>
        <parties>
          <applicants><applicant><applicant-name><name>Example Applicant</name></applicant-name></applicant></applicants>
          <inventors><inventor><inventor-name><name>Example Inventor</name></inventor-name></inventor></inventors>
        </parties>
      </bibliographic-data>
      <abstract lang="en"><p>Continuous wearable temperature and heart-rate monitoring.</p></abstract>
    </exchange-document>
  </exchange-documents>
</ops:world-patent-data>`

function request(): PatentProviderSearchRequest {
  return {
    searchMode: 'manual',
    query: '',
    title: '',
    inventionText: '',
    filters: {},
    jurisdictions: ['EP'],
    sourceMode: 'EPO_ONLY',
    llmExpansion: false,
    limit: 10,
    queryPlan: {
      originalQuery: '',
      normalizedQuery: '',
      searchQuery: '',
      semanticQuery: '',
      inventionFeatures: [],
      technicalKeywords: [],
      synonyms: [],
      mustHaveTerms: [],
      excludedTerms: [],
      cpcCodes: [],
      ipcCodes: [],
      classificationHints: [],
      fieldFilters: { titleContains: ['wearable health monitor'] },
      explicitFilters: {},
      searchVariants: [],
      llmExpanded: false,
      confidence: 1,
      warnings: [],
    },
  }
}

describe('EpoOpsProvider HTTP search', () => {
  beforeEach(() => {
    process.env.EPO_KEY = 'test-key'
    process.env.EPO_SECRET = 'test-secret'
    resetEpoOpsTokenCacheForTests()
    persistPatentResultsToCorpus.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.EPO_KEY
    delete process.env.EPO_SECRET
    resetEpoOpsTokenCacheForTests()
  })

  test('authenticates and sends keyword CQL to the live bibliographic endpoint', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'ops-token', expires_in: 1200 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(searchXml, {
        status: 200,
        headers: { 'Content-Type': 'application/exchange+xml' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    const results = await new EpoOpsProvider().search(request())

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [searchUrl, searchOptions] = fetchMock.mock.calls[1]
    expect(String(searchUrl)).toContain('/published-data/search/biblio?q=')
    expect(decodeURIComponent(String(searchUrl))).toContain('ti="wearable health monitor"')
    expect(searchOptions.headers.Authorization).toBe('Bearer ops-token')
    expect(searchOptions.headers['X-OPS-Range']).toBe('1-10')
    expect(results).toMatchObject([{
      providerId: 'epo-ops',
      publicationNumber: 'EP1234567A1',
      title: 'Wearable health monitor',
      abstract: 'Continuous wearable temperature and heart-rate monitoring.',
    }])
    expect(persistPatentResultsToCorpus).toHaveBeenCalledWith(results, expect.objectContaining({
      providerId: 'epo-ops',
      corpusSource: 'epo-ops',
    }))
  })
})
