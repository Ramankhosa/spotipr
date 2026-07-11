import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { PatentProviderSearchRequest } from '../types'
import {
  buildGooglePatentsBigQueryForTests,
  GooglePatentsBigQueryProvider,
  hasGooglePatentsBigQueryCredentials,
  setGooglePatentsBigQueryClientFactoryForTests,
} from './google-patents-bigquery-provider'

function request(overrides: Partial<PatentProviderSearchRequest> = {}): PatentProviderSearchRequest {
  return {
    searchMode: 'intelligent',
    query: 'thermal battery controller',
    title: '',
    inventionText: '',
    filters: {},
    jurisdictions: ['US'],
    sourceMode: 'PQAI_ONLY',
    llmExpansion: false,
    limit: 10,
    queryPlan: {
      originalQuery: 'thermal battery controller',
      normalizedQuery: 'thermal battery controller',
      searchQuery: 'thermal battery controller predictive cooling',
      semanticQuery: 'thermal battery controller predictive cooling',
      inventionFeatures: ['predictive cooling controller'],
      technicalKeywords: ['thermal', 'battery', 'controller'],
      synonyms: [],
      mustHaveTerms: ['battery cooling'],
      excludedTerms: ['fuel cell'],
      cpcCodes: ['H01M 10/613'],
      ipcCodes: [],
      classificationHints: ['H01M'],
      googlePatentKeywords: ['thermal battery management'],
      patentSearchConceptGroups: [{
        id: 'core',
        label: 'Core',
        kind: 'core',
        terms: ['cooling load prediction'],
        required: true,
      }],
      fieldFilters: {
        excludeTerms: ['combustion engine'],
      },
      explicitFilters: {},
      searchVariants: ['thermal battery controller'],
      retrievalQueries: [{
        id: 'rq1',
        type: 'feature',
        text: 'battery coolant loop controller',
      }],
      llmExpanded: false,
      confidence: 0.9,
      warnings: [],
      featureDetails: [{
        feature: 'controller predicts battery heat generation',
        embeddingSearchText: 'predictive heat generation control',
      }],
      searchExclusions: ['lead acid'],
    } as any,
    ...overrides,
  }
}

function clearBigQueryEnv() {
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
  delete process.env.GOOGLE_PATENTS_BQ_DRY_RUN
}

describe('GooglePatentsBigQueryProvider', () => {
  beforeEach(() => {
    clearBigQueryEnv()
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project'
    process.env.GOOGLE_PATENTS_BQ_MAX_BYTES_BILLED = '1000000000'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    setGooglePatentsBigQueryClientFactoryForTests(null)
    clearBigQueryEnv()
  })

  test('is enabled only when a project and positive bytes cap are configured', () => {
    expect(hasGooglePatentsBigQueryCredentials()).toBe(true)
    delete process.env.GOOGLE_CLOUD_PROJECT
    expect(hasGooglePatentsBigQueryCredentials()).toBe(false)
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project'
    process.env.GOOGLE_PATENTS_BQ_MAX_BYTES_BILLED = '0'
    expect(hasGooglePatentsBigQueryCredentials()).toBe(false)
  })

  test('builds parameterized GoogleSQL from Stage 0 terms, exclusions and classifications', () => {
    const built = buildGooglePatentsBigQueryForTests(request(), 25)
    expect(built.query).toContain('patents-public-data.google_patents_research.publications')
    expect(built.query).toContain('top_terms')
    expect(built.query.toLowerCase()).not.toContain('claims')
    expect(built.query.toLowerCase()).not.toContain('description_localized')
    expect(built.params.terms).toEqual(expect.arrayContaining([
      'thermal battery management',
      'thermal battery controller predictive cooling',
      'predictive heat generation control',
    ]))
    expect(built.params.excludedTerms).toEqual(expect.arrayContaining([
      'fuel cell',
      'combustion engine',
      'lead acid',
    ]))
    expect(built.params.classifications).toEqual(expect.arrayContaining(['h01m10613', 'h01m']))
    expect(built.params.limit).toBe(25)
  })

  test('runs dry-run guarded BigQuery searches and normalizes returned patent rows', async () => {
    const createQueryJob = vi.fn().mockResolvedValue([{ metadata: { statistics: { totalBytesProcessed: '1000' } } }])
    const query = vi.fn()
      .mockResolvedValueOnce([[
        {
          publication_number: 'US-7650331-B1',
          title: 'Thermal battery controller',
          abstract: 'A controller predicts thermal load and adjusts cooling.',
          url: 'https://patents.google.com/patent/US7650331B1/en',
          country: 'United States',
          cpc_codes: ['H01M10/613'],
          score: 38,
        },
      ]])
      .mockResolvedValueOnce([[
        {
          publication_number: 'US-7650331-B1',
          application_number: 'US-87124404-A',
          country_code: 'US',
          publication_date: 20100119,
          filing_date: 20070102,
          assignees: ['Example Corp'],
          inventors: ['Ada Lovelace'],
          ipc_codes: ['H01M10/00'],
          cpc_codes: ['H01M10/613'],
        },
      ]])
    setGooglePatentsBigQueryClientFactoryForTests(() => ({ createQueryJob, query }))

    const provider = new GooglePatentsBigQueryProvider()
    const results = await provider.search(request())

    expect(createQueryJob).toHaveBeenCalledTimes(2)
    expect(query).toHaveBeenCalledTimes(2)
    expect(query.mock.calls[0][0]).toMatchObject({
      location: 'US',
      maximumBytesBilled: '1000000000',
      useLegacySql: false,
    })
    expect(query.mock.calls[0][0].params.terms).toEqual(expect.arrayContaining(['thermal battery management']))
    expect(results[0]).toMatchObject({
      providerId: 'google-patents-bigquery',
      sourceProvider: 'google-patents-bigquery',
      sourceProviders: ['google-patents-bigquery'],
      publicationNumber: 'US7650331B1',
      title: 'Thermal battery controller',
      abstract: 'A controller predicts thermal load and adjusts cooling.',
      applicationNumber: 'US-87124404-A',
      applicants: ['Example Corp'],
      inventors: ['Ada Lovelace'],
      cpcCodes: ['H01M10/613'],
      ipcCodes: ['H01M10/00'],
      filingDate: '2007-01-02',
      publicationDate: '2010-01-19',
      link: 'https://patents.google.com/patent/US7650331B1/en',
    })
  })

  test('fails with a clear warning-ready error when dry run exceeds the bytes cap', async () => {
    process.env.GOOGLE_PATENTS_BQ_MAX_BYTES_BILLED = '100'
    const createQueryJob = vi.fn().mockResolvedValue([{ metadata: { statistics: { totalBytesProcessed: '101' } } }])
    const query = vi.fn()
    setGooglePatentsBigQueryClientFactoryForTests(() => ({ createQueryJob, query }))

    await expect(new GooglePatentsBigQueryProvider().search(request())).rejects.toThrow(/exceeding the configured BigQuery cap/i)
    expect(query).not.toHaveBeenCalled()
  })
})
