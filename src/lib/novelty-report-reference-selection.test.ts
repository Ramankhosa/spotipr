import { describe, expect, it } from 'vitest';
import {
  selectNoveltyReportReferences,
  validateReportReferenceSelection,
  type ReportReferenceCandidate,
} from './novelty-report-reference-selection';

function mapped(index: number, overrides: Partial<ReportReferenceCandidate> = {}): ReportReferenceCandidate {
  return {
    publicationNumber: `US202600${String(index).padStart(3, '0')}A1`,
    mapped: true,
    sourceOrder: index,
    priority: 'High',
    priorityScore: 100 - index,
    featureCoverage: 0.8 - index * 0.001,
    gateScore: 0.9 - index * 0.001,
    hasGateRecord: true,
    gateDecision: 'accept',
    ...overrides,
  };
}

function unmapped(index: number, decision?: string, score = 0.8): ReportReferenceCandidate {
  return {
    publicationNumber: `EP202600${String(index).padStart(3, '0')}A1`,
    mapped: false,
    sourceOrder: index,
    hasGateRecord: decision !== undefined,
    gateDecision: decision,
    gateScore: score,
    evidenceQuality: 'medium',
  };
}

describe('selectNoveltyReportReferences', () => {
  it('keeps every decisive reference in main even beyond the configured target', () => {
    const result = selectNoveltyReportReferences(
      Array.from({ length: 12 }, (_, index) => mapped(index, index < 6
        ? { canonicalDecisive: true }
        : { noveltyThreat: 'high_overlap' })),
      { mainReferenceTarget: 10, minMainReferences: 3 }
    );

    expect(result.main).toHaveLength(12);
    expect(result.main.filter(item => item.reason === 'decisive')).toHaveLength(6);
    expect(result.main.filter(item => item.reason === 'high_overlap')).toHaveLength(6);
    expect(result.mappedSupplementary).toHaveLength(0);
    expect(result.counts.protectedOverflow).toBe(2);
  });

  it('partitions ordinary mapped references and retains low-priority fallback references', () => {
    const ordinary = selectNoveltyReportReferences(Array.from({ length: 18 }, (_, index) => mapped(index)));
    expect(ordinary.main).toHaveLength(10);
    expect(ordinary.mappedSupplementary).toHaveLength(8);

    const lowOnly = selectNoveltyReportReferences(
      Array.from({ length: 8 }, (_, index) => mapped(index, { priority: 'Low', priorityScore: 0 })),
      { mainReferenceTarget: 1, minMainReferences: 3 }
    );
    expect(lowOnly.main).toHaveLength(3);
    expect(lowOnly.mappedSupplementary).toHaveLength(5);
  });

  it('shows only the top 20 explicitly gate-approved unmapped references', () => {
    const eligible = Array.from({ length: 25 }, (_, index) =>
      unmapped(index, index < 5 ? 'accept' : index < 15 ? 'component' : 'borderline', 0.9 - index * 0.01)
    );
    const result = selectNoveltyReportReferences([
      ...eligible,
      unmapped(30, 'reject', 0.99),
      unmapped(31, undefined, 0.99),
    ]);

    expect(result.unmappedSupplementary).toHaveLength(20);
    expect(result.unmappedSupplementary.slice(0, 5).every(item => item.gateDecision === 'accept')).toBe(true);
    expect(result.counts.unmappedEligibleTotal).toBe(25);
    expect(result.counts.unmappedOmitted).toBe(5);
    expect(result.counts.explicitlyRejectedExcluded).toBe(1);
    expect(result.counts.ungatedExcluded).toBe(1);
    expect(result.unmappedSupplementary.some(item => item.publicationNumber.includes('030'))).toBe(false);
    expect(result.unmappedSupplementary.some(item => item.publicationNumber.includes('031'))).toBe(false);
  });

  it('deduplicates publication variants and rejects stale persisted partitions', () => {
    const candidates = [
      mapped(1),
      mapped(2),
      { ...mapped(2), publicationNumber: 'US-2026-00002-A1', canonicalDecisive: true },
      unmapped(1, 'accept'),
    ];
    const result = selectNoveltyReportReferences(candidates);
    expect(result.counts.mappedTotal).toBe(2);
    expect(validateReportReferenceSelection(result, candidates)).toEqual({ valid: true });

    const stale = {
      ...result,
      mappedSupplementary: [],
      main: result.main.slice(0, 1),
      counts: { ...result.counts, mainDisplayed: 1, mappedSupplementaryDisplayed: 0, mappedTotal: 1 },
    };
    expect(validateReportReferenceSelection(stale, candidates)).toMatchObject({ valid: false });
  });
});
