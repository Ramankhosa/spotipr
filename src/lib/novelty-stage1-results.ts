export const STAGE1_PAGE_SIZE = 20;

export type Stage1ResultSort = 'original' | 'score_desc' | 'newest' | 'oldest';

export type Stage1ResultFilters = {
  keyword: string;
  provider: string;
  matchedItem: string;
  minScore: string;
  publicationYearFrom: string;
  publicationYearTo: string;
  sort: Stage1ResultSort;
};

export type Stage1ResultEntry<T = any> = {
  result: T;
  originalIndex: number;
};

export type Stage1PaginationResult<T = any> = {
  allItems: Stage1ResultEntry<T>[];
  items: Stage1ResultEntry<T>[];
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  startIndex: number;
  endIndex: number;
};

export const DEFAULT_STAGE1_RESULT_FILTERS: Stage1ResultFilters = {
  keyword: '',
  provider: '',
  matchedItem: '',
  minScore: '',
  publicationYearFrom: '',
  publicationYearTo: '',
  sort: 'original',
};

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function compactText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(compactText).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).map(compactText).filter(Boolean).join(' ');
  }
  return String(value).trim();
}

function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  values.map(compactText).forEach(value => {
    if (!value) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(value);
  });

  return result;
}

function firstFiniteNumber(values: unknown[]): number | null {
  for (const value of values) {
    const numeric = typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : NaN;
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function normalizedText(value: unknown): string {
  return compactText(value).toLowerCase();
}

export function getStage1PatentNumber(result: any): string {
  return compactText(result?.publicationNumber || result?.pn || result?.publication_number || result?.patent_number || 'N/A') || 'N/A';
}

export function getStage1Providers(result: any): string[] {
  return uniqueStrings([
    ...asArray(result?.sourceProviders),
    result?.sourceProvider,
    result?.providerId,
    result?.provider,
  ]);
}

export function getStage1MatchedItems(result: any): string[] {
  const retrievalMatches = Array.isArray(result?.retrievalMatches) ? result.retrievalMatches : [];
  const retrievalItems = retrievalMatches.flatMap((match: any) => [
    match?.queryText,
    ...asArray(match?.featureLabels),
  ]);

  return uniqueStrings([
    ...asArray(result?.matchedFields),
    ...asArray(result?.matchedFeatures),
    ...retrievalItems,
  ]);
}

export function getStage1ScorePercent(result: any): number {
  const raw = firstFiniteNumber([
    result?.relevanceScore,
    result?.score,
    result?.relevance,
    result?.hybridScore,
    result?.retrievalScore,
  ]);

  if (raw === null) return 0;
  const percent = raw <= 1 ? raw * 100 : raw;
  return Math.max(0, Math.min(100, percent));
}

export function getStage1PublicationYear(result: any): number | null {
  const raw = result?.publicationDate || result?.publication_date || result?.year;
  if (!raw) return null;
  if (raw instanceof Date) {
    const year = raw.getFullYear();
    return Number.isFinite(year) ? year : null;
  }
  if (typeof raw === 'number') {
    return raw >= 1000 && raw <= 9999 ? Math.trunc(raw) : null;
  }
  const match = String(raw).match(/\b(18|19|20|21)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

export function getStage1FilterOptions(results: any[]) {
  return {
    providers: uniqueStrings(results.flatMap(getStage1Providers)).sort((a, b) => a.localeCompare(b)),
    matchedItems: uniqueStrings(results.flatMap(getStage1MatchedItems)).sort((a, b) => a.localeCompare(b)),
  };
}

function getStage1KeywordText(result: any): string {
  return normalizedText([
    getStage1PatentNumber(result),
    result?.title,
    result?.invention_title,
    result?.abstract,
    result?.snippet,
    result?.applicants,
    result?.inventors,
    result?.classifications,
    result?.cpcCodes,
    result?.ipcCodes,
    getStage1Providers(result),
    result?.sourcePdfName,
  ]);
}

function matchesKeyword(result: any, keyword: string): boolean {
  const terms = keyword.toLowerCase().split(/\s+/).map(term => term.trim()).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = getStage1KeywordText(result);
  return terms.every(term => haystack.includes(term));
}

function parseYearFilter(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const year = Number(trimmed);
  return Number.isFinite(year) ? year : null;
}

export function filterStage1Results<T = any>(
  results: T[],
  filters: Stage1ResultFilters,
): Stage1ResultEntry<T>[] {
  const minScore = firstFiniteNumber([filters.minScore]);
  const yearFrom = parseYearFilter(filters.publicationYearFrom);
  const yearTo = parseYearFilter(filters.publicationYearTo);
  const providerFilter = filters.provider.toLowerCase();
  const matchedItemFilter = filters.matchedItem.toLowerCase();

  const filtered = results
    .map((result, originalIndex) => ({ result, originalIndex }))
    .filter(({ result }) => {
      if (!matchesKeyword(result, filters.keyword)) return false;
      if (providerFilter && !getStage1Providers(result).some(provider => provider.toLowerCase() === providerFilter)) return false;
      if (matchedItemFilter && !getStage1MatchedItems(result).some(item => item.toLowerCase() === matchedItemFilter)) return false;
      if (minScore !== null && getStage1ScorePercent(result) < minScore) return false;

      const year = getStage1PublicationYear(result);
      if (yearFrom !== null && (year === null || year < yearFrom)) return false;
      if (yearTo !== null && (year === null || year > yearTo)) return false;

      return true;
    });

  return filtered.sort((a, b) => {
    if (filters.sort === 'score_desc') {
      return getStage1ScorePercent(b.result) - getStage1ScorePercent(a.result) || a.originalIndex - b.originalIndex;
    }
    if (filters.sort === 'newest') {
      return (getStage1PublicationYear(b.result) || 0) - (getStage1PublicationYear(a.result) || 0) || a.originalIndex - b.originalIndex;
    }
    if (filters.sort === 'oldest') {
      const aYear = getStage1PublicationYear(a.result) || Number.MAX_SAFE_INTEGER;
      const bYear = getStage1PublicationYear(b.result) || Number.MAX_SAFE_INTEGER;
      return aYear - bYear || a.originalIndex - b.originalIndex;
    }
    return a.originalIndex - b.originalIndex;
  });
}

export function paginateStage1Results<T = any>(
  entries: Stage1ResultEntry<T>[],
  page: number,
  pageSize = STAGE1_PAGE_SIZE,
): Stage1PaginationResult<T> {
  const safePageSize = Math.max(1, Math.trunc(pageSize));
  const totalItems = entries.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const currentPage = Math.min(Math.max(1, Math.trunc(page) || 1), totalPages);
  const startIndex = totalItems === 0 ? 0 : (currentPage - 1) * safePageSize + 1;
  const endIndex = Math.min(currentPage * safePageSize, totalItems);

  return {
    allItems: entries,
    items: entries.slice((currentPage - 1) * safePageSize, currentPage * safePageSize),
    currentPage,
    totalPages,
    totalItems,
    pageSize: safePageSize,
    startIndex,
    endIndex,
  };
}

export function filterAndPaginateStage1Results<T = any>(
  results: T[],
  filters: Stage1ResultFilters,
  page: number,
  pageSize = STAGE1_PAGE_SIZE,
): Stage1PaginationResult<T> {
  return paginateStage1Results(filterStage1Results(results, filters), page, pageSize);
}
