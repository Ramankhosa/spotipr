import { describe, expect, it } from 'vitest';
import { NoveltySearchService } from './novelty-search-service';
import { buildNoveltyAttorneyReportModel } from './novelty-attorney-report';

describe('novelty scholarly-paper integration', () => {
  it('preserves editable paper search fields during Stage 0 normalization', () => {
    const service = new NoveltySearchService();
    const normalized = service.normalizeApprovedStage0({
      searchQuery: 'patent search query',
      inventionFeatures: ['A sensing mechanism'],
      paperSearchQuery: 'sensing mechanism measurement study',
      paperKeywords: ['sensing mechanism', 'measurement method'],
    }, 'A sensing mechanism measures a technical condition.');

    expect(normalized.paperSearchQuery).toBe('sensing mechanism measurement study');
    expect(normalized.paperKeywords).toEqual(['sensing mechanism', 'measurement method']);
  });

  it('includes scholarly metadata in the attorney report comparison', () => {
    const paperId = 'PAPER:0123456789ABCDEF';
    const report = buildNoveltyAttorneyReportModel({
      id: 'search-1',
      title: 'Test invention',
      jurisdiction: 'IN',
      inventionDescription: 'A sensing mechanism.',
      config: {
        searchSource: {
          includePatents: false,
          includePapers: true,
          paperSources: ['google_scholar'],
        },
      },
      stage0Results: {
        searchQuery: 'sensing mechanism',
        inventionFeatures: ['A sensing mechanism'],
      },
      stage1Results: {
        retrievalCandidates: [{
          id: paperId,
          pn: paperId,
          publicationNumber: paperId,
          referenceType: 'paper',
          title: 'Prior sensing research',
          abstract: 'A sensing mechanism detects the condition.',
          authors: ['A. Author', 'B. Author'],
          year: 2020,
          venue: 'Journal of Sensors',
          doi: '10.1000/sensors',
          link: 'https://doi.org/10.1000/sensors',
          sourceProvider: 'google_scholar',
          sourceProviders: ['google_scholar'],
          citationCount: 42,
        }],
        paperCount: 1,
        patentCount: 0,
        aiRelevance: {
          byPn: {
            [paperId]: { pn: paperId, decision: 'accept', score: 0.9, evidence_quality: 'high' },
          },
          accepted: [paperId],
        },
      },
      stage35Results: {
        feature_map: [{
          pn: paperId,
          title: 'Prior sensing research',
          feature_analysis: [{
            feature: 'A sensing mechanism',
            status: 'Present',
            evidence_quote: 'A sensing mechanism detects the condition.',
            evidence_source: 'abstract',
            confidence: 0.9,
          }],
        }],
      },
      stage4Results: { per_patent_remarks: [] },
    });

    expect(report.comparisons[0]).toMatchObject({
      referenceType: 'paper',
      authors: 'A. Author, B. Author',
      venue: 'Journal of Sensors',
      doi: '10.1000/sensors',
      citationCount: 42,
    });
    expect(report.methodology.corpus).toContain('Scholarly papers');
    expect(report.countLabels).toContainEqual({ label: 'Scholarly papers retrieved', value: 1 });
  });
});
