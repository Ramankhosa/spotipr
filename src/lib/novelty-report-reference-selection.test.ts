import { describe, expect, it } from 'vitest';
import {
  selectNoveltyReportReferences,
  validateReportReferenceSelection,
  DEFAULT_MIN_MAIN_REFERENCES,
  LEGACY_MIN_MAIN_REFERENCES,
  MAIN_REFERENCE_CEILING,
  type ReportReferenceCandidate,
  type ReportReferenceCoverageContext,
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
    expect(result.main).toHaveLength(MAIN_REFERENCE_CEILING);

    const unmappedCandidates = Array.from({ length: 80 }, (_, index) => unmapped(index, 'accept', 0.9));
    const unmappedResult = selectNoveltyReportReferences(unmappedCandidates, {
      maxUnmappedSupplementaryReferences: 10_000,
    });
    expect(unmappedResult.unmappedSupplementary).toHaveLength(50);
  });

  describe('materiality_v1', () => {
    const materiality = { rule: 'materiality_v1' as const };
    // Several cases below check which references the bar admits and which the
    // family and diversity rules move, on fixtures of four to eight candidates.
    // DEFAULT_MIN_MAIN_REFERENCES would top every one of those up to ten and hide
    // the behaviour under test, so they pin the floor low. The production floor is
    // asserted on its own below.
    const smallFloor = { ...materiality, minMainReferences: 3 };

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

    it('reproduces the historical ten-reference width under the legacy floor pin', () => {
      // Recomputes of stale materiality_v1 blobs pass LEGACY_MIN_MAIN_REFERENCES
      // explicitly so already-delivered reports keep their width now that the
      // default backstop is 3 (coverage_v2 sizes new reports from the band).
      const candidates = Array.from({ length: 18 }, (_, index) => immaterial(index));
      const pinned = selectNoveltyReportReferences(candidates, {
        ...materiality,
        minMainReferences: LEGACY_MIN_MAIN_REFERENCES,
      });

      expect(DEFAULT_MIN_MAIN_REFERENCES).toBe(3);
      expect(LEGACY_MIN_MAIN_REFERENCES).toBe(10);
      expect(pinned.main).toHaveLength(10);
      expect(pinned.mappedSupplementary).toHaveLength(8);
      // A raised floor must not start admitting references the bar rejected.
      expect(pinned.main.every(item => item.reason === 'ranked_fill')).toBe(true);

      // Without the pin, the backstop alone applies.
      const unpinned = selectNoveltyReportReferences(candidates, materiality);
      expect(unpinned.main).toHaveLength(3);
    });

    it('lets the bar promote above the floor, up to the ceiling', () => {
      const admitted = (materialCount: number) => selectNoveltyReportReferences(
        [...Array.from({ length: materialCount }, (_, index) => material(index)),
          ...Array.from({ length: 20 }, (_, index) => immaterial(index + materialCount))],
        { ...materiality, minMainReferences: LEGACY_MIN_MAIN_REFERENCES }
      ).main.length;

      // Below the floor the floor wins; above it the evidence does.
      expect(admitted(4)).toBe(10);
      expect(admitted(15)).toBe(15);
      expect(admitted(30)).toBe(MAIN_REFERENCE_CEILING);
    });

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
        smallFloor
      );
      const sparse = selectNoveltyReportReferences(
        [...Array.from({ length: 4 }, (_, index) => material(index)),
          ...Array.from({ length: 14 }, (_, index) => immaterial(index + 4))],
        smallFloor
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
      expect(result.main).toHaveLength(MAIN_REFERENCE_CEILING);
      expect(result.mappedSupplementary).toHaveLength(30 - MAIN_REFERENCE_CEILING);
      expect(result.counts.materialityOverflow).toBe(30 - MAIN_REFERENCE_CEILING);
    });

    it('falls back to the floor when nothing clears the bar, in ranked order', () => {
      const result = selectNoveltyReportReferences(
        Array.from({ length: 8 }, (_, index) => immaterial(index)),
        smallFloor
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
      ], smallFloor);

      expect(result.main).toHaveLength(3);
      expect(result.main.map(item => item.publicationNumber)).toEqual([2, 3, 4].map(pn));
    });

    it('never lets an all-Unknown degraded map clear the bar on its own', () => {
      const degraded = Array.from({ length: 6 }, (_, index) => immaterial(index, {
        hasMappedEvidence: false,
        featureCoverage: 0,
        mappedImportantFeatures: [],
      }));
      const result = selectNoveltyReportReferences(degraded, smallFloor);
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
      expect(result.main).toHaveLength(MAIN_REFERENCE_CEILING);
      expect(result.mappedSupplementary).toHaveLength(30 - MAIN_REFERENCE_CEILING);
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
      const result = selectNoveltyReportReferences(candidates, smallFloor);
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
      ], smallFloor);

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
      ], smallFloor);

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
      ], smallFloor);

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

  describe('coverage_v2', () => {
    const simpleBand = { complexity: 'simple' as const, floor: 3, ceiling: 8 };
    const complexBand = { complexity: 'complex' as const, floor: 7, ceiling: 20 };

    function context(overrides: Partial<ReportReferenceCoverageContext> = {}): ReportReferenceCoverageContext {
      return { band: simpleBand, importantFeatures: [], ...overrides };
    }

    function options(ctx: ReportReferenceCoverageContext) {
      return { rule: 'coverage_v2' as const, coverageContext: ctx };
    }

    /** A mapped reference that clears no bar on its own: closure and the floor decide. */
    function quiet(index: number, covered: string[], overrides: Partial<ReportReferenceCandidate> = {}): ReportReferenceCandidate {
      return mapped(index, {
        priority: 'Low',
        desiredPriority: 'Low',
        priorityScore: 0,
        mappedImportantFeatures: [],
        coveredImportantFeatures: covered,
        hasMappedEvidence: true,
        ...overrides,
      });
    }

    function strong(index: number, overrides: Partial<ReportReferenceCandidate> = {}): ReportReferenceCandidate {
      return mapped(index, {
        desiredPriority: 'High',
        coveredImportantFeatures: ['f1'],
        hasMappedEvidence: true,
        ...overrides,
      });
    }

    it('sizes the report from the k-cover closure, not a fixed count', () => {
      const features = [
        { feature: 'f1', type: 'novelty_candidate' as const },
        { feature: 'f2', type: 'novelty_candidate' as const },
        { feature: 'f3', type: 'novelty_candidate' as const },
      ];
      // Low redundancy: each reference evidences exactly one feature → k=3 per
      // feature demands nine distinct references.
      const sparse = selectNoveltyReportReferences(
        Array.from({ length: 12 }, (_, index) => quiet(index, [`f${(index % 3) + 1}`])),
        options(context({ band: complexBand, importantFeatures: features }))
      );
      expect(sparse.main).toHaveLength(9);
      expect(sparse.coverage?.stats.coverageAdmitted).toBe(9);

      // High redundancy: every reference evidences every feature → three close it.
      const dense = selectNoveltyReportReferences(
        Array.from({ length: 12 }, (_, index) => quiet(index, ['f1', 'f2', 'f3'])),
        options(context({ band: complexBand, importantFeatures: features }))
      );
      expect(dense.main.length).toBeLessThan(sparse.main.length);
      expect(dense.coverage?.stats.featuresCovered).toBe(3);
    });

    it('clamps closure admissions to the band ceiling', () => {
      const features = Array.from({ length: 10 }, (_, index) => ({
        feature: `f${index}`,
        type: 'novelty_candidate' as const,
      }));
      const result = selectNoveltyReportReferences(
        Array.from({ length: 40 }, (_, index) => quiet(index, [`f${index % 10}`])),
        options(context({ importantFeatures: features }))
      );
      expect(result.main).toHaveLength(simpleBand.ceiling);
    });

    it('keeps decisive references even past the band ceiling', () => {
      const result = selectNoveltyReportReferences(
        Array.from({ length: 12 }, (_, index) => strong(index, { canonicalDecisive: index < 10 })),
        options(context())
      );
      expect(result.main.filter(item => item.reason === 'decisive')).toHaveLength(10);
      expect(result.main.length).toBeGreaterThanOrEqual(10);
    });

    it('admits via the relative bar, graded against the run’s own top score', () => {
      const result = selectNoveltyReportReferences([
        quiet(0, [], { priorityScore: 100 }),
        quiet(1, [], { priorityScore: 70 }),
        quiet(2, [], { priorityScore: 50 }),
        quiet(3, [], { priorityScore: 40 }),
        quiet(4, [], { priorityScore: 30 }),
      ], options(context()));
      // 100 and 70 clear 0.6 × 100; the floor lifts the total to three.
      expect(result.coverage?.stats.barCleared).toBe(2);
      expect(result.main).toHaveLength(3);
    });

    it('disables the relative bar when every score is zero', () => {
      const result = selectNoveltyReportReferences(
        Array.from({ length: 6 }, (_, index) => quiet(index, [])),
        options(context())
      );
      expect(result.coverage?.stats.barCleared).toBe(0);
      // The floor is all that admits.
      expect(result.main).toHaveLength(3);
      expect(result.coverage?.stats.floorFilled).toBe(3);
    });

    it('is monotone: more mapped evidence never narrows the report', () => {
      const features = [
        { feature: 'f1', type: 'core_technical' as const },
        { feature: 'f2', type: 'core_technical' as const },
      ];
      const base = Array.from({ length: 6 }, (_, index) => quiet(index, index < 3 ? ['f1'] : []));
      const before = selectNoveltyReportReferences(base, options(context({ importantFeatures: features })));
      const after = selectNoveltyReportReferences(
        base.map((candidate, index) => index >= 3 ? { ...candidate, coveredImportantFeatures: ['f2'] } : candidate),
        options(context({ importantFeatures: features }))
      );
      expect(after.main.length).toBeGreaterThanOrEqual(before.main.length);
      expect(after.coverage!.stats.featuresCovered).toBeGreaterThanOrEqual(before.coverage!.stats.featuresCovered);
    });

    it('shows one member per family and lets closure look past siblings', () => {
      const features = [{ feature: 'f1', type: 'novelty_candidate' as const }];
      const result = selectNoveltyReportReferences([
        quiet(0, ['f1'], { familyKey: 'FAM-1' }),
        quiet(1, ['f1'], { familyKey: 'FAM-1' }),
        quiet(2, ['f1'], { familyKey: 'FAM-1' }),
        quiet(3, ['f1'], { familyKey: 'FAM-2' }),
        quiet(4, ['f1'] ),
      ], options(context({ importantFeatures: features })));
      // k=3 wants three supporters, but only three distinct families exist.
      expect(result.main.map(item => item.publicationNumber)).toEqual([pn(0), pn(3), pn(4)]);
      expect(result.counts.familyDemoted).toBe(2);
    });

    it('falls back to a simple band when no context is supplied', () => {
      const result = selectNoveltyReportReferences(
        Array.from({ length: 18 }, (_, index) => quiet(index, [])),
        { rule: 'coverage_v2' }
      );
      expect(result.main).toHaveLength(3);
      expect(result.coverage?.band).toEqual(simpleBand);
    });

    it('persists the coverage context and validates it on the round-trip', () => {
      const features = [{ feature: 'f1', type: 'core_technical' as const }];
      const candidates = Array.from({ length: 6 }, (_, index) => quiet(index, ['f1']));
      const result = selectNoveltyReportReferences(candidates, options(context({ importantFeatures: features })));

      expect(result.coverage?.band).toEqual(simpleBand);
      expect(result.coverage?.importantFeatures).toEqual(features);
      expect(validateReportReferenceSelection(result, candidates)).toEqual({ valid: true });

      // A coverage_v2 blob without its context cannot be reproduced — reject it.
      const { coverage, ...stripped } = result;
      expect(validateReportReferenceSelection(stripped, candidates)).toEqual({
        valid: false,
        reason: 'coverage_context_missing_or_malformed',
      });
      const corrupt = { ...result, coverage: { ...coverage!, band: { ...simpleBand, ceiling: 999 } } };
      expect(validateReportReferenceSelection(corrupt, candidates)).toMatchObject({ valid: false });
    });

    it('recomputes identically from the persisted context', () => {
      const features = [
        { feature: 'f1', type: 'novelty_candidate' as const },
        { feature: 'f2', type: 'implementation' as const },
      ];
      const candidates = Array.from({ length: 10 }, (_, index) => quiet(index, [`f${(index % 2) + 1}`]));
      const first = selectNoveltyReportReferences(candidates, options(context({ band: complexBand, importantFeatures: features })));
      const second = selectNoveltyReportReferences(candidates, options({
        band: first.coverage!.band,
        importantFeatures: first.coverage!.importantFeatures,
        kByType: first.coverage!.kByType,
      }));
      expect(second.main).toEqual(first.main);
      expect(second.coverage).toEqual(first.coverage);
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
