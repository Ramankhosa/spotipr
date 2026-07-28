// /blog/[slug] — the article.
//
// Reading order is the whole design: headline → the short answer → takeaways →
// the argument → follow-up questions → who wrote it → what to do next. A reader
// who only wants the number gets it in the first screen; a reader who needs the
// reasoning scrolls. The same order is what an answer engine walks, which is why
// the direct answer and the FAQ are structured fields rather than prose buried
// in the body.

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import ArticleBody from '@/components/blog/ArticleBody'
import FaqSection from '@/components/blog/FaqSection'
import PostCard, { JurisdictionChips } from '@/components/blog/PostCard'
import ReadingProgress from '@/components/blog/ReadingProgress'
import ShareLinks from '@/components/blog/ShareLinks'
import TableOfContents from '@/components/blog/TableOfContents'
import BlogCta, { LegalNote, type CtaVariant } from '@/components/blog/BlogCta'
import { AnswerBox, KeyTakeaways } from '@/components/blog/AnswerBlocks'
import { AuthorByline, AuthorCard } from '@/components/blog/AuthorCard'
import { extractHeadings } from '@/lib/blog/content'
import { getPostBySlug, getRelatedPosts } from '@/lib/blog/queries'
import { parseFaqs } from '@/lib/blog/types'
import {
  absoluteUrl,
  articleSchema,
  breadcrumbSchema,
  faqSchema,
  jsonLdGraph,
  organizationSchema,
} from '@/lib/blog/site'

export const revalidate = 300

// Which offer closes the article. Read the category first, then fall back to a
// tag, so a post can override its hub's default without a new field.
const CTA_BY_CATEGORY: Record<string, CtaVariant> = {
  'prior-art-search': 'search',
  'drafting-and-claims': 'draft',
  'office-actions': 'office',
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const post = await getPostBySlug(params.slug)
  if (!post) return { title: 'Article not found' }

  const description = post.seoDescription || post.answerSummary || post.excerpt
  const url = post.canonicalUrl || absoluteUrl(`/blog/${post.slug}`)

  return {
    title: post.seoTitle || post.title,
    description,
    keywords: [post.focusKeyword, ...post.secondaryKeywords].filter(Boolean) as string[],
    alternates: { canonical: url },
    robots: post.noindex ? { index: false, follow: true } : undefined,
    authors: [{ name: post.author.name, url: absoluteUrl(`/blog/authors/${post.author.slug}`) }],
    openGraph: {
      type: 'article',
      title: post.seoTitle || post.title,
      description,
      url,
      publishedTime: post.publishedAt?.toISOString(),
      modifiedTime: post.updatedAt.toISOString(),
      authors: [post.author.name],
      section: post.category.name,
      tags: post.tags,
      images: post.ogImageUrl || post.heroImageUrl
        ? [{ url: absoluteUrl((post.ogImageUrl || post.heroImageUrl) as string) }]
        : undefined,
    },
    twitter: {
      card: post.ogImageUrl || post.heroImageUrl ? 'summary_large_image' : 'summary',
      title: post.seoTitle || post.title,
      description,
    },
  }
}

