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

    expect(decorated.matchCategory).toBe('HIGH_ABSTRACT_OVERLAP');
    expect(decorated.cooperativeRelationshipPresentInSameAbstract).toBe(true);
    expect(decorated.importantFeatureCoverage).toBe(1);
    expect(decorated.legalEvidenceStrength).toBeLessThanOrEqual(0.65);
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
    expect(decorated.matchCategory).not.toBe('HIGH_ABSTRACT_OVERLAP');
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
    expect(decorated.matchCategory).not.toBe('HIGH_ABSTRACT_OVERLAP');
  });

  test('hard ceiling is reported separately from coverage saturation', () => {
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
      inputTokens: 1000,
      outputTokens: 500,
      thoughtTokens: 0,
      batchesCompleted: 6,
    });

    expect(progress.projectedStopReason).toBe('hard_ceiling_reached');
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
