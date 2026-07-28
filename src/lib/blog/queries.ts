// Read paths for the public blog. Server-only: the pages are React Server
// Components and talk to Postgres directly, so there is no public JSON API to
// keep in sync and no client-side fetch waterfall before the crawler sees text.
//
// One rule runs through all of it: `publicWhere()` is the ONLY definition of
// "visible". Scheduled posts become visible on their own when publishedAt
// passes — no cron, no publish job.

import { prisma } from '@/lib/prisma'

export const POSTS_PER_PAGE = 9

/** Published, and not dated into the future. Every public query starts here. */
export function publicWhere() {
  return { status: 'PUBLISHED' as const, publishedAt: { lte: new Date() } }
}

const cardSelect = {
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  answerSummary: true,
  heroImageUrl: true,
  heroImageAlt: true,
  publishedAt: true,
  readingMinutes: true,
  jurisdictions: true,
  tags: true,
  featured: true,
  category: { select: { slug: true, name: true } },
  author: { select: { name: true, slug: true, avatarUrl: true, title: true } },
} as const

export type PostCardData = Awaited<ReturnType<typeof listPosts>>['posts'][number]

export async function listPosts(options: {
  page?: number
  categorySlug?: string
  tag?: string
  authorSlug?: string
  excludeSlugs?: string[]
  take?: number
} = {}) {
  const page = Math.max(1, options.page ?? 1)
  const take = options.take ?? POSTS_PER_PAGE

  const where = {
    ...publicWhere(),
    ...(options.categorySlug ? { category: { slug: options.categorySlug } } : {}),
    ...(options.authorSlug ? { author: { slug: options.authorSlug } } : {}),
    ...(options.tag ? { tags: { has: options.tag } } : {}),
    ...(options.excludeSlugs?.length ? { slug: { notIn: options.excludeSlugs } } : {}),
  }

  const [posts, total] = await Promise.all([
    prisma.blogPost.findMany({
      where,
      select: cardSelect,
      orderBy: { publishedAt: 'desc' },
      skip: (page - 1) * take,
      take,
    }),
    prisma.blogPost.count({ where }),
  ])

  return { posts, total, page, pageCount: Math.max(1, Math.ceil(total / take)) }
}

/** The one post that headlines /blog: the newest featured, else the newest. */
export async function getLeadPost() {
  return (
    (await prisma.blogPost.findFirst({
      where: { ...publicWhere(), featured: true },
      select: cardSelect,
      orderBy: { publishedAt: 'desc' },
    })) ??
    (await prisma.blogPost.findFirst({
      where: publicWhere(),
      select: cardSelect,
      orderBy: { publishedAt: 'desc' },
    }))
  )
}

export async function getPostBySlug(slug: string) {
  return prisma.blogPost.findFirst({
    where: { slug, ...publicWhere() },
    include: {
      category: true,
      author: true,
      reviewer: true,
    },
  })
}

export type FullPost = NonNullable<Awaited<ReturnType<typeof getPostBySlug>>>

/**
 * Hand-picked related posts first (relatedSlugs, in the editor's order), topped
 * up from the same category so the rail is never half-empty.
 */
export async function getRelatedPosts(post: { slug: string; relatedSlugs: string[]; categoryId: string }, limit = 3) {
  const picked = post.relatedSlugs.length
    ? await prisma.blogPost.findMany({
        where: { ...publicWhere(), slug: { in: post.relatedSlugs } },
        select: cardSelect,
      })
    : []

  const ordered = post.relatedSlugs
    .map((slug) => picked.find((p) => p.slug === slug))
    .filter((p): p is (typeof picked)[number] => Boolean(p))

  if (ordered.length >= limit) return ordered.slice(0, limit)

  const fill = await prisma.blogPost.findMany({
    where: {
      ...publicWhere(),
      categoryId: post.categoryId,
      slug: { notIn: [post.slug, ...ordered.map((p) => p.slug)] },
    },
    select: cardSelect,
    orderBy: { publishedAt: 'desc' },
    take: limit - ordered.length,
  })

  return [...ordered, ...fill]
}

/** Categories that actually have something to show — empty hubs are thin pages. */
export async function listCategoriesWithCounts() {
  const [categories, grouped] = await Promise.all([
    prisma.blogCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.blogPost.groupBy({ by: ['categoryId'], where: publicWhere(), _count: { _all: true } }),
  ])

  const counts = new Map(grouped.map((g) => [g.categoryId, g._count._all]))
  return categories
    .map((c) => ({ ...c, postCount: counts.get(c.id) ?? 0 }))
    .filter((c) => c.postCount > 0)
}

export async function getCategoryBySlug(slug: string) {
  return prisma.blogCategory.findUnique({ where: { slug } })
}

export async function getAuthorBySlug(slug: string) {
  return prisma.blogAuthor.findUnique({ where: { slug } })
}

/** Slug + updatedAt for sitemap/RSS/llms.txt. Deliberately tiny. */
export async function listPublishedIndex() {
  return prisma.blogPost.findMany({
    where: publicWhere(),
    select: {
      slug: true,
      title: true,
      excerpt: true,
      answerSummary: true,
      publishedAt: true,
      updatedAt: true,
      category: { select: { name: true, slug: true } },
      author: { select: { name: true } },
    },
    orderBy: { publishedAt: 'desc' },
  })
}
