import { describe, expect, test, vi } from 'vitest';
import { NoveltySearchService } from './novelty-search-service';

vi.mock('./metering/gateway', () => ({
  llmGateway: {
    executeLLMOperation: vi.fn(),
  },
}));

function service() {
  return new NoveltySearchService() as any;
}

describe('NoveltySearchService Stage 1.5 helpers', () => {
  test('reuses only complete Stage 1.5 gate caches', () => {
    const svc = service();
    const complete = { aiRelevance: { byPn: { IN1: {} }, cacheKey: 'k1', gateStatus: 'complete' } };
    const partial = { aiRelevance: { byPn: { IN1: {} }, cacheKey: 'k1', gateStatus: 'partial' } };
    const failed = { aiRelevance: { byPn: { IN1: {} }, cacheKey: 'k1', gateStatus: 'failed' } };

    expect(svc.canReuseStage15Gate(complete, 'k1')).toBe(true);
    expect(svc.canReuseStage15Gate(partial, 'k1')).toBe(false);
    expect(svc.canReuseStage15Gate(failed, 'k1')).toBe(false);
    expect(svc.canReuseStage15Gate(complete, 'different')).toBe(false);
  });

  test('parses raw, fenced, wrapped, trailing-comma, and string-score gate JSON', () => {
    const svc = service();

    expect(svc.parseStage15GateResponse('[{"pn":"IN1","score":"0.8","decision":"accept",}]')).toMatchObject([
      { pn: 'IN1', score: '0.8', decision: 'accept' },
    ]);
    expect(svc.parseStage15GateResponse('```json\n[{"pn":"IN2","score":0.7,"decision":"accept"}]\n```')).toMatchObject([
      { pn: 'IN2', score: 0.7, decision: 'accept' },
    ]);
    expect(svc.parseStage15GateResponse('{"results":[{"pn":"IN3","score":0.6,"decision":"borderline"}]}')).toMatchObject([
      { pn: 'IN3', score: 0.6, decision: 'borderline' },
    ]);
    expect(svc.parseStage15GateResponse('[{"pn":"IN4","score":0.52,"decision":"component"}]')).toMatchObject([
      { pn: 'IN4', score: 0.52, decision: 'component' },
    ]);
    expect(svc.coerceGateScore({ score: '0.82' })).toBe(0.82);
  });

  test('does not index a parsed gate row without a publication number', () => {
    const svc = service();
    const indexed = svc.indexStage15ParsedRows([
      { pn: 'IN1', score: 0.8 },
      { score: 0.95, decision: 'accept' },
      { pn: 'IN3', score: 0.7 },
    ]);

    expect(indexed.IN1).toMatchObject({ pn: 'IN1' });
    expect(indexed.IN3).toMatchObject({ pn: 'IN3' });
    expect(Object.values(indexed)).not.toContainEqual({ score: 0.95, decision: 'accept' });
  });

  test('excludes gate-error records from genuine decision lists and counts them separately', () => {
    const svc = service();
    const candidates = [
      { publicationNumber: 'IN1' },
      { publicationNumber: 'IN2' },
      { publicationNumber: 'IN3' },
    ];
    const byPn = {
      IN1: { pn: 'IN1', decision: 'accept', reviewStatus: 'reviewed' },
      IN2: { pn: 'IN2', decision: 'reject', reviewStatus: 'gate_error', gateError: 'timeout' },
    };

    expect(svc.buildStage15DecisionLists(candidates, byPn, 5)).toEqual({
      accepted: ['IN1'],
      component: [],
      borderline: [],
      rejected: [],
    });
    expect(svc.summarizeStage15GateCounts(candidates, byPn)).toEqual({
      retrievedCount: 3,
      attemptedGateCount: 2,
      reviewedCount: 1,
      gateErrorCount: 1,
      unreviewedCount: 1,
    });
  });

  test('keeps component decisions as a separate Stage 1.5 bucket', () => {
    const svc = service();
    const candidates = [
      { publicationNumber: 'IN1' },
      { publicationNumber: 'IN2' },
      { publicationNumber: 'IN3' },
    ];
    const byPn = {
      IN1: { pn: 'IN1', decision: 'accept', reviewStatus: 'reviewed' },
      IN2: { pn: 'IN2', decision: 'component', reviewStatus: 'reviewed' },
      IN3: { pn: 'IN3', decision: 'borderline', reviewStatus: 'reviewed' },
    };

    expect(svc.buildStage15DecisionLists(candidates, byPn, 5)).toEqual({
      accepted: ['IN1'],
      component: ['IN2'],
      borderline: ['IN3'],
      rejected: [],
    });
  });

  test('keeps gate-error candidates as low-confidence borderline when the fallback decision is borderline', () => {
    const svc = service();
    const candidates = [
      { publicationNumber: 'IN1' },
      { publicationNumber: 'IN2' },
    ];
    const byPn = {
      IN1: { pn: 'IN1', decision: 'borderline', score: 0.2, evidence_quality: 'low', reviewStatus: 'gate_error', gateError: 'parse_error' },
      IN2: { pn: 'IN2', decision: 'reject', score: 0, evidence_quality: 'low', reviewStatus: 'gate_error', gateError: 'timeout' },
    };

    expect(svc.buildStage15DecisionLists(candidates, byPn, 5)).toEqual({
      accepted: [],
      component: [],
      borderline: ['IN1'],
      rejected: [],
    });
  });

  test('formats Stage 1.5 features with stable IDs and importance labels', () => {
    const svc = service();

    expect(svc.buildStage15AtomicFeatures({
      searchQuery: 'query',
      inventionFeatures: ['controller', 'fallback core', 'fallback mechanism'],
      featureDetails: [
        { feature: 'film', feature_type: 'generic_weak' },
        { feature: 'specific control loop', feature_type: 'core_technical' },
        { feature: 'optional display marker', feature_type: 'generic_weak' },
      ],
      noveltyFocus: ['layer', 'novel release trigger'],
    })).toEqual([
      'F1 [core]: specific control loop',
      'F2 [peripheral]: optional display marker',
      'F3 [core]: fallback core',
      'F4 [core]: fallback mechanism',
      'F5 [core]: novel release trigger',
    ]);
  });

  test('repairs claim concept linked features before storing approved Stage 0 metadata', () => {
    const svc = service();
    const normalized = svc.normalizeApprovedStage0({
      searchQuery: 'adaptive torque wrench',
      inventionFeatures: [
        'bolt size identification',
        'bolt material identification',
        'adaptive torque adjustment',
      ],
      claimConcepts: [
        {
          title: 'Adaptive torque from fastener characterization',
          linkedFeatures: ['bolt size detect', 'bolt material identification', 'adaptive torque adjustment'],
          claimableSummary: 'Bolt size and material identification drive torque adjustment.',
          importance: 'primary',
        },
      ],
    }, 'The wrench identifies bolt size and bolt material and adjusts torque.');

    expect(normalized.claimConcepts?.[0].linkedFeatures).toEqual([
      'bolt size identification',
      'bolt material identification',
      'adaptive torque adjustment',
    ]);
    expect(normalized.warnings?.some((warning: string) => warning.includes('was repaired'))).toBe(true);
  });

  test('does not treat individually mapped features as mapped claim concept relationship', () => {
    const svc = service();
    const mapping = svc.buildClaimConceptMapping(
      {
        searchQuery: 'adaptive torque wrench',
        inventionFeatures: [
          'bolt size identification',
          'bolt material identification',
          'adaptive torque adjustment',
        ],
        claimConcepts: [
          {
            title: 'Adaptive torque from fastener characterization',
            linkedFeatures: [
              'bolt size identification',
              'bolt material identification',
              'adaptive torque adjustment',
            ],
            claimableSummary: 'Bolt size and bolt material identification control torque adjustment.',
            importance: 'primary',
          },
        ],
      },
      [
        {
          pn: 'IN1',
          title: 'Torque tool with bolt measurements',
          feature_analysis: [
            { feature: 'bolt size identification', status: 'Present', quote: 'identifies bolt size' },
            { feature: 'bolt material identification', status: 'Present', quote: 'identifies bolt material' },
            { feature: 'adaptive torque adjustment', status: 'Present', quote: 'sets torque value' },
          ],
        },
      ]
    );

    expect(mapping[0]).toMatchObject({
      mappedFeatures: 3,
      totalFeatures: 3,
      coverage: 1,
      relationshipMapped: false,
      relationshipRisk: 'moderate',
    });
    expect(mapping[0].reason).toContain('cooperative relationship is not fully disclosed');
  });

  test('builds a successful no-high-confidence deep-analysis payload', () => {
    const svc = service();
    const stage1Data = {
      visiblePriorArtResults: [],
      retrievalCandidates: [{ publicationNumber: 'IN1' }, { publicationNumber: 'IN2' }],
      aiRelevance: {
        gateStatus: 'complete',
        reviewedCount: 2,
        retrievedCount: 2,
      },
    };

    expect(svc.hasNoHighConfidencePriorArt(stage1Data)).toBe(true);
    const data = svc.buildNoHighConfidenceStageData(
      'search-1',
      { searchQuery: 'query', inventionFeatures: ['feature one'] },
      stage1Data
    );

    expect(data.stage35Data).toMatchObject({
      noHighConfidencePriorArt: true,
      feature_map: [],
      reviewedCount: 2,
      retrievedCount: 2,
    });
    expect(data.stage4Data).toMatchObject({
      noHighConfidencePriorArt: true,
      decision: 'Low Evidence',
      confidence: 'Low',
      novelty_score: 0,
      per_patent_coverage: [],
    });
  });

  test('selects borderline candidates for deep analysis when no accepted candidate exists', () => {
    const svc = service();
    const retrievalCandidates = Array.from({ length: 5 }, (_, index) => ({
      publicationNumber: `IN202500000${index + 1}A`,
      title: `Borderline patent ${index + 1}`,
      abstract: `Related mechanism ${index + 1}`,
    }));
    const byPn = Object.fromEntries(retrievalCandidates.map((candidate, index) => [
      candidate.publicationNumber,
      {
        pn: candidate.publicationNumber,
        decision: 'borderline',
        score: 0.45 + index * 0.05,
        evidence_quality: 'medium',
        reviewStatus: 'reviewed',
      },
    ]));
    const stage1Data = {
      visiblePriorArtResults: [],
      pqaiResults: [],
      retrievalCandidates,
      aiRelevance: {
        accepted: [],
        borderline: retrievalCandidates.map(candidate => candidate.publicationNumber),
        rejected: [],
        byPn,
        gateStatus: 'complete',
        minimumVisibleConfidence: 0.7,
      },
    };

    expect(svc.hasNoHighConfidencePriorArt(stage1Data)).toBe(false);
    const selected = svc.selectRelevantPatentsForDeepAnalysis(stage1Data, 10);

    expect(selected).toHaveLength(5);
    expect(selected.map((item: any) => item.publicationNumber)).toEqual([
      'IN2025000005A',
      'IN2025000004A',
      'IN2025000003A',
      'IN2025000002A',
      'IN2025000001A',
    ]);
    expect(selected.every((item: any) => item.rerankDecision === 'borderline')).toBe(true);
  });

  test('selects direct, then component, then borderline candidates for deep analysis', () => {
    const svc = service();
    const retrievalCandidates = [
      { publicationNumber: 'IN_DIRECT', title: 'Direct match' },
      { publicationNumber: 'IN_COMPONENT', title: 'Component match' },
      { publicationNumber: 'IN_BORDERLINE', title: 'Borderline match' },
    ];
    const stage1Data = {
      retrievalCandidates,
      aiRelevance: {
        accepted: ['IN_DIRECT'],
        component: ['IN_COMPONENT'],
        borderline: ['IN_BORDERLINE'],
        rejected: [],
        byPn: {
          IN_DIRECT: { pn: 'IN_DIRECT', decision: 'accept', score: 0.9, evidence_quality: 'high', reviewStatus: 'reviewed' },
          IN_COMPONENT: { pn: 'IN_COMPONENT', decision: 'component', score: 0.25, evidence_quality: 'low', reviewStatus: 'reviewed' },
          IN_BORDERLINE: { pn: 'IN_BORDERLINE', decision: 'borderline', score: 0.45, evidence_quality: 'medium', reviewStatus: 'reviewed' },
        },
        gateStatus: 'complete',
        minimumVisibleConfidence: 0.7,
        thresholds: { high: 0.7, medium: 0.4 },
      },
    };

    const selected = svc.selectRelevantPatentsForDeepAnalysis(stage1Data, 3);

    expect(selected.map((item: any) => item.publicationNumber)).toEqual([
      'IN_DIRECT',
      'IN_COMPONENT',
      'IN_BORDERLINE',
    ]);
    expect(selected.map((item: any) => item.rerankDecision)).toEqual(['accept', 'component', 'borderline']);
    expect(selected[1].matchCategory).toBe('component');
  });

  test('does not add borderline candidates when direct and component coverage reaches the target', () => {
    const svc = service();
    const componentCandidates = Array.from({ length: 20 }, (_, index) => ({
      publicationNumber: `IN_COMPONENT_${index + 1}`,
      title: `Component ${index + 1}`,
    }));
    const borderlineCandidates = Array.from({ length: 20 }, (_, index) => ({
      publicationNumber: `IN_BORDERLINE_${index + 1}`,
      title: `Borderline ${index + 1}`,
    }));
    const retrievalCandidates = [...componentCandidates, ...borderlineCandidates];
    const byPn = Object.fromEntries([
      ...componentCandidates.map((candidate, index) => [
        candidate.publicationNumber,
        { pn: candidate.publicationNumber, decision: 'component', score: 0.8 - index * 0.01, evidence_quality: 'medium', reviewStatus: 'reviewed' },
      ]),
      ...borderlineCandidates.map((candidate, index) => [
        candidate.publicationNumber,
        { pn: candidate.publicationNumber, decision: 'borderline', score: 0.7 - index * 0.01, evidence_quality: 'medium', reviewStatus: 'reviewed' },
      ]),
    ]);
    const stage1Data = {
      retrievalCandidates,
      aiRelevance: {
        accepted: [],
        component: componentCandidates.map(candidate => candidate.publicationNumber),
        borderline: borderlineCandidates.map(candidate => candidate.publicationNumber),
        rejected: [],
        byPn,
        gateStatus: 'complete',
      },
    };

    const selected = svc.selectRelevantPatentsForDeepAnalysis(stage1Data, 60);

    expect(selected).toHaveLength(20);
    expect(selected.every((item: any) => item.rerankDecision === 'component')).toBe(true);
  });

  test('caps borderline filler when direct and component coverage is thin', () => {
    const svc = service();
    const acceptedCandidates = Array.from({ length: 2 }, (_, index) => ({
      publicationNumber: `IN_ACCEPT_${index + 1}`,
      title: `Accepted ${index + 1}`,
    }));
    const borderlineCandidates = Array.from({ length: 20 }, (_, index) => ({
      publicationNumber: `IN_BORDERLINE_${index + 1}`,
      title: `Borderline ${index + 1}`,
    }));
    const retrievalCandidates = [...acceptedCandidates, ...borderlineCandidates];
    const byPn = Object.fromEntries([
      ...acceptedCandidates.map((candidate, index) => [
        candidate.publicationNumber,
        { pn: candidate.publicationNumber, decision: 'accept', score: 0.9 - index * 0.01, evidence_quality: 'high', reviewStatus: 'reviewed' },
      ]),
      ...borderlineCandidates.map((candidate, index) => [
        candidate.publicationNumber,
        { pn: candidate.publicationNumber, decision: 'borderline', score: 0.7 - index * 0.01, evidence_quality: 'medium', reviewStatus: 'reviewed' },
      ]),
    ]);
    const stage1Data = {
      retrievalCandidates,
      aiRelevance: {
        accepted: acceptedCandidates.map(candidate => candidate.publicationNumber),
        component: [],
        borderline: borderlineCandidates.map(candidate => candidate.publicationNumber),
        rejected: [],
        byPn,
        gateStatus: 'complete',
      },
    };

    const selected = svc.selectRelevantPatentsForDeepAnalysis(stage1Data, 60);

    expect(selected).toHaveLength(12);
    expect(selected.filter((item: any) => item.rerankDecision === 'borderline')).toHaveLength(10);
    expect(selected.slice(0, 2).map((item: any) => item.rerankDecision)).toEqual(['accept', 'accept']);
  });

  test('does not let the five-item borderline UI quota cap deep analysis at five', () => {
    const svc = service();
    const retrievalCandidates = Array.from({ length: 20 }, (_, index) => ({
      publicationNumber: `IN_QUOTA_${index + 1}`,
      title: `Borderline quota candidate ${index + 1}`,
    }));
    const byPn = Object.fromEntries(retrievalCandidates.map((candidate, index) => [
      candidate.publicationNumber,
      {
        pn: candidate.publicationNumber,
        decision: 'borderline',
        score: 0.8 - index * 0.01,
        evidence_quality: 'medium',
        reviewStatus: 'reviewed',
      },
    ]));
    const stage1Data = {
      retrievalCandidates,
      aiRelevance: {
        accepted: [],
        component: [],
        borderline: retrievalCandidates.slice(0, 5).map(candidate => candidate.publicationNumber),
        rejected: [],
        byPn,
        gateStatus: 'complete',
      },
    };

    const selected = svc.selectRelevantPatentsForDeepAnalysis(stage1Data, 60);

    expect(selected).toHaveLength(10);
    expect(selected.every((item: any) => item.rerankDecision === 'borderline')).toBe(true);
  });

  test('keeps no-high-confidence path when accepted and borderline are both empty', () => {
    const svc = service();
    const stage1Data = {
      visiblePriorArtResults: [],
      retrievalCandidates: [{ publicationNumber: 'IN1' }, { publicationNumber: 'IN2' }],
      aiRelevance: {
        accepted: [],
        component: [],
        borderline: [],
        rejected: ['IN1', 'IN2'],
        byPn: {
          IN1: { pn: 'IN1', decision: 'reject', score: 0.1, evidence_quality: 'low', reviewStatus: 'reviewed' },
          IN2: { pn: 'IN2', decision: 'reject', score: 0.2, evidence_quality: 'low', reviewStatus: 'reviewed' },
        },
        gateStatus: 'complete',
      },
    };

    expect(svc.selectRelevantPatentsForDeepAnalysis(stage1Data, 10)).toHaveLength(0);
    expect(svc.hasNoHighConfidencePriorArt(stage1Data)).toBe(true);
  });

  test('uses low-confidence borderline fallback candidates when the whole gate fails', () => {
    const svc = service();
    const fallback = svc.fallbackCandidatesForGateFailure([
      { publicationNumber: 'IN1' },
    ], 5);

    expect(fallback).toMatchObject([
      {
        publicationNumber: 'IN1',
        rerankDecision: 'borderline',
        rerankScore: 0.2,
        evidence_quality: 'low',
      },
    ]);
  });

  test('builds bounded live patent-analysis progress snapshots', () => {
    const svc = service();

    expect(svc.buildStageProgressSnapshot({
      stage: 'relevance_review',
      analyzedPatents: 3,
      totalPatents: 10,
      processedBatches: 1,
      batchCount: 4,
    })).toMatchObject({
      stage: 'relevance_review',
      status: 'running',
      analyzedPatents: 3,
      totalPatents: 10,
      percent: 30,
      message: 'Relevance review: 3 of 10 patents analyzed.',
    });

    expect(svc.buildStageProgressSnapshot({
      stage: 'deep_analysis',
      status: 'running',
      analyzedPatents: 10,
      totalPatents: 10,
    }).percent).toBe(99);

    expect(svc.buildStageProgressSnapshot({
      stage: 'deep_analysis',
      status: 'complete',
      analyzedPatents: 10,
      totalPatents: 10,
    }).percent).toBe(100);
  });
});
