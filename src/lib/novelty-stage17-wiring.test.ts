// Stage 1.7 wiring in executeStage15: prescreen computed once, persisted
// immediately (including on the cache-hit path whose guarded write would drop
// it), reused idempotently, and — enforce mode only — the ungated tail of the
// gate queue reordered by predicted coverage. Observe mode must be a true
// behavioral no-op.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  noveltySearchRun: { findFirst: vi.fn(), update: vi.fn() },
  noveltySearchJob: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
}));
vi.mock('./prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('./metering/gateway', () => ({ llmGateway: { executeLLMOperation: vi.fn() } }));

const prescreenModule = vi.hoisted(() => ({ runNoveltyFeaturePrescreen: vi.fn() }));
vi.mock('@/lib/novelty-feature-prescreen', async (importOriginal) => ({
  ...(await importOriginal() as any),
  runNoveltyFeaturePrescreen: prescreenModule.runNoveltyFeaturePrescreen,
}));

import { NoveltySearchService } from './novelty-search-service';

function service() {
  return new NoveltySearchService() as any;
}

const FEATURES = ['adaptive control', 'moisture feedback'];

function pool(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    publicationNumber: `US${String(index).padStart(7, '0')}A1`,
    title: `Candidate ${index}`,
    abstract: `Abstract ${index}`,
    relevanceScore: 1 - index * 0.001,
  }));
}

function prescreenFixture(cells: Record<string, Record<string, { v: string }>>, overrides: any = {}) {
  return {
    version: 1,
    status: 'ok',
    semanticAvailable: true,
    model: 'm',
    dtype: 'binary',
    scoredCount: Object.keys(cells).length,
    unavailableCount: 0,
    elapsedMs: 5,
    featureTexts: FEATURES,
    cells,
    coverageByFeature: {},
    unavailablePns: [],
    ...overrides,
  };
}

function searchRun(stage1Extra: any = {}, configExtra: any = {}) {
  return {
    id: 'run-1',
    userId: 'user-1',
    config: configExtra,
    stage0Results: {
      inventionFeatures: FEATURES,
      featureDetails: [
        { feature: 'adaptive control', feature_type: 'core_technical' },
        { feature: 'moisture feedback', feature_type: 'novelty_candidate' },
      ],
    },
    stage1Results: { retrievalCandidates: pool(4), ...stage1Extra },
  };
}

function arm(svc: any, run: any) {
  prismaMock.noveltySearchRun.findFirst.mockResolvedValue(run);
  prismaMock.noveltySearchRun.update.mockResolvedValue({});
  prismaMock.noveltySearchJob.findUnique.mockResolvedValue(null);
  prismaMock.user.findUnique.mockResolvedValue({ tenantId: 'tenant-1' });
  const performSpy = vi.spyOn(svc, 'performStage15').mockResolvedValue({
    success: true,
    data: { byPn: {}, nextBatchCursor: 4 },
  });
  vi.spyOn(svc, 'mergeStage15Visibility').mockImplementation(
    (stage1Data: any, gateData: any) => ({ ...(stage1Data || {}), aiRelevance: gateData })
  );
  return performSpy as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  prescreenModule.runNoveltyFeaturePrescreen.mockResolvedValue(prescreenFixture({
    US0000003: { 'adaptive control': { v: 'S' }, 'moisture feedback': { v: 'S' } },
    US0000002: { 'adaptive control': { v: 'P' } },
    US0000000: { 'adaptive control': { v: 'N' } },
    // US0000001 has no cells -> UNAVAILABLE, ordered to the back.
  }));
});

