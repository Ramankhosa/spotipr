// /blog/category/[slug] — a topic hub.
//
// Each hub is the landing page for one head term in the pillar/cluster map, so
// it carries its own title, description and intro copy rather than being a bare
// filtered list. That is the difference between a page that ranks and a page
// that just exists.

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import PostCard from '@/components/blog/PostCard'
import CategoryNav from '@/components/blog/CategoryNav'
import { getCategoryBySlug, listCategoriesWithCounts, listPosts } from '@/lib/blog/queries'
import { absoluteUrl, breadcrumbSchema, jsonLdGraph, organizationSchema } from '@/lib/blog/site'

export const revalidate = 300

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const category = await getCategoryBySlug(params.slug)
  if (!category) return { title: 'Topic not found' }

  return {
    title: category.seoTitle || `${category.name} — patent guides`,
    description: category.seoDescription || category.description || undefined,
    alternates: { canonical: absoluteUrl(`/blog/category/${category.slug}`) },
    openGraph: {
      type: 'website',
      title: category.seoTitle || category.name,
      description: category.seoDescription || category.description || undefined,
      url: absoluteUrl(`/blog/category/${category.slug}`),
    },
  }
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: { slug: string }
  searchParams: { page?: string }
}) {
  const category = await getCategoryBySlug(params.slug)
  if (!category) notFound()

  const page = Math.max(1, Number(searchParams.page) || 1)
  const [{ posts, total, pageCount }, categories] = await Promise.all([
    listPosts({ page, categorySlug: category.slug }),
    listCategoriesWithCounts(),
  ])

  const schema = jsonLdGraph([
    organizationSchema(),
    {
      '@type': 'CollectionPage',
      name: category.name,
      description: category.description || undefined,
      url: absoluteUrl(`/blog/category/${category.slug}`),
      isPartOf: { '@id': `${absoluteUrl('/blog')}#blog` },
    },
    breadcrumbSchema([
      { name: 'Home', url: '/' },
      { name: 'Journal', url: '/blog' },
      { name: category.name, url: `/blog/category/${category.slug}` },
    ]),
  ])

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema }} />

      <section className="border-b border-ai-graphite-900/10 pb-12 pt-28 sm:pt-32">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ai-graphite-400">
            <Link href="/blog" className="hover:text-lamp-700">Journal</Link> · Topic
          </p>
          <h1 className="mt-6 max-w-3xl text-4xl font-medium leading-[1.1] tracking-tight text-ai-graphite-900 sm:text-[2.75rem]">
            {category.name}
          </h1>
          {category.description && (
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ai-graphite-600">
              {category.description}
            </p>
          )}
          <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.2em] text-ai-graphite-400">
            {total} {total === 1 ? 'article' : 'articles'}
          </p>
          <div className="mt-9">
            <CategoryNav categories={categories} activeSlug={category.slug} />
          </div>
        </div>
      </section>

      <section className="py-12 sm:py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>

          {pageCount > 1 && (
            <nav
              aria-label="Pagination"
              className="mt-12 flex items-center justify-between border-t border-ai-graphite-900/10 pt-6"
            >
              {page > 1 ? (
                <Link
                  href={page === 2 ? `/blog/category/${category.slug}` : `/blog/category/${category.slug}?page=${page - 1}`}
                  rel="prev"
                  className="text-sm font-medium text-ai-graphite-600 hover:text-lamp-700"
                >
                  ← Newer
                </Link>
              ) : (
                <span />
              )}
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ai-graphite-400">
                Page {page} of {pageCount}
              </span>
              {page < pageCount ? (
                <Link
                  href={`/blog/category/${category.slug}?page=${page + 1}`}
                  rel="next"
                  className="text-sm font-medium text-ai-graphite-600 hover:text-lamp-700"
                >
                  Older →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </div>
      </section>
    </>
  )
}
