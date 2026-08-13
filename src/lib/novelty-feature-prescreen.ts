// Stage 1.7 feature prescreen: score every invention feature against every
// retrieval candidate's stored corpus embedding, BEFORE the expensive LLM
// relevance gate runs. One embedding call for the feature texts, one SQL scan
// for the whole pool (~17ms at 300 docs measured on production).
//
// The result is a compact feature × candidate verdict matrix persisted inside
// stage1Results. Consumers (gate ordering, deep-analysis sizing, the recall
// net, absence evidence) all read it mode-gated — 'observe' computes and
// persists this blob but influences nothing.
//
// Never throws: any failure — missing API key, timeout, SQL error — returns
// { status: 'unavailable' } and the pipeline proceeds exactly as it always has.
import { scoreElements } from '@/lib/element-scoring/scorer'
import {
  PATENT_CORPUS_EMBEDDING_DTYPE,
  PATENT_CORPUS_EMBEDDING_MODEL,
} from '@/lib/patent-corpus-service'
import type { CoverageImportantFeature, KCoverCandidate } from '@/lib/novelty-kcover'

/** Compact verdict codes: STRONG / PART / WEAK / NONE. Missing cell = UNAVAILABLE. */
export type PrescreenVerdictCode = 'S' | 'P' | 'W' | 'N'

export interface FeaturePrescreenCell {
  v: PrescreenVerdictCode;
  /** Raw similarity, 3dp — kept only on S/P cells so the blob stays small. */
  sim?: number;
}

export interface FeaturePrescreenResult {
  version: 1;
  status: 'ok' | 'unavailable';
  reason?: string;
  semanticAvailable: boolean;
  model: string;
  dtype: string;
  scoredCount: number;
  unavailableCount: number;
  elapsedMs: number;
  /** Fi ↔ inventionFeatures[i]; doubles as the staleness check for idempotent reuse. */
  featureTexts: string[];
  /** canonical pn -> featureKey -> cell. A pn absent here is UNAVAILABLE (no vector), never 'N'. */
  cells: Record<string, Record<string, FeaturePrescreenCell>>;
  coverageByFeature: Record<string, { strong: number; part: number }>;
  familyByPn?: Record<string, string>;
  unavailablePns: string[];
}

/**
 * Same normalization the report modules use: uppercase, strip separators,
 * strip the kind-code suffix so "US1234567A1" and "US1234567" collide.
 */
export function canonicalPrescreenPn(value: unknown): string {
  const compact = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (compact.startsWith('PAPER')) return compact;
  return compact.match(/^(.+\d)[A-Z]\d?$/)?.[1] || compact;
}

/**
 * Patents only — papers (arxiv/crossref/etc) have no corpus vectors and no
 * families. Country code, optionally a short series code (US "RE"/"PP"), then
 * digits: rejects ARXIV/CROSSREF/DOI-shaped identifiers that a two-letter
 * prefix test would admit.
 */
export function isPatentPublicationNumber(canonicalPn: string): boolean {
  return /^[A-Z]{2}[A-Z]{0,2}\d{4,}[A-Z0-9]*$/.test(canonicalPn) && !canonicalPn.startsWith('PAPER');
}

