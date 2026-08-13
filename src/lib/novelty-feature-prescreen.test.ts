import { beforeEach, describe, expect, it, vi } from 'vitest';

const scorer = vi.hoisted(() => ({ scoreElements: vi.fn() }));
vi.mock('@/lib/element-scoring/scorer', () => scorer);
vi.mock('@/lib/patent-corpus-service', () => ({
  PATENT_CORPUS_EMBEDDING_MODEL: 'test-model',
  PATENT_CORPUS_EMBEDDING_DTYPE: 'float',
}));

import {
  canonicalPrescreenPn,
  prescreenCoverCandidates,
  prescreenStrongImportantPns,
  runNoveltyFeaturePrescreen,
  type FeaturePrescreenResult,
} from './novelty-feature-prescreen';

const stage0 = { inventionFeatures: ['Adaptive Control', 'moisture feedback'] };

function pool(...pns: string[]) {
  return pns.map(publicationNumber => ({ publicationNumber }));
}

function scoredCell(verdict: string, similarity?: number) {
  return { verdict, matchedTerms: [], termCoverage: 0, similarity, tier: 'abstract' };
}

function run(overrides: Partial<Parameters<typeof runNoveltyFeaturePrescreen>[0]> = {}) {
  return runNoveltyFeaturePrescreen({
    stage0Data: stage0,
    candidatePool: pool('US-1234567-A1', 'EP7654321B1'),
    searchId: 'search-1',
    timeoutMs: 5000,
    maxCandidates: 300,
    ...overrides,
  });
}

beforeEach(() => {
  scorer.scoreElements.mockReset();
  scorer.scoreElements.mockResolvedValue({
    cells: {
      'US-1234567-A1': { F0: scoredCell('STRONG', 0.71234), F1: scoredCell('PART', 0.66) },
      'EP7654321B1': { F0: scoredCell('WEAK'), F1: scoredCell('NONE') },
    },
    semanticAvailable: true,
    familyByPn: new Map([['US-1234567-A1', 'FAM-9']]),
  });
});

describe('runNoveltyFeaturePrescreen', () => {
  it('produces a compact canonical-keyed blob with sim only on S/P cells', async () => {
    const result = await run();
    expect(result.status).toBe('ok');
    expect(result.version).toBe(1);
    expect(result.featureTexts).toEqual(['Adaptive Control', 'moisture feedback']);
    // Canonical keys: separators and kind codes stripped.
    expect(Object.keys(result.cells).sort()).toEqual(['EP7654321', 'US1234567']);
    expect(result.cells.US1234567['adaptive control']).toEqual({ v: 'S', sim: 0.712 });
    expect(result.cells.US1234567['moisture feedback']).toEqual({ v: 'P', sim: 0.66 });
    // W cells carry no similarity payload; N cells are omitted entirely — a
    // missing feature under a SCORED pn means NONE (UNAVAILABLE is pn-level).
    expect(result.cells.EP7654321['adaptive control']).toEqual({ v: 'W' });
    expect(result.cells.EP7654321['moisture feedback']).toBeUndefined();
    expect(result.coverageByFeature).toEqual({
      'adaptive control': { strong: 1, part: 0 },
      'moisture feedback': { strong: 0, part: 1 },
    });
    expect(result.familyByPn).toEqual({ US1234567: 'FAM-9' });
    expect(result.scoredCount).toBe(2);
    expect(result.unavailableCount).toBe(0);
  });

  it('excludes papers, dedupes publication variants, and caps the pool', async () => {
    await run({
      candidatePool: [
        ...pool('US1234567A1', 'US-1234567-B2', 'PAPER123', 'arxiv:2101.0001'),
        ...pool('EP7654321B1', 'IN9999999A'),
      ],
      maxCandidates: 2,
    });
    const passed = scorer.scoreElements.mock.calls[0][0].publicationNumbers;
    // First raw spelling per canonical wins; papers and non-patent ids dropped;
    // cap applied after dedupe.
    expect(passed).toEqual(['US1234567A1', 'EP7654321B1']);
  });

  it('reports pns the scorer omitted as UNAVAILABLE, never N', async () => {
    scorer.scoreElements.mockResolvedValue({
      cells: { 'US-1234567-A1': { F0: scoredCell('STRONG'), F1: scoredCell('NONE') } },
      semanticAvailable: true,
      familyByPn: new Map(),
    });
    const result = await run();
    expect(result.scoredCount).toBe(1);
    expect(result.unavailablePns).toEqual(['EP7654321']);
    expect(result.cells.EP7654321).toBeUndefined();
  });

  it('returns unavailable instead of throwing when the scorer fails', async () => {
    scorer.scoreElements.mockRejectedValue(new Error('voyage down'));
    const result = await run();
    expect(result.status).toBe('unavailable');
    expect(result.reason).toBe('voyage down');
    expect(result.featureTexts).toEqual(['Adaptive Control', 'moisture feedback']);
  });

  it('times out into unavailable', async () => {
    scorer.scoreElements.mockImplementation(() => new Promise(() => { /* hangs */ }));
    const result = await run({ timeoutMs: 1000 });
    expect(result.status).toBe('unavailable');
    expect(result.reason).toBe('timeout');
  });

  it('is unavailable with no features or no patent candidates', async () => {
    expect((await run({ stage0Data: { inventionFeatures: [] } })).reason).toBe('no_invention_features');
    expect((await run({ candidatePool: pool('PAPER1', 'arxiv:1') })).reason).toBe('no_patent_candidates');
    expect(scorer.scoreElements).not.toHaveBeenCalled();
  });

  it('keeps literal-only scoring usable: semanticAvailable false is still ok', async () => {
    scorer.scoreElements.mockResolvedValue({
      cells: { 'US-1234567-A1': { F0: scoredCell('PART') } },
      semanticAvailable: false,
      familyByPn: new Map(),
    });
    const result = await run();
    expect(result.status).toBe('ok');
    expect(result.semanticAvailable).toBe(false);
  });
});

