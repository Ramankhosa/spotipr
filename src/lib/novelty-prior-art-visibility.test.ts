import { describe, expect, test } from 'vitest';
import {
  buildVisiblePriorArtResults,
  classifyRerankDecision,
  classifyScreeningStopReason,
  matchCategoryFromDecision,
  normalizeRerankDecision,
} from './novelty-prior-art-visibility';

function candidate(pn: string) {
  return { publicationNumber: pn, title: `Patent ${pn}` };
}

describe('buildVisiblePriorArtResults', () => {
  test('keeps accept, component, and selected borderline decisions regardless of score threshold', () => {
    const result = buildVisiblePriorArtResults({
      candidates: [candidate('IN1'), candidate('IN2'), candidate('IN3'), candidate('IN4')],
      byPn: {
        IN1: { pn: 'IN1', decision: 'accept', score: 0.71, evidence_quality: 'medium' },
        IN2: { pn: 'IN2', decision: 'accept', score: 0.69, evidence_quality: 'high' },
        IN3: { pn: 'IN3', decision: 'borderline', score: 0.9, evidence_quality: 'high' },
        IN4: { pn: 'IN4', decision: 'component', score: 0.2, evidence_quality: 'low' },
      },
      minimumVisibleConfidence: 0.7,
      visibleLimit: 30,
    });

    expect(result.visiblePublicationNumbers).toEqual(['IN1', 'IN2', 'IN4', 'IN3']);
    expect(result.gatedCandidates).toHaveLength(4);
    expect(result.hiddenCandidateCount).toBe(0);
  });

  test('normalizes component decisions and keeps them as reviewable component matches', () => {
    expect(normalizeRerankDecision('feature-level')).toBe('component');
    expect(matchCategoryFromDecision('component')).toBe('component');

    const result = buildVisiblePriorArtResults({
      candidates: [candidate('IN1')],
      byPn: {
        IN1: { pn: 'IN1', decision: 'component', score: 0.9, evidence_quality: 'high' },
      },
      minimumVisibleConfidence: 0.7,
      visibleLimit: 30,
    });

    expect(result.visiblePublicationNumbers).toEqual(['IN1']);
    expect(result.gatedCandidates[0]).toMatchObject({
      rerankDecision: 'component',
      matchCategory: 'component',
    });
  });

  test('caps the visible list after keeping decision-routed candidates', () => {
    const candidates = Array.from({ length: 35 }, (_, index) => candidate(`IN${index + 1}`));
    const byPn = Object.fromEntries(candidates.map((item, index) => [
      item.publicationNumber,
      {
        pn: item.publicationNumber,
        decision: 'accept',
        score: index < 28 ? 0.8 : 0.5,
        evidence_quality: 'medium',
      },
    ]));

    const result = buildVisiblePriorArtResults({
      candidates,
      byPn,
      minimumVisibleConfidence: 0.7,
      visibleLimit: 30,
    });

    expect(result.visiblePriorArtResults).toHaveLength(30);
    expect(result.visiblePublicationNumbers.at(-1)).toBe('IN30');
    expect(result.highConfidenceCount).toBe(35);
  });

  test('uses the configured visible cap for high-confidence matches', () => {
    const candidates = Array.from({ length: 35 }, (_, index) => candidate(`IN${index + 1}`));
    const byPn = Object.fromEntries(candidates.map(item => [
      item.publicationNumber,
      { pn: item.publicationNumber, decision: 'accept', score: 0.8, evidence_quality: 'high' },
    ]));

    const result = buildVisiblePriorArtResults({
      candidates,
      byPn,
      minimumVisibleConfidence: 0.7,
      visibleLimit: 30,
    });

    expect(result.visiblePriorArtResults).toHaveLength(30);
    expect(result.highConfidenceCount).toBe(35);
  });

  test('sorts visible matches by decision bucket, then rerank score, before applying the visible cap', () => {
    const result = buildVisiblePriorArtResults({
      candidates: [candidate('IN1'), candidate('IN2'), candidate('IN3')],
      byPn: {
        IN1: { pn: 'IN1', decision: 'component', score: 0.95, evidence_quality: 'medium' },
        IN2: { pn: 'IN2', decision: 'accept', score: 0.4, evidence_quality: 'high' },
        IN3: { pn: 'IN3', decision: 'accept', score: 0.8, evidence_quality: 'medium' },
      },
      minimumVisibleConfidence: 0.7,
      visibleLimit: 2,
    });

    expect(result.visiblePublicationNumbers).toEqual(['IN3', 'IN2']);
  });

  test('keeps accepted rows even when evidence quality is missing', () => {
    const result = buildVisiblePriorArtResults({
      candidates: [candidate('IN1')],
      byPn: {
        IN1: { pn: 'IN1', decision: 'accept', score: 0.95 },
      },
      minimumVisibleConfidence: 0.7,
      visibleLimit: 30,
    });

    expect(result.visiblePublicationNumbers).toEqual(['IN1']);
    expect(result.gatedCandidates).toHaveLength(1);
  });

  test('keeps review-error decisions as borderline instead of rejecting them', () => {
    expect(normalizeRerankDecision('review_error')).toBe('borderline');

    const result = buildVisiblePriorArtResults({
      candidates: [candidate('IN1'), candidate('IN2')],
      byPn: {
        IN1: { pn: 'IN1', decision: 'review_error', score: 0.2, evidence_quality: 'low' },
        IN2: { pn: 'IN2', decision: 'reject', score: 0.99, evidence_quality: 'high' },
      },
      minimumVisibleConfidence: 0.7,
      visibleLimit: 30,
    });

    expect(result.visiblePublicationNumbers).toEqual(['IN1']);
    expect(result.gatedCandidates).toHaveLength(2);
  });
});

