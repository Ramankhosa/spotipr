import crypto from 'crypto';

export const LITERATURE_SOURCE_IDS = [
  'google_scholar',
  'semantic_scholar',
  'crossref',
  'openalex',
  'pubmed',
  'arxiv',
  'core',
] as const;

export type LiteratureSourceId = typeof LITERATURE_SOURCE_IDS[number];

export interface LiteratureSearchOptions {
  yearFrom?: number;
  yearTo?: number;
  limit?: number;
  sources?: string[];
  publicationTypes?: string[];
  openAccessOnly?: boolean;
  minCitations?: number;
  fieldsOfStudy?: string[];
  hasAbstract?: boolean;
}

export interface LiteratureSearchResult {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  publicationDate?: string;
  venue?: string;
  abstract?: string;
  doi?: string;
  url?: string;
  citationCount?: number;
  source: LiteratureSourceId;
  sourceProviders?: LiteratureSourceId[];
  publicationType?: string;
  isOpenAccess?: boolean;
  pdfUrl?: string;
  fieldsOfStudy?: string[];
  relevanceScore?: number;
}

export interface LiteratureProviderStat {
  providerId: LiteratureSourceId;
  enabled: boolean;
  resultCount: number;
  error?: string;
}

export interface LiteratureSearchResponse {
  results: LiteratureSearchResult[];
  totalFound: number;
  sources: LiteratureSourceId[];
  providerStats: LiteratureProviderStat[];
  warnings: string[];
}

const SOURCE_LABELS: Record<LiteratureSourceId, string> = {
  google_scholar: 'Google Scholar',
  semantic_scholar: 'Semantic Scholar',
  crossref: 'Crossref',
  openalex: 'OpenAlex',
  pubmed: 'PubMed',
  arxiv: 'arXiv',
  core: 'CORE',
};