describe('executeStage15 Stage 1.7 wiring', () => {
  it('computes the prescreen once, persists it immediately, and reorders the tail (enforce)', async () => {
    const svc = service();
    const performSpy = arm(svc, searchRun());

    const result = await svc.executeStage15('run-1', 'user-1');
    expect(result.success).toBe(true);
    expect(prescreenModule.runNoveltyFeaturePrescreen).toHaveBeenCalledTimes(1);

    // Persisted by ensureFeaturePrescreen itself, before the gate ran.
    const firstUpdate = prismaMock.noveltySearchRun.update.mock.calls[0][0];
    expect(firstUpdate.data.stage1Results.featurePrescreen.status).toBe('ok');

    // Enforce: fresh run (cursor 0) reorders the whole pool by S=2/P=1 weight;
    // cell-less candidates go to the back preserving relative order.
    const gateInput = performSpy.mock.calls[0][2];
    expect(gateInput.retrievalCandidates.map((c: any) => c.publicationNumber)).toEqual([
      'US0000003A1', // S+S = 4
      'US0000002A1', // P = 1
      'US0000000A1', // cells present, score 0
      'US0000001A1', // no cells -> -1
    ]);
    expect(gateInput.prescreenOrdering).toMatchObject({ applied: true, tailStart: 0 });
    expect(gateInput.featurePrescreen.status).toBe('ok');
  });

  it('leaves ordering bit-identical in observe mode', async () => {
    const svc = service();
    const performSpy = arm(svc, searchRun({}, { stage17: { mode: 'observe' } }));

    await svc.executeStage15('run-1', 'user-1');

    // Computed and persisted...
    expect(prescreenModule.runNoveltyFeaturePrescreen).toHaveBeenCalledTimes(1);
    expect(prismaMock.noveltySearchRun.update.mock.calls[0][0].data.stage1Results.featurePrescreen).toBeDefined();
    // ...but influencing nothing.
    const gateInput = performSpy.mock.calls[0][2];
    expect(gateInput.retrievalCandidates.map((c: any) => c.publicationNumber)).toEqual(
      pool(4).map(c => c.publicationNumber)
    );
    expect(gateInput.prescreenOrdering).toBeUndefined();
  });

  it('never reorders the gated prefix on a resumed run', async () => {
    const svc = service();
    const performSpy = arm(svc, searchRun({ aiRelevance: { byPn: undefined, nextBatchCursor: 2 } }));

    await svc.executeStage15('run-1', 'user-1');

    const gateInput = performSpy.mock.calls[0][2];
    // Prefix [0,2) untouched; tail [2,4) reordered (US3 outranks US2... both in
    // tail: US3 S+S=4 > US2 P=1).
    expect(gateInput.retrievalCandidates.map((c: any) => c.publicationNumber)).toEqual([
      'US0000000A1', 'US0000001A1', 'US0000003A1', 'US0000002A1',
    ]);
    expect(gateInput.prescreenOrdering.tailStart).toBe(2);
  });

  it('persists the prescreen even on the cache-hit path whose own write is guarded', async () => {
    const svc = service();
    const run = searchRun({
      aiRelevance: { byPn: { US0000000: {} }, nextBatchCursor: 4 },
      visiblePriorArtResults: [],  // guard `!Array.isArray(...)` is false -> branch skips its write
    });
    arm(svc, run);
    vi.spyOn(svc, 'canReuseStage15Gate').mockReturnValue(true);

    const result = await svc.executeStage15('run-1', 'user-1');
    expect(result.success).toBe(true);
    // performStage15 never ran (cache hit)...
    expect(svc.performStage15).not.toHaveBeenCalled();
    // ...yet the fresh prescreen reached the DB via ensureFeaturePrescreen.
    const wrote = prismaMock.noveltySearchRun.update.mock.calls.some(
      call => call[0].data.stage1Results?.featurePrescreen?.status === 'ok'
    );
    expect(wrote).toBe(true);
  });

  it('reuses a valid stored blob and recomputes on stale featureTexts', async () => {
    const svc = service();
    arm(svc, searchRun({ featurePrescreen: prescreenFixture({}, { featureTexts: FEATURES }) }));
    await svc.executeStage15('run-1', 'user-1');
    expect(prescreenModule.runNoveltyFeaturePrescreen).not.toHaveBeenCalled();

    vi.clearAllMocks();
    prescreenModule.runNoveltyFeaturePrescreen.mockResolvedValue(prescreenFixture({}));
    const svc2 = service();
    arm(svc2, searchRun({ featurePrescreen: prescreenFixture({}, { featureTexts: ['different feature'] }) }));
    await svc2.executeStage15('run-1', 'user-1');
    expect(prescreenModule.runNoveltyFeaturePrescreen).toHaveBeenCalledTimes(1);
  });

  it('keeps an unavailable prescreen in memory only, so a resume retries', async () => {
    const svc = service();
    arm(svc, searchRun());
    prescreenModule.runNoveltyFeaturePrescreen.mockResolvedValue(
      prescreenFixture({}, { status: 'unavailable', reason: 'timeout' })
    );

    const result = await svc.executeStage15('run-1', 'user-1');
    expect(result.success).toBe(true);
    // No prescreen-bearing write happened before the gate persist.
    const prescreenWrites = prismaMock.noveltySearchRun.update.mock.calls.filter(
      call => call[0].data.stage1Results?.featurePrescreen?.status === 'ok'
    );
    expect(prescreenWrites).toHaveLength(0);
    // And the enforce-mode reorder was skipped (fail open).
    const gateInput = (svc.performStage15 as any).mock.calls[0][2];
    expect(gateInput.prescreenOrdering).toBeUndefined();
  });

  it('skips everything when stage17 is disabled', async () => {
    const svc = service();
    const performSpy = arm(svc, searchRun({}, { stage17: { enabled: false } }));
    await svc.executeStage15('run-1', 'user-1');
    expect(prescreenModule.runNoveltyFeaturePrescreen).not.toHaveBeenCalled();
    expect(performSpy.mock.calls[0][2].featurePrescreen).toBeUndefined();
  });
});

