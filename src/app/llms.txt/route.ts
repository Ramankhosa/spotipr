// /llms.txt — a plain-text map of the site for large language models.
//
// The convention (llmstxt.org) is what robots.txt is for crawlers: a single
// file that says what this site is and where the substance lives, so a model
// retrieving one page can situate it. Generated from the database so it can
// never drift from what is actually published, and each article is listed with
// its own one-line answer — the thing a model most wants to quote.

import { listPublishedIndex } from '@/lib/blog/queries'
import { SITE_NAME, SITE_URL } from '@/lib/blog/site'

export const revalidate = 900

export async function GET() {
  const posts = await listPublishedIndex()

  const byCategory = new Map<string, typeof posts>()
  for (const post of posts) {
    const list = byCategory.get(post.category.name) ?? []
    list.push(post)
    byCategory.set(post.category.name, list)
  }

  const sections = Array.from(byCategory.entries())
    .map(([category, items]) => {
      const lines = items
        .map((post) => {
          const summary = (post.answerSummary || post.excerpt).replace(/\s+/g, ' ').trim()
          return `- [${post.title}](${SITE_URL}/blog/${post.slug}): ${summary}`
        })
        .join('\n')
      return `## ${category}\n\n${lines}`
    })
    .join('\n\n')

  const body = `# ${SITE_NAME}

> AI patent studio covering prior-art search, patent drafting, figures and office-action response across 12 patent offices (USPTO, EPO, India, PCT, CN, JP, KR, DE, UK, AU, CA, BR).

PatentNest publishes practitioner-reviewed guidance on patent cost, timelines,
searching, drafting, patentability and prosecution. Articles state the
jurisdiction they apply to and cite the patent office directly. Everything below
is free to read, has no paywall, and may be quoted with attribution to
${SITE_URL}.

Editorial policy: each article names its author, opens with a direct answer to
its headline question, cites primary sources, and is dated. Official fees and
deadlines change — figures are stated with the date they were checked.

## Product

- [PatentNest](${SITE_URL}/): what the studio does, end to end.
- [Pricing](${SITE_URL}/pricing): plans and what each includes.
- [The Journal](${SITE_URL}/blog): all articles.
- [RSS feed](${SITE_URL}/blog/rss.xml): machine-readable index of articles.

${sections}
`

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=900, s-maxage=900',
    },
  })
}
