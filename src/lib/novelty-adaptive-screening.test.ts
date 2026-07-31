import { describe, expect, test, vi } from 'vitest';
import { NoveltySearchService } from './novelty-search-service';

vi.mock('./metering/gateway', () => ({
  llmGateway: { executeLLMOperation: vi.fn() },
}));

function service() {
  return new NoveltySearchService() as any;
}

function stage0(withRelationship = true) {
  return {
    title: 'Marine drone anomaly maintenance system',
    searchQuery: 'marine drone sensor anomaly maintenance offshore inspection',
    inventionFeatures: [
      'marine drone collects offshore sensor data',
      'anomaly model triggers maintenance alert',
    ],
    featureDetails: [
      { feature: 'marine drone collects offshore sensor data', feature_type: 'core_technical' },
      { feature: 'anomaly model triggers maintenance alert', feature_type: 'novelty_candidate' },
    ],
    noveltyFocusInteractions: withRelationship ? [{
      description: 'sensor data feeds anomaly model which triggers maintenance alert',
      linkedFeatures: [
        'marine drone collects offshore sensor data',
        'anomaly model triggers maintenance alert',
      ],
    }] : [],
    confidence: 0.9,
  };
}

function highOverlapPatent() {
  return {
    canonicalPn: 'US1',
    publicationNumber: 'US1A1',
    title: 'Marine drone anomaly maintenance system',
    abstract: 'A marine drone collects offshore sensor data. The sensor data feeds an anomaly model which triggers a maintenance alert for offshore inspection.',
    sourceProvider: 'pqai',
    jurisdiction: 'US',
  };
}

function highOverlapMap() {
  return {
    pn: 'US1',
    feature_analysis: [
      {
        feature: 'marine drone collects offshore sensor data',
        status: 'Present',
        quote: 'marine drone collects offshore sensor data',
        field: 'abstract',
        confidence: 0.95,
      },
      {
        feature: 'anomaly model triggers maintenance alert',
        status: 'Present',
        quote: 'anomaly model which triggers a maintenance alert',
        field: 'abstract',
        confidence: 0.9,
      },
    ],
  };
}

