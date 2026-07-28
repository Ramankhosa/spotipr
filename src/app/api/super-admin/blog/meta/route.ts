// GET /api/super-admin/blog/meta — the selects the composer needs: categories,
// bylines, and the slugs available for the "related articles" picker.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireBlogAdmin } from '@/lib/blog/admin-guard'

export async function GET(request: NextRequest) {
  const guard = await requireBlogAdmin(request)
  if (guard.response) return guard.response

  const [categories, authors, posts] = await Promise.all([
    prisma.blogCategory.findMany({
      select: { id: true, name: true, slug: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    prisma.blogAuthor.findMany({
      where: { isActive: true },
      select: { id: true, name: true, title: true, slug: true },
      orderBy: { name: 'asc' },
    }),
    prisma.blogPost.findMany({
      select: { slug: true, title: true, status: true },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    }),
  ])

  return NextResponse.json({ categories, authors, posts, canWrite: guard.actor.canWrite })
}
