import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { retryPatentImportFileExtraction } from '@/lib/patent-corpus-service'
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

export async function POST(request: NextRequest, { params }: { params: { id: string; fileId: string } }) {
  try {
    const auth = await verifySuperAdmin(request)
    if ('error' in auth) return auth.error

    const file = await retryPatentImportFileExtraction(params.id, params.fileId)
    const runner = kickPatentCorpusRunner('file-retry')
    return NextResponse.json({ file, runner })
  } catch (error) {
    console.error('[PatentCorpus] File extraction retry failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to retry PDF extraction.' },
      { status: 500 }
    )
  }
}
