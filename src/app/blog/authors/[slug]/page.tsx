// /blog/authors/[slug] — the author page.
//
// This exists for one reason: E-E-A-T. Article JSON-LD points its Person node
// here, so "who wrote this and what makes them qualified" resolves to a real
// URL with real credentials rather than a name string. It also gives readers
// somewhere to go after an article they trusted.

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Linkedin, Globe } from 'lucide-react'
import PostCard from '@/components/blog/PostCard'
import { getAuthorBySlug, listPosts } from '@/lib/blog/queries'
import { absoluteUrl, breadcrumbSchema, jsonLdGraph, organizationSchema } from '@/lib/blog/site'

export const revalidate = 300

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const author = await getAuthorBySlug(params.slug)
  if (!author) return { title: 'Author not found' }

  return {
    title: `${author.name} — ${author.title || 'Contributor'}`,
    description: author.bio || `Articles by ${author.name} on the PatentNest Journal.`,
    alternates: { canonical: absoluteUrl(`/blog/authors/${author.slug}`) },
  }
}

export default async function AuthorPage({ params }: { params: { slug: string } }) {
  const author = await getAuthorBySlug(params.slug)
  if (!author) notFound()

  const { posts, total } = await listPosts({ authorSlug: author.slug, take: 24 })

  const schema = jsonLdGraph([
    organizationSchema(),
    {
      '@type': 'ProfilePage',
      url: absoluteUrl(`/blog/authors/${author.slug}`),
      mainEntity: {
        '@type': 'Person',
        name: author.name,
        jobTitle: author.title || undefined,
        description: author.bio || undefined,
        url: absoluteUrl(`/blog/authors/${author.slug}`),
        sameAs: [author.linkedinUrl, author.websiteUrl].filter(Boolean),
        knowsAbout: ['Patent law', 'Patent drafting', 'Prior art search', 'Patent prosecution'],
      },
    },
    breadcrumbSchema([
      { name: 'Home', url: '/' },
      { name: 'Journal', url: '/blog' },
      { name: author.name, url: `/blog/authors/${author.slug}` },
    ]),
  ])

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema }} />

      <section className="border-b border-ai-graphite-900/10 pb-12 pt-28 sm:pt-32">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ai-graphite-400">
            <Link href="/blog" className="hover:text-lamp-700">Journal</Link> · Author
          </p>

          <div className="mt-8 max-w-3xl">
            <h1 className="text-4xl font-medium tracking-tight text-ai-graphite-900">{author.name}</h1>
            {author.title && <p className="mt-2 text-lg text-ai-graphite-500">{author.title}</p>}
            {author.bio && (
              <p className="mt-6 text-base leading-relaxed text-ai-graphite-600">{author.bio}</p>
            )}

            {!!author.credentials.length && (
              <ul className="mt-6 flex flex-wrap gap-1.5">
                {author.credentials.map((credential) => (
                  <li
                    key={credential}
                    className="rounded border border-ai-graphite-900/10 bg-white px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ai-graphite-500"
                  >
                    {credential}
                  </li>
                ))}
              </ul>
            )}

            {(author.linkedinUrl || author.websiteUrl) && (
              <div className="mt-6 flex items-center gap-4 text-sm text-ai-graphite-500">
                {author.linkedinUrl && (
                  <a
                    href={author.linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 hover:text-lamp-700"
                  >
                    <Linkedin className="h-4 w-4" /> LinkedIn
                  </a>
                )}
                {author.websiteUrl && (
                  <a
                    href={author.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 hover:text-lamp-700"
                  >
                    <Globe className="h-4 w-4" /> Website
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="py-12 sm:py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ai-graphite-400">
            {total} {total === 1 ? 'article' : 'articles'}
          </p>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        </div>
      </section>
    </>
  )
}
