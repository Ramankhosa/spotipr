// The editorial rubric, expressed as code.
//
// Every rule here comes from the strategy in docs/BLOG_SEO_STRATEGY.md, and the
// composer runs it live on every keystroke — an author never has to remember the
// checklist, they just watch the score. Two families of rules:
//
//   SEARCH — the classic on-page signals (title, meta, slug, depth, links).
//   ANSWER — what makes a page quotable by AI Overviews / ChatGPT / Perplexity:
//            a direct answer up top, question-shaped headings, takeaways, FAQ,
//            tables and lists that survive extraction, and named sources.
//
// The score is a weighted pass ratio; a `warn` counts as half. Nothing here
// blocks publishing — it advises. Editors overrule rubrics, not the other way
// round.

import { countWords, extractHeadings, stripHtml } from './content'
import { parseFaqs, type FaqItem } from './types'

export type CheckStatus = 'pass' | 'warn' | 'fail'
export type CheckGroup = 'search' | 'answer' | 'trust'

export interface SeoCheck {
  id: string
  group: CheckGroup
  label: string
  status: CheckStatus
  /** What to do about it, in the imperative. Shown under a failing check. */
  hint: string
  weight: number
}

export interface SeoAuditResult {
  score: number
  checks: SeoCheck[]
  stats: {
    words: number
    readingMinutes: number
    titleChars: number
    metaChars: number
    answerWords: number
    h2Count: number
    questionHeadings: number
    internalLinks: number
    externalLinks: number
    keywordDensity: number
    faqCount: number
  }
}

export interface AuditablePost {
  title?: string | null
  slug?: string | null
  excerpt?: string | null
  content?: string | null
  answerSummary?: string | null
  keyTakeaways?: string[] | null
  faqs?: unknown
  focusKeyword?: string | null
  secondaryKeywords?: string[] | null
  seoTitle?: string | null
  seoDescription?: string | null
  heroImageUrl?: string | null
  heroImageAlt?: string | null
  tags?: string[] | null
  jurisdictions?: string[] | null
  categoryId?: string | null
  authorId?: string | null
  reviewerId?: string | null
}

/** Offices and registries whose pages count as primary sources. */
const AUTHORITY_DOMAINS = [
  'uspto.gov', 'wipo.int', 'epo.org', 'ipindia.gov.in', 'jpo.go.jp',
  'kipo.go.kr', 'cnipa.gov.cn', 'gov.uk', 'ipaustralia.gov.au',
  'supremecourt.gov', 'uscourts.gov', 'oecd.org', 'nature.com',
]

const QUESTION_STARTERS = /^(how|what|why|when|who|which|where|can|do|does|is|are|should|will|must)\b/i

function countMatches(haystack: string, needle: string): number {
  if (!needle) return 0
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return (haystack.match(new RegExp(`\\b${escaped}\\b`, 'gi')) || []).length
}

