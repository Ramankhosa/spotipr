import { normalizeRerankDecision, type PriorArtGateRecord, type RerankDecision } from './novelty-prior-art-visibility';

export interface NoveltyReportCountSummary {
  patentsSearched: number;
  patentsFound: number;
  directlyRelevant: number;
  directMatches: number;
  componentMatches: number;
  borderlineMatches: number;
  screened: number;
  candidateMatches: number;
  detailedCitations: number;
}

function cleanText(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function canonicalPatentNumber(value: unknown) {
  const compact = cleanText(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (compact.startsWith('PAPER')) return compact;
  const kindSuffixMatch = compact.match(/^(.+\d)[A-Z]\d?$/);
  return kindSuffixMatch?.[1] || compact;
}

function publicationNumber(value: any) {
  return cleanText(
    value?.pn ||
    value?.publicationNumber ||
    value?.publication_number ||
    value?.patentNumber ||
    value?.patent_number ||
    value?.id ||
    value
  );
}

function finiteCount(...values: unknown[]) {
  let firstFinite = 0;
  let hasFinite = false;
  for (const value of values) {
    const count = Number(value);
    if (!Number.isFinite(count) || count < 0) continue;
    const normalized = Math.trunc(count);
    if (!hasFinite) {
      firstFinite = normalized;
      hasFinite = true;
    }
    if (normalized > 0) return normalized;
  }
  return hasFinite ? firstFinite : 0;
}

function uniquePatentCount(...sources: unknown[]) {
  const numbers = new Set<string>();
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const item of source) {
      const canonical = canonicalPatentNumber(publicationNumber(item));
      if (canonical) numbers.add(canonical);
    }
  }
  return numbers.size;
}

function boundedCount(value: number, max: number) {
  if (max <= 0) return Math.max(0, value);
  return Math.min(Math.max(0, value), max);
}

/**
 * Count gate decisions from the full `byPn` record map.
 *
 * `aiRelevance.borderline` is a UI-sized list capped at `stage15.borderlineQuota`
 * (5 by default), so counting it under-reports every run that reviewed more than
 * five borderline candidates. `byPn` holds every reviewed decision, keyed under
 * several aliases per publication, so dedupe by canonical number.
 *
 * Returns null when no gate record map is available, so callers fall back to the
 * legacy list-derived counts.
 */
function decisionCountsFromGateRecords(byPn: unknown): Record<RerankDecision, number> | null {
  if (!byPn || typeof byPn !== 'object' || Array.isArray(byPn)) return null;
  const entries = Object.entries(byPn as Record<string, PriorArtGateRecord | undefined>);
  if (entries.length === 0) return null;

  const decisionByCanonical = new Map<string, RerankDecision>();
  for (const [key, record] of entries) {
    if (!record || typeof record !== 'object') continue;
    const canonical = canonicalPatentNumber(cleanText(record.pn) || key);
    if (!canonical || decisionByCanonical.has(canonical)) continue;
    decisionByCanonical.set(canonical, normalizeRerankDecision(record.rerankDecision || record.decision));
  }
  if (decisionByCanonical.size === 0) return null;

  const counts: Record<RerankDecision, number> = { accept: 0, component: 0, borderline: 0, reject: 0 };
  Array.from(decisionByCanonical.values()).forEach((decision: RerankDecision) => {
    counts[decision] += 1;
  });
  return counts;
}

export function buildNoveltyReportCountSummary(stage1: any, stage35: any): NoveltyReportCountSummary {
  const aiRelevance = stage1?.aiRelevance || {};
  const detailedCitations = Array.isArray(stage35?.feature_map) ? stage35.feature_map.length : 0;
  const retrievedUnique = uniquePatentCount(
    stage1?.retrievalCandidates,
    stage1?.rawPriorArtResults,
    stage1?.candidateResults
  );
  const visibleUnique = uniquePatentCount(
    stage1?.visiblePriorArtResults,
    stage1?.priorArtResults,
    stage1?.pqaiResults
  );
  const gateDecisionCounts = decisionCountsFromGateRecords(aiRelevance?.byPn);
  const directMatches = gateDecisionCounts
    ? gateDecisionCounts.accept
    : uniquePatentCount(aiRelevance?.accepted);
  const componentMatches = gateDecisionCounts
    ? gateDecisionCounts.component
    : uniquePatentCount(aiRelevance?.component);
  const borderlineMatches = gateDecisionCounts
    ? gateDecisionCounts.borderline
    : uniquePatentCount(aiRelevance?.borderline);
  const gateMatchUnique = gateDecisionCounts
    ? gateDecisionCounts.accept + gateDecisionCounts.component + gateDecisionCounts.borderline
    : uniquePatentCount(aiRelevance?.accepted, aiRelevance?.component, aiRelevance?.borderline);
  const patentsSearched = finiteCount(
    stage1?.retrievedCount,
    aiRelevance?.retrievedCount,
    retrievedUnique,
    stage1?.totalCandidates
  );
  const screened = boundedCount(
    finiteCount(
      stage1?.reviewedCount,
      aiRelevance?.reviewedCount,
      aiRelevance?.consideredCount,
      aiRelevance?.reviewedCandidateCount
    ),
    patentsSearched
  );
  const hasComponentCategory = Boolean(gateDecisionCounts) || Array.isArray(aiRelevance?.component);
  const directlyRelevant = boundedCount(
    hasComponentCategory
      ? directMatches
      : finiteCount(
          directMatches,
          stage1?.visibleCount,
          aiRelevance?.visibleCount,
          aiRelevance?.highConfidenceCount,
          visibleUnique,
          detailedCitations
        ),
    patentsSearched
  );
  const candidateMatches = boundedCount(
    finiteCount(gateMatchUnique, aiRelevance?.accepted?.length, aiRelevance?.borderline?.length, visibleUnique, detailedCitations),
    patentsSearched
  );
  const patentsFound = Math.max(candidateMatches, directlyRelevant);

  return {
    patentsSearched,
    patentsFound,
    directlyRelevant,
    directMatches: boundedCount(directMatches, patentsSearched),
    componentMatches: boundedCount(componentMatches, patentsSearched),
    borderlineMatches: boundedCount(borderlineMatches, patentsSearched),
    screened,
    candidateMatches,
    detailedCitations,
  };
}
