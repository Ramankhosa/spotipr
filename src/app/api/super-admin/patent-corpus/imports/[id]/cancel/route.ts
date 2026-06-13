import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { cancelPatentImportBatch } from '@/lib/patent-corpus-service'
import { getPatentCorpusRunnerState } from '@/lib/patent-corpus-runner'

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

    const result = await cancelPatentImportBatch(params.id)
    return NextResponse.json({
      ...result,
      runner: getPatentCorpusRunnerState(),
    })
  } catch (error) {
    console.error('[PatentCorpus] Cancel failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to cancel import batch.' },
      { status: statusForError(error) }
    )
  }
}
