// Content derivation for blog posts: slugs, reading time, heading anchors and
// the table of contents.
//
// Body HTML is stored exactly as the composer produced it, so anchors are added
// at RENDER time rather than on save. That keeps the stored document editable
// (no injected ids to trip over on the next edit) and means changing the anchor
// scheme never requires a data migration. The regex pass is safe here because
// the only writers are our own TipTap editor and the seed script — not arbitrary
// user HTML.

import type { HeadingNode } from './types'

const WORDS_PER_MINUTE = 225

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '')
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#8217;|&rsquo;/g, '’')
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

export function countWords(htmlOrText: string): number {
  const text = htmlOrText.includes('<') ? stripHtml(htmlOrText) : htmlOrText
  if (!text) return 0
  return text.split(/\s+/).filter(Boolean).length
}

export function readingMinutes(htmlOrText: string): number {
  return Math.max(1, Math.round(countWords(htmlOrText) / WORDS_PER_MINUTE))
}

/**
 * Extract h2/h3 headings and give each a stable, unique id. Both the TOC and
 * the anchored body call this so their ids can never drift apart.
 */
export function extractHeadings(html: string): HeadingNode[] {
  const headings: HeadingNode[] = []
  const seen = new Map<string, number>()
  const re = /<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/gi
  let match: RegExpExecArray | null

  while ((match = re.exec(html)) !== null) {
    const level = Number(match[1]) as 2 | 3
    const text = stripHtml(match[2])
    if (!text) continue
    const base = slugify(text) || `section-${headings.length + 1}`
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    headings.push({ id: count === 0 ? base : `${base}-${count + 1}`, text, level })
  }
  return headings
}

/** The same pass as extractHeadings, but rewriting the tags with their ids. */
export function withHeadingAnchors(html: string): string {
  const ids = extractHeadings(html).map((h) => h.id)
  let i = 0
  return html.replace(/<h([23])\b([^>]*)>([\s\S]*?)<\/h\1>/gi, (full, level, attrs, inner) => {
    if (!stripHtml(inner)) return full
    const id = ids[i++]
    if (!id) return full
    const cleaned = String(attrs).replace(/\sid="[^"]*"/gi, '')
    return `<h${level}${cleaned} id="${id}">${inner}</h${level}>`
  })
}

/** First N characters of body text, cut on a word boundary. */
export function excerptFrom(html: string, maxChars = 180): string {
  const text = stripHtml(html)
  if (text.length <= maxChars) return text
  const cut = text.slice(0, maxChars)
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`
}

/** "27 July 2026" — one date format across every editorial surface. */
export function formatPostDate(value: Date | string | null | undefined): string {
  if (!value) return ''
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Escape for embedding text in HTML/XML we build by hand (RSS, JSON-LD alt text). */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