describe('prescreen helpers', () => {
  const important = [
    { feature: 'Adaptive Control', type: 'core_technical' as const },
    { feature: 'moisture feedback', type: 'novelty_candidate' as const },
  ];

  function prescreen(cells: FeaturePrescreenResult['cells']): FeaturePrescreenResult {
    return {
      version: 1, status: 'ok', semanticAvailable: true, model: 'm', dtype: 'float',
      scoredCount: Object.keys(cells).length, unavailableCount: 0, elapsedMs: 1,
      featureTexts: ['Adaptive Control', 'moisture feedback'],
      cells, coverageByFeature: {}, unavailablePns: [],
    };
  }

  it('cover candidates use S∪P on important features, weighted S=2 P=1', () => {
    const candidates = prescreenCoverCandidates(prescreen({
      US1: { 'adaptive control': { v: 'S' }, 'moisture feedback': { v: 'P' } },
      US2: { 'adaptive control': { v: 'W' }, 'moisture feedback': { v: 'N' } },
    }), important);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      key: 'US1',
      coveredFeatures: ['adaptive control', 'moisture feedback'],
      priorityScore: 3,
    });
  });

  it('strong-important map counts S only', () => {
    const strong = prescreenStrongImportantPns(prescreen({
      US1: { 'adaptive control': { v: 'S' }, 'moisture feedback': { v: 'S' } },
      US2: { 'adaptive control': { v: 'P' } },
    }), important);
    expect(strong.get('US1')).toBe(2);
    expect(strong.has('US2')).toBe(false);
  });

  it('both helpers return empty for unavailable prescreens', () => {
    const unavailable = { ...prescreen({}), status: 'unavailable' as const };
    expect(prescreenCoverCandidates(unavailable, important)).toEqual([]);
    expect(prescreenStrongImportantPns(unavailable, important).size).toBe(0);
  });
});

describe('canonicalPrescreenPn', () => {
  it('strips separators and kind codes, preserves paper ids', () => {
    expect(canonicalPrescreenPn('US-1234567-A1')).toBe('US1234567');
    expect(canonicalPrescreenPn('us1234567b2')).toBe('US1234567');
    expect(canonicalPrescreenPn('PAPER123')).toBe('PAPER123');
  });
});
