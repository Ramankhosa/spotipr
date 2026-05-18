import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
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

  return NextResponse.json({ runner: getPatentCorpusRunnerState() })
}

export async function POST(request: NextRequest) {
  const auth = await verifySuperAdmin(request, true)
  if ('error' in auth) return auth.error

  return NextResponse.json({ runner: kickPatentCorpusRunner('manual') })
}
