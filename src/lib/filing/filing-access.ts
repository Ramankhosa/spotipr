/**
 * Access control for the filing endpoints.
 *
 * A patent is reachable by its creator, the owning project's user, or a project
 * collaborator — the same rule the rest of the patent API uses.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../prisma'
import { authenticateUser } from '../auth-middleware'

export interface FilingActor {
  userId: string
  tenantId: string | null
  roles: string[]
}

export async function requirePatentAccess(
  request: NextRequest,
  patentId: string
): Promise<{ actor: FilingActor } | { response: NextResponse }> {
  const authResult = await authenticateUser(request)
  if (!authResult.user) {
    return {
      response: NextResponse.json(
        { error: authResult.error?.message || 'Unauthorized' },
        { status: authResult.error?.status || 401 }
      ),
    }
  }

  const userId = authResult.user.id
  const patent = await prisma.patent.findFirst({
    where: {
      id: patentId,
      OR: [
        { createdBy: userId },
        {
          project: {
            OR: [
              { userId },
              { collaborators: { some: { userId } } },
            ],
          },
        },
      ],
    },
    select: { id: true },
  })

  if (!patent) {
    return {
      response: NextResponse.json({ error: 'Patent not found or access denied' }, { status: 404 }),
    }
  }

  return {
    actor: {
      userId,
      tenantId: (authResult.user as { tenantId?: string | null }).tenantId ?? null,
      roles: ((authResult.user as { roles?: string[] }).roles) || [],
    },
  }
}

export function isAccessDenied(
  result: { actor: FilingActor } | { response: NextResponse }
): result is { response: NextResponse } {
  return 'response' in result
}