export function auditPost(post: AuditablePost): SeoAuditResult {
  const content = post.content ?? ''
  const bodyText = stripHtml(content)
  const words = countWords(bodyText)
  const title = (post.seoTitle || post.title || '').trim()
  const meta = (post.seoDescription || '').trim()
  const answer = (post.answerSummary || '').trim()
  const answerWords = countWords(answer)
  const keyword = (post.focusKeyword || '').trim().toLowerCase()
  const takeaways = (post.keyTakeaways || []).filter(Boolean)
  const faqs: FaqItem[] = parseFaqs(post.faqs)

  const headings = extractHeadings(content)
  const h2s = headings.filter((h) => h.level === 2)
  const questionHeadings = headings.filter((h) => QUESTION_STARTERS.test(h.text) || h.text.includes('?')).length

  const hrefs = Array.from(content.matchAll(/href="([^"]+)"/gi)).map((m) => m[1])
  const internalLinks = hrefs.filter((h) => h.startsWith('/')).length
  const externalLinks = hrefs.filter((h) => AUTHORITY_DOMAINS.some((d) => h.includes(d))).length

  const keywordHits = keyword ? countMatches(bodyText, keyword) : 0
  const keywordDensity = keyword && words ? (keywordHits / words) * 100 : 0
  const firstHundred = bodyText.split(/\s+/).slice(0, 100).join(' ').toLowerCase()

  const images = Array.from(content.matchAll(/<img\b[^>]*>/gi)).map((m) => m[0])
  const imagesMissingAlt = images.filter((tag) => !/alt="[^"]+"/i.test(tag)).length
  const hasTableOrList = /<(table|ul|ol)\b/i.test(content)

  const checks: SeoCheck[] = [
    // --- SEARCH -------------------------------------------------------------
    {
      id: 'title-length',
      group: 'search',
      label: `Title is ${title.length} characters`,
      status: title.length >= 40 && title.length <= 65 ? 'pass' : title.length >= 30 && title.length <= 72 ? 'warn' : 'fail',
      hint: 'Aim for 40–65 characters so the full headline survives the SERP truncation.',
      weight: 2,
    },
    {
      id: 'title-keyword',
      group: 'search',
      label: 'Focus keyword appears in the title',
      status: !keyword ? 'fail' : title.toLowerCase().includes(keyword) ? 'pass' : 'warn',
      hint: 'Set a focus keyword and use it in the title — ideally in the first half.',
      weight: 3,
    },
    {
      id: 'meta-description',
      group: 'search',
      label: `Meta description is ${meta.length} characters`,
      status: meta.length >= 120 && meta.length <= 165 ? 'pass' : meta.length >= 80 ? 'warn' : 'fail',
      hint: 'Write 120–165 characters that promise the answer and use the keyword once.',
      weight: 2,
    },
    {
      id: 'slug',
      group: 'search',
      label: 'Slug is short and keyword-bearing',
      status: (() => {
        const slug = (post.slug || '').trim()
        if (!slug) return 'fail'
        const segments = slug.split('-').length
        const hasKeyword = !keyword || keyword.split(/\s+/).every((w) => slug.includes(w.replace(/[^a-z0-9]/g, '')))
        return segments <= 7 && hasKeyword ? 'pass' : 'warn'
      })(),
      hint: 'Keep the slug under ~7 words and include the keyword. Never change it after publishing.',
      weight: 1,
    },
    {
      id: 'depth',
      group: 'search',
      label: `${words.toLocaleString()} words of body copy`,
      status: words >= 1200 ? 'pass' : words >= 700 ? 'warn' : 'fail',
      hint: 'Informational patent queries are won at 1,200+ words of genuinely useful copy.',
      weight: 2,
    },
    {
      id: 'structure',
      group: 'search',
      label: `${h2s.length} H2 sections`,
      status: h2s.length >= 5 ? 'pass' : h2s.length >= 3 ? 'warn' : 'fail',
      hint: 'Break the article into at least 5 H2 sections so it can be skimmed and extracted.',
      weight: 1,
    },
    {
      id: 'keyword-early',
      group: 'search',
      label: 'Keyword used in the first 100 words',
      status: !keyword ? 'fail' : firstHundred.includes(keyword) ? 'pass' : 'warn',
      hint: 'Retrieval engines weigh the opening heavily — use the exact phrase early.',
      weight: 2,
    },
    {
      id: 'keyword-density',
      group: 'search',
      label: `Keyword density ${keywordDensity.toFixed(2)}%`,
      status: keywordDensity >= 0.3 && keywordDensity <= 2.5 ? 'pass' : keywordDensity > 0 ? 'warn' : 'fail',
      hint: 'Stay between 0.3% and 2.5%. Above that reads as stuffing to both people and models.',
      weight: 1,
    },
    {
      id: 'internal-links',
      group: 'search',
      label: `${internalLinks} internal links`,
      status: internalLinks >= 3 ? 'pass' : internalLinks >= 1 ? 'warn' : 'fail',
      hint: 'Link to at least 3 sibling articles or product pages to spread authority through the cluster.',
      weight: 2,
    },

    // --- ANSWER ENGINE ------------------------------------------------------
    {
      id: 'answer-summary',
      group: 'answer',
      label: `Direct answer is ${answerWords} words`,
      status: answerWords >= 40 && answerWords <= 80 ? 'pass' : answerWords > 0 ? 'warn' : 'fail',
      hint: 'Open with 40–80 words that answer the headline outright. This is the block AI answers quote.',
      weight: 3,
    },
    {
      id: 'takeaways',
      group: 'answer',
      label: `${takeaways.length} key takeaways`,
      status: takeaways.length >= 4 ? 'pass' : takeaways.length >= 2 ? 'warn' : 'fail',
      hint: 'Give 4–6 standalone takeaways. Each should make sense lifted out of the page.',
      weight: 2,
    },
    {
      id: 'faqs',
      group: 'answer',
      label: `${faqs.length} FAQ entries`,
      status: faqs.length >= 4 ? 'pass' : faqs.length >= 2 ? 'warn' : 'fail',
      hint: 'Add 4+ real follow-up questions. They become FAQPage JSON-LD and long-tail entry points.',
      weight: 2,
    },
    {
      id: 'question-headings',
      group: 'answer',
      label: `${questionHeadings} question-shaped headings`,
      status: questionHeadings >= 3 ? 'pass' : questionHeadings >= 1 ? 'warn' : 'fail',
      hint: 'Phrase headings the way readers search: "How long does examination take?" beats "Examination".',
      weight: 2,
    },
    {
      id: 'extractable',
      group: 'answer',
      label: 'Contains a table or list',
      status: hasTableOrList ? 'pass' : 'fail',
      hint: 'Put the comparable facts — fees, deadlines, options — into a table or list. Models lift those wholesale.',
      weight: 1,
    },

    // --- TRUST --------------------------------------------------------------
    {
      id: 'sources',
      group: 'trust',
      label: `${externalLinks} links to primary sources`,
      status: externalLinks >= 2 ? 'pass' : externalLinks >= 1 ? 'warn' : 'fail',
      hint: 'Cite the office itself (USPTO, WIPO, EPO, IPO India). Citations are the strongest E-E-A-T signal you control.',
      weight: 2,
    },
    {
      id: 'byline',
      group: 'trust',
      label: 'Author and reviewer set',
      status: post.authorId && post.reviewerId ? 'pass' : post.authorId ? 'warn' : 'fail',
      hint: 'Anything that reads as legal guidance should carry a named author and a named reviewer.',
      weight: 2,
    },
    {
      id: 'imagery',
      group: 'trust',
      label: imagesMissingAlt > 0 ? `${imagesMissingAlt} images missing alt text` : 'Hero image and alt text',
      status: imagesMissingAlt > 0 ? 'fail' : post.heroImageUrl && post.heroImageAlt ? 'pass' : 'warn',
      hint: 'Every image needs descriptive alt text; a hero image also drives the social card.',
      weight: 1,
    },
    {
      id: 'taxonomy',
      group: 'trust',
      label: 'Category, tags and jurisdictions set',
      status: post.categoryId && (post.tags?.length ?? 0) >= 2 && (post.jurisdictions?.length ?? 0) >= 1 ? 'pass'
        : post.categoryId ? 'warn' : 'fail',
      hint: 'Tag the office(s) the advice applies to — patent answers are worthless without jurisdiction.',
      weight: 1,
    },
    {
      id: 'excerpt',
      group: 'trust',
      label: 'Card excerpt written',
      status: (post.excerpt || '').trim().length >= 80 ? 'pass' : (post.excerpt || '').trim().length > 0 ? 'warn' : 'fail',
      hint: 'Write a human summary for listings and social shares — not a truncated first paragraph.',
      weight: 1,
    },
  ]

  const earned = checks.reduce((sum, c) => sum + c.weight * (c.status === 'pass' ? 1 : c.status === 'warn' ? 0.5 : 0), 0)
  const total = checks.reduce((sum, c) => sum + c.weight, 0)

  return {
    score: Math.round((earned / total) * 100),
    checks,
    stats: {
      words,
      readingMinutes: Math.max(1, Math.round(words / 225)),
      titleChars: title.length,
      metaChars: meta.length,
      answerWords,
      h2Count: h2s.length,
      questionHeadings,
      internalLinks,
      externalLinks,
      keywordDensity: Number(keywordDensity.toFixed(2)),
      faqCount: faqs.length,
    },
  }
}

/** Band used for the score dial in the composer and the list view. */
export function scoreBand(score: number): { label: string; tone: 'good' | 'ok' | 'poor' } {
  if (score >= 85) return { label: 'Ready to publish', tone: 'good' }
  if (score >= 65) return { label: 'Needs a pass', tone: 'ok' }
  return { label: 'Not ready', tone: 'poor' }
}
