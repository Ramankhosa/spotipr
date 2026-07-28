// RSS 2.0 feed for the journal.
//
// Still worth having in 2026: practitioners read IP news in feed readers, and
// aggregators and newsletter tools ingest RSS, which is a cheap distribution
// channel that doesn't depend on an algorithm. The description carries the
// article's direct answer, so even a feed-only reader gets the substance.

import { listPublishedIndex } from '@/lib/blog/queries'
import { escapeXml } from '@/lib/blog/content'
import { BLOG_NAME, BLOG_TAGLINE, SITE_URL, absoluteUrl } from '@/lib/blog/site'

export const revalidate = 900

export async function GET() {
  const posts = await listPublishedIndex()
  const updated = posts[0]?.publishedAt ?? new Date()

  const items = posts
    .map((post) => {
      const url = absoluteUrl(`/blog/${post.slug}`)
      return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${post.publishedAt?.toUTCString()}</pubDate>
      <category>${escapeXml(post.category.name)}</category>
      <dc:creator>${escapeXml(post.author.name)}</dc:creator>
      <description>${escapeXml(post.answerSummary || post.excerpt)}</description>
    </item>`
    })
    .join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeXml(BLOG_NAME)}</title>
    <link>${SITE_URL}/blog</link>
    <description>${escapeXml(BLOG_TAGLINE)}</description>
    <language>en</language>
    <lastBuildDate>${updated.toUTCString()}</lastBuildDate>
    <atom:link href="${SITE_URL}/blog/rss.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=900, s-maxage=900',
    },
  })
}
