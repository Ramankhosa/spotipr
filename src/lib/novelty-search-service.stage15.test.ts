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
          IN_COMPONENT: { pn: 'IN_COMPONENT', decision: 'component', score: 0.55, evidence_quality: 'medium', reviewStatus: 'reviewed' },
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
});
