import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { PATENT_CORPUS_MAX_PDFS_PER_BATCH, releasePatentImportBatchFiles } from '@/lib/patent-corpus-service'
import { kickPatentCorpusRunner } from '@/lib/patent-corpus-runner'

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

function statusForError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/not found/i.test(message)) return 404
  return 500
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await verifySuperAdmin(request)
    if ('error' in auth) return auth.error

    const batch = await releasePatentImportBatchFiles(params.id)
    const runner = kickPatentCorpusRunner('upload-finalize')

    return NextResponse.json({
      batch,
      runner,
      limits: { maxPdfsPerBatch: PATENT_CORPUS_MAX_PDFS_PER_BATCH },
    })
  } catch (error) {
    console.error('[PatentCorpus] Import finalize failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to finalize import batch.' },
      { status: statusForError(error) }
    )
  }
}
