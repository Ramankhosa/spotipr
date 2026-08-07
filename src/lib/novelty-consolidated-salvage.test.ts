import { afterEach, describe, expect, test, vi } from 'vitest';
import { NoveltySearchService } from './novelty-search-service';

vi.mock('./metering/gateway', () => ({
  llmGateway: { executeLLMOperation: vi.fn() },
}));

// The consolidated stage persists progress, an aggregation snapshot and an LLM-call
// audit row. None of that is under test here; stub the client so the assertions are
// about salvage behaviour rather than database availability.
vi.mock('./prisma', () => {
  const resolve = () => Promise.resolve({});
  const model = { create: resolve, update: resolve, upsert: resolve, createMany: resolve, deleteMany: resolve, findMany: () => Promise.resolve([]), findFirst: resolve, findUnique: resolve };
  return {
    prisma: new Proxy({}, {
      get: (_target, key) => (key === 'then' ? undefined : model),
    }),
  };
});

const FEATURES = ['soil moisture sensing', 'closed-loop valve control'];

/** Publication numbers are kind-stripped before the prompt, and salvage rewrites
 *  replies back to that canonical form so downstream decoration can match them. */
const canon = (pn: string) => pn.replace(/[A-Z]\d*$/, '');

/** createUnknownFeatureMap stamps this on every cell it fabricates, which is the only
 *  reliable way to tell a fabricated row from an analysed one: stage-3.5 QA can also
 *  downgrade a genuine mapping to Unknown when its quote is unsupported. */
const isFabricated = (cell: any) => cell?.reason === 'Feature-mapping execution failed.';

function service() {
  const svc = new NoveltySearchService() as any;
  vi.spyOn(svc, 'persistDeepAnalysisProgress').mockResolvedValue(undefined);
  vi.spyOn(svc, 'ensureSearchNotCancelled').mockResolvedValue({ success: true });
  vi.spyOn(svc, 'safelyHydrateClaimsForAnalysisBatch').mockResolvedValue({});
  vi.spyOn(svc, 'storeFeatureMapResults').mockResolvedValue(undefined);
  vi.spyOn(svc, 'storeAggregationSnapshot').mockResolvedValue(undefined);
  return svc;
}

/** Stage 1 data whose gate accepts every candidate, so all of them reach deep analysis. */
function stage1For(publicationNumbers: string[]) {
  const byPn: Record<string, any> = {};
  for (const pn of publicationNumbers) {
    byPn[pn] = { pn, decision: 'accept', score: 0.9, evidence_quality: 'high', reviewStatus: 'reviewed' };
  }
  return {
    retrievalCandidates: publicationNumbers.map(pn => ({
      publicationNumber: pn,
      title: `Title ${pn}`,
      abstract: `Abstract for ${pn} describing soil moisture sensing and valve control.`,
    })),
    aiRelevance: {
      accepted: publicationNumbers,
      component: [],
      borderline: [],
      rejected: [],
      byPn,
      gateStatus: 'complete',
    },
  };
}

function mapFor(pn: string, status = 'Present') {
  return {
    pn,
    title: `Title ${pn}`,
    feature_analysis: FEATURES.map(feature => ({
      feature,
      status,
      extent_score: 0.8,
      confidence: 0.9,
      evidence: { quote: `${pn} discloses ${feature}`, field: 'abstract' },
    })),
  };
}

function remarkFor(pn: string) {
  return {
    pn,
    novelty_threat: 'moderate_overlap',
    summary: `${pn} overlaps partially.`,
    comparison_rows: FEATURES.map(feature => ({
      feature,
      status: 'Present',
      patent_disclosure: `${pn} teaches ${feature}`,
      evidence_quote: `${pn} discloses ${feature}`,
      professional_remark: 'Relevant disclosure.',
    })),
  };
}

afterEach(() => vi.restoreAllMocks());

