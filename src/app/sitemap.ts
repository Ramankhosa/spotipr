// The XML sitemap, generated from the database rather than maintained by hand.
//
// Marketing pages carry static priorities; articles carry their real
// lastModified so a substantive revision is re-crawled instead of waiting for a
// routine sweep. Only content that `publicWhere()` would serve appears here —
// a sitemap listing a 404 is a crawl-budget leak.

import type { MetadataRoute } from 'next'
import { prisma } from '@/lib/prisma'
import { publicWhere } from '@/lib/blog/queries'
import { SITE_URL } from '@/lib/blog/site'

const STATIC_ROUTES: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'] }[] = [
  { path: '/', priority: 1, changeFrequency: 'weekly' },
  { path: '/pricing', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/blog', priority: 0.9, changeFrequency: 'daily' },
  { path: '/contact', priority: 0.5, changeFrequency: 'yearly' },
  { path: '/free-trial', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/developers', priority: 0.4, changeFrequency: 'monthly' },
  { path: '/terms', priority: 0.2, changeFrequency: 'yearly' },
  { path: '/privacy', priority: 0.2, changeFrequency: 'yearly' },
]

export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()
  const staticEntries = STATIC_ROUTES.map((route) => ({
    url: `${SITE_URL}${route.path}`,
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }))

  // A sitemap is not worth failing a build over: if the database is unreachable
  // (CI without a DB, or a transient outage), serve the static routes rather
  // than throwing.
  let posts: { slug: string; updatedAt: Date; featured: boolean }[] = []
  let categories: { slug: string; updatedAt: Date }[] = []
  let authors: { slug: string; updatedAt: Date }[] = []

  try {
    ;[posts, categories, authors] = await Promise.all([
      prisma.blogPost.findMany({
        where: { ...publicWhere(), noindex: false },
        select: { slug: true, updatedAt: true, featured: true },
        orderBy: { publishedAt: 'desc' },
      }),
      prisma.blogCategory.findMany({ select: { slug: true, updatedAt: true } }),
      prisma.blogAuthor.findMany({ where: { isActive: true }, select: { slug: true, updatedAt: true } }),
    ])
  } catch (error) {
    console.error('[sitemap] could not read the journal from the database:', error)
    return staticEntries
  }

  return [
    ...staticEntries,
    ...categories.map((category) => ({
      url: `${SITE_URL}/blog/category/${category.slug}`,
      lastModified: category.updatedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
    ...posts.map((post) => ({
      url: `${SITE_URL}/blog/${post.slug}`,
      lastModified: post.updatedAt,
      changeFrequency: 'monthly' as const,
      priority: post.featured ? 0.9 : 0.8,
    })),
    ...authors.map((author) => ({
      url: `${SITE_URL}/blog/authors/${author.slug}`,
      lastModified: author.updatedAt,
      changeFrequency: 'monthly' as const,
      priority: 0.4,
    })),
  ]
}
