// Authorization for the editorial admin.
//
// Same shape as the other super-admin surfaces: SUPER_ADMIN_VIEWER may read the
// desk, only SUPER_ADMIN may write. The server decides this on every request —
// the composer's `canWrite` flag only greys out controls, it is not the gate.

import { NextResponse, type NextRequest } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'

export interface AdminActor {
  id: string
  email: string
  canWrite: boolean
}

type GuardResult = { actor: AdminActor; response?: never } | { actor?: never; response: NextResponse }

export async function requireBlogAdmin(
  request: NextRequest,
  options: { write?: boolean } = {}
): Promise<GuardResult> {
  const authResult = await authenticateUser(request)
  if (!authResult.user) {
    return {
      response: NextResponse.json(
        { error: authResult.error?.message || 'Authentication required' },
        { status: authResult.error?.status || 401 }
      ),
    }
  }

  const roles: string[] = authResult.user.roles || []
  const isAdmin = roles.includes('SUPER_ADMIN')
  const isViewer = roles.includes('SUPER_ADMIN_VIEWER')

  if (!isAdmin && !isViewer) {
    return { response: NextResponse.json({ error: 'Super admin privileges required' }, { status: 403 }) }
  }

  if (options.write && !isAdmin) {
    return { response: NextResponse.json({ error: 'Read-only access' }, { status: 403 }) }
  }

  return {
    actor: { id: authResult.user.id, email: authResult.user.email, canWrite: isAdmin },
  }
}