describe('consolidated analysis batch salvage', () => {
  test('keeps the patents that came back and marks only the missing one Unknown, without retrying', async () => {
    const { llmGateway } = await import('./metering/gateway');
    const svc = service();
    const pns = ['US1000001A1', 'US1000002A1', 'US1000003A1'];

    // The model omits the third patent entirely — the single most common defect.
    (llmGateway.executeLLMOperation as any).mockResolvedValue({
      success: true,
      response: {
        output: JSON.stringify({
          feature_map: [mapFor(pns[0]), mapFor(pns[1])],
          per_patent_remarks: [remarkFor(pns[0]), remarkFor(pns[1])],
          quality_flags: { low_evidence: false, ambiguous_abstracts: false, language_mismatch: false },
          stats: { patents_analyzed: 2, avg_abstract_length_words: 40 },
        }),
        outputTokens: 100,
        metadata: { inputTokens: 500 },
      },
    });

    const result = await svc.performConsolidatedDeepAnalysis(
      'salvage-run',
      { inventionFeatures: FEATURES, searchQuery: 'irrigation' },
      stage1For(pns),
      svc.mergeConfig(),
      {}
    );

    expect(result.success).toBe(true);
    const maps = result.data.stage35Data.feature_map;
    const byPn = new Map<string, any>(maps.map((m: any) => [m.pn, m]));

    // All three patents are represented.
    expect(maps).toHaveLength(3);
    // The two returned by the model keep real per-feature analysis. Exact statuses are
    // not asserted: stage-3.5 QA legitimately downgrades a mapping whose quote is not
    // supported by the record. What matters is that they were analysed at all.
    for (const pn of [pns[0], pns[1]]) {
      const cells = byPn.get(canon(pn)).feature_analysis;
      expect(cells).toHaveLength(FEATURES.length);
      expect(cells.some(isFabricated)).toBe(false);
    }
    // ...and only the omitted one is fabricated as Unknown.
    const filled = byPn.get(canon(pns[2])).feature_analysis;
    expect(filled.every(isFabricated)).toBe(true);
    expect(filled.every((c: any) => c.status === 'Unknown')).toBe(true);

    // The decisive cost assertion: a partial response is not a batch failure, so the
    // batch is not re-sent. Previously this cost a second full call and still threw
    // away the two good patents.
    expect((llmGateway.executeLLMOperation as any).mock.calls).toHaveLength(1);
  });

  test('drops hallucinated and duplicated rows instead of failing the batch', async () => {
    const { llmGateway } = await import('./metering/gateway');
    const svc = service();
    const pns = ['US2000001A1', 'US2000002A1'];

    (llmGateway.executeLLMOperation as any).mockResolvedValue({
      success: true,
      response: {
        output: JSON.stringify({
          feature_map: [
            mapFor(pns[0]),
            mapFor(pns[0]),                 // duplicate
            mapFor('US9999999A1'),          // never requested
            mapFor(pns[1]),
          ],
          per_patent_remarks: [remarkFor(pns[0]), remarkFor(pns[1])],
          quality_flags: { low_evidence: false, ambiguous_abstracts: false, language_mismatch: false },
          stats: { patents_analyzed: 2, avg_abstract_length_words: 40 },
        }),
        outputTokens: 100,
        metadata: { inputTokens: 500 },
      },
    });

    const result = await svc.performConsolidatedDeepAnalysis(
      'salvage-noise',
      { inventionFeatures: FEATURES, searchQuery: 'irrigation' },
      stage1For(pns),
      svc.mergeConfig(),
      {}
    );

    const maps = result.data.stage35Data.feature_map;
    expect(maps.map((m: any) => m.pn).sort()).toEqual(pns.map(canon).sort());
    expect((llmGateway.executeLLMOperation as any).mock.calls).toHaveLength(1);
  });

  test('rejects a row whose feature coverage is incomplete rather than understating overlap', async () => {
    const { llmGateway } = await import('./metering/gateway');
    const svc = service();
    const pns = ['US3000001A1', 'US3000002A1'];

    const partialMap = {
      pn: pns[1],
      title: `Title ${pns[1]}`,
      // Only one of the two invention features was mapped.
      feature_analysis: [{ feature: FEATURES[0], status: 'Present', extent_score: 0.8, confidence: 0.9 }],
    };

    (llmGateway.executeLLMOperation as any).mockResolvedValue({
      success: true,
      response: {
        output: JSON.stringify({
          feature_map: [mapFor(pns[0]), partialMap],
          per_patent_remarks: [remarkFor(pns[0])],
          quality_flags: { low_evidence: false, ambiguous_abstracts: false, language_mismatch: false },
          stats: { patents_analyzed: 2, avg_abstract_length_words: 40 },
        }),
        outputTokens: 100,
        metadata: { inputTokens: 500 },
      },
    });

    const result = await svc.performConsolidatedDeepAnalysis(
      'salvage-partial-row',
      { inventionFeatures: FEATURES, searchQuery: 'irrigation' },
      stage1For(pns),
      svc.mergeConfig(),
      {}
    );

    const byPn = new Map<string, any>(result.data.stage35Data.feature_map.map((m: any) => [m.pn, m]));
    expect(byPn.get(canon(pns[0])).feature_analysis.some(isFabricated)).toBe(false);
    // An incomplete row is not trusted: it is replaced rather than allowed to understate
    // overlap with a partial feature set.
    expect(byPn.get(canon(pns[1])).feature_analysis.every(isFabricated)).toBe(true);
  });

  test('still retries and falls back when nothing in the response is usable', async () => {
    const { llmGateway } = await import('./metering/gateway');
    const svc = service();
    const pns = ['US4000001A1'];

    (llmGateway.executeLLMOperation as any).mockResolvedValue({
      success: true,
      response: {
        output: JSON.stringify({
          feature_map: [mapFor('US8888888A1')],   // wrong patent entirely
          per_patent_remarks: [],
          quality_flags: {},
          stats: {},
        }),
        outputTokens: 10,
        metadata: { inputTokens: 100 },
      },
    });

    const result = await svc.performConsolidatedDeepAnalysis(
      'salvage-hopeless',
      { inventionFeatures: FEATURES, searchQuery: 'irrigation' },
      stage1For(pns),
      svc.mergeConfig(),
      {}
    );

    // Two attempts, then the batch falls back — unchanged behaviour for a genuinely
    // broken response, so the salvage path cannot mask a real failure. With every batch
    // failed the stage reports failure and the caller routes to the legacy 3.5a chain.
    expect((llmGateway.executeLLMOperation as any).mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(result.success).toBe(false);
  });
});
