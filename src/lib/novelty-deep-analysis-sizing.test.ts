import { describe, expect, test, vi } from 'vitest';
import { NoveltySearchService } from './novelty-search-service';

vi.mock('./metering/gateway', () => ({
  llmGateway: { executeLLMOperation: vi.fn() },
}));

function service() {
  return new NoveltySearchService() as any;
}

function stage0Simple() {
  return {
    title: 'Straw bottle',
    inventionFeatures: [
      'bottle with integrated straw',
      'straw retention clip',
      'leakproof lid seal',
      'fold-flat straw hinge',
    ],
    featureDetails: [
      { feature: 'bottle with integrated straw', feature_type: 'core_technical' },
      { feature: 'straw retention clip', feature_type: 'core_technical' },
      { feature: 'leakproof lid seal', feature_type: 'implementation' },
      { feature: 'fold-flat straw hinge', feature_type: 'implementation' },
    ],
    claimConcepts: [],
    noveltyFocusInteractions: [],
    confidence: 0.9,
  };
}

function stage0Complex() {
  const features = Array.from({ length: 12 }, (_, index) => `distinct subsystem behaviour number ${index}`);
  return {
    title: 'Smart irrigation controller',
    inventionFeatures: features,
    featureDetails: features.map(feature => ({ feature, feature_type: 'core_technical' as const })),
    claimConcepts: [
      { title: 'sensing loop', importance: 'primary', linkedFeatures: features.slice(0, 2), claimableSummary: 'x' },
      { title: 'control loop', importance: 'secondary', linkedFeatures: features.slice(2, 4), claimableSummary: 'y' },
      { title: 'power management', importance: 'secondary', linkedFeatures: features.slice(4, 6), claimableSummary: 'z' },
    ],
    noveltyFocusInteractions: [],
    confidence: 0.9,
  };
}

function stage1With(acceptedCount: number, borderlineCount = 0) {
  const total = acceptedCount + borderlineCount;
  const candidates = Array.from({ length: total }, (_, index) => ({
    publicationNumber: `US20260${String(index).padStart(4, '0')}A1`,
    title: `Prior art ${index}`,
    abstract: 'background art',
  }));
  const byPn: Record<string, any> = {};
  candidates.forEach((candidate, index) => {
    byPn[candidate.publicationNumber] = {
      pn: candidate.publicationNumber,
      rerankDecision: index < acceptedCount ? 'accept' : 'borderline',
      rerankScore: 0.8 - index * 0.001,
    };
  });
  return {
    retrievalCandidates: candidates,
    aiRelevance: { byPn, gateStatus: 'completed' },
  };
}

// Accepted and component candidates always flow into deep analysis in full;
// the complexity-derived target sizes how far the pipeline digs into the
// borderline tier. These fixtures therefore use a thin accept set plus a deep
// borderline pool — the case where invention complexity should decide depth.
describe('complexity-aware deep-analysis sizing', () => {
  test('a complex invention digs deeper into borderline candidates than a simple one', () => {
    const svc = service();
    // 2 accepted + 10 borderline → reviewable 12, ratio target ceil(12 × 0.35) = 5.
    const simple = svc.selectRelevantPatentsForDeepAnalysis(stage1With(2, 10), 60, stage0Simple());
    const complex = svc.selectRelevantPatentsForDeepAnalysis(stage1With(2, 10), 60, stage0Complex());

    // simple: clamp(5, 8, 24) = 8 → 2 accepted + 6 borderline.
    expect(simple).toHaveLength(8);
    // complex: clamp(5, 16, 40) = 16 → needs 14 borderline, capped at the
    // 10-borderline fill limit → 2 accepted + 10 borderline.
    expect(complex).toHaveLength(12);
  });

  test('keeps the legacy bounds when no stage0 data is supplied', () => {
    const svc = service();
    // Legacy invocation shape (no stage0): clamp(5, 8, 40) = 8 → 2 + 6.
    expect(svc.selectRelevantPatentsForDeepAnalysis(stage1With(2, 10), 60)).toHaveLength(8);
  });

  test('never pads with borderline when accepted candidates already meet the target', () => {
    const svc = service();
    // 30 accepted → ratio target ceil(40 × 0.35) = 14 < 30 accepted → no borderline fill.
    const selected = svc.selectRelevantPatentsForDeepAnalysis(stage1With(30, 10), 60, stage0Simple());
    expect(selected).toHaveLength(30);
  });

  test('the caller-supplied maximum still wins', () => {
    const svc = service();
    expect(svc.selectRelevantPatentsForDeepAnalysis(stage1With(40, 0), 10, stage0Complex())).toHaveLength(10);
  });

  test('adaptive mode still analyzes the whole reviewable pool', () => {
    const svc = service();
    const selected = svc.selectRelevantPatentsForDeepAnalysis(stage1With(20, 10), 60, stage0Simple(), true);
    expect(selected).toHaveLength(30);
  });
});
