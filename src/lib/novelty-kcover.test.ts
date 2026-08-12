import { describe, expect, it } from 'vitest';
import {
  DEFAULT_K_BY_TYPE,
  REPORT_BAND_CEILING_MAX,
  kCoverSelect,
  resolveComplexityBand,
  type CoverageImportantFeature,
  type KCoverCandidate,
} from './novelty-kcover';

describe('resolveComplexityBand', () => {
  it('maps each complexity to its band', () => {
    expect(resolveComplexityBand('simple', 4)).toEqual({ complexity: 'simple', floor: 3, ceiling: 8 });
    expect(resolveComplexityBand('moderate', 6)).toEqual({ complexity: 'moderate', floor: 5, ceiling: 14 });
    expect(resolveComplexityBand('complex', 10)).toEqual({ complexity: 'complex', floor: 7, ceiling: 20 });
    expect(resolveComplexityBand('crowded', 10)).toEqual({ complexity: 'crowded', floor: 8, ceiling: 25 });
  });

  it('stretches the ceiling for feature-heavy inventions, capped at the hard max', () => {
    // 18 important features on a 'moderate' profile: ceil(18 * 1.2) = 22 > 14.
    expect(resolveComplexityBand('moderate', 18).ceiling).toBe(22);
    // Never past the hard cap.
    expect(resolveComplexityBand('moderate', 40).ceiling).toBe(REPORT_BAND_CEILING_MAX);
    // Stretch never lowers a band ceiling.
    expect(resolveComplexityBand('complex', 2).ceiling).toBe(20);
  });

  it('treats unknown labels and bad counts as simple', () => {
    expect(resolveComplexityBand(undefined, NaN)).toEqual({ complexity: 'simple', floor: 3, ceiling: 8 });
    expect(resolveComplexityBand('nonsense', -5)).toEqual({ complexity: 'simple', floor: 3, ceiling: 8 });
  });
});

function feature(name: string, type: CoverageImportantFeature['type'] = 'core_technical'): CoverageImportantFeature {
  return { feature: name, type };
}

function candidate(key: string, covered: string[], overrides: Partial<KCoverCandidate> = {}): KCoverCandidate {
  return { key, coveredFeatures: covered, ...overrides };
}

