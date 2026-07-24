/**
 * Auth guard for the access-request admin API.
 *
 * SUPER_ADMIN_VIEWER may read the inbox; only SUPER_ADMIN may triage, approve or
 * decline. `verifySuperAdmin` in super-admin-auth.ts is write-only by design, so
 * this adds the read-capable variant and reports which of the two the caller is.
 */

import { NextRequest } from 'next/server'
import { verifyJWT } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export interface AccessRequestAdmin {
  userId: string
  email: string
  canWrite: boolean
}

export async function requireAdmin(request: NextRequest): Promise<AccessRequestAdmin | null> {
  const header = request.headers.get('authorization') || request.headers.get('Authorization')
  if (!header?.startsWith('Bearer ')) return null

  const payload = verifyJWT(header.substring(7))
  if (!payload?.email) return null

  const user = await prisma.user.findUnique({
    where: { email: payload.email },
    select: { id: true, email: true, roles: true },
  })
  if (!user) return null

  const isAdmin = Boolean(user.roles?.includes('SUPER_ADMIN'))
  const isViewer = Boolean(user.roles?.includes('SUPER_ADMIN_VIEWER'))
  if (!isAdmin && !isViewer) return null

  return { userId: user.id, email: user.email, canWrite: isAdmin }
}
