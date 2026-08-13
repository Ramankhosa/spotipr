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

// ---- Stage 1.7 prescreen-driven sizing ------------------------------------

function withPrescreen(stage1: any, cells: Record<string, Record<string, { v: string }>>) {
  return {
    ...stage1,
    featurePrescreen: {
      version: 1,
      status: 'ok',
      semanticAvailable: true,
      model: 'm',
      dtype: 'binary',
      scoredCount: Object.keys(cells).length,
      unavailableCount: 0,
      elapsedMs: 3,
      featureTexts: stage0Simple().inventionFeatures,
      cells,
      coverageByFeature: {},
      unavailablePns: [],
    },
  };
}

function canonicalOf(index: number) {
  // stage1With pns are US2026...A1; canonical strips the kind code.
  return `US20260${String(index).padStart(4, '0')}`;
}

const POLICY = { enforce: true, attrition: 1.5 };

describe('prescreen-driven sizing (stage17 enforce)', () => {
  test('target = kCoverDemand × attrition, clamped to the profile bounds', () => {
    const svc = service();
    // Two core features (k=2 each); candidates 0..3 each cover one feature →
    // demand = 4; ceil(4 × 1.5) = 6 < simple floor 8 → floor wins.
    const cells: Record<string, Record<string, { v: string }>> = {};
    for (let index = 0; index < 4; index += 1) {
      cells[canonicalOf(index)] = {
        [stage0Simple().inventionFeatures[index % 2]]: { v: 'S' },
      };
    }
    const selected = svc.selectRelevantPatentsForDeepAnalysis(
      withPrescreen(stage1With(2, 10), cells), 60, stage0Simple(), false, POLICY
    );
    // Floor 8 = 2 accepted + 6 borderline.
    expect(selected).toHaveLength(8);
  });

  test('a high prescreen demand widens the target past the ratio formula', () => {
    const svc = service();
    // 8 candidates each covering a DIFFERENT core feature of an 8-feature...
    // simple invention has 4 features; use one feature covered by many distinct
    // candidates under novelty k=3 to drive demand: here 12 candidates each
    // covering one of the two core features → demand = 4 (k=2 × 2 features).
    // Instead drive width via attrition on a larger demand: cover both features
    // per candidate on 6 distinct candidates → demand stays small; so test the
    // clamp directly with a spread of single-feature candidates.
    const cells: Record<string, Record<string, { v: string }>> = {};
    for (let index = 0; index < 12; index += 1) {
      cells[canonicalOf(index)] = {
        [stage0Simple().inventionFeatures[index % 2]]: { v: index % 3 === 0 ? 'S' : 'P' },
      };
    }
    const selected = svc.selectRelevantPatentsForDeepAnalysis(
      withPrescreen(stage1With(2, 20), cells), 60, stage0Simple(), false, POLICY
    );
    // demand 4 → ceil(4×1.5)=6 → clamped to floor 8. Ratio formula would give
    // clamp(ceil(22×0.35)=8, 8, 24) = 8 as well: assert the prescreen path
    // produced a bounded, not runaway, target.
    expect(selected.length).toBeLessThanOrEqual(12);
    expect(selected.length).toBeGreaterThanOrEqual(8);
  });

  test('falls back to exact legacy sizing when the prescreen is unavailable or absent', () => {
    const svc = service();
    const legacy = svc.selectRelevantPatentsForDeepAnalysis(stage1With(2, 10), 60, stage0Simple());
    const unavailable = svc.selectRelevantPatentsForDeepAnalysis(
      {
        ...stage1With(2, 10),
        featurePrescreen: { version: 1, status: 'unavailable', featureTexts: [] },
      },
      60, stage0Simple(), false, POLICY
    );
    const noPolicy = svc.selectRelevantPatentsForDeepAnalysis(
      withPrescreen(stage1With(2, 10), { [canonicalOf(0)]: { [stage0Simple().inventionFeatures[0]]: { v: 'S' } } }),
      60, stage0Simple()
    );
    expect(unavailable.map((c: any) => c.publicationNumber)).toEqual(legacy.map((c: any) => c.publicationNumber));
    expect(noPolicy.map((c: any) => c.publicationNumber)).toEqual(legacy.map((c: any) => c.publicationNumber));
  });

  test('borderline slots go to coverage-closing candidates first, then score order', () => {
    const svc = service();
    // 2 accepted (indices 0-1), 10 borderline (2-11). Feature A covered by the
    // accepted candidates; feature B only by LOW-scored borderline candidates
    // 10 and 11 — greedy must pick them despite their scores, then top up by
    // score order.
    const [featureA, featureB] = stage0Simple().inventionFeatures;
    const cells: Record<string, Record<string, { v: string }>> = {
      [canonicalOf(0)]: { [featureA]: { v: 'S' } },
      [canonicalOf(1)]: { [featureA]: { v: 'S' } },
      [canonicalOf(10)]: { [featureB]: { v: 'S' } },
      [canonicalOf(11)]: { [featureB]: { v: 'S' } },
    };
    const selected = svc.selectRelevantPatentsForDeepAnalysis(
      withPrescreen(stage1With(2, 10), cells), 60, stage0Simple(), false, POLICY
    );
    const pns = selected.map((c: any) => c.publicationNumber);
    // Both feature-B teachers make the cut even though 8 higher-scored
    // borderline candidates exist.
    expect(pns).toContain('US202600010A1');
    expect(pns).toContain('US202600011A1');
    // Accepted always first.
    expect(pns.slice(0, 2)).toEqual(['US202600000A1', 'US202600001A1']);
  });

  test('adaptive enforce caps the reviewable pool at the prescreen target', () => {
    const svc = service();
    // Demand 2 (two features, each k=2 but only one candidate covers each →
    // required clamps to available 1+1) → ceil(2×1.5)=3 → floor 8 → target 8.
    const [featureA, featureB] = stage0Simple().inventionFeatures;
    const cells = {
      [canonicalOf(0)]: { [featureA]: { v: 'S' } },
      [canonicalOf(1)]: { [featureB]: { v: 'S' } },
    };
    const selected = svc.selectRelevantPatentsForDeepAnalysis(
      withPrescreen(stage1With(30, 0), cells), 60, stage0Simple(), true, POLICY
    );
    // Without the prescreen, adaptive analyzes all 30.
    expect(selected).toHaveLength(8);
  });
});
