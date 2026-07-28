// GET  /api/super-admin/blog       — the editorial desk (list + filters)
// POST /api/super-admin/blog       — create a post
//
// Derived fields (word count, reading time, SEO score) are computed here, on
// save, from the same audit the composer shows live. Doing it server-side means
// a post created by the seed script or an API client is scored identically to
// one typed into the editor.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireBlogAdmin } from '@/lib/blog/admin-guard'
// Shared with [id]/route.ts — a route.ts may not export anything but handlers.
import { derivedFields, postInputSchema, uniqueSlug } from '@/lib/blog/post-write'

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
