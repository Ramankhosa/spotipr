import { describe, expect, test } from 'vitest';
import {
  DEFAULT_STAGE1_RESULT_FILTERS,
  filterAndPaginateStage1Results,
  filterStage1Results,
  getRawStage1SearchResults,
  getStage1ScorePercent,
  type Stage1ResultFilters,
} from '@/lib/novelty-stage1-results';

const filters = (overrides: Partial<Stage1ResultFilters> = {}): Stage1ResultFilters => ({
  ...DEFAULT_STAGE1_RESULT_FILTERS,
  ...overrides,
});

describe('novelty Stage 1 result helpers', () => {
  test('raw search results prefer retrieval candidates over relevance-visible matches', () => {
    const results = {
      stage1: {
        retrievalCandidates: [
          { publicationNumber: 'RAW-1' },
          { publicationNumber: 'RAW-2' },
        ],
        visiblePriorArtResults: [
          { publicationNumber: 'VISIBLE-1' },
        ],
        pqaiResults: [
          { publicationNumber: 'VISIBLE-1' },
        ],
      },
    };

    expect(getRawStage1SearchResults(results).map(item => item.publicationNumber)).toEqual(['RAW-1', 'RAW-2']);
  });

  test('pagination splits 45 results into three pages at page size 20', () => {
    const results = Array.from({ length: 45 }, (_, index) => ({
      publicationNumber: `IN${index + 1}`,
      title: `Patent ${index + 1}`,
    }));

    const firstPage = filterAndPaginateStage1Results(results, filters(), 1, 20);
    const thirdPage = filterAndPaginateStage1Results(results, filters(), 3, 20);

    expect(firstPage.totalPages).toBe(3);
    expect(firstPage.items).toHaveLength(20);
    expect(firstPage.startIndex).toBe(1);
    expect(firstPage.endIndex).toBe(20);
    expect(thirdPage.items).toHaveLength(5);
    expect(thirdPage.startIndex).toBe(41);
    expect(thirdPage.endIndex).toBe(45);
  });

  test('provider filter narrows results using merged provider fields', () => {
    const results = [
      { publicationNumber: 'P1', sourceProvider: 'pqai' },
      { publicationNumber: 'P2', sourceProviders: ['indian-corpus', 'pqai'] },
      { publicationNumber: 'P3', providerId: 'epo-ops' },
    ];

    const filtered = filterStage1Results(results, filters({ provider: 'indian-corpus' }));

    expect(filtered.map(item => item.result.publicationNumber)).toEqual(['P2']);
  });

  test('matched item filter works for matched fields and retrieval match text', () => {
    const results = [
      { publicationNumber: 'P1', matchedFields: ['title'] },
      {
        publicationNumber: 'P2',
        retrievalMatches: [
          { queryText: 'encoder synchronization', featureLabels: ['rotating pipe'] },
        ],
      },
    ];

    expect(filterStage1Results(results, filters({ matchedItem: 'title' })).map(item => item.result.publicationNumber)).toEqual(['P1']);
    expect(filterStage1Results(results, filters({ matchedItem: 'encoder synchronization' })).map(item => item.result.publicationNumber)).toEqual(['P2']);
    expect(filterStage1Results(results, filters({ matchedItem: 'rotating pipe' })).map(item => item.result.publicationNumber)).toEqual(['P2']);
  });

  test('keyword search covers key displayed patent fields', () => {
    const cases = [
      ['patent number', 'IN2024001', { publicationNumber: 'IN2024001' }],
      ['title', 'synchronization', { title: 'Pipe synchronization marker' }],
      ['abstract', 'tamper', { abstract: 'Tamper evidence capture workflow' }],
      ['applicant', 'Acme', { applicants: ['Acme Research'] }],
      ['inventor', 'Kumar', { inventors: ['Anita Kumar'] }],
      ['classification', 'G06F', { classifications: ['G06F 21/64'] }],
      ['source pdf', 'archive', { sourcePdfName: 'archive-import.pdf' }],
    ] as const;

    cases.forEach(([label, keyword, extra], index) => {
      const results = [
        { publicationNumber: `NOISE-${label}`, title: 'unrelated' },
        { publicationNumber: `MATCH-${index}`, ...extra },
      ];

      const filtered = filterStage1Results(results, filters({ keyword }));
      const expectedPublicationNumber = 'publicationNumber' in extra ? extra.publicationNumber : `MATCH-${index}`;

      expect(filtered.map(item => item.result.publicationNumber)).toEqual([expectedPublicationNumber]);
    });
  });

  test('score filter handles 0-1 and 0-100 score values', () => {
    const results = [
      { publicationNumber: 'P1', relevanceScore: 0.72 },
      { publicationNumber: 'P2', score: 72 },
      { publicationNumber: 'P3', relevance: 0.39 },
    ];

    const filtered = filterStage1Results(results, filters({ minScore: '60' }));

    expect(getStage1ScorePercent(results[0])).toBe(72);
    expect(getStage1ScorePercent(results[1])).toBe(72);
    expect(filtered.map(item => item.result.publicationNumber)).toEqual(['P1', 'P2']);
  });

  test('year range and sort options behave deterministically', () => {
    const results = [
      { publicationNumber: 'P1', publicationDate: '2019-02-01', relevanceScore: 0.9 },
      { publicationNumber: 'P2', publicationDate: '2025-04-10', relevanceScore: 0.7 },
      { publicationNumber: 'P3', publication_date: '2021-08-11', relevanceScore: 0.8 },
    ];

    const oldest = filterStage1Results(results, filters({
      publicationYearFrom: '2020',
      publicationYearTo: '2025',
      sort: 'oldest',
    }));
    const newest = filterStage1Results(results, filters({
      publicationYearFrom: '2020',
      publicationYearTo: '2025',
      sort: 'newest',
    }));

    expect(oldest.map(item => item.result.publicationNumber)).toEqual(['P3', 'P2']);
    expect(newest.map(item => item.result.publicationNumber)).toEqual(['P2', 'P3']);
  });
});
