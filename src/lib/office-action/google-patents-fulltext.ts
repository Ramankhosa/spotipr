/**
 * Office Action Studio — free full-text fetch from the Google Patents page
 *
 * The Google Patents patent page (patents.google.com/patent/<pub>/en) is
 * server-rendered with the title, abstract, claims and description in the HTML.
 * We construct the URL deterministically from the publication number and parse
 * the page — a FREE path used before any paid retrieval. It is best-effort: if
 * the page is blocked, rate-limited, or its markup changes, this returns null
 * and the resolver falls through to the paid last-resort tier.
 *
 * Naming here is neutral on purpose — nothing about the retrieval source ever
 * reaches the attorney (see citation-resolver's toAttorneyView).
 */

const ENABLED = process.env.GOOGLE_PATENTS_PAGE_FETCH !== 'false' // default on
const TIMEOUT_MS = Number(process.env.GOOGLE_PATENTS_PAGE_TIMEOUT_MS) || 15_000
const UA = 'Mozilla/5.0 (compatible; OfficeActionStudio/1.0)'

export interface FetchedFullText {
  publicationNumber: string
  title?: string
  abstract?: string
  claims?: string
  description?: string
  complete: boolean
}

export function googlePatentsPageFetchEnabled(): boolean { return ENABLED }

/** patents.google.com uses a bare, uppercase publication number with no spaces. */
export function googlePatentsUrl(pub: string): string {
  const clean = (pub || '').toUpperCase().replace(/\s+/g, '')
  return `https://patents.google.com/patent/${encodeURIComponent(clean)}/en`
}

function decodeEntities(s: string): string {
  return (s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<\/(p|div|li|section|br|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim()
}

function metaContent(html: string, name: string): string | undefined {
  const re = new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']*)["']`, 'i')
  const m = re.exec(html)
  return m ? decodeEntities(m[1]).trim() : undefined
}

function sectionByItemprop(html: string, prop: string): string | undefined {
  const re = new RegExp(`<section[^>]+itemprop=["']${prop}["'][^>]*>([\\s\\S]*?)<\\/section>`, 'i')
  const m = re.exec(html)
  const text = m ? stripTags(m[1]) : undefined
  return text && text.length > 20 ? text : undefined
}

/** Parse a Google Patents page HTML into structured full text (best-effort). */
export function parseGooglePatentsHtml(html: string, pub: string): FetchedFullText {
  const title = metaContent(html, 'DC.title')
  const abstract = metaContent(html, 'description') || sectionByItemprop(html, 'abstract')
  const claims = sectionByItemprop(html, 'claims')
  const description = sectionByItemprop(html, 'description')
  return {
    publicationNumber: pub,
    title, abstract, claims, description,
    complete: Boolean(claims && description)
  }
}

/**
 * Fetch and parse the Google Patents page for a publication number.
 * Returns null on any failure (disabled, network, blocked, empty parse) so the
 * caller falls through to the next tier.
 */
export async function fetchGooglePatentsPage(pub: string): Promise<FetchedFullText | null> {
  if (!ENABLED || !pub) return null
  try {
    const res = await fetch(googlePatentsUrl(pub), {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store'
    })
    if (!res.ok) return null
    const html = await res.text()
    const parsed = parseGooglePatentsHtml(html, pub)
    // Require at least one substantive field, else treat as a miss.
    if (!parsed.title && !parsed.claims && !parsed.description) return null
    return parsed
  } catch (e) {
    console.warn('[OA fulltext] Google Patents page fetch failed:', e instanceof Error ? e.message : e)
    return null
  }
}
