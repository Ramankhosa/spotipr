// GET    /api/super-admin/blog/[id] — load one post into the composer
// PATCH  /api/super-admin/blog/[id] — save (full replace of the editable fields)
// DELETE /api/super-admin/blog/[id] — remove a post
//
// Deleting is real deletion, but the UI only offers it for drafts: a published
// URL that has been indexed and linked should be ARCHIVED, which 404s the page
// while keeping the row (and the option to restore it) intact.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireBlogAdmin } from '@/lib/blog/admin-guard'
import { derivedFields, postInputSchema, uniqueSlug } from '@/lib/blog/post-write'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireBlogAdmin(request)
  if (guard.response) return guard.response

  const post = await prisma.blogPost.findUnique({ where: { id: params.id } })
  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

  return NextResponse.json({ post, canWrite: guard.actor.canWrite })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireBlogAdmin(request, { write: true })
  if (guard.response) return guard.response

  const existing = await prisma.blogPost.findUnique({
    where: { id: params.id },
    select: { id: true, slug: true, publishedAt: true },
  })
  if (!existing) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

  const parsed = postInputSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid post', details: parsed.error.flatten() }, { status: 400 })
  }

  const input = parsed.data
  const slug =
    input.slug && input.slug !== existing.slug
      ? await uniqueSlug(input.slug, existing.id)
      : existing.slug
  const derived = derivedFields(input, existing.publishedAt)

  const post = await prisma.blogPost.update({
    where: { id: params.id },
    data: {
      ...input,
      slug,
      canonicalUrl: input.canonicalUrl || null,
      faqs: input.faqs ?? [],
      ...derived,
      updatedBy: guard.actor.email,
    },
    select: { id: true, slug: true, status: true, seoScore: true, publishedAt: true, updatedAt: true },
  })

  return NextResponse.json({ post })
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireBlogAdmin(request, { write: true })
  if (guard.response) return guard.response

  const post = await prisma.blogPost.findUnique({
    where: { id: params.id },
    select: { status: true },
  })
  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

  if (post.status === 'PUBLISHED') {
    return NextResponse.json(
      { error: 'Archive a published post instead of deleting it — the URL may already be indexed.' },
      { status: 409 }
    )
  }

  await prisma.blogPost.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
}
