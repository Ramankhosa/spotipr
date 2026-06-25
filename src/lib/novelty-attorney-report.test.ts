import { describe, expect, it } from 'vitest';
import { buildNoveltyAttorneyReportModel } from './novelty-attorney-report';

describe('buildNoveltyAttorneyReportModel', () => {
  it('builds professional preliminary assessment sections and side-by-side comparison rows', () => {
    const model = buildNoveltyAttorneyReportModel({
      id: 'search123456789',
      title: 'Soil moisture irrigation controller',
      jurisdiction: 'IN',
      inventionDescription: 'A controller measures soil moisture and modulates irrigation water delivery using threshold logic.',
      config: { searchSource: { mode: 'PQAI_PLUS_INDIAN' } },
      stage0Results: {
        searchQuery: 'soil moisture irrigation controller',
        inventionFeatures: ['soil moisture measurement loop', 'threshold-based irrigation decision rule', 'sensor', 'unsupported dosing signal'],
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
              {
                feature: 'unsupported dosing signal',
                status: 'Present',
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
              {
                feature: 'unsupported dosing signal',
                status: 'Unknown',
                reason: 'Evidence is too thin.',
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
                professional_remark: 'The reference teaches soil moisture sensing in the irrigation controller, so claim drafting should focus on the narrower threshold-control rule.',
              },
              {
                feature_id: 'KF2',
                feature: 'threshold-based irrigation decision rule',
                user_invention_disclosure: 'The controller uses threshold logic to decide irrigation delivery.',
                patent_disclosure: 'The patent controls irrigation without disclosing the submitted threshold decision rule.',
                status: 'Absent',
                evidence_quote: '',
                evidence_source: 'none',
                extent_score: 0.08,
                confidence: 0.84,
                attorney_remark: 'Attorney remark: The reference lacks the threshold-triggered sequence. Novelty impact: potential distinction. Claim review note: emphasize threshold inputs.',
                novelty_impact: 'The threshold sequence is a mapped technical difference from this reference.',
                claim_review_note: 'State the threshold inputs and resulting control transition expressly.',
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
    expect(model.tableOfContents.map(item => item.title)).toContain('Claim-Positioning Observations');
    expect(model.tableOfContents).toContainEqual({ number: '1', title: 'Search Overview' });
    expect(model.tableOfContents).toContainEqual({ number: '2', title: 'Citation Analysis' });
    expect(model.tableOfContents).toContainEqual({ number: '2.2', title: 'List of Other Shortlisted Citations' });
    expect(model.tableOfContents.some(item => item.number === '2.3')).toBe(false);
    expect(model.reportTitle).toBe('Preliminary Novelty Assessment Report');
    expect(model.evidenceBasis).toContain('Preliminary patentability intelligence');
    expect(model.methodology.searchedEvidence).toContain('full claims');
    expect(model.methodology.searchedEvidence).toContain('legal status');
    expect(model.methodology.preliminaryStatus).toContain('preliminary assessment');
    expect(model.limitations).toContain('full patent documents');
    expect(model.limitations).not.toMatch(/limited available patent data|title\/abstract|title and abstract/i);
    expect(model.countLabels.map(item => item.label)).toEqual([
      'Candidate records retrieved/ranked',
      'Shortlisted candidate citations',
      'Direct invention-level mapped citations',
      'Component / feature-level mapped citations',
      'Citations selected for detailed feature mapping',
    ]);
    expect(model.scoringLegend.map(item => item.label)).toEqual(expect.arrayContaining([
      'D - Directly Mapped',
      'P - Partially Mapped',
      'Feature Mapping',
      'N - Not Expressly Taught',
    ]));
    expect(model.scoringLegend.map(item => item.label)).not.toContain('Retrieval Relevance');
    expect(model.scoringLegend.map(item => item.label)).not.toContain('Evidence Confidence');
    expect(model.scoringLegend.map(item => item.label)).not.toContain('Absent / weak signal');

    expect(model.citations[0]).toMatchObject({ citationNo: 'D1', publicationNumber: 'IN123A' });
    expect(model.citations[0]).toMatchObject({
      matchCategory: 'direct',
      matchCategoryLabel: 'Direct invention-level match',
      referenceRole: 'Closest invention-level reference',
      reviewPriority: 'High',
    });
    expect(model.componentCitations.map(item => item.publicationNumber)).toEqual(['IN456A']);
    expect(model.comparisons[0].technicalDisclosure).toContain('soil moisture sensor');
    expect(model.comparisons[0].abstract).toBe('A soil moisture sensor controls irrigation.');
    expect(model.comparisons[0].rows).toHaveLength(4);
    expect(model.comparisons[0].noveltyThreat).toBe('Related / moderate-overlap');
    expect(model.comparisons[0].claimImpactSummary).toContain('Feature mapping: 2 directly mapped, 0 partially mapped, 1 not expressly taught, 1 requiring full-text review.');
    expect(model.comparisons[0].rows[0]).toMatchObject({
      featureNumber: 'KF1',
      userDisclosure: 'The invention measures soil moisture in a feedback loop.',
      patentDisclosure: 'The patent discloses soil moisture sensing.',
      status: 'Present',
      statusLabel: 'Directly Mapped',
      publicMappingStatus: 'Directly Mapped',
      publicMappingCode: 'D',
      evidenceSource: 'abstract',
      extentScore: 0.88,
      confidence: 0.91,
      crispRemark: 'This is a direct overlap in the abstract.',
      professionalRemark: 'The reference teaches soil moisture sensing in the irrigation controller, so claim drafting should focus on the narrower threshold-control rule.',
      attorneyRemark: 'This is a direct overlap in the abstract.',
      claimReviewNote: 'Do not rely on this loop alone for novelty.',
    });
    expect(model.comparisons[0].rows[1]).toMatchObject({
      featureNumber: 'KF2',
      status: 'Absent',
      statusLabel: 'Not Expressly Taught',
      publicMappingStatus: 'Not Expressly Taught',
      publicMappingCode: 'N',
      patentDisclosure: 'The patent controls irrigation without disclosing the submitted threshold decision rule.',
      evidenceSource: 'none',
      extentScore: null,
      crispRemark: 'The reference lacks the threshold-triggered sequence. potential distinction. emphasize threshold inputs.',
    });
    expect(model.comparisons[0].rows[1].crispRemark).not.toMatch(/Attorney remark|Novelty impact|Claim review note/i);
    expect(model.comparisons[0].rows[1].professionalRemark).toContain('The reference lacks the threshold-triggered sequence.');
    expect(model.comparisons[0].rows[1].professionalRemark).toContain('potential distinction.');
    expect(model.comparisons[0].rows[1].professionalRemark).not.toMatch(/Attorney remark|Novelty impact|Claim review note|Confidence|Coverage|\d+%/i);
    expect(model.comparisons[0].rows[3]).toMatchObject({
      featureNumber: 'KF4',
      status: 'Unknown',
      statusLabel: 'Requires Full-Text Review',
      publicMappingStatus: 'Requires Full-Text Review',
      publicMappingCode: 'R',
      evidenceSource: 'none',
    });
    expect(model.comparisons[0].rows[3].professionalRemark).toContain('unsupported dosing signal');

    expect(model.featureSummaries[2]).toMatchObject({
      featureNumber: 'KF3',
      type: 'generic_weak',
    });
    expect(model.genericFeatureRisk.features).toContain('sensor');
    expect(model.assigneeLandscape.summary).toContain('repeated entity signal');
    expect(model.inventorSignals.repeated).toEqual([{ name: 'Asha Kumar', count: 2 }]);
    expect(model.reportConfidence.legalConclusion).toBe('Not provided; requires review.');
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
    const renderedModelText = JSON.stringify(model);
    expect(model.publicClosestCitation?.publicationNumber).toBe('IN123A');
    expect(renderedModelText).not.toMatch(/Mapped, needs review|Absent \/ weak signal|Evidence Confidence|limited available patent data|deterministic fallback|available data does not/i);
  });
});
