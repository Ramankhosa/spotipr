// /blog — the journal index.
//
// Shape borrowed from what works on the best IP blogs and then tightened: one
// lead article at full width (Henry Patent Law Firm's "featured story"), a real
// topic nav that links to indexable hubs (DeepIP, Solve Intelligence), and cards
// that answer "is this for me?" with jurisdiction and reading time before the
// click. What we deliberately don't copy: infinite scroll, gated PDFs, and
// "LEARN MORE" buttons that hide the article behind a form.

import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, Rss } from 'lucide-react'
import PostCard, { JurisdictionChips } from '@/components/blog/PostCard'
import CategoryNav from '@/components/blog/CategoryNav'
import { getLeadPost, listCategoriesWithCounts, listPosts, POSTS_PER_PAGE } from '@/lib/blog/queries'
import { formatPostDate } from '@/lib/blog/content'
import {
  BLOG_NAME,
  BLOG_TAGLINE,
  absoluteUrl,
  breadcrumbSchema,
  jsonLdGraph,
  organizationSchema,
} from '@/lib/blog/site'

export const revalidate = 300

export const metadata: Metadata = {
  title: `${BLOG_NAME} — patent guidance for founders and attorneys`,
  description:
    'Plain-English answers on patent cost, timelines, prior-art search, claim drafting, software patentability and office actions — across the USPTO, EPO, India and the PCT.',
  alternates: {
    canonical: absoluteUrl('/blog'),
    types: { 'application/rss+xml': absoluteUrl('/blog/rss.xml') },
  },
  openGraph: {
    type: 'website',
    title: `${BLOG_NAME} — patent guidance for founders and attorneys`,
    description: BLOG_TAGLINE,
    url: absoluteUrl('/blog'),
  },
}

export default async function BlogIndexPage({
  searchParams,
}: {
  searchParams: { page?: string }
}) {
  const page = Math.max(1, Number(searchParams.page) || 1)
  const lead = page === 1 ? await getLeadPost() : null
  const { posts, pageCount } = await listPosts({
    page,
    excludeSlugs: lead ? [lead.slug] : [],
    take: lead ? POSTS_PER_PAGE - 1 : POSTS_PER_PAGE,
  })
  const categories = await listCategoriesWithCounts()

  const schema = jsonLdGraph([
    organizationSchema(),
    {
      '@type': 'Blog',
      '@id': `${absoluteUrl('/blog')}#blog`,
      name: BLOG_NAME,
      description: BLOG_TAGLINE,
      url: absoluteUrl('/blog'),
      publisher: { '@id': `${absoluteUrl('/')}#organization` },
    },
    breadcrumbSchema([
      { name: 'Home', url: '/' },
      { name: 'Journal', url: '/blog' },
    ]),
  ])

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema }} />

      {/* Masthead */}
      <section className="border-b border-ai-graphite-900/10 pb-12 pt-28 sm:pt-32">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4 sm:gap-6">
            <span className="h-px flex-1 bg-ai-graphite-900/15" />
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-ai-graphite-500 sm:text-[11px]">
              Published by PatentNest · Vol. 1
            </p>
            <span className="h-px flex-1 bg-ai-graphite-900/15" />
          </div>

          <h1 className="mt-9 max-w-3xl text-4xl font-medium leading-[1.08] tracking-tight text-ai-graphite-900 sm:text-5xl">
            The PatentNest Journal
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ai-graphite-600">
            {BLOG_TAGLINE} Every article states which patent office it applies to, cites the office
            itself, and is reviewed before it goes up.
          </p>

          <div className="mt-9">
            <CategoryNav categories={categories} />
          </div>
        </div>
      </section>

      {/* Lead article */}
      {lead && (
        <section className="border-b border-ai-graphite-900/10 py-12 sm:py-14">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ai-graphite-400">
              Featured
            </p>
            <Link href={`/blog/${lead.slug}`} className="group mt-6 block">
              <div className="grid gap-8 lg:grid-cols-[1.25fr_1fr] lg:gap-14">
                <div>
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-lamp-700">
                    {lead.category.name}
                  </span>
                  <h2 className="mt-4 text-3xl font-semibold leading-[1.15] tracking-tight text-ai-graphite-900 transition-colors group-hover:text-lamp-700 sm:text-4xl">
                    {lead.title}
                  </h2>
                  <p className="mt-5 max-w-2xl text-base leading-relaxed text-ai-graphite-600">
                    {lead.answerSummary || lead.excerpt}
                  </p>
                  <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[10px] uppercase tracking-[0.15em] text-ai-graphite-400">
                    <span>{lead.author.name}</span>
                    <span aria-hidden>·</span>
                    <span>{formatPostDate(lead.publishedAt)}</span>
                    <span aria-hidden>·</span>
                    <span>{lead.readingMinutes} min read</span>
                  </div>
                  <span className="mt-7 inline-flex items-center gap-2 text-sm font-medium text-lamp-700">
                    Read the article
                    <ArrowRight
                      className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </span>
                </div>

                <div className="rounded-xl border border-ai-graphite-900/10 bg-white p-6 sm:p-7">
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ai-graphite-400">
                    In this article
                  </p>
                  <p className="mt-4 text-[0.9375rem] leading-relaxed text-ai-graphite-700">
                    {lead.excerpt}
                  </p>
                  <div className="mt-6 border-t border-ai-graphite-900/[0.07] pt-4">
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ai-graphite-400">
                      Applies to
                    </p>
                    <JurisdictionChips codes={lead.jurisdictions} className="mt-3" />
                  </div>
                </div>
              </div>
            </Link>
          </div>
        </section>
      )}

      {/* Grid */}
      <section className="py-12 sm:py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          {posts.length === 0 ? (
            <p className="rounded-xl border border-dashed border-ai-graphite-900/15 bg-white/50 p-12 text-center text-sm text-ai-graphite-500">
              No articles published yet.
            </p>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {posts.map((post) => (
                <PostCard key={post.id} post={post} />
              ))}
            </div>
          )}

          {pageCount > 1 && (
            <nav
              aria-label="Pagination"
              className="mt-12 flex items-center justify-between border-t border-ai-graphite-900/10 pt-6"
            >
              {page > 1 ? (
                <Link
                  href={page === 2 ? '/blog' : `/blog?page=${page - 1}`}
                  rel="prev"
                  className="text-sm font-medium text-ai-graphite-600 hover:text-lamp-700"
                >
                  ← Newer articles
                </Link>
              ) : (
                <span />
              )}
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ai-graphite-400">
                Page {page} of {pageCount}
              </span>
              {page < pageCount ? (
                <Link
                  href={`/blog?page=${page + 1}`}
                  rel="next"
                  className="text-sm font-medium text-ai-graphite-600 hover:text-lamp-700"
                >
                  Older articles →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}

          <p className="mt-12 flex items-center justify-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ai-graphite-400">
            <Rss className="h-3 w-3" aria-hidden />
            <a href="/blog/rss.xml" className="hover:text-lamp-700">
              Subscribe by RSS
            </a>
          </p>
        </div>
      </section>
    </>
  )
}
