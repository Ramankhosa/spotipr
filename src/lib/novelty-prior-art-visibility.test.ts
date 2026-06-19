import { describe, expect, test } from 'vitest';
import { buildVisiblePriorArtResults } from './novelty-prior-art-visibility';

function candidate(pn: string) {
  return { publicationNumber: pn, title: `Patent ${pn}` };
}

describe('buildVisiblePriorArtResults', () => {
  test('shows only accepted candidates at or above the visible confidence threshold', () => {
    const result = buildVisiblePriorArtResults({
      candidates: [candidate('IN1'), candidate('IN2'), candidate('IN3'), candidate('IN4')],
      byPn: {
        IN1: { pn: 'IN1', decision: 'accept', score: 0.71, evidence_quality: 'medium' },
        IN2: { pn: 'IN2', decision: 'accept', score: 0.69, evidence_quality: 'high' },
        IN3: { pn: 'IN3', decision: 'borderline', score: 0.9, evidence_quality: 'high' },
        IN4: { pn: 'IN4', decision: 'accept', score: 0.95, evidence_quality: 'low' },
      },
      minimumVisibleConfidence: 0.7,
      visibleLimit: 30,
    });

    expect(result.visiblePublicationNumbers).toEqual(['IN1']);
    expect(result.gatedCandidates).toHaveLength(4);
    expect(result.hiddenCandidateCount).toBe(3);
  });

  test('caps the visible list without backfilling weak candidates', () => {
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

    expect(result.visiblePriorArtResults).toHaveLength(28);
    expect(result.visiblePublicationNumbers.at(-1)).toBe('IN28');
    expect(result.highConfidenceCount).toBe(28);
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

  test('sorts visible matches by rerank score before applying the visible cap', () => {
    const result = buildVisiblePriorArtResults({
      candidates: [candidate('IN1'), candidate('IN2'), candidate('IN3')],
      byPn: {
        IN1: { pn: 'IN1', decision: 'accept', score: 0.71, evidence_quality: 'medium' },
        IN2: { pn: 'IN2', decision: 'accept', score: 0.95, evidence_quality: 'high' },
        IN3: { pn: 'IN3', decision: 'accept', score: 0.8, evidence_quality: 'medium' },
      },
      minimumVisibleConfidence: 0.7,
      visibleLimit: 2,
    });

    expect(result.visiblePublicationNumbers).toEqual(['IN2', 'IN3']);
  });

  test('keeps missing evidence quality hidden even with an accepted high score', () => {
    const result = buildVisiblePriorArtResults({
      candidates: [candidate('IN1')],
      byPn: {
        IN1: { pn: 'IN1', decision: 'accept', score: 0.95 },
      },
      minimumVisibleConfidence: 0.7,
      visibleLimit: 30,
    });

    expect(result.visiblePriorArtResults).toHaveLength(0);
    expect(result.gatedCandidates).toHaveLength(1);
  });
});
