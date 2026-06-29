export const DEFAULT_VISIBLE_PRIOR_ART_LIMIT = 50;
export const DEFAULT_MINIMUM_VISIBLE_CONFIDENCE = 0.7;

export type RerankDecision = 'accept' | 'component' | 'borderline' | 'reject';
export type PriorArtMatchCategory = 'direct' | 'component' | 'borderline' | 'rejected';

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
  reviewStatus?: 'reviewed' | 'gate_error' | 'review_error';
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
  const compact = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (compact.startsWith('PAPER')) return compact;
  return compact.replace(/[A-Z]\d*$/, '');
}

export function normalizeRerankDecision(value: unknown): RerankDecision {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'accept' || normalized === 'accepted') return 'accept';
  if (
    normalized === 'component' ||
    normalized === 'feature' ||
    normalized === 'feature_level' ||
    normalized === 'feature-level' ||
    normalized === 'partial_feature' ||
    normalized === 'subsystem'
  ) return 'component';
  if (
    normalized === 'borderline' ||
    normalized === 'review_error' ||
    normalized === 'review-error' ||
    normalized === 'needs_review' ||
    normalized === 'needs-review' ||
    normalized === 'manual_review' ||
    normalized === 'manual-review' ||
    normalized === 'uncertain' ||
    normalized === 'unknown' ||
    normalized === 'parse_error' ||
    normalized === 'parse-error' ||
    normalized === 'error'
  ) return 'borderline';
  return 'reject';
}

export function matchCategoryFromDecision(value: unknown): PriorArtMatchCategory {
  const decision = normalizeRerankDecision(value);
  if (decision === 'accept') return 'direct';
  if (decision === 'component') return 'component';
  if (decision === 'borderline') return 'borderline';
  return 'rejected';
}

export function matchCategoryLabel(value: unknown): string {
  const category = matchCategoryFromDecision(value);
  if (category === 'direct') return 'Direct invention-level match';
  if (category === 'component') return 'Component / feature-level prior art';
  if (category === 'borderline') return 'Borderline / needs review';
  return 'Rejected / remote';
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
    matchCategory: matchCategoryFromDecision(rerankDecision),
    matchCategoryLabel: matchCategoryLabel(rerankDecision),
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
  _minimumVisibleConfidence = DEFAULT_MINIMUM_VISIBLE_CONFIDENCE
): boolean {
  if (!gate) return false;
  const decision = normalizeRerankDecision(gate.rerankDecision || gate.decision);
  return decision === 'accept' || decision === 'component' || decision === 'borderline';
}

function visibleDecisionPriority(value: unknown): number {
  const decision = normalizeRerankDecision(value);
  if (decision === 'accept') return 0;
  if (decision === 'component') return 1;
  if (decision === 'borderline') return 2;
  return 3;
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
  const reviewable: Array<{ item: T; index: number; score: number; priority: number }> = [];

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const gate = getGateRecordForCandidate(candidate, byPn);
    if (!gate) continue;
    const annotated = annotatePriorArtCandidate(candidate, gate);
    gatedCandidates.push(annotated);
    if (isVisiblePriorArtGate(gate, minimumVisibleConfidence)) {
      reviewable.push({
        item: annotated,
        index,
        score: finiteScore(gate.rerankScore, gate.score),
        priority: visibleDecisionPriority(gate.rerankDecision || gate.decision),
      });
    }
  }

  const visiblePriorArtResults = reviewable
    .sort((a, b) => (a.priority - b.priority) || (b.score - a.score) || (a.index - b.index))
    .slice(0, visibleLimit)
    .map(entry => entry.item);
  return {
    gatedCandidates,
    visiblePriorArtResults,
    visiblePublicationNumbers: visiblePriorArtResults.map(getPriorArtPublicationNumber).filter(Boolean),
    highConfidenceCount: reviewable.length,
    hiddenCandidateCount: Math.max(0, candidates.length - visiblePriorArtResults.length),
  };
}
