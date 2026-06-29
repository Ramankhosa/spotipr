import { prisma } from '@/lib/prisma';

function cleanText(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
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

  const featureMaps = Array.isArray(stage35?.feature_map) ? stage35.feature_map : [];
  featureMaps.forEach((item: any) => add(item?.pn || item?.publicationNumber || item?.publication_number));

  const remarks = Array.isArray(stage4?.per_patent_remarks) ? stage4.per_patent_remarks : [];
  remarks.forEach((item: any) => add(item?.pn || item?.publicationNumber || item?.publication_number || item?.patent_number));

  return Array.from(numbers);
}

export async function hydrateNoveltyReportPatentMetadata<T extends { stage1Results?: any; stage35Results?: any; stage4Results?: any }>(searchRun: T): Promise<T> {
  const numbers = patentNumbersFromSearchRun(searchRun);
  const patentNumbers = numbers.filter(number => !canonicalPatentNumber(number).startsWith('PAPER'));
  if (!patentNumbers.length) return searchRun;

  const canonicalNumbers = Array.from(new Set(patentNumbers.map(canonicalPatentNumber).filter(Boolean))).slice(0, 80);
  const numericTokens = canonicalNumbers.map(value => value.replace(/^IN/i, '')).filter(Boolean);
  const localPatents = await prisma.localPatent.findMany({
    where: {
      OR: [
        ...canonicalNumbers.map(value => ({ publicationNumber: { contains: value } })),
        ...numericTokens.map(value => ({ applicationNumberRaw: { contains: value } })),
      ],
    },
    take: 200,
  });
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
