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
      distributed_component_risks: ['Separate references collectively map important features'],
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
    expect(remarks.key_risks).toContain('Separate references collectively map important features');
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
    expect(NOVELTY_SEARCH_NORMALIZATION_PROMPT_V2).toContain(
      'Do not prefix them with feature IDs such as "F1:"'
    );
    expect(NOVELTY_SEARCH_NORMALIZATION_PROMPT_V2).not.toContain('"feature_id"');
    expect(NOVELTY_SEARCH_NORMALIZATION_PROMPT_V2).toContain(
      'Each invention_feature must be a standalone atomic technical phrase'
    );
    expect(NOVELTY_SEARCH_NORMALIZATION_PROMPT_V2).toContain(
      'If a phrase contains multiple independent mechanisms joined by "and", split it into separate features'
    );
    expect(NOVELTY_SEARCH_NORMALIZATION_PROMPT_V2).toContain(
      'Return 3-8 invention_features unless the disclosure truly contains fewer; use up to 10 only'
    );
    expect(NOVELTY_SEARCH_NORMALIZATION_PROMPT_V2).toContain(
      'core_technical: a baseline technical object'
    );
    expect(NOVELTY_SEARCH_NORMALIZATION_PROMPT_V2).toContain(
      'feature_details must include exactly one row for each invention_features item'
    );
    expect(source).toContain('Score means usefulness for deep novelty mapping');
    expect(source).toContain('Component-salvage rule');
    expect(source).toContain('Do not reject a concrete component disclosure merely because it lacks the full invention combination');
    expect(source).toContain('A patent is not relevant merely because it discloses one generic component');
    expect(PR_35A_FEATURE_MAPPING_BATCH_PROMPT_V3).toContain(
      'A feature marked Absent or Unknown in one patent is not automatically unique'
    );
    expect(CONSOLIDATED_CANDIDATE_ANALYSIS_PROMPT).toContain(
      'A feature marked Absent or Unknown in one patent is not automatically unique'
    );
    expect(CONSOLIDATED_CANDIDATE_ANALYSIS_PROMPT).toContain('professional_remark');
    expect(CONSOLIDATED_CANDIDATE_ANALYSIS_PROMPT).not.toContain('"attorney_remark":');
    expect(CONSOLIDATED_CANDIDATE_ANALYSIS_PROMPT).not.toContain('"novelty_impact":');
    expect(CONSOLIDATED_CANDIDATE_ANALYSIS_PROMPT).not.toContain('"claim_review_note":');
    expect(CONSOLIDATED_CANDIDATE_ANALYSIS_PROMPT).toContain(
      '"novelty_threat": "high_overlap|moderate_overlap|related|low_overlap"'
    );
    expect(CONSOLIDATED_CANDIDATE_ANALYSIS_PROMPT).not.toContain('"aiRelevance":');
    expect(CONSOLIDATED_CANDIDATE_ANALYSIS_PROMPT).toContain(
      'Candidates have already passed Stage 1.5 relevance screening'
    );
    expect(CONSOLIDATED_CANDIDATE_ANALYSIS_PROMPT).toContain(
      'If no supplied patent-data quote supports the feature, use Absent or Unknown'
    );
    expect(CONSOLIDATED_CANDIDATE_ANALYSIS_PROMPT).toContain(
      'Use Absent when the supplied patent data is adequate to compare'
    );
    expect(CONSOLIDATED_CANDIDATE_ANALYSIS_PROMPT).toContain(
      'Do not output aiRelevance, accepted, component, borderline, or rejected routing lists'
    );
    expect(CONSOLIDATED_CANDIDATE_ANALYSIS_PROMPT).toContain('"potential_differentiators"');
    expect(CONSOLIDATED_CANDIDATE_ANALYSIS_PROMPT).toContain('"closest_mapped_references"');
    expect(CONSOLIDATED_CANDIDATE_ANALYSIS_PROMPT).toContain('Unknown evidence lowers confidence');
    expect(CONSOLIDATED_CANDIDATE_ANALYSIS_PROMPT).toContain('"extent_score": 0.0');
    expect(CONSOLIDATED_CANDIDATE_ANALYSIS_PROMPT).toContain('Evaluate extent_score independently for every patent-feature pair');
    expect(CONSOLIDATED_CANDIDATE_ANALYSIS_PROMPT).toContain('evidence_source must be title, abstract, or none');
    expect(CONSOLIDATED_CANDIDATE_ANALYSIS_PROMPT).toContain('limited available patent data');
    expect(CONSOLIDATED_CANDIDATE_ANALYSIS_PROMPT).toContain('Do not repeat the source-field limitation in narrative fields');
    expect(CONSOLIDATED_CANDIDATE_ANALYSIS_PROMPT).not.toContain('title/abstract evidence');
    expect(STAGE4_REPORT_PROMPT_FROM_REMARKS_V3).not.toContain('preliminary claim-positioning');
    expect(source).toContain('Relevance should reflect threat to the invention as a whole');
    expect(source).toContain("const stage0SearchQuery = String(stage0Data.searchQuery || '').trim()");
    expect(source).toContain('retrievalQueries: buildIndianCorpusRetrievalQueries(stage0SearchQuery, stage0Features)');
    expect(source).toContain('private isBroadStage15Feature(value: string): boolean');
    expect(source).toContain('const features = this.buildStage15AtomicFeatures(stage0Data)');
    expect(STAGE4_REPORT_PROMPT_FROM_REMARKS_V3).toContain(
      'Never output "No significant risks identified"'
    );
    expect(STAGE4_REPORT_PROMPT_FROM_REMARKS_V3).toContain('"Potential Differentiators"');
    expect(STAGE4_REPORT_PROMPT_FROM_REMARKS_V3).toContain('distributed_component_risks');
    expect(STAGE4_REPORT_PROMPT_FROM_REMARKS_V3).toContain('legacy novelty_points');
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
          professional_remark: 'The reference teaches the soil moisture measurement loop, so claim drafting should focus on the narrower control rule.',
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
      professional_remark: 'The reference teaches the soil moisture measurement loop, so claim drafting should focus on the narrower control rule.',
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
    expect(rows[1].professional_remark).toContain('threshold-based irrigation decision rule');
  });

  test('preserves Unknown cells in the feature matrix', () => {
    const service = new NoveltySearchService() as any;
    const matrix = service.generateFeatureMatrix(
      [{
        pn: 'IN1',
        title: 'Thin disclosure',
        feature_analysis: [{ feature: 'closed-loop dosing', status: 'Unknown', reason: 'Abstract is too thin.' }],
      }],
      ['closed-loop dosing'],
      { patents_analyzed: 1 }
    );

    expect(matrix.cells).toHaveLength(1);
    expect(matrix.cells[0]).toMatchObject({ status: 'Unknown', reason: 'Abstract is too thin.' });
  });

  test('rejects a Present or Partial evidence quote not found in the supplied patent text', () => {
    const service = new NoveltySearchService() as any;
    const patent = {
      title: 'Closed-loop irrigation controller',
      abstract: 'A moisture sensor controls a valve using a measured threshold.',
    };

    expect(service.validateFeatureCellEvidence({
      feature: 'threshold-controlled irrigation',
      status: 'Present',
      quote: 'moisture sensor controls a valve',
      field: 'abstract',
      confidence: 0.9,
    }, patent)).toMatchObject({ status: 'Present' });

    expect(service.validateFeatureCellEvidence({
      feature: 'threshold-controlled irrigation',
      status: 'Present',
      quote: 'an invented disclosure that is not present',
      field: 'abstract',
      confidence: 0.9,
    }, patent)).toMatchObject({
      status: 'Unknown',
      evidence_source: 'none',
    });
  });

  test('does not count Unknown evidence as Absent or unique', () => {
    const service = new NoveltySearchService() as any;
    const result = service.computePerFeatureUniqueness([
      { pn: 'IN1', feature_analysis: [{ feature: 'feature A', status: 'Unknown' }] },
      { pn: 'IN2', feature_analysis: [{ feature: 'feature A', status: 'Absent' }] },
    ], ['feature A']);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      feature: 'feature A',
      present_in: 0,
      partial_in: 0,
      absent_in: 1,
      uniqueness: 0.5,
      unknown_in: 1,
      mapped_in: 0,
      feature_seen_anywhere: false,
    });
  });

  test('weak remote mapping does not erase closest-reference differentiation gap', () => {
    const service = new NoveltySearchService() as any;
    const features = ['multilayer oral film', 'saliva-triggered compliance marker'];
    const featureTypes = new Map([
      ['multilayer oral film', 'core_technical'],
      ['saliva-triggered compliance marker', 'novelty_candidate'],
    ]);
    const featureMaps: PatentFeatureMap[] = [
      {
        pn: 'CLOSEST_FILM',
        feature_analysis: [
          { feature: 'multilayer oral film', status: 'Present' },
          { feature: 'saliva-triggered compliance marker', status: 'Absent' },
        ],
      },
      {
        pn: 'REMOTE_MARKER',
        feature_analysis: [
          { feature: 'multilayer oral film', status: 'Absent' },
          { feature: 'saliva-triggered compliance marker', status: 'Present' },
        ],
      },
    ];

    const rows = service.computePerFeatureUniqueness(featureMaps, features, featureTypes, ['CLOSEST_FILM']);
    const marker = rows.find((row: any) => row.feature === 'saliva-triggered compliance marker');

    expect(marker).toMatchObject({
      feature_seen_anywhere: true,
      feature_gap_against_closest_refs: true,
      combination_sensitive_differentiator: true,
    });
    expect(service.computeNoveltyScore(rows, [])).toBeGreaterThan(0);
  });

  test('high mapped-overlap requires novelty-candidate or nearly-all core coverage', () => {
    const service = new NoveltySearchService() as any;
    const features = [
      'core feature 1',
      'core feature 2',
      'core feature 3',
      'core feature 4',
      'core feature 5',
      'core feature 6',
      'distinctive release trigger',
    ];
    const featureTypes = new Map(features.map(feature => [
      feature,
      feature === 'distinctive release trigger' ? 'novelty_candidate' : 'core_technical',
    ]));
    const broadOnly: PatentFeatureMap = {
      pn: 'BROAD_ONLY',
      feature_analysis: [
        { feature: 'core feature 1', status: 'Present' },
        { feature: 'core feature 2', status: 'Present' },
        { feature: 'core feature 3', status: 'Present' },
        { feature: 'core feature 4', status: 'Present' },
        { feature: 'core feature 5', status: 'Partial', extent_score: 0.4 },
        { feature: 'core feature 6', status: 'Partial', extent_score: 0.4 },
        { feature: 'distinctive release trigger', status: 'Absent' },
      ],
    };
    const withNoveltyCandidate: PatentFeatureMap = {
      pn: 'NOVELTY_MAPPED',
      feature_analysis: [
        ...broadOnly.feature_analysis.filter(cell => cell.feature !== 'distinctive release trigger'),
        { feature: 'distinctive release trigger', status: 'Present' },
      ],
    };

    expect(service.findHighMappedOverlapReference([broadOnly], features, featureTypes)).toBeNull();
    expect(service.findHighMappedOverlapReference([broadOnly, withNoveltyCandidate], features, featureTypes)).toMatchObject({
      pn: 'NOVELTY_MAPPED',
    });
  });

  test('feature-map cache hash changes with evidence or model', () => {
    const service = new NoveltySearchService() as any;
    const features = ['feature A'];
    const first = service.createBatchHash(
      [{ canonicalPn: 'IN1', title: 'Patent', abstract: 'first evidence' }],
      features,
      'model-a'
    );
    const changedEvidence = service.createBatchHash(
      [{ canonicalPn: 'IN1', title: 'Patent', abstract: 'second evidence' }],
      features,
      'model-a'
    );
    const changedModel = service.createBatchHash(
      [{ canonicalPn: 'IN1', title: 'Patent', abstract: 'first evidence' }],
      features,
      'model-b'
    );

    expect(changedEvidence).not.toBe(first);
    expect(changedModel).not.toBe(first);
  });

  test('canonical Stage 1 candidates are used instead of the legacy empty PQAI list', () => {
    const service = new NoveltySearchService() as any;
    const candidate = { publicationNumber: 'IN1', title: 'Candidate' };

    expect(service.getStage1CandidatePool({
      retrievalCandidates: [candidate],
      pqaiResults: [],
    })).toEqual([candidate]);
  });
});
