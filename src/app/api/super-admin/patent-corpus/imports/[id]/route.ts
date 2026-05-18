import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

async function verifySuperAdmin(request: NextRequest) {
  const auth = await authenticateUser(request)
  if (!auth.user) {
    return { error: NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 }) }
  }

  const roles = auth.user.roles || []
  if (!roles.includes('SUPER_ADMIN') && !roles.includes('SUPER_ADMIN_VIEWER')) {
    return { error: NextResponse.json({ error: 'Super admin access required' }, { status: 403 }) }
  }

  return { user: auth.user }
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await verifySuperAdmin(request)
  if ('error' in auth) return auth.error

  const batch = await (prisma as any).patentImportBatch.findUnique({
    where: { id: params.id },
    include: {
      uploader: { select: { id: true, email: true, name: true } },
      files: { orderBy: { createdAt: 'asc' } },
    },
  })

  if (!batch) {
    return NextResponse.json({ error: 'Import batch not found' }, { status: 404 })
  }

  const embeddings = await (prisma as any).localPatentEmbedding.groupBy({
    by: ['status'],
    _count: { id: true },
  }).catch(() => [])

  return NextResponse.json({ batch, embeddings })
}
