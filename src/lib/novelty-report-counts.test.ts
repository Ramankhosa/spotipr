import { describe, expect, it } from 'vitest';
import { buildNoveltyReportCountSummary } from './novelty-report-counts';

function gateRecord(pn: string, decision: string, extra: Record<string, unknown> = {}) {
  return { pn, decision, rerankScore: 0.5, reviewStatus: 'reviewed', ...extra };
}

/**
 * `byPn` is written under several aliases per publication (raw, uppercase,
 * canonical), which is why the counter has to dedupe.
 */
function byPnFrom(records: Array<{ pn: string; decision: string }>) {
  const byPn: Record<string, any> = {};
  for (const record of records) {
    const full = gateRecord(record.pn, record.decision);
    byPn[record.pn] = full;
    byPn[record.pn.toUpperCase()] = full;
    byPn[record.pn.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/[A-Z]\d*$/, '')] = full;
  }
  return byPn;
}

function stage1With(records: Array<{ pn: string; decision: string }>, overrides: Record<string, unknown> = {}) {
  const accepted = records.filter(r => r.decision === 'accept').map(r => r.pn);
  const component = records.filter(r => r.decision === 'component').map(r => r.pn);
  const borderline = records.filter(r => r.decision === 'borderline').map(r => r.pn);
  return {
    retrievalCandidates: records.map(r => ({ publicationNumber: r.pn })),
    retrievedCount: records.length,
    aiRelevance: {
      byPn: byPnFrom(records),
      accepted,
      component,
      // The gate stores a UI-sized borderline list capped at stage15.borderlineQuota.
      borderline: borderline.slice(0, 5),
      reviewedCount: records.length,
      ...overrides,
    },
  };
}

describe('buildNoveltyReportCountSummary', () => {
  it('counts every borderline decision, not the list truncated to the UI quota', () => {
    const records = [
      ...Array.from({ length: 6 }, (_, i) => ({ pn: `US10000${i}A1`, decision: 'accept' })),
      ...Array.from({ length: 40 }, (_, i) => ({ pn: `US20000${i}A1`, decision: 'borderline' })),
      ...Array.from({ length: 10 }, (_, i) => ({ pn: `US30000${i}A1`, decision: 'reject' })),
    ];
    const stage1 = stage1With(records);
    expect(stage1.aiRelevance.borderline).toHaveLength(5);

    const counts = buildNoveltyReportCountSummary(stage1, { feature_map: [] });

    expect(counts.borderlineMatches).toBe(40);
    expect(counts.directMatches).toBe(6);
    // accept + component + borderline, none of them truncated
    expect(counts.candidateMatches).toBe(46);
    expect(counts.patentsFound).toBe(46);
  });

  it('falls back to the legacy lists when no gate record map is present', () => {
    const counts = buildNoveltyReportCountSummary({
      retrievalCandidates: [{ publicationNumber: 'US1A1' }, { publicationNumber: 'US2A1' }, { publicationNumber: 'US3A1' }],
      retrievedCount: 3,
      aiRelevance: {
        accepted: ['US1A1'],
        component: ['US2A1'],
        borderline: ['US3A1'],
        reviewedCount: 3,
      },
    }, { feature_map: [] });

    expect(counts.directMatches).toBe(1);
    expect(counts.componentMatches).toBe(1);
    expect(counts.borderlineMatches).toBe(1);
    expect(counts.candidateMatches).toBe(3);
  });

  it('dedupes alias keys and kind-code variants to one publication', () => {
    const shared = gateRecord('US-2026-00002-A1', 'accept');
    const counts = buildNoveltyReportCountSummary({
      retrievalCandidates: [{ publicationNumber: 'US-2026-00002-A1' }],
      retrievedCount: 1,
      aiRelevance: {
        byPn: {
          'us-2026-00002-a1': shared,
          'US-2026-00002-A1': shared,
          'US202600002': shared,
          // A different kind code for the same publication must not double-count.
          'US202600002B2': { ...shared, pn: 'US202600002B2' },
        },
        reviewedCount: 1,
      },
    }, { feature_map: [] });

    expect(counts.directMatches).toBe(1);
  });

  it('counts gate_error rows as borderline, matching the decision lists', () => {
    const errored = {
      pn: 'US900001A1',
      decision: 'borderline',
      reviewStatus: 'gate_error',
      gateError: 'timeout',
    };
    const counts = buildNoveltyReportCountSummary({
      retrievalCandidates: [{ publicationNumber: 'US900001A1' }],
      retrievedCount: 1,
      aiRelevance: { byPn: { US900001A1: errored }, reviewedCount: 1 },
    }, { feature_map: [] });

    expect(counts.borderlineMatches).toBe(1);
  });

  it('still bounds every count by the retrieved total', () => {
    const records = Array.from({ length: 30 }, (_, i) => ({ pn: `US80000${i}A1`, decision: 'accept' }));
    const counts = buildNoveltyReportCountSummary({
      // byPn holds more records than the current candidate pool
      retrievalCandidates: records.slice(0, 5).map(r => ({ publicationNumber: r.pn })),
      retrievedCount: 5,
      aiRelevance: { byPn: byPnFrom(records), reviewedCount: 5 },
    }, { feature_map: [] });

    expect(counts.patentsSearched).toBe(5);
    expect(counts.directMatches).toBeLessThanOrEqual(5);
    expect(counts.candidateMatches).toBeLessThanOrEqual(5);
  });

  it('reports detailed citations from the feature map, unchanged', () => {
    const counts = buildNoveltyReportCountSummary(
      stage1With([{ pn: 'US1A1', decision: 'accept' }]),
      { feature_map: [{ pn: 'US1A1' }, { pn: 'US2A1' }, { pn: 'US3A1' }] }
    );
    expect(counts.detailedCitations).toBe(3);
  });
});
