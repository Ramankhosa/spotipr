import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { patentImportFileStoredFileExists } from '@/lib/patent-corpus-service'

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

  const fileIds = (batch.files || []).map((file: any) => file.id)
  const embeddingRows = fileIds.length
    ? await prisma.$queryRaw<any[]>`
        SELECT p."sourceImportFileId" AS "fileId", e."status", COUNT(*)::int AS "count"
        FROM "local_patents" p
        JOIN "local_patent_embeddings" e ON e."localPatentId" = p."id"
        WHERE p."sourceImportFileId" IN (${Prisma.join(fileIds)})
        GROUP BY p."sourceImportFileId", e."status"
      `
    : []
  const embeddingCountsByFile = new Map<string, Record<string, number>>()
  for (const row of embeddingRows) {
    const current = embeddingCountsByFile.get(row.fileId) || {}
    current[row.status] = Number(row.count || 0)
    embeddingCountsByFile.set(row.fileId, current)
  }
  batch.files = await Promise.all((batch.files || []).map(async (file: any) => ({
    ...file,
    embeddingCounts: embeddingCountsByFile.get(file.id) || {},
    storedFileExists: await patentImportFileStoredFileExists(file),
  })))

  const embeddings = await (prisma as any).localPatentEmbedding.groupBy({
    by: ['status'],
    _count: { id: true },
  }).catch(() => [])

  return NextResponse.json({ batch, embeddings })
}