describe('adaptive title/abstract screening', () => {
  test('title-only evidence cannot establish a Present feature', () => {
    const svc = service();
    const repaired = svc.validateFeatureCellEvidence({
      feature: 'marine drone',
      status: 'Present',
      quote: 'Marine drone anomaly maintenance system',
      field: 'title',
      confidence: 0.95,
    }, {
      title: 'Marine drone anomaly maintenance system',
      abstract: 'A vehicle performs inspection.',
    });

    expect(repaired.status).toBe('Partial');
    expect(repaired.evidenceDepth).toBe('TITLE_ONLY');
    expect(repaired.legalEvidenceStrength).toBe(0.3);
  });

  test('explicit abstract support can produce a high abstract-level overlap candidate', () => {
    const svc = service();
    const idea = stage0(true);
    const patent = highOverlapPatent();
    const repaired = svc.validateAndRepairFeatureMaps([highOverlapMap()], [patent], idea.inventionFeatures);
    const clusters = svc.buildScreeningQueryClusters(idea);
    const decorated = svc.decorateTitleAbstractScreeningMap(
      repaired[0], patent, idea, { decision: 'accept', score: 0.95 }, clusters, []
    );

    expect(decorated.matchCategory).toBe('HIGH_RECORD_OVERLAP');
    expect(decorated.cooperativeRelationshipPresentInSameAbstract).toBe(true);
    expect(decorated.importantFeatureCoverage).toBe(1);
    expect(decorated.legalEvidenceStrength).toBeLessThanOrEqual(0.65);
  });

  test('verified claim-only critical evidence and relationship can produce high record overlap', () => {
    const svc = service();
    const idea = stage0(true);
    const patent = {
      ...highOverlapPatent(),
      abstract: 'A vehicle performs offshore inspection.',
      claimsText: '1. A marine drone collects offshore sensor data, wherein the sensor data feeds an anomaly model which triggers a maintenance alert.',
      claimsAvailability: 'FULL',
      claimsContentHash: 'claim-hash',
    };
    const claimMap = highOverlapMap();
    for (const cell of claimMap.feature_analysis) cell.field = 'claims';
    const repaired = svc.validateAndRepairFeatureMaps([claimMap], [patent], idea.inventionFeatures);
    const decorated = svc.decorateTitleAbstractScreeningMap(
      repaired[0], patent, idea, { decision: 'accept', score: 0.95 }, svc.buildScreeningQueryClusters(idea), []
    );

    expect(repaired[0].feature_analysis.every((cell: any) => cell.evidence_source === 'claims')).toBe(true);
    expect(decorated.matchCategory).toBe('HIGH_RECORD_OVERLAP');
    expect(decorated.cooperativeRelationshipPresentInSameRecord).toBe(true);
    expect(decorated.cooperativeRelationshipPresentInSameAbstract).toBe(false);
    expect(decorated.cooperativeRelationshipEvidenceSource).toBe('claims');
    expect(decorated.evidenceDepth).toBe('CLAIMS_AND_ABSTRACT');
  });

  test('claim evidence wins provenance when the same quote also appears in the abstract', () => {
    const repaired = service().validateFeatureCellEvidence({
      feature: 'controller coupled to sensor',
      status: 'Present',
      quote: 'controller coupled to sensor',
      confidence: 0.9,
    }, {
      title: 'Controller system',
      abstract: 'A controller coupled to sensor performs monitoring.',
      claimsText: '1. A controller coupled to sensor configured to perform monitoring.',
      claimsAvailability: 'FIRST_CLAIM_ONLY',
      claimsContentHash: 'same-quote-hash',
    });

    expect(repaired.evidence_source).toBe('claims');
    expect(repaired.claim_number).toBe(1);
    expect(repaired.claims_completeness).toBe('FIRST_CLAIM_ONLY');
  });

  test('missing cooperative relationship blocks high-overlap stopping', () => {
    const svc = service();
    const idea = stage0(true);
    idea.noveltyFocusInteractions[0].description = 'cryptographically binds synchronized maintenance authority';
    const patent = {
      ...highOverlapPatent(),
      abstract: 'A marine drone collects offshore sensor data. An anomaly model triggers a maintenance alert.',
    };
    const repaired = svc.validateAndRepairFeatureMaps([highOverlapMap()], [patent], idea.inventionFeatures);
    const decorated = svc.decorateTitleAbstractScreeningMap(
      repaired[0], patent, idea, { decision: 'accept', score: 0.95 }, svc.buildScreeningQueryClusters(idea), []
    );

    expect(decorated.cooperativeRelationshipPresentInSameAbstract).toBe(false);
    expect(decorated.matchCategory).not.toBe('HIGH_RECORD_OVERLAP');
  });

  test('generic-only mappings cannot trigger high-overlap stopping', () => {
    const svc = service();
    const idea = {
      searchQuery: 'artificial intelligence sensor cloud platform',
      inventionFeatures: ['sensor', 'cloud platform'],
      featureDetails: [
        { feature: 'sensor', feature_type: 'generic_weak' },
        { feature: 'cloud platform', feature_type: 'generic_weak' },
      ],
    };
    const patent = {
      canonicalPn: 'GEN1', title: 'AI sensor cloud platform',
      abstract: 'A sensor sends data to a cloud platform for artificial intelligence analytics.',
    };
    const map = {
      pn: 'GEN1', feature_analysis: [
        { feature: 'sensor', status: 'Present', quote: 'sensor sends data', field: 'abstract', confidence: 0.9 },
        { feature: 'cloud platform', status: 'Present', quote: 'cloud platform', field: 'abstract', confidence: 0.9 },
      ],
    };
    const repaired = svc.validateAndRepairFeatureMaps([map], [patent], idea.inventionFeatures);
    const decorated = svc.decorateTitleAbstractScreeningMap(
      repaired[0], patent, idea, { decision: 'accept', score: 0.99 }, svc.buildScreeningQueryClusters(idea), []
    );

    expect(decorated.genericFeatureOnlyMatch).toBe(true);
    expect(decorated.genericityRiskLevel).toBe('HIGH');
    expect(decorated.matchCategory).not.toBe('HIGH_RECORD_OVERLAP');
  });

  test('operational safety budget is reported separately from coverage saturation', () => {
    const svc = service();
    const idea = stage0(false);
    const clusters = svc.buildScreeningQueryClusters(idea);
    const maps = Array.from({ length: 24 }, (_, index) => ({
      pn: `P${index + 1}`,
      feature_analysis: idea.inventionFeatures.map(feature => ({
        feature, status: 'Present', quote: feature, evidence_source: 'abstract', evidenceDepth: 'TITLE_AND_ABSTRACT', mappingConfidence: 0.9,
      })),
      domainTier: 1,
      genericityRiskLevel: 'LOW',
      matchCategory: 'COMPONENT_LEVEL_OVERLAP',
      queryClusterIds: clusters.map((cluster: any) => cluster.id),
    }));
    const candidates = maps.map((map: any) => ({ publicationNumber: map.pn, title: idea.title, abstract: idea.searchQuery }));
    const byPn = Object.fromEntries(candidates.map((candidate: any) => [candidate.publicationNumber, { decision: 'borderline', score: 0.4 }]));
    const progress = svc.buildAdaptiveScreeningProgress({
      maps,
      stage0Data: idea,
      stage1Data: { retrievalCandidates: candidates, aiRelevance: { byPn, reviewedCount: candidates.length }, hasMoreCandidates: false },
      clusters,
      config: svc.mergeConfig({ adaptiveAnalysis: { mode: 'observe' } }),
      inputTokens: 249900,
      outputTokens: 100,
      thoughtTokens: 0,
      batchesCompleted: 6,
    });

    expect(progress.projectedStopReason).toBe('safety_budget_reached');
    expect(progress.completeness).toBe('incomplete');
  });

  test('degraded analysis cannot produce a favorable saturation stop', () => {
    const svc = service();
    const idea = stage0(false);
    const clusters = svc.buildScreeningQueryClusters(idea);
    const maps = Array.from({ length: 12 }, (_, index) => ({
      pn: `D${index + 1}`,
      feature_analysis: idea.inventionFeatures.map(feature => ({
        feature,
        status: 'Absent',
        reason: 'Not disclosed in reviewed record',
      })),
      domainTier: 1,
      genericityRiskLevel: 'LOW',
      matchCategory: 'COMPONENT_LEVEL_OVERLAP',
      queryClusterIds: clusters.map((cluster: any) => cluster.id),
    }));
    const candidates = maps.map((map: any) => ({ publicationNumber: map.pn, title: idea.title, abstract: idea.searchQuery }));
    const byPn = Object.fromEntries(candidates.map((candidate: any) => [candidate.publicationNumber, { decision: 'borderline', score: 0.4 }]));
    const progress = svc.buildAdaptiveScreeningProgress({
      maps,
      stage0Data: idea,
      stage1Data: { retrievalCandidates: candidates, aiRelevance: { byPn, reviewedCount: candidates.length }, hasMoreCandidates: false },
      clusters,
      config: svc.mergeConfig({ adaptiveAnalysis: { mode: 'observe' } }),
      inputTokens: 1000,
      outputTokens: 500,
      thoughtTokens: 0,
      batchesCompleted: 3,
      degradedBatchCount: 1,
    });

    expect(progress.projectedStopReason).toBe('safe_report_due_to_qa_failure');
    expect(progress.completeness).toBe('degraded');
    expect(progress.evidenceQualityLow).toBe(true);
  });

  test('honors the configured number of confirmation batches for a decisive reference', () => {
    const svc = service();
    const idea = stage0(false);
    const clusters = svc.buildScreeningQueryClusters(idea);
    const maps = Array.from({ length: 5 }, (_, index) => ({
      pn: `C${index + 1}`,
      feature_analysis: idea.inventionFeatures.map(feature => ({
        feature,
        status: 'Present',
        quote: feature,
        evidence_source: 'abstract',
        evidenceDepth: 'TITLE_AND_ABSTRACT',
        mappingConfidence: 0.95,
      })),
      screeningConfidence: 0.95,
      importantFeatureCoverage: 1,
      domainTier: 1,
      genericityRiskLevel: 'LOW',
      matchCategory: index === 0 ? 'HIGH_ABSTRACT_OVERLAP' : 'COMPONENT_LEVEL_OVERLAP',
      queryClusterIds: clusters.map((cluster: any) => cluster.id),
    }));
    const candidates = maps.map((map: any) => ({ publicationNumber: map.pn, title: idea.title, abstract: idea.searchQuery }));
    const byPn = Object.fromEntries(candidates.map((candidate: any, index: number) => [
      candidate.publicationNumber,
      { decision: index === 0 ? 'accept' : 'component', score: 0.9 - index * 0.05 },
    ]));
    const base = {
      maps,
      stage0Data: idea,
      stage1Data: { retrievalCandidates: candidates, aiRelevance: { byPn, reviewedCount: candidates.length }, hasMoreCandidates: false },
      clusters,
      inputTokens: 1000,
      outputTokens: 500,
      thoughtTokens: 0,
      batchesCompleted: 2,
    };

    const confirmed = svc.buildAdaptiveScreeningProgress({
      ...base,
      config: svc.mergeConfig({ adaptiveAnalysis: { mode: 'observe', confirmationBatches: 1 } }),
    });
    const awaitingSecondBatch = svc.buildAdaptiveScreeningProgress({
      ...base,
      config: svc.mergeConfig({ adaptiveAnalysis: { mode: 'observe', confirmationBatches: 2 } }),
    });

    expect(confirmed.projectedStopReason).toBe('high_record_overlap_candidate_confirmed');
    expect(confirmed.confirmationBatchCompleted).toBe(true);
    expect(awaitingSecondBatch.confirmationBatchCompleted).toBe(false);
    expect(awaitingSecondBatch.projectedStopReason).not.toBe('high_record_overlap_candidate_confirmed');
  });

  test('QA downgrade of an accepted candidate produces the safe-report reason', () => {
    const svc = service();
    const idea = stage0(false);
    const clusters = svc.buildScreeningQueryClusters(idea);
    const maps = [{
      pn: 'QA1',
      feature_analysis: idea.inventionFeatures.map((feature, index) => ({
        feature,
        status: index === 0 ? 'Unknown' : 'Present',
        quote: index === 0 ? undefined : feature,
        evidence_source: index === 0 ? 'none' : 'abstract',
        evidenceDepth: index === 0 ? 'NONE' : 'TITLE_AND_ABSTRACT',
        qaDowngraded: index === 0,
      })),
      matchCategory: 'COMPONENT_LEVEL_OVERLAP',
      domainTier: 1,
      genericityRiskLevel: 'LOW',
      queryClusterIds: clusters.map((cluster: any) => cluster.id),
    }];
    const candidates = [{ publicationNumber: 'QA1', title: idea.title, abstract: idea.searchQuery }];
    const progress = svc.buildAdaptiveScreeningProgress({
      maps,
      stage0Data: idea,
      stage1Data: { retrievalCandidates: candidates, aiRelevance: { byPn: { QA1: { decision: 'accept', score: 0.9 } }, reviewedCount: 1 } },
      clusters,
      config: svc.mergeConfig({ adaptiveAnalysis: { mode: 'observe' } }),
      inputTokens: 100,
      outputTokens: 50,
      thoughtTokens: 0,
      batchesCompleted: 1,
    });

    expect(progress.projectedStopReason).toBe('safe_report_due_to_qa_failure');
  });

  test('coverage saturation remains distinct when minimum and cluster requirements are met', () => {
    const svc = service();
    const idea = stage0(false);
    const clusters = svc.buildScreeningQueryClusters(idea);
    const maps = Array.from({ length: 16 }, (_, index) => ({
      pn: `S${index + 1}`,
      feature_analysis: idea.inventionFeatures.map(feature => ({
        feature,
        status: 'Present',
        quote: feature,
        evidence_source: 'abstract',
        evidenceDepth: 'TITLE_AND_ABSTRACT',
        mappingConfidence: 0.9,
      })),
      domainTier: 1,
      genericityRiskLevel: 'LOW',
      matchCategory: 'COMPONENT_LEVEL_OVERLAP',
      queryClusterIds: clusters.map((cluster: any) => cluster.id),
    }));
    const candidates = maps.map((map: any) => ({ publicationNumber: map.pn, title: idea.title, abstract: idea.searchQuery }));
    const byPn = Object.fromEntries(candidates.map((candidate: any) => [candidate.publicationNumber, { decision: 'borderline', score: 0.4 }]));
    const progress = svc.buildAdaptiveScreeningProgress({
      maps,
      stage0Data: idea,
      stage1Data: { retrievalCandidates: candidates, aiRelevance: { byPn, reviewedCount: candidates.length }, hasMoreCandidates: false },
      clusters,
      config: svc.mergeConfig({ adaptiveAnalysis: { mode: 'observe' } }),
      inputTokens: 1000,
      outputTokens: 500,
      thoughtTokens: 0,
      batchesCompleted: 4,
    });

    expect(progress.projectedStopReason).toBe('coverage_saturation');
  });
});
