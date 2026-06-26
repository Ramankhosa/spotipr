import { describe, expect, test } from 'vitest'
import {
  buildManualPatentSearchQueryPlan,
  createPatentSearchQueryPlan,
  buildDeterministicPatentSearchQueryPlan,
  parsePatentSearchPlannerResponse,
} from '@/lib/patent-search/query-planner'
import { canonicalPublicationNumber, mergeFilters, normalizeClassification } from '@/lib/patent-search/utils'

describe('patent search query planner', () => {
  test('parses explicit fielded filters from a query', () => {
    const plan = buildDeterministicPatentSearchQueryPlan({
      query: 'title:"hydrogen storage" applicant:IIT ipc:C01B 3/00 from:2026-01-01',
      filters: { inventors: ['Anand Kumar'] },
      llmExpansion: false,
    })

    expect(plan.searchQuery).toContain('hydrogen storage')
    expect(plan.fieldFilters.applicants).toEqual(['IIT'])
    expect(plan.fieldFilters.inventors).toEqual(['Anand Kumar'])
    expect(plan.fieldFilters.ipcCodes).toEqual(['C01B 3/00'])
    expect(plan.fieldFilters.publicationDateFrom).toBe('2026-01-01')
  })

  test('normalizes split and compact classification forms', () => {
    expect(normalizeClassification('C07D | 471 / 04')).toBe('C07D 471/04')
    expect(normalizeClassification(':E04H0009020000')).toBe('E04H0009020000')
  })

  test('keeps explicit filters when merging inferred filters', () => {
    const merged = mergeFilters(
      { applicants: ['Inferred Applicant'], classifications: ['G06F 17/30'] },
      { applicants: ['User Applicant'], publicationNumber: '202411077405A' }
    )

    expect(merged.applicants).toEqual(['Inferred Applicant', 'User Applicant'])
    expect(merged.publicationNumber).toBe('202411077405A')
    expect(merged.classifications).toEqual(['G06F 17/30'])
  })

  test('parses balanced JSON from an LLM response', () => {
    const parsed = parsePatentSearchPlannerResponse('noise {"searchQuery":"milk urea test","warnings":[]} tail')
    expect(parsed.searchQuery).toBe('milk urea test')
  })

  test('canonicalizes patent numbers for dedupe', () => {
    expect(canonicalPublicationNumber('IN202411077405A')).toBe('IN202411077405')
  })

  test('builds manual fielded plans without LLM expansion', async () => {
    const plan = await createPatentSearchQueryPlan({
      searchMode: 'manual',
      llmExpansion: true,
      filters: {
        titleContains: ['hydrogen storage'],
        applicants: ['IIT Delhi, CSIR'],
        excludeTerms: ['battery\nvehicle'],
      },
    })

    expect(plan.llmExpanded).toBe(false)
    expect(plan.confidence).toBe(1)
    expect(plan.fieldFilters.titleContains).toEqual(['hydrogen storage'])
    expect(plan.fieldFilters.applicants).toEqual(['IIT Delhi', 'CSIR'])
    expect(plan.fieldFilters.excludeTerms).toEqual(['battery', 'vehicle'])
  })

  test('uses manual query text as any-text contains when no explicit any-text field is supplied', () => {
    const plan = buildManualPatentSearchQueryPlan({
      searchMode: 'manual',
      query: 'milk urea rapid detection',
      filters: { inventors: ['Sharma'] },
    })

    expect(plan.searchQuery).toContain('milk urea rapid detection')
    expect(plan.fieldFilters.anyTextContains).toEqual(['milk urea rapid detection'])
    expect(plan.fieldFilters.inventors).toEqual(['Sharma'])
  })

  test('maps manual title and abstract filters to EPO keyword fields only for EPO searches', () => {
    const epoPlan = buildManualPatentSearchQueryPlan({
      searchMode: 'manual',
      sourceMode: 'EPO_ONLY',
      filters: {
        titleContains: ['irrigation controller'],
        abstractContains: ['soil moisture valve control'],
        anyTextContains: ['water scheduling'],
      },
    })
    const indianPlan = buildManualPatentSearchQueryPlan({
      searchMode: 'manual',
      sourceMode: 'INDIAN_ONLY',
      filters: {
        titleContains: ['irrigation controller'],
        abstractContains: ['soil moisture valve control'],
        anyTextContains: ['water scheduling'],
      },
    })

    expect(epoPlan.epoTitleKeywords).toEqual(['irrigation controller'])
    expect(epoPlan.epoAbstractKeywords).toEqual(['soil moisture valve control'])
    expect(epoPlan.epoCombinedKeywords).toEqual(['water scheduling'])
    expect(indianPlan.fieldFilters.titleContains).toEqual(['irrigation controller'])
    expect(indianPlan.fieldFilters.abstractContains).toEqual(['soil moisture valve control'])
    expect(indianPlan.epoTitleKeywords).toBeUndefined()
    expect(indianPlan.epoAbstractKeywords).toBeUndefined()
    expect(indianPlan.epoCombinedKeywords).toBeUndefined()
  })
})
