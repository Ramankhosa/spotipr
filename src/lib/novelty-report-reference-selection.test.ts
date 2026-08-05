import { describe, expect, it } from 'vitest';
import {
  selectNoveltyReportReferences,
  validateReportReferenceSelection,
  type ReportReferenceCandidate,
} from './novelty-report-reference-selection';

function pn(index: number) {
  return `US202600${String(index).padStart(3, '0')}A1`;
}

function mapped(index: number, overrides: Partial<ReportReferenceCandidate> = {}): ReportReferenceCandidate {
  return {
    publicationNumber: pn(index),
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

  it('defaults to the legacy rule and stamps it on the selection', () => {
    const implicit = selectNoveltyReportReferences(Array.from({ length: 18 }, (_, index) => mapped(index)));
    const explicit = selectNoveltyReportReferences(
      Array.from({ length: 18 }, (_, index) => mapped(index)),
      { rule: 'fixed_target_v1' }
    );

    expect(implicit.rule).toBe('fixed_target_v1');
    expect(implicit).toEqual(explicit);
  });

  it('treats an unknown or absent rule as the legacy rule', () => {
    const candidates = Array.from({ length: 18 }, (_, index) => mapped(index));
    const legacy = selectNoveltyReportReferences(candidates, { rule: 'fixed_target_v1' });

    expect(selectNoveltyReportReferences(candidates, { rule: undefined })).toEqual(legacy);
    expect(selectNoveltyReportReferences(candidates, { rule: 'nonsense' as any })).toEqual(legacy);
  });

  it('validates a persisted selection that predates the rule field', () => {
    const candidates = [mapped(1), mapped(2), unmapped(1, 'accept')];
    const current = selectNoveltyReportReferences(candidates);
    const { rule, ...preRuleBlob } = current;

    expect(rule).toBe('fixed_target_v1');
    expect('rule' in preRuleBlob).toBe(false);
    // Historical blobs must keep validating, or every completed report silently
    // recomputes on its next render.
    expect(validateReportReferenceSelection(preRuleBlob, candidates)).toEqual({ valid: true });
  });

  it('clamps caller-supplied option values to their ceilings', () => {
    const candidates = Array.from({ length: 40 }, (_, index) => mapped(index));
    const result = selectNoveltyReportReferences(candidates, { mainReferenceTarget: 10_000 });
    expect(result.main).toHaveLength(20);

    const unmappedCandidates = Array.from({ length: 80 }, (_, index) => unmapped(index, 'accept', 0.9));
    const unmappedResult = selectNoveltyReportReferences(unmappedCandidates, {
      maxUnmappedSupplementaryReferences: 10_000,
    });
    expect(unmappedResult.unmappedSupplementary).toHaveLength(50);
  });

  describe('materiality_v1', () => {
    const materiality = { rule: 'materiality_v1' as const };

    function material(index: number, overrides: Partial<ReportReferenceCandidate> = {}): ReportReferenceCandidate {
      return mapped(index, {
        desiredPriority: 'High',
        mappedImportantFeatures: ['f1', 'f2'],
        hasMappedEvidence: true,
        ...overrides,
      });
    }

    function immaterial(index: number, overrides: Partial<ReportReferenceCandidate> = {}): ReportReferenceCandidate {
      return mapped(index, {
        priority: 'Low',
        desiredPriority: 'Low',
        mappedImportantFeatures: [],
        hasMappedEvidence: true,
        ...overrides,
      });
    }

    it('shows nothing when nothing was mapped', () => {
      const result = selectNoveltyReportReferences([unmapped(1, 'accept')], materiality);
      expect(result.main).toHaveLength(0);
      expect(result.mappedSupplementary).toHaveLength(0);
      expect(result.counts.mappedTotal).toBe(0);
    });

    it('shows every reference when fewer exist than the floor', () => {
      const two = selectNoveltyReportReferences([material(0), material(1)], materiality);
      expect(two.main).toHaveLength(2);
      expect(two.mappedSupplementary).toHaveLength(0);
    });

    it('varies the count with the evidence instead of pinning it to a target', () => {
      const dense = selectNoveltyReportReferences(
        Array.from({ length: 18 }, (_, index) => material(index)),
        materiality
      );
      const sparse = selectNoveltyReportReferences(
        [...Array.from({ length: 4 }, (_, index) => material(index)),
          ...Array.from({ length: 14 }, (_, index) => immaterial(index + 4))],
        materiality
      );

      expect(dense.main).toHaveLength(18);
      expect(sparse.main).toHaveLength(4);
      expect(sparse.mappedSupplementary).toHaveLength(14);
    });

    it('caps at the ceiling and counts the overflow', () => {
      const result = selectNoveltyReportReferences(
        Array.from({ length: 30 }, (_, index) => material(index)),
        materiality
      );
      expect(result.main).toHaveLength(20);
      expect(result.mappedSupplementary).toHaveLength(10);
      expect(result.counts.materialityOverflow).toBe(10);
    });

    it('falls back to the floor when nothing clears the bar, in ranked order', () => {
      const result = selectNoveltyReportReferences(
        Array.from({ length: 8 }, (_, index) => immaterial(index)),
        materiality
      );
      expect(result.main).toHaveLength(3);
      // priorityScore descends with index, so the floor takes the top three.
      expect(result.main.map(item => item.publicationNumber)).toEqual([0, 1, 2].map(pn));
    });

    it('prefers references carrying evidence when filling the floor', () => {
      const result = selectNoveltyReportReferences([
        immaterial(0, { hasMappedEvidence: false, priorityScore: 100 }),
        immaterial(1, { hasMappedEvidence: false, priorityScore: 99 }),
        immaterial(2, { hasMappedEvidence: true, priorityScore: 10 }),
        immaterial(3, { hasMappedEvidence: true, priorityScore: 9 }),
        immaterial(4, { hasMappedEvidence: true, priorityScore: 8 }),
      ], materiality);

      expect(result.main).toHaveLength(3);
      expect(result.main.map(item => item.publicationNumber)).toEqual([2, 3, 4].map(pn));
    });

    it('never lets an all-Unknown degraded map clear the bar on its own', () => {
      const degraded = Array.from({ length: 6 }, (_, index) => immaterial(index, {
        hasMappedEvidence: false,
        featureCoverage: 0,
        mappedImportantFeatures: [],
      }));
      const result = selectNoveltyReportReferences(degraded, materiality);
      // Only the floor admits them.
      expect(result.main).toHaveLength(3);
      expect(result.main.every(item => item.reason === 'ranked_fill')).toBe(true);
    });

    it('keeps every decisive reference even past the ceiling', () => {
      const result = selectNoveltyReportReferences(
        Array.from({ length: 24 }, (_, index) => material(index, { canonicalDecisive: index < 22 })),
        materiality
      );
      expect(result.main.filter(item => item.reason === 'decisive')).toHaveLength(22);
      expect(result.main.length).toBeGreaterThanOrEqual(22);
    });

    it('makes high-overlap references compete for slots under the ceiling', () => {
      const result = selectNoveltyReportReferences(
        Array.from({ length: 30 }, (_, index) => material(index, { noveltyThreat: 'high_overlap' })),
        materiality
      );
      expect(result.main).toHaveLength(20);
      expect(result.mappedSupplementary).toHaveLength(10);
    });

    it('admits a reference that uniquely covers an otherwise-uncovered feature', () => {
      const candidates = [
        ...Array.from({ length: 5 }, (_, index) => material(index, { mappedImportantFeatures: ['shared'] })),
        immaterial(9, { mappedImportantFeatures: ['orphan'], priorityScore: 1 }),
      ];
      const result = selectNoveltyReportReferences(candidates, materiality);
      const orphan = result.main.find(item => item.publicationNumber === pn(9));
      expect(orphan).toBeDefined();
      expect(orphan?.reason).toBe('coverage_diversity');
      expect(result.counts.diversityAdmitted).toBe(1);
    });

    it('displaces ordinary fill rather than a decisive reference when at the ceiling', () => {
      const candidates = [
        ...Array.from({ length: 20 }, (_, index) => material(index, {
          canonicalDecisive: index < 19,
          mappedImportantFeatures: ['shared'],
        })),
        immaterial(25, { mappedImportantFeatures: ['orphan'], priorityScore: 1 }),
      ];
      const result = selectNoveltyReportReferences(candidates, materiality);

      expect(result.main.filter(item => item.reason === 'decisive')).toHaveLength(19);
      expect(result.main.some(item => item.reason === 'coverage_diversity')).toBe(true);
    });

    it('reads the uncapped tier, not the display-capped priority', () => {
      // `priority` is capped at 4 Critical / 8 High by applySelectivePriorities;
      // reading it would silently re-impose a bound of 12.
      const candidates = Array.from({ length: 18 }, (_, index) => material(index, {
        priority: index < 12 ? 'High' : 'Low',
        desiredPriority: 'High',
      }));
      expect(selectNoveltyReportReferences(candidates, materiality).main).toHaveLength(18);
    });

    it('falls back to priority when no uncapped tier is supplied', () => {
      const candidates = Array.from({ length: 6 }, (_, index) => mapped(index, {
        priority: index < 2 ? 'High' : 'Low',
        hasMappedEvidence: true,
      }));
      const result = selectNoveltyReportReferences(candidates, materiality);
      // 2 clear the bar, floor lifts it to 3.
      expect(result.main).toHaveLength(3);
    });

    it('keeps main in ranked order for downstream top-N consumers', () => {
      const result = selectNoveltyReportReferences(
        Array.from({ length: 6 }, (_, index) => material(index, { canonicalDecisive: index === 5 })),
        materiality
      );
      const scores = result.main.map(item =>
        Number(item.publicationNumber.replace(/\D/g, ''))
      );
      expect(scores).toEqual([...scores].sort((a, b) => a - b));
    });

    it('shows one member per family and sends siblings to the appendix', () => {
      const result = selectNoveltyReportReferences([
        material(0, { familyKey: 'FAM-1' }),
        material(1, { familyKey: 'FAM-1' }),
        material(2, { familyKey: 'FAM-1' }),
        material(3, { familyKey: 'FAM-2' }),
        material(4, { familyKey: 'FAM-2' }),
        material(5),
      ], materiality);

      expect(result.main.map(item => item.publicationNumber)).toEqual([pn(0), pn(3), pn(5)]);
      expect(result.counts.familyDemoted).toBe(3);
      // The partition is untouched: siblings are still counted and still shown.
      expect(result.counts.mappedTotal).toBe(6);
      expect(result.mappedSupplementary).toHaveLength(3);
    });

    it('never demotes a decisive reference for sharing a family', () => {
      const result = selectNoveltyReportReferences([
        material(0, { familyKey: 'FAM-1', canonicalDecisive: true }),
        material(1, { familyKey: 'FAM-1', canonicalDecisive: true }),
        material(2, { familyKey: 'FAM-1' }),
        material(3),
      ], materiality);

      expect(result.main.filter(item => item.reason === 'decisive')).toHaveLength(2);
      expect(result.main.map(item => item.publicationNumber)).toContain(pn(0));
      expect(result.main.map(item => item.publicationNumber)).toContain(pn(1));
      expect(result.main.map(item => item.publicationNumber)).not.toContain(pn(2));
    });

    it('re-admits a family sibling only when nothing else is left for the floor', () => {
      const result = selectNoveltyReportReferences([
        material(0, { familyKey: 'FAM-1' }),
        material(1, { familyKey: 'FAM-1' }),
        material(2, { familyKey: 'FAM-1' }),
      ], materiality);

      // Only one distinct family exists, so the floor has to fall back to siblings.
      expect(result.main).toHaveLength(3);
    });

    it('asserts no family relationship when the key is absent or self-referential', () => {
      const withoutKeys = selectNoveltyReportReferences(
        Array.from({ length: 4 }, (_, index) => material(index)),
        materiality
      );
      // A key equal to the reference's own number carries no grouping information.
      const selfKeys = selectNoveltyReportReferences(
        Array.from({ length: 4 }, (_, index) => material(index, { familyKey: pn(index) })),
        materiality
      );

      expect(withoutKeys.main).toHaveLength(4);
      expect(selfKeys.main).toHaveLength(4);
      expect(selfKeys.counts.familyDemoted).toBe(0);
    });

    it('leaves the persisted-selection validator unaffected by family demotion', () => {
      const candidates = [
        material(0, { familyKey: 'FAM-1' }),
        material(1, { familyKey: 'FAM-1' }),
        material(2),
        unmapped(1, 'accept'),
      ];
      const result = selectNoveltyReportReferences(candidates, materiality);
      expect(validateReportReferenceSelection(result, candidates)).toEqual({ valid: true });

      // A blob written before families existed must still validate.
      const preFamily = {
        ...result,
        main: result.main.map(({ familyKey, ...rest }) => rest),
        mappedSupplementary: result.mappedSupplementary.map(({ familyKey, ...rest }) => rest),
      };
      expect(validateReportReferenceSelection(preFamily, candidates)).toEqual({ valid: true });
    });

    it('does not apply family demotion under the legacy rule', () => {
      const candidates = Array.from({ length: 12 }, (_, index) => material(index, { familyKey: 'FAM-1' }));
      const legacy = selectNoveltyReportReferences(candidates, { rule: 'fixed_target_v1' });
      expect(legacy.main).toHaveLength(10);
      expect(legacy.counts.familyDemoted).toBeUndefined();
    });

    it('still partitions every mapped reference so the validator passes', () => {
      const candidates = [
        ...Array.from({ length: 25 }, (_, index) => material(index)),
        unmapped(1, 'accept'),
      ];
      const result = selectNoveltyReportReferences(candidates, materiality);
      expect(result.counts.mappedTotal).toBe(25);
      expect(result.main.length + result.mappedSupplementary.length).toBe(25);
      expect(validateReportReferenceSelection(result, candidates)).toEqual({ valid: true });
    });
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
