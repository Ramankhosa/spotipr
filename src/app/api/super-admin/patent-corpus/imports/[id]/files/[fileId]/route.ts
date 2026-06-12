import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { patentImportFileStoredFileExists, patentWhereForImportFile } from '@/lib/patent-corpus-service'

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

export async function GET(request: NextRequest, { params }: { params: { id: string; fileId: string } }) {
  const auth = await verifySuperAdmin(request)
  if ('error' in auth) return auth.error

  const { searchParams } = new URL(request.url)
  const page = Math.max(1, Number(searchParams.get('page') || '1') || 1)
  const pageSize = Math.min(Math.max(Number(searchParams.get('pageSize') || '25') || 25, 1), 100)

  const file = await (prisma as any).patentImportFile.findFirst({
    where: { id: params.fileId, batchId: params.id },
  })
  if (!file) {
    return NextResponse.json({ error: 'Import file not found.' }, { status: 404 })
  }

  const where = patentWhereForImportFile(file)
  const [total, patentIds, patents] = await Promise.all([
    (prisma as any).localPatent.count({ where }),
    (prisma as any).localPatent.findMany({ where, select: { id: true } }),
    (prisma as any).localPatent.findMany({
      where,
      orderBy: [
        { sourcePageNumber: 'asc' },
        { publicationNumber: 'asc' },
      ],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        publicationNumber: true,
        applicationNumberRaw: true,
        title: true,
        abstract: true,
        sourcePageNumber: true,
        sourcePdfName: true,
        sourceFileHash: true,
        sourceImportFileId: true,
        extractionConfidence: true,
        extractionWarnings: true,
        createdAt: true,
        updatedAt: true,
        embeddings: {
          select: {
            id: true,
            model: true,
            status: true,
            textHash: true,
            errorMessage: true,
            embeddedAt: true,
            updatedAt: true,
          },
        },
      },
    }),
  ])

  const ids = patentIds.map((patent: any) => patent.id)
  const embeddingRows = ids.length
    ? await (prisma as any).localPatentEmbedding.groupBy({
        by: ['status'],
        where: { localPatentId: { in: ids } },
        _count: { id: true },
      })
    : []
  const embeddingCounts = embeddingRows.reduce((acc: Record<string, number>, row: any) => {
    acc[row.status] = row._count?.id || 0
    return acc
  }, {})

  return NextResponse.json({
    file: {
      ...file,
      storedFileExists: await patentImportFileStoredFileExists(file),
    },
    patents,
    embeddingCounts,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  })
}