describe('classifyRerankDecision', () => {
  test('maps every documented literal and its synonyms', () => {
    expect(classifyRerankDecision('accept')).toEqual({ decision: 'accept', recognized: true });
    expect(classifyRerankDecision('ACCEPTED ')).toEqual({ decision: 'accept', recognized: true });
    expect(classifyRerankDecision('feature-level')).toEqual({ decision: 'component', recognized: true });
    expect(classifyRerankDecision('borderline')).toEqual({ decision: 'borderline', recognized: true });
    expect(classifyRerankDecision('reject')).toEqual({ decision: 'reject', recognized: true });
    expect(classifyRerankDecision('rejected')).toEqual({ decision: 'reject', recognized: true });
  });

  test('rejection must be stated, not inferred from an unmatched value', () => {
    // The regression this guards: `reject` used to be the fallback, so any literal
    // the gate drifted to — a renamed label, a stray period — silently erased the
    // candidate from deep analysis, the visible list and both appendices.
    for (const drifted of ['partial', 'accept.', 'relevant', 'component-level', 'keep', '¯\_(ツ)_/¯']) {
      expect(classifyRerankDecision(drifted)).toEqual({ decision: 'borderline', recognized: false });
    }
  });

  test('keeps an unrecognized decision visible for review', () => {
    const result = buildVisiblePriorArtResults({
      candidates: [candidate('IN1'), candidate('IN2')],
      byPn: {
        IN1: { pn: 'IN1', decision: 'partial', score: 0.5, evidence_quality: 'medium' },
        IN2: { pn: 'IN2', decision: 'reject', score: 0.99, evidence_quality: 'high' },
      },
      visibleLimit: 30,
    });

    expect(result.visiblePublicationNumbers).toEqual(['IN1']);
  });

  test('an absent or empty decision degrades to borderline, never to reject', () => {
    expect(normalizeRerankDecision('')).toBe('borderline');
    expect(normalizeRerankDecision(undefined)).toBe('borderline');
    expect(normalizeRerankDecision(null)).toBe('borderline');
  });
});

describe('classifyScreeningStopReason', () => {
  test('separates a broken search from an exhausted one', () => {
    expect(classifyScreeningStopReason('gate_errors')).toBe('error');
    expect(classifyScreeningStopReason('empty_wave')).toBe('error');
    expect(classifyScreeningStopReason('candidate_ceiling')).toBe('bounded');
    expect(classifyScreeningStopReason('wall_clock')).toBe('bounded');
    expect(classifyScreeningStopReason('token_budget')).toBe('bounded');
    expect(classifyScreeningStopReason('pool_exhausted')).toBe('exhausted');
    expect(classifyScreeningStopReason('yield_below_threshold')).toBe('exhausted');
    expect(classifyScreeningStopReason(undefined)).toBe('exhausted');
  });
});
