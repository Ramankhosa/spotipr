import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { appendPatentImportBatchFiles, PATENT_CORPUS_MAX_PDFS_PER_BATCH } from '@/lib/patent-corpus-service'
import { getPatentCorpusRunnerState, kickPatentCorpusRunner } from '@/lib/patent-corpus-runner'

export const runtime = 'nodejs'

async function verifySuperAdmin(request: NextRequest) {
  const auth = await authenticateUser(request)
  if (!auth.user) {
    return { error: NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 }) }
  }

  if (!(auth.user.roles || []).includes('SUPER_ADMIN')) {
    return { error: NextResponse.json({ error: 'Write access required' }, { status: 403 }) }
  }

  return { user: auth.user }
}

async function uploadsFromRequest(request: NextRequest) {
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
  return uploads
}

function statusForError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/not found/i.test(message)) return 404
  if (/at most|no .*pdf|exceeds|cannot accept/i.test(message)) return 400
  return 500
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await verifySuperAdmin(request)
    if ('error' in auth) return auth.error
    const deferProcessing = request.nextUrl.searchParams.get('deferProcessing') === '1'
    const uploads = await uploadsFromRequest(request)

    if (!uploads.length) {
      return NextResponse.json({ error: 'Upload at least one PDF or ZIP file.' }, { status: 400 })
    }

    const batch = await appendPatentImportBatchFiles({
      batchId: params.id,
      uploads,
      deferProcessing,
    })
    const runner = deferProcessing ? getPatentCorpusRunnerState() : kickPatentCorpusRunner('upload-append')

    return NextResponse.json({
      batch,
      runner,
      limits: { maxPdfsPerBatch: PATENT_CORPUS_MAX_PDFS_PER_BATCH },
    }, { status: 201 })
  } catch (error) {
    console.error('[PatentCorpus] Import append failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to append PDFs to import batch.' },
      { status: statusForError(error) }
    )
  }
}
