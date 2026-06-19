import fs from 'fs';
import path from 'path';
import { describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/metering/gateway', () => ({
  llmGateway: { executeLLMOperation: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {},
}));

vi.mock('@/lib/idea-bank-service', () => ({
  IdeaBankService: vi.fn(),
}));

vi.mock('@/lib/idea-bank-funnel', () => ({
  ideaBankFunnel: { processIdeasAsync: vi.fn() },
  isIdeaBankGenerationEnabled: vi.fn(() => false),
}));

vi.mock('@/lib/service-usage-tracker', () => ({
  checkServiceQuota: vi.fn(),
  trackServiceUsage: vi.fn(),
}));

vi.mock('@/lib/patent-search', () => ({
  patentSearchOrchestrator: { search: vi.fn() },
}));

import {
  CONSOLIDATED_CANDIDATE_ANALYSIS_PROMPT,
  NOVELTY_SEARCH_NORMALIZATION_PROMPT_V2,
  NoveltySearchService,
  PR_35A_FEATURE_MAPPING_BATCH_PROMPT_V3,
  STAGE4_REPORT_PROMPT_FROM_REMARKS_V3,
  type AggregationResult,
  type PatentFeatureMap,
} from '@/lib/novelty-search-service';

describe('novelty search guardrails', () => {
  test('integration check acknowledges majority Present plus Partial coverage', () => {
    const service = new NoveltySearchService() as any;
    const features = ['feature A', 'feature B', 'feature C', 'feature D', 'feature E'];
    const featureMaps: PatentFeatureMap[] = [
      {
        pn: 'IN202411020074',
        feature_analysis: [
          { feature: 'feature A', status: 'Present' },
          { feature: 'feature B', status: 'Present' },
          { feature: 'feature C', status: 'Partial' },
          { feature: 'feature D', status: 'Absent' },
          { feature: 'feature E', status: 'Absent' },
        ],
      },
    ];

    const result = service.performIntegrationCheck(featureMaps, features, []);

    expect(result.any_single_patent_covers_majority).toBe(true);
    expect(result.integration_pn).toBe('IN202411020074');
    expect(result.explanation).toContain('IN202411020074');
    expect(result.explanation).toContain('majority');
  });

  test('potential differentiators exclude generics and closest-reference overlap', () => {
    const service = new NoveltySearchService() as any;
    const features = [
      'housing',
      'encoder-based synchronization',
      'pH enzyme triggered release profile',
    ];
    const closestMap: PatentFeatureMap = {
      pn: 'CLOSEST',
      feature_analysis: [
        { feature: 'housing', status: 'Absent' },
        { feature: 'encoder-based synchronization', status: 'Partial' },
        { feature: 'pH enzyme triggered release profile', status: 'Absent' },
      ],
    };

    expect(service.isGenericNoveltyFeature('housing')).toBe(true);
    expect(service.isPotentialDifferentiator('housing', closestMap, { low_evidence: false })).toBe(false);
    expect(service.isPotentialDifferentiator('encoder-based synchronization', closestMap, { low_evidence: false })).toBe(false);
    expect(service.isPotentialDifferentiator('pH enzyme triggered release profile', closestMap, { low_evidence: false })).toBe(true);
    expect(service.getPotentialDifferentiatorFeatures([closestMap], features, { low_evidence: false })).toEqual([
      'pH enzyme triggered release profile',
    ]);
  });

  test('deterministic risks replace no-risk boilerplate in final remarks', () => {
    const service = new NoveltySearchService() as any;
    const aggregationResult: AggregationResult = {
      idea_id: 'idea-1',
      per_patent_coverage: [
        { pn: 'P1', present_count: 3, partial_count: 1, absent_count: 1, coverage_ratio: 0.8 },
      ],
      per_feature_uniqueness: [
        { feature: 'housing', present_in: 1, partial_in: 0, absent_in: 0, uniqueness: 0 },
      ],
      integration_check: {
        any_single_patent_covers_majority: true,
        integration_pn: 'P1',
        explanation: 'Patent P1 maps to a majority of extracted features',
      },
      novelty_score: 0.6,
      decision: 'Partially Novel',
      confidence: 'Medium',
      risk_factors: ['Closest reference P1 maps to a majority of extracted features'],
    };

    const remarks = service.buildProfessionalConcludingRemarks(
      { key_risks: ['No significant risks identified.'] },
      aggregationResult,
      [],
      [],
      [],
      aggregationResult.per_feature_uniqueness,
      aggregationResult.integration_check.explanation,
      {}
    );

    expect(remarks.key_risks).toContain('Closest reference P1 maps to a majority of extracted features');
    expect(remarks.key_risks).not.toContain('No significant risks identified.');
  });

  test('prompt updates include the surgical guardrail instructions', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/lib/novelty-search-service.ts'), 'utf8');

    expect(NOVELTY_SEARCH_NORMALIZATION_PROMPT_V2).toContain(
      'novelty_focus must not include ordinary field-common parts'
    );
    expect(NOVELTY_SEARCH_NORMALIZATION_PROMPT_V2).toContain(
      '"feature_type": "core_technical|implementation|novelty_candidate|generic_weak"'
    );
    expect(source).toContain('Score means invention-level relevance, not mere feature overlap');
    expect(source).toContain('If overlap is only a generic component, keep score below 0.40');
    expect(source).toContain('A patent is not relevant merely because it discloses one generic component');
    expect(PR_35A_FEATURE_MAPPING_BATCH_PROMPT_V3).toContain(
      'A feature marked Absent or Unknown in one patent is not automatically unique'
    );
    expect(CONSOLIDATED_CANDIDATE_ANALYSIS_PROMPT).toContain(
      'A feature marked Absent or Unknown in one patent is not automatically unique'
    );
    expect(CONSOLIDATED_CANDIDATE_ANALYSIS_PROMPT).toContain('attorney_remark');
    expect(CONSOLIDATED_CANDIDATE_ANALYSIS_PROMPT).toContain(
      '"novelty_threat": "high_overlap|moderate_overlap|related|low_overlap"'
    );
    expect(CONSOLIDATED_CANDIDATE_ANALYSIS_PROMPT).toContain('"extent_score": 0.0');
    expect(CONSOLIDATED_CANDIDATE_ANALYSIS_PROMPT).toContain('Evaluate extent_score independently for every patent-feature pair');
    expect(CONSOLIDATED_CANDIDATE_ANALYSIS_PROMPT).toContain('evidence_source must be title, abstract, or none');
    expect(source).toContain('Relevance should reflect threat to the invention as a whole');
    expect(STAGE4_REPORT_PROMPT_FROM_REMARKS_V3).toContain(
      'Never output "No significant risks identified"'
    );
    expect(STAGE4_REPORT_PROMPT_FROM_REMARKS_V3).toContain('Use comparison_rows as the source for feature-level remarks');
  });

  test('comparison row normalization returns complete attorney-grade rows for every feature', () => {
    const service = new NoveltySearchService() as any;
    const rows = service.normalizePatentComparisonRows(
      [
        {
          feature_id: 'KF1',
          feature: 'soil moisture measurement loop',
          user_invention_disclosure: 'The user idea measures soil moisture repeatedly.',
          patent_disclosure: 'The patent describes a soil moisture sensor.',
          status: 'Present',
          evidence_quote: 'soil moisture sensor',
          evidence_source: 'abstract',
          extent_score: 0.89,
          confidence: 0.87,
          attorney_remark: 'Direct abstract overlap.',
          novelty_impact: 'This feature is covered.',
          claim_review_note: 'Claim a narrower control rule.',
        },
      ],
      {
        pn: 'IN123A',
        feature_analysis: [
          { feature: 'soil moisture measurement loop', status: 'Present', quote: 'soil moisture sensor' },
          { feature: 'threshold-based irrigation decision rule', status: 'Absent', reason: 'No threshold rule disclosed.' },
        ],
      },
      {
        searchQuery: 'soil moisture irrigation controller',
        inventionFeatures: ['soil moisture measurement loop', 'threshold-based irrigation decision rule'],
        featureDetails: [
          { feature: 'threshold-based irrigation decision rule', user_disclosure: 'The controller applies a threshold rule.' },
        ],
      }
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      feature_id: 'KF1',
      evidence_source: 'abstract',
      extent_score: 0.89,
      attorney_remark: 'Direct abstract overlap.',
      claim_review_note: 'Claim a narrower control rule.',
    });
    expect(rows[1]).toMatchObject({
      feature_id: 'KF2',
      status: 'Absent',
      user_invention_disclosure: 'The controller applies a threshold rule.',
      evidence_source: 'none',
    });
    expect(rows[1].extent_score).toBeLessThanOrEqual(0.2);
    expect(rows[1].attorney_remark).toContain('IN123A');
    expect(rows[1].claim_review_note).toContain('threshold-based irrigation decision rule');
  });
});
