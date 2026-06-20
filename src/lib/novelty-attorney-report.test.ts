import { describe, expect, it } from 'vitest';
import { buildNoveltyAttorneyReportModel } from './novelty-attorney-report';

describe('buildNoveltyAttorneyReportModel', () => {
  it('builds safe title/abstract report sections and side-by-side comparison rows', () => {
    const model = buildNoveltyAttorneyReportModel({
      id: 'search123456789',
      title: 'Soil moisture irrigation controller',
      jurisdiction: 'IN',
      inventionDescription: 'A controller measures soil moisture and modulates irrigation water delivery using threshold logic.',
      config: { searchSource: { mode: 'PQAI_PLUS_INDIAN' } },
      stage0Results: {
        searchQuery: 'soil moisture irrigation controller',
        inventionFeatures: ['soil moisture measurement loop', 'threshold-based irrigation decision rule', 'sensor'],
        noveltyFocus: ['threshold-based irrigation decision rule'],
        featureDetails: [
          {
            feature: 'soil moisture measurement loop',
            feature_type: 'core_technical',
            user_disclosure: 'The invention measures soil moisture in a feedback loop.',
          },
          {
            feature: 'threshold-based irrigation decision rule',
            feature_type: 'novelty_candidate',
            user_disclosure: 'The controller uses threshold logic to decide irrigation delivery.',
          },
          {
            feature: 'sensor',
            feature_type: 'generic_weak',
            user_disclosure: 'The controller uses a sensor.',
          },
        ],
      },
      stage1Results: {
        retrievedCount: 180,
        reviewedCount: 120,
        visibleCount: 30,
        retrievalCandidates: [
          {
            publicationNumber: 'IN123A',
            title: 'Automatic irrigation controller',
            abstract: 'A soil moisture sensor controls irrigation.',
            relevanceScore: 0.82,
            assignees: ['Agro Tech Pvt Ltd'],
            inventors: ['Asha Kumar'],
          },
          {
            publicationNumber: 'IN456A',
            title: 'Irrigation valve timing',
            abstract: 'A valve timing system for irrigation delivery.',
            relevanceScore: 0.61,
            assignees: ['Agro Tech Pvt Ltd'],
            inventors: ['Asha Kumar'],
          },
        ],
        aiRelevance: {
          accepted: ['IN123A'],
          component: ['IN456A'],
          borderline: [],
          byPn: {
            IN123: {
              decision: 'accept',
              score: 0.82,
              rerankScore: 0.82,
              evidence_quality: 'high',
            },
            IN456: {
              decision: 'component',
              score: 0.61,
              rerankScore: 0.61,
              evidence_quality: 'medium',
            },
          },
        },
      },
      stage35Results: {
        feature_map: [
          {
            pn: 'IN123A',
            title: 'Automatic irrigation controller',
            feature_analysis: [
              {
                feature: 'soil moisture measurement loop',
                status: 'Present',
                quote: 'soil moisture sensor controls irrigation',
                field: 'abstract',
              },
              {
                feature: 'threshold-based irrigation decision rule',
                status: 'Absent',
                reason: 'No threshold rule disclosed in the abstract.',
              },
              {
                feature: 'sensor',
                status: 'Present',
                quote: 'soil moisture sensor',
                field: 'abstract',
              },
            ],
          },
          {
            pn: 'IN456A',
            title: 'Irrigation valve timing',
            feature_analysis: [
              {
                feature: 'soil moisture measurement loop',
                status: 'Partial',
                quote: 'irrigation delivery',
                field: 'abstract',
              },
              {
                feature: 'threshold-based irrigation decision rule',
                status: 'Absent',
                reason: 'No threshold rule disclosed in the abstract.',
              },
              {
                feature: 'sensor',
                status: 'Absent',
                reason: 'No sensor disclosed in the abstract.',
              },
            ],
          },
        ],
      },
      stage4Results: {
        decision: 'Partially Novel',
        confidence: 'Medium',
        executive_summary: { summary: 'One close irrigation reference was found.' },
        per_patent_remarks: [
          {
            pn: 'IN123A',
            summary: 'Close irrigation-control reference.',
            novelty_threat: 'obvious',
            comparison_rows: [
              {
                feature_id: 'KF1',
                feature: 'soil moisture measurement loop',
                user_invention_disclosure: 'The invention measures soil moisture in a feedback loop.',
                patent_disclosure: 'The patent discloses soil moisture sensing.',
                status: 'Present',
                evidence_quote: 'soil moisture sensor',
                evidence_source: 'abstract',
                extent_score: 0.88,
                confidence: 0.91,
                attorney_remark: 'This is a direct overlap in the abstract.',
                novelty_impact: 'This feature is materially overlapping.',
                claim_review_note: 'Do not rely on this loop alone for novelty.',
              },
            ],
          },
          {
            pn: 'IN456A',
            summary: 'Related irrigation-control reference.',
            novelty_threat: 'adjacent',
          },
        ],
      },
    });

    expect(model.reportNumber).toMatch(/^PN-NOV-IN-\d{8}-SEARCH12$/);
    expect(model.tableOfContents.map(item => item.title)).toContain('Search Scope and Methodology');
    expect(model.tableOfContents.map(item => item.title)).toContain('Preliminary Claim-Positioning Observations');
    expect(model.evidenceBasis).toContain('Automated patent intelligence');
    expect(model.methodology.searchedEvidence).toContain('title and abstract text');
    expect(model.countLabels.map(item => item.label)).toEqual([
      'Candidate records retrieved/ranked',
      'Shortlisted candidate citations',
      'Direct invention-level mapped citations',
      'Component / feature-level mapped citations',
      'Citations selected for detailed feature mapping',
    ]);
    expect(model.scoringLegend.map(item => item.label)).toEqual(expect.arrayContaining([
      'Retrieval Relevance',
      'Feature Coverage',
      'Evidence Confidence',
      'Absent / weak signal',
    ]));

    expect(model.citations[0]).toMatchObject({ citationNo: 'D1', publicationNumber: 'IN123A' });
    expect(model.citations[0]).toMatchObject({
      matchCategory: 'direct',
      matchCategoryLabel: 'Direct invention-level match',
    });
    expect(model.componentCitations.map(item => item.publicationNumber)).toEqual(['IN456A']);
    expect(model.comparisons[0].technicalDisclosure).toContain('soil moisture sensor');
    expect(model.comparisons[0].rows).toHaveLength(3);
    expect(model.comparisons[0].noveltyThreat).toBe('Related / moderate-overlap');
    expect(model.comparisons[0].claimImpactSummary).toContain('Absent / weak-signal');
    expect(model.comparisons[0].rows[0]).toMatchObject({
      featureNumber: 'KF1',
      userDisclosure: 'The invention measures soil moisture in a feedback loop.',
      patentDisclosure: 'The patent discloses soil moisture sensing.',
      status: 'Present',
      statusLabel: 'Present',
      evidenceSource: 'abstract',
      extentScore: 0.88,
      confidence: 0.91,
      attorneyRemark: 'This is a direct overlap in the abstract.',
      claimReviewNote: 'Do not rely on this loop alone for novelty.',
    });
    expect(model.comparisons[0].rows[1]).toMatchObject({
      featureNumber: 'KF2',
      status: 'Absent',
      statusLabel: 'Absent / weak signal',
      patentDisclosure: 'No threshold rule disclosed in the abstract.',
      evidenceSource: 'none',
      extentScore: null,
    });

    expect(model.featureSummaries[2]).toMatchObject({
      featureNumber: 'KF3',
      type: 'generic_weak',
    });
    expect(model.genericFeatureRisk.features).toContain('sensor');
    expect(model.assigneeLandscape.summary).toContain('repeated entity signal');
    expect(model.inventorSignals.repeated).toEqual([{ name: 'Asha Kumar', count: 2 }]);
    expect(model.reportConfidence.legalConclusion).toBe('Not provided; requires attorney review.');
    expect(model.limitations).toContain('not a legal opinion');
    expect(model.nextSteps).toEqual(expect.arrayContaining([
      'Review the highest-overlap mapped citations at claim level.',
    ]));
    expect(model.counts).toMatchObject({
      searched: 180,
      found: 2,
      directlyRelevant: 1,
      analyzed: 2,
    });
  });
});
