export const DEFAULT_VISIBLE_PRIOR_ART_LIMIT = 30;
export const DEFAULT_MINIMUM_VISIBLE_CONFIDENCE = 0.7;

export type RerankDecision = 'accept' | 'borderline' | 'reject';

export interface PriorArtGateRecord {
  pn?: string;
  score?: number;
  rerankScore?: number;
  decision?: string;
  rerankDecision?: string;
  matched_features?: string[];
  missing_features?: string[];
  reason?: string;
  evidence_quality?: string;
  reviewStatus?: 'reviewed' | 'gate_error';
  gateError?: 'timeout' | 'parse_error' | 'llm_error' | 'missing_candidate_row';
}

export interface VisiblePriorArtBuildResult<T = any> {
  gatedCandidates: T[];
  visiblePriorArtResults: T[];
  visiblePublicationNumbers: string[];
  highConfidenceCount: number;
  hiddenCandidateCount: number;
}

export function getPriorArtPublicationNumber(candidate: any): string {
  return String(
    candidate?.publicationNumber ||
    candidate?.publication_number ||
    candidate?.pn ||
    candidate?.id ||
    ''
  ).trim();
}

export function canonicalPriorArtNumber(value: unknown): string {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/[A-Z]\d*$/, '');
}

export function normalizeRerankDecision(value: unknown): RerankDecision {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'accept' || normalized === 'accepted') return 'accept';
  if (normalized === 'borderline') return 'borderline';
  return 'reject';
}

function finiteScore(...values: unknown[]): number {
  for (const value of values) {
    const numeric = typeof value === 'number'
      ? value
      : (typeof value === 'string' && value.trim() ? Number(value) : NaN);
    if (Number.isFinite(numeric)) return Math.max(0, Math.min(1, numeric));
  }
  return 0;
}

export function getGateRecordForCandidate(
  candidate: any,
  byPn: Record<string, PriorArtGateRecord | undefined>
): PriorArtGateRecord | undefined {
  const pn = getPriorArtPublicationNumber(candidate);
  if (!pn) return undefined;
  return byPn[pn] || byPn[pn.toUpperCase()] || byPn[canonicalPriorArtNumber(pn)];
}

export function annotatePriorArtCandidate<T = any>(candidate: T, gate: PriorArtGateRecord): T {
  const rerankScore = finiteScore(gate.rerankScore, gate.score);
  const rerankDecision = normalizeRerankDecision(gate.rerankDecision || gate.decision);
  const evidenceQuality = String(gate.evidence_quality || 'low').toLowerCase();

  return {
    ...(candidate as any),
    rerankScore,
    rerankDecision,
    matched_features: Array.isArray(gate.matched_features) ? gate.matched_features : [],
    missing_features: Array.isArray(gate.missing_features) ? gate.missing_features : [],
    evidence_quality: evidenceQuality,
    reviewStatus: gate.reviewStatus || 'reviewed',
    gateError: gate.gateError,
    rerankReason: typeof gate.reason === 'string' ? gate.reason : '',
    relevanceScore: rerankScore,
    scores: {
      ...((candidate as any)?.scores || {}),
      rerank: rerankScore,
      aiRelevance: rerankScore,
    },
  } as T;
}

export function isVisiblePriorArtGate(
  gate: PriorArtGateRecord | undefined,
  minimumVisibleConfidence = DEFAULT_MINIMUM_VISIBLE_CONFIDENCE
): boolean {
  if (!gate) return false;
  const score = finiteScore(gate.rerankScore, gate.score);
  const decision = normalizeRerankDecision(gate.rerankDecision || gate.decision);
  const evidenceQuality = String(gate.evidence_quality || 'low').toLowerCase();
  return decision === 'accept' && score >= minimumVisibleConfidence && evidenceQuality !== 'low';
}

export function buildVisiblePriorArtResults<T = any>(params: {
  candidates: T[];
  byPn: Record<string, PriorArtGateRecord | undefined>;
  minimumVisibleConfidence?: number;
  visibleLimit?: number;
}): VisiblePriorArtBuildResult<T> {
  const candidates = Array.isArray(params.candidates) ? params.candidates : [];
  const byPn = params.byPn || {};
  const minimumVisibleConfidence = typeof params.minimumVisibleConfidence === 'number'
    ? params.minimumVisibleConfidence
    : DEFAULT_MINIMUM_VISIBLE_CONFIDENCE;
  const visibleLimit = Math.max(0, Math.trunc(
    typeof params.visibleLimit === 'number' ? params.visibleLimit : DEFAULT_VISIBLE_PRIOR_ART_LIMIT
  ));

  const gatedCandidates: T[] = [];
  const highConfidence: Array<{ item: T; index: number; score: number }> = [];

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const gate = getGateRecordForCandidate(candidate, byPn);
    if (!gate) continue;
    const annotated = annotatePriorArtCandidate(candidate, gate);
    gatedCandidates.push(annotated);
    if (isVisiblePriorArtGate(gate, minimumVisibleConfidence)) {
      highConfidence.push({
        item: annotated,
        index,
        score: finiteScore(gate.rerankScore, gate.score),
      });
    }
  }

  const visiblePriorArtResults = highConfidence
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .slice(0, visibleLimit)
    .map(entry => entry.item);
  return {
    gatedCandidates,
    visiblePriorArtResults,
    visiblePublicationNumbers: visiblePriorArtResults.map(getPriorArtPublicationNumber).filter(Boolean),
    highConfidenceCount: highConfidence.length,
    hiddenCandidateCount: Math.max(0, candidates.length - visiblePriorArtResults.length),
  };
}