describe('applyPrescreenRecallNet', () => {
  function gatedStage1(prescreen: any, cursor: number, poolSize = 8) {
    const candidates = pool(poolSize);
    const byPn: Record<string, any> = {};
    for (let index = 0; index < cursor; index += 1) {
      byPn[candidates[index].publicationNumber] = { pn: candidates[index].publicationNumber, rerankDecision: 'accept' };
    }
    return {
      retrievalCandidates: candidates,
      aiRelevance: { byPn, nextBatchCursor: cursor },
      featurePrescreen: prescreen,
    };
  }

  function armRecall(svc: any, gateResult: any = { success: true, data: { byPn: {}, nextBatchCursor: 4 } }) {
    const performSpy = vi.spyOn(svc, 'performStage15').mockResolvedValue(gateResult);
    vi.spyOn(svc, 'mergeStage15Visibility').mockImplementation(
      (stage1Data: any, gateData: any) => ({ ...(stage1Data || {}), aiRelevance: gateData })
    );
    const stage0 = searchRun().stage0Results;
    const config = svc.mergeConfig();
    return { performSpy: performSpy as any, stage0, config };
  }

  it('promotes STRONG-on-important ungated candidates through a narrowed wave, prefix untouched', async () => {
    const svc = service();
    const { performSpy, stage0, config } = armRecall(svc);
    const prescreen = prescreenFixture({
      US0000005: { 'adaptive control': { v: 'S' }, 'moisture feedback': { v: 'S' } },
      US0000003: { 'adaptive control': { v: 'S' } },
      US0000004: { 'adaptive control': { v: 'P' } }, // PART never promotes
      US0000006: { 'moisture feedback': { v: 'W' } },
    });
    const stage1 = gatedStage1(prescreen, 2);

    const result = await svc.applyPrescreenRecallNet('run-1', stage0, stage1, config, {});

    const reordered = performSpy.mock.calls[0][2];
    const pns = reordered.retrievalCandidates.map((c: any) => c.publicationNumber);
    // Prefix [0,2) untouched; picks follow ranked by STRONG count (US5=2, US3=1).
    expect(pns.slice(0, 4)).toEqual(['US0000000A1', 'US0000001A1', 'US0000005A1', 'US0000003A1']);
    expect(reordered.prescreenRecallNet).toMatchObject({ promotedCount: 2, pns: ['US0000005', 'US0000003'] });
    // Narrowed config bounds the wave to exactly the recall set.
    const narrowed = performSpy.mock.calls[0][3];
    expect(narrowed.stage15.maxCandidates).toBe(2);
    expect(narrowed.stage15.maxTotalCandidates).toBe(4);
    expect(performSpy.mock.calls[0][5]).toEqual({ appendNextBatch: true });
    // Result carries the merged gate.
    expect(result.prescreenRecallNet.promotedCount).toBe(2);
  });

  it('is promote-only: never touches candidates that already have gate records', async () => {
    const svc = service();
    const { performSpy, stage0, config } = armRecall(svc);
    const prescreen = prescreenFixture({
      // STRONG cell on an already-gated candidate: must not be re-promoted.
      US0000000: { 'adaptive control': { v: 'S' } },
    });
    const stage1 = gatedStage1(prescreen, 2);

    const result = await svc.applyPrescreenRecallNet('run-1', stage0, stage1, config, {});
    expect(performSpy).not.toHaveBeenCalled();
    expect(result).toBe(stage1);
  });

  it('deduplicates by family against the gated prefix and within picks', async () => {
    const svc = service();
    const { performSpy, stage0, config } = armRecall(svc);
    const prescreen = prescreenFixture({
      US0000003: { 'adaptive control': { v: 'S' } },
      US0000004: { 'adaptive control': { v: 'S' } },
      US0000005: { 'adaptive control': { v: 'S' } },
    }, {
      familyByPn: {
        US0000000: 'FAM-GATED',   // family already represented in the prefix
        US0000003: 'FAM-GATED',   // -> skipped
        US0000004: 'FAM-NEW',
        US0000005: 'FAM-NEW',     // sibling of a pick -> skipped
      },
    });
    const stage1 = gatedStage1(prescreen, 2);

    await svc.applyPrescreenRecallNet('run-1', stage0, stage1, config, {});
    const reordered = performSpy.mock.calls[0][2];
    expect(reordered.prescreenRecallNet.pns).toEqual(['US0000004']);
  });

  it('caps promotions at ten', async () => {
    const svc = service();
    const { performSpy, stage0, config } = armRecall(svc);
    const cells: Record<string, any> = {};
    for (let index = 2; index < 20; index += 1) {
      cells[`US${String(index).padStart(7, '0')}`] = { 'adaptive control': { v: 'S' } };
    }
    const stage1 = gatedStage1(prescreenFixture(cells), 2, 20);

    await svc.applyPrescreenRecallNet('run-1', stage0, stage1, config, {});
    expect(performSpy.mock.calls[0][2].prescreenRecallNet.promotedCount).toBe(10);
  });

  it('fails open: a gate failure returns stage1Data unchanged', async () => {
    const svc = service();
    const { stage0, config } = armRecall(svc, { success: false, error: 'gate exploded' });
    const prescreen = prescreenFixture({ US0000003: { 'adaptive control': { v: 'S' } } });
    const stage1 = gatedStage1(prescreen, 2);

    const result = await svc.applyPrescreenRecallNet('run-1', stage0, stage1, config, {});
    expect(result).toBe(stage1);
  });
});