const DEFAULT_SOURCES: LiteratureSourceId[] = ['google_scholar', 'semantic_scholar', 'crossref'];

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeXml(value: string): string {
  return cleanText(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function finiteYear(value: unknown): number | undefined {
  const match = String(value ?? '').match(/\b(18|19|20|21)\d{2}\b/);
  return match ? Number(match[0]) : undefined;
}

function normalizedDoi(value: unknown): string | undefined {
  const doi = cleanText(value).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
  return doi || undefined;
}

function stablePaperId(result: Pick<LiteratureSearchResult, 'doi' | 'url' | 'title' | 'year'>): string {
  const seed = normalizedDoi(result.doi)?.toLowerCase() || cleanText(result.url).toLowerCase() || `${cleanText(result.title).toLowerCase()}|${result.year || ''}`;
  return `PAPER:${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16).toUpperCase()}`;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 20000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url: string, init: RequestInit = {}): Promise<any> {
  const response = await fetchWithTimeout(url, init);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function sourceEnabled(source: LiteratureSourceId): boolean {
  if (source === 'google_scholar') return Boolean(process.env.Serp_API_KEY || process.env.SERPAPI_API_KEY);
  if (source === 'core') return Boolean(process.env.CORE_API_KEY);
  return true;
}

function parseScholarAuthors(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => cleanText((item as any)?.name || item)).filter(Boolean);
  return cleanText(value).split(' - ')[0].split(',').map(cleanText).filter(Boolean);
}

async function searchGoogleScholar(query: string, options: LiteratureSearchOptions): Promise<LiteratureSearchResult[]> {
  const apiKey = process.env.Serp_API_KEY || process.env.SERPAPI_API_KEY;
  if (!apiKey) return [];
  const params = new URLSearchParams({ api_key: apiKey, engine: 'google_scholar', q: query, num: String(Math.min(options.limit || 20, 20)) });
  if (options.yearFrom) params.set('as_ylo', String(options.yearFrom));
  if (options.yearTo) params.set('as_yhi', String(options.yearTo));
  const data = await fetchJson(`https://serpapi.com/search.json?${params}`);
  if (data?.error) throw new Error(cleanText(data.error));
  return (data?.organic_results || []).map((item: any) => {
    const summary = cleanText(item?.publication_info?.summary);
    return {
      id: '',
      title: cleanText(item?.title),
      authors: parseScholarAuthors(item?.publication_info?.authors || summary),
      year: finiteYear(summary),
      venue: cleanText(summary.split(' - ')[1]?.replace(/,?\s*\d{4}\s*$/, '')) || undefined,
      abstract: cleanText(item?.snippet) || undefined,
      doi: normalizedDoi(cleanText(item?.link).match(/10\.\d{4,9}\/[^\s?#]+/i)?.[0]),
      url: cleanText(item?.link) || undefined,
      citationCount: Number(item?.inline_links?.cited_by?.total) || 0,
      source: 'google_scholar' as const,
      pdfUrl: cleanText(item?.resources?.[0]?.link) || undefined,
    };
  }).filter((item: LiteratureSearchResult) => item.title);
}

async function searchSemanticScholar(query: string, options: LiteratureSearchOptions): Promise<LiteratureSearchResult[]> {
  const params = new URLSearchParams({
    query,
    limit: String(Math.min(options.limit || 20, 100)),
    fields: 'title,authors,year,venue,abstract,citationCount,externalIds,url,publicationTypes,isOpenAccess,fieldsOfStudy,openAccessPdf',
  });
  if (options.yearFrom || options.yearTo) params.set('year', `${options.yearFrom || 1800}-${options.yearTo || new Date().getFullYear()}`);
  if (options.minCitations) params.set('minCitationCount', String(options.minCitations));
  const headers: Record<string, string> = { 'User-Agent': 'PatentNest/1.0' };
  if (process.env.SEMANTIC_SCHOLAR_API_KEY) headers['x-api-key'] = process.env.SEMANTIC_SCHOLAR_API_KEY;
  const data = await fetchJson(`https://api.semanticscholar.org/graph/v1/paper/search?${params}`, { headers });
  return (data?.data || []).map((paper: any) => ({
    id: '',
    title: cleanText(paper?.title),
    authors: (paper?.authors || []).map((author: any) => cleanText(author?.name)).filter(Boolean),
    year: Number(paper?.year) || undefined,
    venue: cleanText(paper?.venue) || undefined,
    abstract: cleanText(paper?.abstract) || undefined,
    doi: normalizedDoi(paper?.externalIds?.DOI),
    url: cleanText(paper?.url) || undefined,
    citationCount: Number(paper?.citationCount) || 0,
    source: 'semantic_scholar' as const,
    publicationType: cleanText(paper?.publicationTypes?.[0]) || undefined,
    isOpenAccess: Boolean(paper?.isOpenAccess),
    pdfUrl: cleanText(paper?.openAccessPdf?.url) || undefined,
    fieldsOfStudy: (paper?.fieldsOfStudy || []).map(cleanText).filter(Boolean),
  })).filter((item: LiteratureSearchResult) => item.title);
}

async function searchCrossref(query: string, options: LiteratureSearchOptions): Promise<LiteratureSearchResult[]> {
  const params = new URLSearchParams({ query, rows: String(Math.min(options.limit || 20, 100)), select: 'DOI,title,author,published,container-title,abstract,is-referenced-by-count,type,URL,link' });
  const filters: string[] = [];
  if (options.yearFrom) filters.push(`from-pub-date:${options.yearFrom}-01-01`);
  if (options.yearTo) filters.push(`until-pub-date:${options.yearTo}-12-31`);
  if (filters.length) params.set('filter', filters.join(','));
  const email = process.env.CROSSREF_EMAIL;
  if (email) params.set('mailto', email);
  const data = await fetchJson(`https://api.crossref.org/works?${params}`, { headers: { 'User-Agent': `PatentNest/1.0${email ? ` (mailto:${email})` : ''}` } });
  return (data?.message?.items || []).map((work: any) => {
    const dateParts = work?.published?.['date-parts']?.[0] || [];
    const publicationDate = dateParts.length ? dateParts.map((part: number, index: number) => index ? String(part).padStart(2, '0') : String(part)).join('-') : undefined;
    return {
      id: '',
      title: cleanText(work?.title?.[0]),
      authors: (work?.author || []).map((author: any) => cleanText(`${author?.given || ''} ${author?.family || ''}`)).filter(Boolean),
      year: Number(dateParts[0]) || undefined,
      publicationDate,
      venue: cleanText(work?.['container-title']?.[0]) || undefined,
      abstract: cleanText(work?.abstract) || undefined,
      doi: normalizedDoi(work?.DOI),
      url: cleanText(work?.URL) || undefined,
      citationCount: Number(work?.['is-referenced-by-count']) || 0,
      source: 'crossref' as const,
      publicationType: cleanText(work?.type) || undefined,
      pdfUrl: cleanText((work?.link || []).find((link: any) => /pdf/i.test(link?.['content-type']))?.URL) || undefined,
    };
  }).filter((item: LiteratureSearchResult) => item.title);
}

function decodeOpenAlexAbstract(index: Record<string, number[]> | undefined): string | undefined {
  if (!index || typeof index !== 'object') return undefined;
  const words: Array<[number, string]> = [];
  Object.entries(index).forEach(([word, positions]) => positions.forEach(position => words.push([position, word])));
  return words.sort((a, b) => a[0] - b[0]).map(([, word]) => word).join(' ') || undefined;
}

async function searchOpenAlex(query: string, options: LiteratureSearchOptions): Promise<LiteratureSearchResult[]> {
  const params = new URLSearchParams({ search: query, 'per-page': String(Math.min(options.limit || 20, 100)) });
  const filters: string[] = [];
  if (options.yearFrom) filters.push(`from_publication_date:${options.yearFrom}-01-01`);
  if (options.yearTo) filters.push(`to_publication_date:${options.yearTo}-12-31`);
  if (options.openAccessOnly) filters.push('is_oa:true');
  if (options.minCitations) filters.push(`cited_by_count:>${Math.max(0, options.minCitations - 1)}`);
  if (filters.length) params.set('filter', filters.join(','));
  if (process.env.OPENALEX_EMAIL) params.set('mailto', process.env.OPENALEX_EMAIL);
  const data = await fetchJson(`https://api.openalex.org/works?${params}`);
  return (data?.results || []).map((work: any) => ({
    id: '',
    title: cleanText(work?.display_name),
    authors: (work?.authorships || []).map((entry: any) => cleanText(entry?.author?.display_name)).filter(Boolean),
    year: Number(work?.publication_year) || undefined,
    publicationDate: cleanText(work?.publication_date) || undefined,
    venue: cleanText(work?.primary_location?.source?.display_name) || undefined,
    abstract: decodeOpenAlexAbstract(work?.abstract_inverted_index),
    doi: normalizedDoi(work?.doi),
    url: cleanText(work?.primary_location?.landing_page_url || work?.id) || undefined,
    citationCount: Number(work?.cited_by_count) || 0,
    source: 'openalex' as const,
    publicationType: cleanText(work?.type) || undefined,
    isOpenAccess: Boolean(work?.open_access?.is_oa),
    pdfUrl: cleanText(work?.best_oa_location?.pdf_url || work?.primary_location?.pdf_url) || undefined,
    fieldsOfStudy: (work?.concepts || []).slice(0, 8).map((concept: any) => cleanText(concept?.display_name)).filter(Boolean),
  })).filter((item: LiteratureSearchResult) => item.title);
}

async function searchPubmed(query: string, options: LiteratureSearchOptions): Promise<LiteratureSearchResult[]> {
  let term = query;
  if (options.yearFrom || options.yearTo) term += ` AND ${options.yearFrom || 1800}:${options.yearTo || 3000}[dp]`;
  const common = new URLSearchParams({ db: 'pubmed', retmode: 'json', retmax: String(Math.min(options.limit || 20, 100)), term });
  if (process.env.NCBI_API_KEY) common.set('api_key', process.env.NCBI_API_KEY);
  const search = await fetchJson(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${common}`);
  const ids: string[] = search?.esearchresult?.idlist || [];
  if (!ids.length) return [];
  const params = new URLSearchParams({ db: 'pubmed', retmode: 'xml', id: ids.join(',') });
  if (process.env.NCBI_API_KEY) params.set('api_key', process.env.NCBI_API_KEY);
  const response = await fetchWithTimeout(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?${params}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const xml = await response.text();
  return Array.from(xml.matchAll(/<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g)).map(match => {
    const article = match[1];
    const text = (pattern: RegExp) => decodeXml(article.match(pattern)?.[1] || '');
    const pmid = text(/<PMID[^>]*>([^<]+)<\/PMID>/);
    const doi = text(/<ArticleId IdType="doi">([^<]+)<\/ArticleId>/);
    const authors = Array.from(article.matchAll(/<Author[^>]*>[\s\S]*?<LastName>([^<]+)<\/LastName>[\s\S]*?(?:<ForeName>([^<]+)<\/ForeName>)?[\s\S]*?<\/Author>/g))
      .map(author => cleanText(`${decodeXml(author[2] || '')} ${decodeXml(author[1] || '')}`)).filter(Boolean);
    return {
      id: '',
      title: text(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/),
      authors,
      year: finiteYear(text(/<PubDate>([\s\S]*?)<\/PubDate>/)),
      venue: text(/<Journal>[\s\S]*?<Title>([^<]+)<\/Title>/) || undefined,
      abstract: text(/<Abstract>([\s\S]*?)<\/Abstract>/) || undefined,
      doi: normalizedDoi(doi),
      url: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : undefined,
      source: 'pubmed' as const,
      publicationType: 'journal-article',
    };
  }).filter((item: LiteratureSearchResult) => item.title);
}

async function searchArxiv(query: string, options: LiteratureSearchOptions): Promise<LiteratureSearchResult[]> {
  const params = new URLSearchParams({ search_query: `all:${query}`, start: '0', max_results: String(Math.min(options.limit || 20, 50)), sortBy: 'relevance', sortOrder: 'descending' });
  const response = await fetchWithTimeout(`https://export.arxiv.org/api/query?${params}`, { headers: { 'User-Agent': 'PatentNest/1.0' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const xml = await response.text();
  return Array.from(xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)).map(match => {
    const entry = match[1];
    const text = (pattern: RegExp) => decodeXml(entry.match(pattern)?.[1] || '');
    const url = text(/<id>([^<]+)<\/id>/);
    const year = finiteYear(text(/<published>([^<]+)<\/published>/));
    const authors = Array.from(entry.matchAll(/<author>[\s\S]*?<name>([^<]+)<\/name>[\s\S]*?<\/author>/g)).map(author => decodeXml(author[1])).filter(Boolean);
    return {
      id: '',
      title: text(/<title>([\s\S]*?)<\/title>/),
      authors,
      year,
      publicationDate: text(/<published>([^<]+)<\/published>/) || undefined,
      venue: 'arXiv',
      abstract: text(/<summary>([\s\S]*?)<\/summary>/) || undefined,
      doi: normalizedDoi(text(/<arxiv:doi[^>]*>([^<]+)<\/arxiv:doi>/)),
      url: url || undefined,
      source: 'arxiv' as const,
      publicationType: 'preprint',
      isOpenAccess: true,
      pdfUrl: url ? url.replace('/abs/', '/pdf/') : undefined,
    };
  }).filter((item: LiteratureSearchResult) => item.title && (!options.yearFrom || !item.year || item.year >= options.yearFrom) && (!options.yearTo || !item.year || item.year <= options.yearTo));
}

async function searchCore(query: string, options: LiteratureSearchOptions): Promise<LiteratureSearchResult[]> {
  if (!process.env.CORE_API_KEY) return [];
  const data = await fetchJson('https://api.core.ac.uk/v3/search/works', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.CORE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, limit: Math.min(options.limit || 20, 100), offset: 0 }),
  });
  return (data?.results || []).map((work: any) => ({
    id: '',
    title: cleanText(work?.title),
    authors: (work?.authors || []).map((author: any) => cleanText(author?.name || author)).filter(Boolean),
    year: Number(work?.yearPublished) || undefined,
    publicationDate: cleanText(work?.datePublished) || undefined,
    venue: cleanText(work?.publisher || work?.journals?.[0]?.title) || undefined,
    abstract: cleanText(work?.abstract) || undefined,
    doi: normalizedDoi(work?.doi),
    url: cleanText(work?.downloadUrl || work?.sourceFulltextUrls?.[0] || (work?.doi ? `https://doi.org/${work.doi}` : '')) || undefined,
    citationCount: Number(work?.citationCount) || 0,
    source: 'core' as const,
    isOpenAccess: true,
    pdfUrl: cleanText(work?.downloadUrl || work?.sourceFulltextUrls?.[0]) || undefined,
  })).filter((item: LiteratureSearchResult) => item.title);
}

const SEARCHERS: Record<LiteratureSourceId, (query: string, options: LiteratureSearchOptions) => Promise<LiteratureSearchResult[]>> = {
  google_scholar: searchGoogleScholar,
  semantic_scholar: searchSemanticScholar,
  crossref: searchCrossref,
  openalex: searchOpenAlex,
  pubmed: searchPubmed,
  arxiv: searchArxiv,
  core: searchCore,
};

function normalizeSourceIds(sources: string[] | undefined): LiteratureSourceId[] {
  const requested = sources?.length ? sources : DEFAULT_SOURCES;
  return Array.from(new Set(requested.filter((source): source is LiteratureSourceId => (LITERATURE_SOURCE_IDS as readonly string[]).includes(source))));
}

function localFilter(result: LiteratureSearchResult, options: LiteratureSearchOptions): boolean {
  if (options.yearFrom && result.year && result.year < options.yearFrom) return false;
  if (options.yearTo && result.year && result.year > options.yearTo) return false;
  if (options.openAccessOnly && !result.isOpenAccess && !result.pdfUrl) return false;
  if (options.minCitations && (result.citationCount || 0) < options.minCitations) return false;
  if (options.hasAbstract && !cleanText(result.abstract)) return false;
  if (options.publicationTypes?.length && result.publicationType && !options.publicationTypes.includes(result.publicationType)) return false;
  if (options.fieldsOfStudy?.length && result.fieldsOfStudy?.length) {
    const fields = result.fieldsOfStudy.join(' ').toLowerCase();
    if (!options.fieldsOfStudy.some(field => fields.includes(field.replace(/-/g, ' ').toLowerCase()))) return false;
  }
  return true;
}

function relevance(query: string, result: LiteratureSearchResult): number {
  const tokens = Array.from(new Set(query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(token => token.length > 2))).slice(0, 18);
  if (!tokens.length) return 0.5;
  const title = result.title.toLowerCase();
  const abstract = (result.abstract || '').toLowerCase();
  let score = 0;
  tokens.forEach(token => { score += title.includes(token) ? 3 : abstract.includes(token) ? 1 : 0; });
  const lexical = Math.min(1, score / Math.max(4, tokens.length * 2));
  const citation = Math.min(0.12, Math.log10((result.citationCount || 0) + 1) * 0.03);
  return Math.min(1, lexical * 0.88 + citation);
}

function deduplicate(results: LiteratureSearchResult[]): LiteratureSearchResult[] {
  const byKey = new Map<string, LiteratureSearchResult>();
  for (const item of results) {
    const key = normalizedDoi(item.doi)?.toLowerCase() || `${item.title.toLowerCase().replace(/[^a-z0-9]/g, '')}|${item.year || ''}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...item, sourceProviders: [item.source] });
      continue;
    }
    byKey.set(key, {
      ...existing,
      authors: existing.authors.length ? existing.authors : item.authors,
      abstract: existing.abstract || item.abstract,
      doi: existing.doi || item.doi,
      url: existing.url || item.url,
      venue: existing.venue || item.venue,
      citationCount: Math.max(existing.citationCount || 0, item.citationCount || 0),
      isOpenAccess: existing.isOpenAccess || item.isOpenAccess,
      pdfUrl: existing.pdfUrl || item.pdfUrl,
      sourceProviders: Array.from(new Set([...(existing.sourceProviders || [existing.source]), item.source])),
    });
  }
  return Array.from(byKey.values());
}

export function normalizeLiteratureCandidate(result: LiteratureSearchResult): any {
  const referenceId = stablePaperId(result);
  const sourceProviders = result.sourceProviders || [result.source];
  return {
    id: referenceId,
    pn: referenceId,
    publicationNumber: referenceId,
    publication_number: referenceId,
    referenceId,
    referenceType: 'paper',
    title: result.title,
    abstract: result.abstract || '',
    snippet: result.abstract || '',
    authors: result.authors,
    year: result.year,
    publicationDate: result.publicationDate || (result.year ? String(result.year) : undefined),
    venue: result.venue,
    doi: result.doi,
    link: result.url,
    sourceUrl: result.url,
    pdfUrl: result.pdfUrl,
    citationCount: result.citationCount,
    publicationType: result.publicationType,
    isOpenAccess: result.isOpenAccess,
    fieldsOfStudy: result.fieldsOfStudy,
    sourceProvider: result.source,
    sourceProviders,
    sourceLabel: sourceProviders.map(source => SOURCE_LABELS[source]).join(', '),
    relevanceScore: result.relevanceScore || 0,
    retrievalScore: result.relevanceScore || 0,
  };
}

export class LiteratureSearchService {
  async search(query: string, options: LiteratureSearchOptions = {}): Promise<LiteratureSearchResponse> {
    const sources = normalizeSourceIds(options.sources);
    const limit = Math.max(1, Math.min(100, Number(options.limit) || Number(process.env.SEARCH_RESULTS_LIMIT) || 20));
    const providerStats: LiteratureProviderStat[] = [];
    const warnings: string[] = [];
    const settled = await Promise.all(sources.map(async source => {
      const enabled = sourceEnabled(source);
      if (!enabled) {
        providerStats.push({ providerId: source, enabled: false, resultCount: 0, error: `${SOURCE_LABELS[source]} is not configured.` });
        warnings.push(`${SOURCE_LABELS[source]} was skipped because its API key is not configured.`);
        return [];
      }
      try {
        const results = await SEARCHERS[source](query, { ...options, limit });
        providerStats.push({ providerId: source, enabled: true, resultCount: results.length });
        return results;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        providerStats.push({ providerId: source, enabled: true, resultCount: 0, error: message });
        warnings.push(`${SOURCE_LABELS[source]} search failed: ${message}`);
        return [];
      }
    }));
    const results = deduplicate(settled.flat())
      .filter(item => localFilter(item, options))
      .map(item => ({ ...item, id: stablePaperId(item), relevanceScore: relevance(query, item) }))
      .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0) || (b.citationCount || 0) - (a.citationCount || 0))
      .slice(0, limit);
    return { results, totalFound: results.length, sources, providerStats, warnings };
  }
}

export const literatureSearchService = new LiteratureSearchService();
