import { describe, expect, it } from 'vitest';
import { evaluateScreeningWave, type ScreeningWaveConfig } from './novelty-search-service';

const config: ScreeningWaveConfig = {
  maxTotalCandidates: 180,
  totalTimeoutMs: 300000,
  maxTokens: 250000,
  minYieldToContinue: 0.1,
  yieldDecayFactor: 0.25,
  yieldConfirmationWaves: 1,
};

function records(spec: Array<{ decision: string; quality?: string; error?: boolean; score?: number }>) {
  return spec.map((item, index) => ({
    pn: `US${index}`,
    decision: item.decision,
    score: item.score,
    rerankScore: item.score,
    evidence_quality: item.quality ?? 'medium',
    reviewStatus: item.error ? ('gate_error' as const) : ('reviewed' as const),
  }));
}

function evaluate(overrides: Partial<Parameters<typeof evaluateScreeningWave>[0]> = {}) {
  return evaluateScreeningWave({
    records: records([{ decision: 'accept' }]),
    waveIndex: 2,
    firstWaveYield: 0.5,
    elapsedMs: 0,
    tokensUsed: 0,
    cursor: 90,
    poolSize: 300,
    orderTrusted: true,
    consecutiveLowWaves: 0,
    config,
    ...overrides,
  });
}

describe('evaluateScreeningWave', () => {
  it('continues while the wave keeps yielding relevant hits', () => {
    const decision = evaluate({ records: records(Array.from({ length: 10 }, () => ({ decision: 'accept' }))) });
    expect(decision.shouldContinue).toBe(true);
    expect(decision.waveYield).toBe(1);
  });

  it('stops when the yield drops below the threshold', () => {
    const decision = evaluate({
      records: records(Array.from({ length: 20 }, () => ({ decision: 'borderline' }))),
    });
    expect(decision.shouldContinue).toBe(false);
    expect(decision.stopReason).toBe('yield_below_threshold');
    expect(decision.waveYield).toBe(0);
  });

  it('always processes the first wave in full', () => {
    const decision = evaluate({
      waveIndex: 1,
      firstWaveYield: null,
      records: records(Array.from({ length: 20 }, () => ({ decision: 'borderline' }))),
    });
    expect(decision.shouldContinue).toBe(true);
  });

  it('treats borderline as unknown rather than as relevance', () => {
    // 10 borderline + 1 accept = 9% yield, under the 10% floor.
    const decision = evaluate({
      records: records([
        ...Array.from({ length: 10 }, () => ({ decision: 'borderline' })),
        { decision: 'accept' },
      ]),
    });
    expect(decision.strong).toBe(1);
    expect(decision.shouldContinue).toBe(false);
  });

  it('counts components only when their evidence is not weak', () => {
    const strong = evaluate({ records: records(Array.from({ length: 4 }, () => ({ decision: 'component', quality: 'high' }))) });
    const weak = evaluate({ records: records(Array.from({ length: 4 }, () => ({ decision: 'component', quality: 'low' }))) });

    expect(strong.strong).toBe(4);
    expect(strong.shouldContinue).toBe(true);
    expect(weak.strong).toBe(0);
    expect(weak.shouldContinue).toBe(false);
  });

  it('reports gate failure as its own stop reason, not as exhausted relevance', () => {
    const decision = evaluate({
      records: records([
        ...Array.from({ length: 8 }, () => ({ decision: 'borderline', error: true })),
        ...Array.from({ length: 2 }, () => ({ decision: 'accept' })),
      ]),
    });
    expect(decision.stopReason).toBe('gate_errors');
    expect(decision.stopReason).not.toBe('yield_below_threshold');
  });

  it('is independent of retrieval scores', () => {
    const spec = [
      ...Array.from({ length: 5 }, () => ({ decision: 'accept' })),
      ...Array.from({ length: 5 }, () => ({ decision: 'borderline' })),
    ];
    const allEqual = evaluate({ records: records(spec.map(s => ({ ...s, score: 0.5 }))) });
    const allZero = evaluate({ records: records(spec.map(s => ({ ...s, score: 0 }))) });
    const missing = evaluate({ records: records(spec.map(s => ({ ...s, score: undefined }))) });

    expect(allEqual.shouldContinue).toBe(true);
    expect(allZero).toEqual(allEqual);
    expect(missing).toEqual(allEqual);
  });

  it('disables the yield rule when the ordering is not trustworthy', () => {
    const untrusted = evaluate({
      orderTrusted: false,
      records: records(Array.from({ length: 20 }, () => ({ decision: 'borderline' }))),
    });
    expect(untrusted.shouldContinue).toBe(true);
  });

  it('requires consecutive low waves when confirmation is configured', () => {
    const lowWave = records(Array.from({ length: 20 }, () => ({ decision: 'borderline' })));
    const patient = { ...config, yieldConfirmationWaves: 2 };

    const first = evaluate({ records: lowWave, config: patient, consecutiveLowWaves: 0 });
    expect(first.shouldContinue).toBe(true);
    expect(first.consecutiveLowWaves).toBe(1);

    const second = evaluate({ records: lowWave, config: patient, consecutiveLowWaves: 1 });
    expect(second.shouldContinue).toBe(false);
    expect(second.stopReason).toBe('yield_below_threshold');
  });

  it('resets the low-wave counter when yield recovers', () => {
    const decision = evaluate({
      consecutiveLowWaves: 1,
      records: records(Array.from({ length: 10 }, () => ({ decision: 'accept' }))),
    });
    expect(decision.consecutiveLowWaves).toBe(0);
  });

  it('scales the threshold to the first wave in a structurally low-yield domain', () => {
    // First wave yielded 8%; a later wave at 4% is still a quarter of that, so the
    // relative floor does not fire — only the absolute floor decides.
    const lowDomain = { ...config, minYieldToContinue: 0.02 };
    const decision = evaluate({
      firstWaveYield: 0.08,
      config: lowDomain,
      records: records([
        ...Array.from({ length: 1 }, () => ({ decision: 'accept' })),
        ...Array.from({ length: 24 }, () => ({ decision: 'borderline' })),
      ]),
    });
    expect(decision.waveYield).toBeCloseTo(0.04, 3);
    expect(decision.shouldContinue).toBe(true);
  });

  it.each([
    ['pool_exhausted', { cursor: 300, poolSize: 300 }],
    ['candidate_ceiling', { cursor: 180, poolSize: 300 }],
    ['wall_clock', { elapsedMs: 300000 }],
    ['token_budget', { tokensUsed: 250000 }],
  ])('stops with %s when that bound is reached', (reason, overrides) => {
    const decision = evaluate({
      records: records(Array.from({ length: 10 }, () => ({ decision: 'accept' }))),
      ...overrides,
    });
    expect(decision.shouldContinue).toBe(false);
    expect(decision.stopReason).toBe(reason);
  });

  it('stops on a wave with nothing reviewable', () => {
    const decision = evaluate({ records: [] });
    expect(decision.shouldContinue).toBe(false);
    expect(decision.stopReason).toBe('empty_wave');
  });
});
