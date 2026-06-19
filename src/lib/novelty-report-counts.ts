export interface NoveltyReportCountSummary {
  patentsSearched: number;
  patentsFound: number;
  directlyRelevant: number;
  screened: number;
  candidateMatches: number;
  detailedCitations: number;
}

function cleanText(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function canonicalPatentNumber(value: unknown) {
  const compact = cleanText(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
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
  const gateMatchUnique = uniquePatentCount(aiRelevance?.accepted, aiRelevance?.borderline);
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
  const directlyRelevant = boundedCount(
    finiteCount(
      detailedCitations,
      stage1?.visibleCount,
      aiRelevance?.visibleCount,
      aiRelevance?.highConfidenceCount,
      visibleUnique
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
    screened,
    candidateMatches,
    detailedCitations,
  };
}
