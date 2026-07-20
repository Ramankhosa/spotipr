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
      paperSearchQueries: ['sensing mechanism study', 'technical condition measurement'],
      googleScholarSearchQuery: '"sensing mechanism" "technical condition"',
      academicDatabaseSearchQuery: 'sensing mechanism technical condition measurement',
      paperYearFrom: 1900,
      paperYearTo: 2026,
    }, 'A sensing mechanism measures a technical condition.');

    expect(normalized.paperSearchQuery).toBe('sensing mechanism measurement study');
    expect(normalized.paperKeywords).toEqual(['sensing mechanism', 'measurement method']);
    expect(normalized.paperSearchQueries).toEqual(['sensing mechanism study', 'technical condition measurement']);
    expect(normalized.googleScholarSearchQuery).toBe('"sensing mechanism" "technical condition"');
    expect(normalized.academicDatabaseSearchQuery).toBe('sensing mechanism technical condition measurement');
    expect(normalized.paperYearFrom).toBe(1900);
    expect(normalized.paperYearTo).toBe(2026);
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
      stage4Results: {
        per_patent_remarks: [{
          pn: paperId,
          title: 'Prior sensing research',
          remarks: 'The paper maps the sensing mechanism but does not describe the claimed control relationship.',
          summary: 'The paper maps the sensing mechanism but does not describe the claimed control relationship.',
          overlap_features: ['A sensing mechanism'],
          missing_features: [],
        }],
      },
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
    expect(report.paperCitations).toHaveLength(1);
    expect(report.patentCitations).toHaveLength(0);
    expect(report.paperComparisons[0].summary).toContain('maps the sensing mechanism');
    expect(report.tableOfContents).toContainEqual({ number: '2.2.1', title: 'Prior sensing research' });
  });

  it('omits scholarly sections and counts when publications are not selected', () => {
    const report = buildNoveltyAttorneyReportModel({
      id: 'patent-only-search',
      title: 'Patent-only invention',
      jurisdiction: 'IN',
      inventionDescription: 'A technical mechanism.',
      config: { searchSource: { includePatents: true, includePapers: false, mode: 'INDIAN_ONLY' } },
      stage0Results: { searchQuery: 'technical mechanism', inventionFeatures: ['A technical mechanism'] },
      stage1Results: { retrievalCandidates: [], patentCount: 0, paperCount: 0 },
      stage35Results: { feature_map: [] },
      stage4Results: {},
    });

    expect(report.paperCitations).toEqual([]);
    expect(report.paperComparisons).toEqual([]);
    expect(report.countLabels.some(item => item.label === 'Scholarly papers retrieved')).toBe(false);
    expect(report.tableOfContents.some(item => item.title === 'Relevant Scholarly Publications')).toBe(false);
    expect(report.tableOfContents).toContainEqual({ number: '2.2', title: 'Appendix B: Shortlisted but Unmapped Citations' });
  });
});
