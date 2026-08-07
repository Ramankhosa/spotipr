export const DEFAULT_VISIBLE_PRIOR_ART_LIMIT = 50;
export const DEFAULT_MINIMUM_VISIBLE_CONFIDENCE = 0.7;

export type RerankDecision = 'accept' | 'component' | 'borderline' | 'reject';
export type PriorArtMatchCategory = 'direct' | 'component' | 'borderline' | 'rejected';

export type ScreeningStopReason =
  | 'pool_exhausted'
  | 'yield_below_threshold'
  | 'candidate_ceiling'
  | 'wall_clock'
  | 'token_budget'
  | 'gate_errors'
  | 'empty_wave';

/**
 * Why screening stopped, grouped by what it means for the reader.
 *
 * - `exhausted` — the pool ran out, or the tail stopped yielding relevant art.
 *   Coverage is as complete as the corpus allows.
 * - `bounded`   — a configured ceiling was reached. Coverage is deliberate and
 *   more candidates remain.
 * - `error`     — the gate failed. Coverage is incomplete for a reason that has
 *   nothing to do with the invention, which is the one case a reader must not
 *   mistake for "we looked and found little".
 *
 * Lives here rather than beside the screening loop so the report renderer can read
 * it without importing the pipeline service, and its database and gateway clients,
 * at runtime.
 */
export type ScreeningStopClass = 'exhausted' | 'bounded' | 'error';

export function classifyScreeningStopReason(reason?: string | null): ScreeningStopClass {
  if (reason === 'gate_errors' || reason === 'empty_wave') return 'error';
  if (reason === 'candidate_ceiling' || reason === 'wall_clock' || reason === 'token_budget') return 'bounded';
  return 'exhausted';
}

export interface PriorArtGateRecord {
  pn?: string;
  score?: number;
  rerankScore?: number;
  decision?: string;
  rerankDecision?: string;
  matched_features?: string[];
  missing_features?: string[];
  primary_claim_relationship?: boolean;
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

const ACCEPT_LITERALS = new Set(['accept', 'accepted']);
const COMPONENT_LITERALS = new Set([
  'component', 'feature', 'feature_level', 'feature-level', 'partial_feature', 'subsystem',
]);
const BORDERLINE_LITERALS = new Set([
  'borderline', 'review_error', 'review-error', 'needs_review', 'needs-review',
  'manual_review', 'manual-review', 'uncertain', 'unknown', 'parse_error', 'parse-error', 'error',
]);
/**
 * Rejection has to be stated, not inferred from "nothing else matched".
 *
 * This set exists so the fallback below can be `borderline`. Everywhere else the
 * gate is unsure — a thrown call, unparseable JSON, a candidate the model skipped,
 * an empty decision field — the candidate is kept for bounded review. An
 * unrecognised decision string carries the same information as those, so it
 * resolves the same way. Defaulting to `reject` instead meant one drifted literal
 * ("partial", "accept.", a renamed label after a model change) silently erased the
 * candidate from deep analysis, from the visible list and from both appendices,
 * while the run still reported gateStatus 'complete'.
 */
const REJECT_LITERALS = new Set([
  'reject', 'rejected', 'irrelevant', 'not_relevant', 'not-relevant', 'not relevant',
  'discard', 'discarded', 'exclude', 'excluded', 'remote', 'no',
]);

export interface RerankDecisionClassification {
  decision: RerankDecision;
  /**
   * False when the raw value matched no known literal. The decision is still
   * usable — it degrades to `borderline` — but callers on the ingestion path
   * should count it, because a prompt or model change that shifts the decision
   * vocabulary is otherwise undetectable.
   */
  recognized: boolean;
}

export function classifyRerankDecision(value: unknown): RerankDecisionClassification {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (ACCEPT_LITERALS.has(normalized)) return { decision: 'accept', recognized: true };
  if (COMPONENT_LITERALS.has(normalized)) return { decision: 'component', recognized: true };
  if (BORDERLINE_LITERALS.has(normalized)) return { decision: 'borderline', recognized: true };
  if (REJECT_LITERALS.has(normalized)) return { decision: 'reject', recognized: true };
  return { decision: 'borderline', recognized: false };
}

export function normalizeRerankDecision(value: unknown): RerankDecision {
  return classifyRerankDecision(value).decision;
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
