import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LiteratureSearchService,
  normalizeLiteratureCandidate,
  type LiteratureSearchResult,
} from './literature-search-service';

const originalSerpApiKey = process.env.SERPAPI_API_KEY;

describe('LiteratureSearchService', () => {
  beforeEach(() => {
    process.env.SERPAPI_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalSerpApiKey === undefined) delete process.env.SERPAPI_API_KEY;
    else process.env.SERPAPI_API_KEY = originalSerpApiKey;
  });

  it('creates a stable paper reference compatible with the novelty pipeline', () => {
    const paper: LiteratureSearchResult = {
      id: 'provider-id',
      title: 'A technical paper',
      authors: ['A. Author'],
      year: 2020,
      doi: '10.1000/example',
      url: 'https://doi.org/10.1000/example',
      source: 'crossref',
    };

    const first = normalizeLiteratureCandidate(paper);
    const second = normalizeLiteratureCandidate({ ...paper, id: 'different-provider-id', source: 'semantic_scholar' });

    expect(first.referenceType).toBe('paper');
    expect(first.publicationNumber).toMatch(/^PAPER:[A-F0-9]{16}$/);
    expect(second.publicationNumber).toBe(first.publicationNumber);
    expect(first.authors).toEqual(['A. Author']);
  });

  it('deduplicates the same DOI returned by Google Scholar and Crossref', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('serpapi.com')) {
        return new Response(JSON.stringify({
          organic_results: [{
            title: 'Shared Research Result',
            link: 'https://doi.org/10.1000/shared',
            snippet: 'A mechanism matching the invention.',
            publication_info: { summary: 'A. Author - Test Journal, 2021' },
            inline_links: { cited_by: { total: 12 } },
          }],
        }), { status: 200 });
      }
      if (url.includes('api.crossref.org')) {
        return new Response(JSON.stringify({
          message: { items: [{
            DOI: '10.1000/shared',
            title: ['Shared Research Result'],
            author: [{ given: 'A.', family: 'Author' }],
            published: { 'date-parts': [[2021]] },
            'container-title': ['Test Journal'],
            abstract: 'A mechanism matching the invention.',
            'is-referenced-by-count': 15,
            URL: 'https://doi.org/10.1000/shared',
          }] },
        }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }));

    const response = await new LiteratureSearchService().search('matching invention mechanism', {
      sources: ['google_scholar', 'crossref'],
      limit: 10,
    });

    expect(response.results).toHaveLength(1);
    expect(response.results[0].sourceProviders).toEqual(expect.arrayContaining(['google_scholar', 'crossref']));
    expect(response.results[0].citationCount).toBe(15);
    expect(response.providerStats).toHaveLength(2);
  });

  it('returns warnings instead of failing the full search when a provider errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 503 })));

    const response = await new LiteratureSearchService().search('technical query', {
      sources: ['crossref'],
    });

    expect(response.results).toEqual([]);
    expect(response.warnings[0]).toContain('Crossref search failed');
    expect(response.providerStats[0]).toMatchObject({ providerId: 'crossref', resultCount: 0 });
  });
});