export function prescreenFeatureKey(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

const VERDICT_CODE: Record<string, PrescreenVerdictCode> = {
  STRONG: 'S', PART: 'P', WEAK: 'W', NONE: 'N',
};

function unavailableResult(reason: string, featureTexts: string[], elapsedMs: number): FeaturePrescreenResult {
  return {
    version: 1,
    status: 'unavailable',
    reason,
    semanticAvailable: false,
    model: PATENT_CORPUS_EMBEDDING_MODEL,
    dtype: PATENT_CORPUS_EMBEDDING_DTYPE,
    scoredCount: 0,
    unavailableCount: 0,
    elapsedMs,
    featureTexts,
    cells: {},
    coverageByFeature: {},
    unavailablePns: [],
  };
}

export async function runNoveltyFeaturePrescreen(input: {
  stage0Data: any;
  candidatePool: any[];
  searchId: string;
  tenantId?: string;
  userId?: string;
  timeoutMs: number;
  maxCandidates: number;
}): Promise<FeaturePrescreenResult> {
  const startedAt = Date.now();
  const featureTexts: string[] = (Array.isArray(input.stage0Data?.inventionFeatures)
    ? input.stage0Data.inventionFeatures
    : [])
    .map((feature: unknown) => String(feature || '').trim())
    .filter(Boolean);

  try {
    if (featureTexts.length === 0) return unavailableResult('no_invention_features', featureTexts, 0);

    // Patents only, deduped by canonical number, first raw spelling wins,
    // capped like the stage would be.
    const rawByCanonical = new Map<string, string>();
    for (const candidate of Array.isArray(input.candidatePool) ? input.candidatePool : []) {
      const raw = String(
        candidate?.publicationNumber || candidate?.publication_number || candidate?.pn || ''
      ).trim();
      if (!raw) continue;
      const canonical = canonicalPrescreenPn(raw);
      if (!canonical || !isPatentPublicationNumber(canonical) || rawByCanonical.has(canonical)) continue;
      rawByCanonical.set(canonical, raw);
      if (rawByCanonical.size >= Math.max(1, Math.trunc(input.maxCandidates))) break;
    }
    if (rawByCanonical.size === 0) {
      return unavailableResult('no_patent_candidates', featureTexts, Date.now() - startedAt);
    }

    const elements = featureTexts.map((text, index) => ({ id: `F${index}`, text, origin: 'manual' } as any));
    const timeoutMs = Math.max(1000, Math.trunc(input.timeoutMs));
    const scored = await Promise.race([
      scoreElements({
        elements,
        publicationNumbers: Array.from(rawByCanonical.values()),
        traceId: `stage17:${input.searchId}`,
        externalAiUsage: input.tenantId && input.userId
          ? { tenantId: input.tenantId, userId: input.userId, operationId: input.searchId }
          : undefined,
      }),
      new Promise<'timeout'>(resolve => {
        const timer = setTimeout(() => resolve('timeout'), timeoutMs);
        // Do not hold the event loop open for the timeout guard.
        (timer as any)?.unref?.();
      }),
    ]);
    if (scored === 'timeout') {
      return unavailableResult('timeout', featureTexts, Date.now() - startedAt);
    }

    const cells: FeaturePrescreenResult['cells'] = {};
    const coverageByFeature: FeaturePrescreenResult['coverageByFeature'] = {};
    for (const text of featureTexts) {
      coverageByFeature[prescreenFeatureKey(text)] = { strong: 0, part: 0 };
    }
    const unavailablePns: string[] = [];
    for (const [canonical, raw] of Array.from(rawByCanonical.entries())) {
      const scoredCells = scored.cells[raw];
      if (!scoredCells) {
        // No corpus vector / no document text: missing evidence, never 'N'.
        unavailablePns.push(canonical);
        continue;
      }
      // Compactness: 'N' cells are omitted — for a SCORED pn (present in
      // `cells`), a missing feature key means NONE. UNAVAILABLE remains a
      // pn-level distinction (the pn is absent from `cells` entirely). On a
      // 300-candidate pool the N cells dominate, so this roughly halves the
      // persisted blob.
      const compact: Record<string, FeaturePrescreenCell> = {};
      featureTexts.forEach((text, index) => {
        const cell = scoredCells[`F${index}`];
        if (!cell) return;
        const code = VERDICT_CODE[String(cell.verdict)] || 'N';
        if (code === 'N') return;
        const featureKey = prescreenFeatureKey(text);
        compact[featureKey] = code === 'S' || code === 'P'
          ? { v: code, ...(typeof cell.similarity === 'number' ? { sim: Number(cell.similarity.toFixed(3)) } : {}) }
          : { v: code };
        if (code === 'S') coverageByFeature[featureKey].strong += 1;
        if (code === 'P') coverageByFeature[featureKey].part += 1;
      });
      cells[canonical] = compact;
    }

    const familyByPn: Record<string, string> = {};
    if (scored.familyByPn instanceof Map) {
      for (const [rawPn, family] of Array.from(scored.familyByPn.entries())) {
        const canonical = canonicalPrescreenPn(rawPn);
        if (canonical && family) familyByPn[canonical] = String(family);
      }
    }

    return {
      version: 1,
      status: 'ok',
      semanticAvailable: Boolean(scored.semanticAvailable),
      model: PATENT_CORPUS_EMBEDDING_MODEL,
      dtype: PATENT_CORPUS_EMBEDDING_DTYPE,
      scoredCount: Object.keys(cells).length,
      unavailableCount: unavailablePns.length,
      elapsedMs: Date.now() - startedAt,
      featureTexts,
      cells,
      coverageByFeature,
      ...(Object.keys(familyByPn).length ? { familyByPn } : {}),
      unavailablePns,
    };
  } catch (error: any) {
    return unavailableResult(
      String(error?.message || 'prescreen_failed').slice(0, 200),
      featureTexts,
      Date.now() - startedAt
    );
  }
}

/**
 * The prescreen matrix as k-cover candidates: a candidate "covers" an important
 * feature when its cell is STRONG or PART — the signal calibrated at 83% recall
 * of LLM-Present on production runs.
 */
export function prescreenCoverCandidates(
  prescreen: FeaturePrescreenResult | undefined,
  importantFeatures: CoverageImportantFeature[]
): KCoverCandidate[] {
  if (!prescreen || prescreen.status !== 'ok') return [];
  const importantKeys = new Set(importantFeatures.map(feature => prescreenFeatureKey(feature.feature)));
  const candidates: KCoverCandidate[] = [];
  let index = 0;
  for (const [canonical, cellsByFeature] of Object.entries(prescreen.cells)) {
    const covered: string[] = [];
    let priorityScore = 0;
    for (const [featureKey, cell] of Object.entries(cellsByFeature)) {
      if (!importantKeys.has(featureKey)) continue;
      if (cell.v === 'S') { covered.push(featureKey); priorityScore += 2; }
      else if (cell.v === 'P') { covered.push(featureKey); priorityScore += 1; }
    }
    if (covered.length > 0) {
      candidates.push({ key: canonical, coveredFeatures: covered, priorityScore, sourceOrder: index });
    }
    index += 1;
  }
  return candidates;
}

/**
 * STRONG-only per-candidate counts on important features — the recall-net
 * signal. STRONG precision measured 86% on production; PART only 54%, which is
 * why PART never promotes an ungated candidate.
 */
export function prescreenStrongImportantPns(
  prescreen: FeaturePrescreenResult | undefined,
  importantFeatures: CoverageImportantFeature[]
): Map<string, number> {
  const strongByPn = new Map<string, number>();
  if (!prescreen || prescreen.status !== 'ok') return strongByPn;
  const importantKeys = new Set(importantFeatures.map(feature => prescreenFeatureKey(feature.feature)));
  for (const [canonical, cellsByFeature] of Object.entries(prescreen.cells)) {
    let strong = 0;
    for (const [featureKey, cell] of Object.entries(cellsByFeature)) {
      if (cell.v === 'S' && importantKeys.has(featureKey)) strong += 1;
    }
    if (strong > 0) strongByPn.set(canonical, strong);
  }
  return strongByPn;
}
