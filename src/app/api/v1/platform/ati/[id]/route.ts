import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { createAuditLog } from '@/lib/auth'
import { requirePlatformScope, authenticateRequest } from '@/lib/middleware'

const updateTokenSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'ISSUED', 'REVOKED', 'EXPIRED', 'USED_UP']).optional(),
  expires_at: z.string().optional(), // ISO date string
  max_uses: z.number().min(1).optional(),
  plan_tier: z.string().optional(),
  notes: z.string().optional()
})

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Check platform scope access
    const scopeCheck = await requirePlatformScope()(request)
    if (scopeCheck) return scopeCheck

    // Get authenticated user for audit logging
    const { user: authUser } = await authenticateRequest(request)

    const tokenId = params.id

    // Get existing token with tenant info
    const existingToken = await prisma.aTIToken.findFirst({
      where: { id: tokenId },
      include: { tenant: true }
    })

    if (!existingToken) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: 'ATI token not found' },
        { status: 404 }
      )
    }

    const body = await request.json()
    const updates = updateTokenSchema.parse(body)

    // Build update object
    const updateData: any = {}
    if (updates.status !== undefined) updateData.status = updates.status
    if (updates.expires_at !== undefined) updateData.expiresAt = updates.expires_at ? new Date(updates.expires_at) : null
    if (updates.max_uses !== undefined) updateData.maxUses = updates.max_uses
    if (updates.plan_tier !== undefined) updateData.planTier = updates.plan_tier
    if (updates.notes !== undefined) updateData.notes = updates.notes

    // Update token
    const updatedToken = await prisma.aTIToken.update({
      where: { id: tokenId },
      data: updateData,
      include: { tenant: true }
    })

    // Check if status change affects usage
    if (updates.status === 'USED_UP' && existingToken.usageCount < (updates.max_uses || existingToken.maxUses || 0)) {
      const maxUses = updates.max_uses || existingToken.maxUses || 1
      await prisma.aTIToken.update({
        where: { id: tokenId },
        data: { usageCount: maxUses }
      })
    }

    // Audit log
    const ip = request.headers.get('x-forwarded-for') ||
               request.headers.get('x-real-ip') ||
               'unknown'

    await createAuditLog({
      actorUserId: authUser!.sub,
      tenantId: existingToken.tenantId || undefined,
      action: 'ATI_UPDATE',
      resource: `ati_token:${tokenId}`,
      ip,
      meta: {
        fingerprint: existingToken.fingerprint,
        previousData: {
          status: existingToken.status,
          expiresAt: existingToken.expiresAt,
          maxUses: existingToken.maxUses,
          planTier: existingToken.planTier,
          notes: existingToken.notes
        },
        newData: updateData
      }
    })

    return NextResponse.json({
      success: true,
      token: {
        id: updatedToken.id,
        fingerprint: updatedToken.fingerprint,
        status: updatedToken.status,
        expires_at: updatedToken.expiresAt?.toISOString(),
        max_uses: updatedToken.maxUses,
        usage_count: updatedToken.usageCount,
        plan_tier: updatedToken.planTier,
        notes: updatedToken.notes,
        created_at: updatedToken.createdAt.toISOString(),
        updated_at: updatedToken.updatedAt.toISOString(),
        ...(updatedToken.tenant && {
          tenant: {
            id: updatedToken.tenant.id,
            name: updatedToken.tenant.name,
            ati_id: updatedToken.tenant.atiId
          }
        })
      }
    }, { status: 200 })

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 'INVALID_INPUT', message: 'Invalid input data', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Super Admin ATI update error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Check platform scope access
    const scopeCheck = await requirePlatformScope()(request)
    if (scopeCheck) return scopeCheck

    // Get authenticated user for audit logging
    const { user: authUser } = await authenticateRequest(request)

    const tokenId = params.id

    // Get token with tenant info before deleting
    const token = await prisma.aTIToken.findFirst({
      where: { id: tokenId },
      include: { tenant: true }
    })

    if (!token) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: 'ATI token not found' },
        { status: 404 }
      )
    }

    // Update status to REVOKED instead of deleting
    await prisma.aTIToken.update({
      where: { id: tokenId },
      data: { status: 'REVOKED' }
    })

    // Audit log
    const ip = request.headers.get('x-forwarded-for') ||
               request.headers.get('x-real-ip') ||
               'unknown'

    await createAuditLog({
      actorUserId: authUser!.sub,
      tenantId: token.tenantId || undefined,
      action: 'ATI_REVOKE',
      resource: `ati_token:${tokenId}`,
      ip,
      meta: {
        fingerprint: token.fingerprint,
        previousStatus: token.status
      }
    })

    return NextResponse.json({ success: true }, { status: 200 })

  } catch (error) {
    console.error('Super Admin ATI revoke error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}
