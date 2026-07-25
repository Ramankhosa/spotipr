import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { createPatentImportBatch, getPatentCorpusCoverageStats, PATENT_CORPUS_MAX_PDFS_PER_BATCH } from '@/lib/patent-corpus-service'
import { getPatentCorpusRunnerState, kickPatentCorpusRunner } from '@/lib/patent-corpus-runner'

export const runtime = 'nodejs'

async function verifySuperAdmin(request: NextRequest, write = false) {
  const auth = await authenticateUser(request)
  if (!auth.user) {
    return { error: NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 }) }
  }

  const roles = auth.user.roles || []
  const isSuperAdmin = roles.includes('SUPER_ADMIN')
  const isViewer = roles.includes('SUPER_ADMIN_VIEWER')
  if (!isSuperAdmin && !isViewer) {
    return { error: NextResponse.json({ error: 'Super admin access required' }, { status: 403 }) }
  }
  if (write && !isSuperAdmin) {
    return { error: NextResponse.json({ error: 'Write access required' }, { status: 403 }) }
  }

  return { user: auth.user }
}

export async function GET(request: NextRequest) {
  const auth = await verifySuperAdmin(request)
  if ('error' in auth) return auth.error

  const { searchParams } = new URL(request.url)
  const take = Math.min(Math.max(Number(searchParams.get('take') || '25'), 1), 100)

  const batches = await (prisma as any).patentImportBatch.findMany({
    orderBy: { createdAt: 'desc' },
    take,
    include: {
      uploader: { select: { id: true, email: true, name: true } },
      files: {
        orderBy: { createdAt: 'asc' },
        take: 5,
      },
    },
  })

  const includeCoverage = searchParams.get('includeCoverage') === '1'
  const coverage = includeCoverage
    ? await getPatentCorpusCoverageStats().catch(error => {
        console.warn('[PatentCorpus] Coverage stats skipped:', error instanceof Error ? error.message : String(error))
        return null
      })
    : null

  return NextResponse.json({
    batches,
    coverage,
    runner: getPatentCorpusRunnerState(),
    limits: { maxPdfsPerBatch: PATENT_CORPUS_MAX_PDFS_PER_BATCH },
  })
}

export async function POST(request: NextRequest) {
  try {
    const auth = await verifySuperAdmin(request, true)
    if ('error' in auth) return auth.error
    const deferProcessing = request.nextUrl.searchParams.get('deferProcessing') === '1'

    const formData = await request.formData()
    const fileValues = [
      ...formData.getAll('files'),
      ...formData.getAll('file'),
    ]

    const uploads = []
    for (const value of fileValues) {
      if (!value || typeof value === 'string' || typeof value.arrayBuffer !== 'function') continue
      const buffer = Buffer.from(await value.arrayBuffer())
      uploads.push({
        fileName: value.name,
        mimeType: value.type,
        buffer,
      })
    }

    if (!uploads.length) {
      return NextResponse.json({ error: 'Upload at least one PDF or ZIP file.' }, { status: 400 })
    }

    const batch = await createPatentImportBatch({
      uploadedBy: auth.user.id,
      uploads,
      deferProcessing,
    })
    const runner = deferProcessing ? getPatentCorpusRunnerState() : kickPatentCorpusRunner('upload')

    return NextResponse.json({
      batch,
      runner,
      limits: { maxPdfsPerBatch: PATENT_CORPUS_MAX_PDFS_PER_BATCH },
    }, { status: 201 })
  } catch (error) {
    console.error('[PatentCorpus] Import upload failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create patent import batch.' },
      { status: 500 }
    )
  }
}
