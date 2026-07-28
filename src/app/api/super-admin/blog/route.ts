// GET  /api/super-admin/blog       — the editorial desk (list + filters)
// POST /api/super-admin/blog       — create a post
//
// Derived fields (word count, reading time, SEO score) are computed here, on
// save, from the same audit the composer shows live. Doing it server-side means
// a post created by the seed script or an API client is scored identically to
// one typed into the editor.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireBlogAdmin } from '@/lib/blog/admin-guard'
import { auditPost } from '@/lib/blog/seo-audit'
import { countWords, readingMinutes, slugify } from '@/lib/blog/content'

const faqSchema = z.array(z.object({ question: z.string().min(1), answer: z.string().min(1) }))

export const postInputSchema = z.object({
  title: z.string().min(3).max(200),
  slug: z.string().max(120).optional(),
  subtitle: z.string().max(400).optional().nullable(),
  excerpt: z.string().min(1).max(600),
  content: z.string().min(1),
  status: z.enum(['DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED']).optional(),
  publishedAt: z.string().datetime().optional().nullable(),
  answerSummary: z.string().max(1200).optional().nullable(),
  keyTakeaways: z.array(z.string().min(1)).max(8).optional(),
  faqs: faqSchema.max(12).optional(),
  focusKeyword: z.string().max(120).optional().nullable(),
  secondaryKeywords: z.array(z.string()).max(12).optional(),
  tags: z.array(z.string()).max(12).optional(),
  jurisdictions: z.array(z.string()).max(12).optional(),
  seoTitle: z.string().max(200).optional().nullable(),
  seoDescription: z.string().max(400).optional().nullable(),
  canonicalUrl: z.string().url().optional().nullable().or(z.literal('')),
  heroImageUrl: z.string().optional().nullable(),
  heroImageAlt: z.string().max(300).optional().nullable(),
  ogImageUrl: z.string().optional().nullable(),
  noindex: z.boolean().optional(),
  featured: z.boolean().optional(),
  relatedSlugs: z.array(z.string()).max(6).optional(),
  categoryId: z.string().min(1),
  authorId: z.string().min(1),
  reviewerId: z.string().optional().nullable(),
})

export type PostInput = z.infer<typeof postInputSchema>

/**
 * Everything the database stores that isn't typed by the editor: counts, score,
 * and the publish timestamp implied by the status.
 */
export function derivedFields(input: PostInput, existingPublishedAt?: Date | null) {
  const audit = auditPost({ ...input, faqs: input.faqs })

  // PUBLISHED with no date means "now"; SCHEDULED keeps whatever future date the
  // editor picked; going back to DRAFT keeps the old date so re-publishing
  // doesn't silently reset the article's age.
  let publishedAt = input.publishedAt ? new Date(input.publishedAt) : existingPublishedAt ?? null
  if (input.status === 'PUBLISHED' && !publishedAt) publishedAt = new Date()

  return {
    wordCount: countWords(input.content),
    readingMinutes: readingMinutes(input.content),
    seoScore: audit.score,
    seoChecks: audit.checks as unknown as object,
    publishedAt,
  }
}

/** Make sure a slug is unique, appending -2, -3… like every CMS ever. */
export async function uniqueSlug(base: string, ignoreId?: string): Promise<string> {
  const root = slugify(base) || 'post'
  let candidate = root
  let suffix = 1
  // Slugs are the permanent address of an article; a collision must never
  // silently overwrite the other post.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const clash = await prisma.blogPost.findFirst({ where: { slug: candidate }, select: { id: true } })
    if (!clash || clash.id === ignoreId) return candidate
    suffix += 1
    candidate = `${root}-${suffix}`
  }
}

export async function GET(request: NextRequest) {
  const guard = await requireBlogAdmin(request)
  if (guard.response) return guard.response

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const categoryId = searchParams.get('categoryId')
  const query = searchParams.get('q')?.trim()

  const posts = await prisma.blogPost.findMany({
    where: {
      ...(status && status !== 'ALL' ? { status: status as never } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(query
        ? {
            OR: [
              { title: { contains: query, mode: 'insensitive' as const } },
              { slug: { contains: query, mode: 'insensitive' as const } },
              { focusKeyword: { contains: query, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    select: {
      id: true, slug: true, title: true, status: true, featured: true, publishedAt: true,
      updatedAt: true, wordCount: true, readingMinutes: true, seoScore: true, viewCount: true,
      focusKeyword: true, noindex: true,
      category: { select: { id: true, name: true, slug: true } },
      author: { select: { id: true, name: true } },
    },
    orderBy: [{ updatedAt: 'desc' }],
    take: 200,
  })

  const counts = await prisma.blogPost.groupBy({ by: ['status'], _count: { _all: true } })

  return NextResponse.json({
    posts,
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
    canWrite: guard.actor.canWrite,
  })
}

export async function POST(request: NextRequest) {
  const guard = await requireBlogAdmin(request, { write: true })
  if (guard.response) return guard.response

  const parsed = postInputSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid post', details: parsed.error.flatten() }, { status: 400 })
  }

  const input = parsed.data
  const slug = await uniqueSlug(input.slug || input.title)
  const derived = derivedFields(input)

  const post = await prisma.blogPost.create({
    data: {
      ...input,
      slug,
      canonicalUrl: input.canonicalUrl || null,
      faqs: input.faqs ?? [],
      ...derived,
      createdBy: guard.actor.email,
      updatedBy: guard.actor.email,
    },
    select: { id: true, slug: true, seoScore: true },
  })

  return NextResponse.json({ post }, { status: 201 })
}