export default async function ArticlePage({ params }: { params: { slug: string } }) {
  const post = await getPostBySlug(params.slug)
  if (!post) notFound()

  const headings = extractHeadings(post.content)
  const faqs = parseFaqs(post.faqs)
  const related = await getRelatedPosts(post)
  const url = absoluteUrl(`/blog/${post.slug}`)
  const ctaVariant: CtaVariant =
    CTA_BY_CATEGORY[post.category.slug] ??
    (post.tags.includes('office-actions') ? 'office' : 'general')

  const schema = jsonLdGraph([
    organizationSchema(),
    articleSchema({
      title: post.seoTitle || post.title,
      description: post.seoDescription || post.answerSummary || post.excerpt,
      slug: post.slug,
      publishedAt: post.publishedAt,
      updatedAt: post.updatedAt,
      wordCount: post.wordCount,
      keywords: [post.focusKeyword, ...post.secondaryKeywords, ...post.tags].filter(Boolean) as string[],
      sections: [post.category.name],
      imageUrl: post.ogImageUrl || post.heroImageUrl,
      author: {
        name: post.author.name,
        slug: post.author.slug,
        title: post.author.title,
        url: post.author.linkedinUrl,
      },
      reviewer: post.reviewer ? { name: post.reviewer.name, slug: post.reviewer.slug } : null,
    }),
    faqs.length ? faqSchema(faqs) : null,
    breadcrumbSchema([
      { name: 'Home', url: '/' },
      { name: 'Journal', url: '/blog' },
      { name: post.category.name, url: `/blog/category/${post.category.slug}` },
      { name: post.title, url: `/blog/${post.slug}` },
    ]),
  ])

  return (
    <>
      <ReadingProgress />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema }} />

      <article className="pb-16 pt-28 sm:pt-32">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          {/* Breadcrumbs — visible, and mirrored in BreadcrumbList JSON-LD */}
          <nav aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-1 font-mono text-[10px] uppercase tracking-[0.15em] text-ai-graphite-400">
              <li>
                <Link href="/blog" className="hover:text-lamp-700">Journal</Link>
              </li>
              <li aria-hidden><ChevronRight className="h-3 w-3" /></li>
              <li>
                <Link href={`/blog/category/${post.category.slug}`} className="hover:text-lamp-700">
                  {post.category.name}
                </Link>
              </li>
            </ol>
          </nav>

          <div className="mt-8 grid gap-12 lg:grid-cols-[minmax(0,1fr)_220px] lg:gap-16">
            {/* --- Column 1: the article ------------------------------------ */}
            <div className="min-w-0">
              <header className="max-w-[68ch]">
                <h1 className="text-3xl font-semibold leading-[1.12] tracking-tight text-ai-graphite-900 sm:text-[2.75rem]">
                  {post.title}
                </h1>
                {post.subtitle && (
                  <p className="mt-5 text-lg leading-relaxed text-ai-graphite-600">{post.subtitle}</p>
                )}

                <div className="mt-7 flex flex-wrap items-center justify-between gap-4 border-y border-ai-graphite-900/10 py-5">
                  <AuthorByline
                    author={post.author}
                    reviewer={post.reviewer}
                    publishedAt={post.publishedAt}
                    updatedAt={post.updatedAt}
                    readingMinutes={post.readingMinutes}
                  />
                  <JurisdictionChips codes={post.jurisdictions} />
                </div>
              </header>

              <div className="max-w-[68ch]">
                {post.answerSummary && <AnswerBox>{post.answerSummary}</AnswerBox>}
                <KeyTakeaways items={post.keyTakeaways} />

                {post.heroImageUrl && (
                  <figure className="mt-10">
                    {/* eslint-disable-next-line @next/next/no-img-element -- editorial
                        imagery is uploaded to arbitrary paths; no loader config needed. */}
                    <img
                      src={post.heroImageUrl}
                      alt={post.heroImageAlt || ''}
                      className="w-full rounded-xl border border-ai-graphite-900/10"
                    />
                    {post.heroImageAlt && (
                      <figcaption className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-ai-graphite-400">
                        {post.heroImageAlt}
                      </figcaption>
                    )}
                  </figure>
                )}

                <ArticleBody html={post.content} />
                <FaqSection faqs={faqs} />
                <LegalNote />
                <AuthorCard author={post.author} />
                <BlogCta variant={ctaVariant} />
              </div>
            </div>

            {/* --- Column 2: the rail --------------------------------------- */}
            <aside className="hidden lg:block">
              <div className="sticky top-24 space-y-8">
                <TableOfContents headings={headings} />
                <div className="border-t border-ai-graphite-900/10 pt-6">
                  <ShareLinks url={url} title={post.title} />
                </div>
                {post.tags.length > 0 && (
                  <div className="border-t border-ai-graphite-900/10 pt-6">
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ai-graphite-400">
                      Filed under
                    </p>
                    <ul className="mt-3 flex flex-wrap gap-1.5">
                      {post.tags.map((tag) => (
                        <li
                          key={tag}
                          className="rounded border border-ai-graphite-900/10 bg-white px-2 py-1 text-[11px] text-ai-graphite-500"
                        >
                          {tag}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </aside>
          </div>

          {/* Related */}
          {related.length > 0 && (
            <section className="mt-20 border-t border-ai-graphite-900/10 pt-12">
              <h2 className="font-mono text-[10px] uppercase tracking-[0.25em] text-ai-graphite-400">
                Keep reading
              </h2>
              <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {related.map((item) => (
                  <PostCard key={item.id} post={item} />
                ))}
              </div>
            </section>
          )}
        </div>
      </article>
    </>
  )
}
