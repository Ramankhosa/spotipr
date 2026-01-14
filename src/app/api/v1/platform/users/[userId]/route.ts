import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { createAuditLog } from '@/lib/auth'
import { requirePlatformScope, authenticateRequest } from '@/lib/middleware'

const updateStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED'])
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    const scopeCheck = await requirePlatformScope()(request)
    if (scopeCheck) return scopeCheck

    const { user: authUser } = await authenticateRequest(request)

    const { userId } = params
    const body = await request.json()
    const { status } = updateStatusSchema.parse(body)

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, tenantId: true, roles: true, status: true }
    })

    if (!targetUser) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: 'User not found' },
        { status: 404 }
      )
    }

    if (targetUser.roles.some(role => role === 'SUPER_ADMIN' || role === 'SUPER_ADMIN_VIEWER')) {
      return NextResponse.json(
        { code: 'FORBIDDEN', message: 'Cannot change status of super admin accounts' },
        { status: 403 }
      )
    }

    await prisma.user.update({
      where: { id: userId },
      data: { status }
    })

    await createAuditLog({
      actorUserId: authUser!.sub,
      tenantId: targetUser.tenantId || undefined,
      action: 'USER_STATUS_CHANGE',
      resource: `user:${userId}`,
      ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
      meta: { previousStatus: targetUser.status, newStatus: status }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 'INVALID_INPUT', message: 'Invalid input data', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Platform user status update error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}
