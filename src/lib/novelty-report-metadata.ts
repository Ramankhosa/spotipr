import { prisma } from '@/lib/prisma';
import { PATENT_CORPUS_SOURCE_INDIAN } from '@/lib/patent-corpus-service';

// Report hydration runs on the request path (search detail + attorney-report PDF), so it
// must never outlive the request. `local_patents` holds the ~45M-row Google Patents corpus
// alongside the Indian corpus; a lookup that cannot use an index sequential-scans all of it.
const HYDRATION_STATEMENT_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.NOVELTY_REPORT_HYDRATION_TIMEOUT_MS || '8000') || 8000
);

// Kind codes appended to a kind-stripped number so lookups stay exact-match against the
// unique `publicationNumberKey` index. Matching on a computed kind-stripped expression (or
// a `contains`/LIKE '%..%') instead would sequential-scan the whole corpus.
const KIND_CODE_VARIANTS = ['A', 'A1', 'A2', 'A4', 'B', 'B1', 'B2', 'B4', 'C', 'C1', 'U', 'U1'];

// Only the columns localPatentToMetadata actually reads. The corpus rows carry rawText,
// claimsText and descriptionText, which would otherwise be dragged over the wire per row.
const METADATA_SELECT = {
  publicationNumber: true,
  applicationNumberRaw: true,
  familyId: true,
  title: true,
  abstract: true,
  abstractOriginal: true,
  applicants: true,
  inventors: true,
  classifications: true,
  filingDate: true,
  publicationDate: true,
  numberOfPages: true,
  numberOfClaims: true,
  sourcePdfName: true,
  sourcePageNumber: true,
  extractionConfidence: true,
  rawApplicantBlock: true,
  rawInventorBlock: true,
  ipIndiaDetails: true,
} as const;

