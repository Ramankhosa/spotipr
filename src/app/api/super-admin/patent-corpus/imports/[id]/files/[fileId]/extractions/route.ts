import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { deletePatentImportFileExtractions } from '@/lib/patent-corpus-service'

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

export async function DELETE(request: NextRequest, { params }: { params: { id: string; fileId: string } }) {
  try {
    const auth = await verifySuperAdmin(request)
    if ('error' in auth) return auth.error

    const result = await deletePatentImportFileExtractions(params.id, params.fileId)
    return NextResponse.json(result)
  } catch (error) {
    console.error('[PatentCorpus] Delete file extractions failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete PDF extractions.' },
      { status: 500 }
    )
  }
}
