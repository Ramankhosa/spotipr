/**
 * Shared super-admin authentication guard for API routes.
 *
 * Verifies the Bearer JWT and requires the SUPER_ADMIN role.
 * Returns the admin's identity, or null when the request is not authorized.
 */

import { NextRequest } from 'next/server'
import { verifyJWT } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export interface SuperAdminIdentity {
  userId: string
  email: string
}

export async function verifySuperAdmin(request: NextRequest): Promise<SuperAdminIdentity | null> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  const token = authHeader.substring(7)
  const payload = verifyJWT(token)
  if (!payload?.email) return null

  const user = await prisma.user.findUnique({
    where: { email: payload.email },
    select: { id: true, email: true, roles: true }
  })

  if (!user?.roles?.includes('SUPER_ADMIN')) return null
  return { userId: user.id, email: user.email }
}
