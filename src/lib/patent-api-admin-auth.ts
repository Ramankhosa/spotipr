import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'

export async function authenticatePatentApiAdmin(request: NextRequest, write = false) {
  const auth = await authenticateUser(request)
  if (!auth.user) {
    return { error: NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 }) }
  }
  const roles = auth.user.roles || []
  const isAdmin = roles.includes('SUPER_ADMIN')
  const isViewer = roles.includes('SUPER_ADMIN_VIEWER')
  if (!isAdmin && !isViewer) return { error: NextResponse.json({ error: 'Super admin access required.' }, { status: 403 }) }
  if (write && !isAdmin) return { error: NextResponse.json({ error: 'Read-only super admins cannot modify API clients.' }, { status: 403 }) }
  return { user: auth.user, readOnly: !isAdmin }
}