function cleanText(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** Compact form that keeps the kind code — matches local_patents."publicationNumberKey". */
function compactPatentNumber(value: unknown) {
  return cleanText(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function canonicalPatentNumber(value: unknown) {
  const compact = cleanText(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (compact.startsWith('PAPER')) return compact;
  const kindSuffixMatch = compact.match(/^(.+\d)[A-Z]\d?$/);
  return kindSuffixMatch?.[1] || compact;
}

function getPublicationNumber(value: any): string {
  return cleanText(
    value?.publicationNumber ||
    value?.publication_number ||
    value?.pn ||
    value?.patent_number ||
    value?.id
  );
}

function hasValue(value: unknown) {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim() !== '' && value.trim() !== '-';
  return true;
}

function fillMissing(target: any, source: any, keys: string[]) {
  for (const key of keys) {
    if (!hasValue(target[key]) && hasValue(source[key])) target[key] = source[key];
  }
}

function localPatentToMetadata(patent: any) {
  return {
    providerId: 'indian-corpus',
    sourceProvider: 'indian-corpus',
    publicationNumber: patent.publicationNumber,
    publication_number: patent.publicationNumber,
    pn: patent.publicationNumber,
    applicationNumber: patent.applicationNumberRaw || null,
    applicationNumberRaw: patent.applicationNumberRaw || null,
    // Carried so a report recomputed at render time can reproduce the pipeline's
    // family grouping instead of falling back to per-publication behaviour.
    familyId: patent.familyId || null,
    title: patent.title,
    abstract: patent.abstract || patent.abstractOriginal || null,
    abstractOriginal: patent.abstractOriginal || null,
    applicants: patent.applicants || null,
    assignees: patent.applicants || null,
    inventors: Array.isArray(patent.inventors) ? patent.inventors : [],
    classifications: Array.isArray(patent.classifications) ? patent.classifications : [],
    filingDate: patent.filingDate || null,
    publicationDate: patent.publicationDate || null,
    link: `https://patents.google.com/patent/${patent.publicationNumber}`,
    sourceUrl: `https://patents.google.com/patent/${patent.publicationNumber}`,
    numberOfPages: patent.numberOfPages ?? null,
    numberOfClaims: patent.numberOfClaims ?? null,
    sourcePdfName: patent.sourcePdfName || null,
    sourcePageNumber: patent.sourcePageNumber || null,
    extractionConfidence: patent.extractionConfidence ?? null,
    raw: {
      publicationNumber: patent.publicationNumber,
      applicationNumberRaw: patent.applicationNumberRaw,
      filingDate: patent.filingDate,
      publicationDate: patent.publicationDate,
      title: patent.title,
      abstract: patent.abstract,
      abstractOriginal: patent.abstractOriginal,
      applicants: patent.applicants,
      inventors: patent.inventors,
      classifications: patent.classifications,
      rawApplicantBlock: patent.rawApplicantBlock,
      rawInventorBlock: patent.rawInventorBlock,
      ipIndiaDetails: patent.ipIndiaDetails,
    },
  };
}

function enrichItem(item: any, localByCanonical: Map<string, any>) {
  if (!item || typeof item !== 'object') return item;
  const pn = getPublicationNumber(item);
  const local = localByCanonical.get(canonicalPatentNumber(pn));
  if (!local) return item;

  const enriched = { ...item };
  fillMissing(enriched, local, [
    'publicationNumber',
    'publication_number',
    'pn',
    'applicationNumber',
    'applicationNumberRaw',
    'title',
    'abstract',
    'abstractOriginal',
    'applicants',
    'assignees',
    'inventors',
    'classifications',
    'filingDate',
    'publicationDate',
    'link',
    'sourceUrl',
    'numberOfPages',
    'numberOfClaims',
    'sourcePdfName',
    'sourcePageNumber',
    'extractionConfidence',
  ]);
  enriched.raw = { ...(local.raw || {}), ...(item.raw || {}) };
  enriched.sourceProviders = Array.from(new Set([
    ...(Array.isArray(item.sourceProviders) ? item.sourceProviders : []),
    item.sourceProvider,
    local.sourceProvider,
  ].filter(Boolean)));
  return enriched;
}

function patentNumbersFromSearchRun(searchRun: any): string[] {
  const stage1 = searchRun?.stage1Results || {};
  const stage35 = searchRun?.stage35Results || {};
  const stage4 = searchRun?.stage4Results || {};
  const numbers = new Set<string>();
  const add = (value: unknown) => {
    const text = cleanText(value);
    if (text) numbers.add(text);
  };

  // Analysed references first. The lookup below is capped, and the retrieval pool
  // can hold 300 candidates, so leading with the pool can push the very references
  // the report renders in detail outside the window.
  const featureMaps = Array.isArray(stage35?.feature_map) ? stage35.feature_map : [];
  featureMaps.forEach((item: any) => add(item?.pn || item?.publicationNumber || item?.publication_number));

  const remarks = Array.isArray(stage4?.per_patent_remarks) ? stage4.per_patent_remarks : [];
  remarks.forEach((item: any) => add(item?.pn || item?.publicationNumber || item?.publication_number || item?.patent_number));

  [
    stage1.visiblePriorArtResults,
    stage1.gatedCandidates,
    stage1.retrievalCandidates,
    stage1.rawPriorArtResults,
    stage1.candidateResults,
    stage1.priorArtResults,
    stage1.pqaiResults,
    stage1.fallbackCandidates,
  ].forEach(source => {
    if (!Array.isArray(source)) return;
    source.forEach(item => add(getPublicationNumber(item)));
  });

  return Array.from(numbers);
}

export async function hydrateNoveltyReportPatentMetadata<T extends { stage1Results?: any; stage35Results?: any; stage4Results?: any }>(searchRun: T): Promise<T> {
  const numbers = patentNumbersFromSearchRun(searchRun);
  const patentNumbers = numbers.filter(number => !canonicalPatentNumber(number).startsWith('PAPER'));
  if (!patentNumbers.length) return searchRun;

  const canonicalNumbers = Array.from(new Set(patentNumbers.map(canonicalPatentNumber).filter(Boolean))).slice(0, 80);
  const numericTokens = canonicalNumbers.map(value => value.replace(/^IN/i, '')).filter(Boolean);

  // Every branch below is an exact match against an indexed column: `publicationNumber` and
  // `publicationNumberKey` both carry unique b-tree indexes, and the `applicationNumberRaw`
  // branch is confined to the Indian corpus so it resolves through the corpusSources GIN
  // index instead of scanning the Google corpus. Kind-code variants are enumerated here
  // because the canonical form is kind-stripped while the stored key retains the kind code.
  const exactPublicationNumbers = new Set<string>();
  const compactPublicationKeys = new Set<string>();
  for (const number of patentNumbers.slice(0, 200)) {
    const raw = cleanText(number);
    if (!raw) continue;
    exactPublicationNumbers.add(raw);
    exactPublicationNumbers.add(raw.toUpperCase());
    const compact = compactPatentNumber(raw);
    if (compact) compactPublicationKeys.add(compact);
  }
  for (const canonical of canonicalNumbers) {
    compactPublicationKeys.add(canonical);
    for (const kind of KIND_CODE_VARIANTS) compactPublicationKeys.add(`${canonical}${kind}`);
  }

  let localPatents: Array<Record<string, any>> = [];
  try {
    const [, rows] = await prisma.$transaction([
      prisma.$executeRaw`SELECT set_config('statement_timeout', ${String(HYDRATION_STATEMENT_TIMEOUT_MS)}, true)`,
      prisma.localPatent.findMany({
        where: {
          OR: [
            { publicationNumber: { in: Array.from(exactPublicationNumbers) } },
            { publicationNumberKey: { in: Array.from(compactPublicationKeys) } },
            {
              corpusSources: { has: PATENT_CORPUS_SOURCE_INDIAN },
              applicationNumberRaw: { in: numericTokens },
            },
          ],
        },
        select: METADATA_SELECT,
        take: 200,
      }),
    ]);
    localPatents = rows as Array<Record<string, any>>;
  } catch (error) {
    // Enrichment is additive: the report already carries the pipeline's own metadata. Never
    // fail (or stall) an export because the corpus lookup did not come back.
    console.warn('[NoveltyReportMetadata] Local corpus hydration skipped.',
      error instanceof Error ? error.message : error);
    return searchRun;
  }
  if (!localPatents.length) return searchRun;

  const localByCanonical = new Map<string, any>();
  localPatents.forEach(patent => {
    const metadata = localPatentToMetadata(patent);
    localByCanonical.set(canonicalPatentNumber(patent.publicationNumber), metadata);
    if (patent.applicationNumberRaw) localByCanonical.set(canonicalPatentNumber(patent.applicationNumberRaw), metadata);
  });

  const stage1 = { ...((searchRun as any).stage1Results || {}) };
  const enrichArray = (value: any) => Array.isArray(value) ? value.map(item => enrichItem(item, localByCanonical)) : value;
  [
    'visiblePriorArtResults',
    'gatedCandidates',
    'retrievalCandidates',
    'rawPriorArtResults',
    'candidateResults',
    'priorArtResults',
    'pqaiResults',
    'fallbackCandidates',
  ].forEach(key => {
    stage1[key] = enrichArray(stage1[key]);
  });

  const existing = new Set<string>();
  for (const key of ['retrievalCandidates', 'rawPriorArtResults', 'candidateResults']) {
    if (!Array.isArray(stage1[key])) stage1[key] = [];
    stage1[key].forEach((item: any) => existing.add(canonicalPatentNumber(getPublicationNumber(item))));
  }
  for (const number of numbers) {
    const canonical = canonicalPatentNumber(number);
    const local = localByCanonical.get(canonical);
    if (local && !existing.has(canonical)) {
      stage1.retrievalCandidates.push(local);
      stage1.rawPriorArtResults.push(local);
      stage1.candidateResults.push(local);
      existing.add(canonical);
    }
  }

  return {
    ...(searchRun as any),
    stage1Results: stage1,
  };
}
