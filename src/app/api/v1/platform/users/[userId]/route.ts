import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { createAuditLog } from '@/lib/auth'
import { requirePlatformScope, authenticateRequest } from '@/lib/middleware'
import {
  forceMarkManagedUserEmailVerified,
  resendManagedUserEmailVerification,
  setManagedUserEmailDraftingEnabled,
  updateManagedUserEmail
} from '@/lib/admin-user-email-service'

const updateStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED'])
})

const updateEmailDraftingSchema = z.object({
  enabled: z.boolean()
})

const updateEmailSchema = z.object({
  newEmail: z.string().email()
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

    const body = await request.json()
    const action = typeof body?.action === 'string' ? body.action : 'change_status'

    if (action === 'change_email') {
      const { newEmail } = updateEmailSchema.parse(body)
      const result = await updateManagedUserEmail({
        actorUserId: authUser!.sub,
        targetUserId: userId,
        newEmail,
        auditAction: 'PLATFORM_USER_EMAIL_CHANGE',
        ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
      })

      if (!result.success) {
        return NextResponse.json(
          { code: result.code, message: result.error },
          { status: result.code === 'NOT_FOUND' ? 404 : result.code === 'FORBIDDEN' ? 403 : 400 }
        )
      }

      return NextResponse.json({
        success: true,
        changed: result.changed,
        user: result.user,
        message: result.changed ? 'Email updated. Verification required before email drafting can be re-enabled.' : 'Email unchanged'
      })
    }

    if (action === 'set_email_drafting_enabled') {
      const { enabled } = updateEmailDraftingSchema.parse(body)
      const result = await setManagedUserEmailDraftingEnabled({
        actorUserId: authUser!.sub,
        targetUserId: userId,
        enabled,
        auditAction: 'PLATFORM_USER_EMAIL_DRAFTING_TOGGLE',
        ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
      })

      if (!result.success) {
        return NextResponse.json(
          { code: result.code, message: result.error },
          { status: result.code === 'NOT_FOUND' ? 404 : result.code === 'FORBIDDEN' ? 403 : 400 }
        )
      }

      return NextResponse.json({ success: true, user: result.user })
    }

    if (action === 'resend_verification_email') {
      const result = await resendManagedUserEmailVerification({
        actorUserId: authUser!.sub,
        targetUserId: userId,
        auditAction: 'PLATFORM_USER_EMAIL_VERIFICATION_RESEND',
        ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
      })

      if (!result.success) {
        return NextResponse.json(
          { code: result.code, message: result.error },
          { status: result.code === 'NOT_FOUND' ? 404 : result.code === 'FORBIDDEN' ? 403 : 400 }
        )
      }

      return NextResponse.json({ success: true, user: result.user, message: 'Verification email sent successfully' })
    }

    if (action === 'force_mark_email_verified') {
      const result = await forceMarkManagedUserEmailVerified({
        actorUserId: authUser!.sub,
        targetUserId: userId,
        auditAction: 'PLATFORM_USER_EMAIL_FORCE_VERIFIED',
        ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
      })

      if (!result.success) {
        return NextResponse.json(
          { code: result.code, message: result.error },
          { status: result.code === 'NOT_FOUND' ? 404 : result.code === 'FORBIDDEN' ? 403 : 400 }
        )
      }

      return NextResponse.json({
        success: true,
        changed: result.changed,
        user: result.user,
        message: result.changed ? 'User email marked as verified.' : 'Email was already verified.'
      })
    }

    const { status } = updateStatusSchema.parse(body)

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