describe('kCoverSelect', () => {
  it('stops as soon as every feature has its required supporters', () => {
    // One reference covers both features; core_technical requires k=2, so a
    // second supporter per feature is demanded before closure.
    const result = kCoverSelect(
      [
        candidate('A', ['f1', 'f2']),
        candidate('B', ['f1']),
        candidate('C', ['f2']),
        candidate('D', ['f1', 'f2']),
      ],
      [feature('f1'), feature('f2')]
    );
    // A + D satisfy k=2 on both features; B and C add nothing.
    expect(result.selectedKeys).toEqual(['A', 'D']);
    expect(result.featuresCovered).toBe(2);
    expect(result.featuresTotal).toBe(2);
  });

  it('demands deeper corroboration for novelty-candidate features', () => {
    const candidates = ['A', 'B', 'C', 'D'].map(key => candidate(key, ['novel']));
    const result = kCoverSelect(candidates, [feature('novel', 'novelty_candidate')]);
    expect(result.selectedKeys).toHaveLength(DEFAULT_K_BY_TYPE.novelty_candidate);
  });

  it('never demands supporters that do not exist', () => {
    const result = kCoverSelect(
      [candidate('A', ['novel'])],
      [feature('novel', 'novelty_candidate'), feature('untaught', 'core_technical')]
    );
    expect(result.selectedKeys).toEqual(['A']);
    const untaught = result.perFeature.find(entry => entry.feature === 'untaught');
    expect(untaught?.required).toBe(0);
    expect(untaught?.available).toBe(0);
    expect(result.featuresCovered).toBe(1);
  });

  it('is monotone: adding evidence to a candidate never shrinks the selection width', () => {
    const features = [feature('f1'), feature('f2', 'novelty_candidate'), feature('f3', 'implementation')];
    const base = [
      candidate('A', ['f1']),
      candidate('B', ['f2']),
      candidate('C', ['f3']),
      candidate('D', ['f2']),
    ];
    const before = kCoverSelect(base, features);
    const upgraded = base.map(entry =>
      entry.key === 'A' ? candidate('A', ['f1', 'f2']) : entry
    );
    const after = kCoverSelect(upgraded, features);
    expect(after.featuresCovered).toBeGreaterThanOrEqual(before.featuresCovered);
    // The upgraded pool can satisfy the k=3 novelty demand more fully.
    const demandAfter = after.perFeature.find(entry => entry.feature === 'f2');
    const demandBefore = before.perFeature.find(entry => entry.feature === 'f2');
    expect(demandAfter!.satisfiedBy.length).toBeGreaterThanOrEqual(demandBefore!.satisfiedBy.length);
  });

  it('breaks ties deterministically: gain, then priorityScore, then sourceOrder, then key', () => {
    const features = [feature('f1', 'implementation')];
    const tied = kCoverSelect(
      [
        candidate('B', ['f1'], { priorityScore: 5, sourceOrder: 1 }),
        candidate('A', ['f1'], { priorityScore: 5, sourceOrder: 1 }),
        candidate('C', ['f1'], { priorityScore: 9, sourceOrder: 2 }),
      ],
      features
    );
    // implementation requires k=1: highest priorityScore wins the single slot.
    expect(tied.selectedKeys).toEqual(['C']);

    const byKey = kCoverSelect(
      [candidate('B', ['f1'], { sourceOrder: 0 }), candidate('A', ['f1'], { sourceOrder: 0 })],
      features
    );
    expect(byKey.selectedKeys).toEqual(['A']);
  });

  it('is deterministic across repeated invocations', () => {
    const features = [feature('f1'), feature('f2', 'novelty_candidate')];
    const candidates = Array.from({ length: 12 }, (_, index) =>
      candidate(`P${index}`, index % 2 ? ['f1'] : ['f2'], { priorityScore: index % 3 })
    );
    const first = kCoverSelect(candidates, features);
    const second = kCoverSelect(candidates, features);
    expect(second).toEqual(first);
  });

  it('ignores features and cells outside the important set', () => {
    const result = kCoverSelect(
      [candidate('A', ['f1', 'irrelevant'])],
      [feature('f1', 'implementation')]
    );
    expect(result.selectedKeys).toEqual(['A']);
    expect(result.featuresTotal).toBe(1);
  });

  it('matches feature names case-insensitively', () => {
    const result = kCoverSelect(
      [candidate('A', ['Sensor Fusion  '])],
      [feature('sensor fusion', 'implementation')]
    );
    expect(result.featuresCovered).toBe(1);
  });

  it('honours a caller-supplied kByType override', () => {
    const candidates = ['A', 'B', 'C'].map(key => candidate(key, ['f1']));
    const result = kCoverSelect(candidates, [feature('f1', 'implementation')], { kByType: { implementation: 3 } });
    expect(result.selectedKeys).toHaveLength(3);
  });

  it('seeds preselected keys first and only closes remaining demand', () => {
    const features = [feature('f1', 'novelty_candidate')]; // k=3
    const result = kCoverSelect(
      [
        candidate('SEED', ['f1'], { priorityScore: 0 }),
        candidate('A', ['f1'], { priorityScore: 10 }),
        candidate('B', ['f1'], { priorityScore: 9 }),
        candidate('C', ['f1'], { priorityScore: 8 }),
      ],
      features,
      { preselected: ['SEED'] }
    );
    // SEED counts as one supporter; greedy adds only the two best remaining.
    expect(result.selectedKeys).toEqual(['SEED', 'A', 'B']);
  });

  it('returns empty selection when nothing is covered', () => {
    const result = kCoverSelect(
      [candidate('A', [])],
      [feature('f1')]
    );
    expect(result.selectedKeys).toEqual([]);
    expect(result.featuresCovered).toBe(0);
  });
});
