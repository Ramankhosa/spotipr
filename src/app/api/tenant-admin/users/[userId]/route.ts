/**
 * Tenant Admin - Individual User Management API
 * 
 * GET    - Get user details with teams and quotas
 * PATCH  - Update user role or status
 * DELETE - Deactivate user (soft delete)
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, requireTenantRole } from '@/lib/middleware'
import { 
  changeUserRole, 
  canChangeRole,
  getHighestRole,
  getUserTeams
} from '@/lib/org-access-service'
import { prisma } from '@/lib/prisma'
import type { UserRole } from '@prisma/client'
import {
  resendManagedUserEmailVerification,
  setManagedUserEmailDraftingEnabled,
  updateManagedUserEmail
} from '@/lib/admin-user-email-service'

export const dynamic = 'force-dynamic'

/**
 * GET /api/tenant-admin/users/[userId]
 * Get detailed user information
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    const authResult = await authenticateRequest(request)
    if (authResult.error) return authResult.error
    
    const actor = authResult.user!
    
    // Require at least MANAGER role
    const roleCheck = await requireTenantRole(['OWNER', 'ADMIN', 'MANAGER'])(request)
    if (roleCheck) return roleCheck
    
    const { userId } = params
    
    // Get target user
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        firstName: true,
        lastName: true,
        roles: true,
        status: true,
        emailVerified: true,
        emailDraftingEnabled: true,
        tenantId: true,
        createdAt: true,
        updatedAt: true,
        teamMemberships: {
          include: {
            team: { select: { id: true, name: true, description: true } }
          }
        },
        serviceQuotas: true,
        _count: {
          select: {
            patents: true,
            projects: true
          }
        }
      }
    })
    
    if (!user || user.tenantId !== actor.tenant_id) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    
    // Determine what role changes are allowed
    const actorRoles = actor.roles || []
    const userHighestRole = getHighestRole(user.roles)
    const availableRoles: UserRole[] = ['ADMIN', 'MANAGER', 'ANALYST', 'VIEWER']
      .filter(role => canChangeRole(actorRoles as UserRole[], userHighestRole, role as UserRole).allowed) as UserRole[]
    
    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        firstName: user.firstName,
        lastName: user.lastName,
        roles: user.roles,
        currentRole: userHighestRole,
        status: user.status,
        emailVerified: user.emailVerified,
        emailDraftingEnabled: user.emailDraftingEnabled,
        teams: user.teamMemberships.map(m => ({
          id: m.team.id,
          name: m.team.name,
          description: m.team.description,
          role: m.role,
          isLead: m.role === 'LEAD'
        })),
        serviceQuotas: user.serviceQuotas,
        stats: {
          patents: user._count.patents,
          projects: user._count.projects
        },
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      },
      permissions: {
        canChangeRole: availableRoles.length > 0,
        availableRoles,
        canDeactivate: canChangeRole(actorRoles as UserRole[], userHighestRole, 'VIEWER').allowed
      }
    })
    
  } catch (error) {
    console.error('[TenantAdmin] User details error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch user details' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/tenant-admin/users/[userId]
 * Update user role or status
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    const authResult = await authenticateRequest(request)
    if (authResult.error) return authResult.error
    
    const actor = authResult.user!
    
    // Require OWNER or ADMIN role
    const roleCheck = await requireTenantRole(['OWNER', 'ADMIN'])(request)
    if (roleCheck) return roleCheck
    
    const { userId } = params
    const body = await request.json()
    const { action, newRole, status, newEmail, enabled } = body
    
    if (!actor.tenant_id) {
      return NextResponse.json({ error: 'No tenant context' }, { status: 400 })
    }
    
    // Handle role change
    if (action === 'change_role' && newRole) {
      const result = await changeUserRole(
        {
          userId: actor.sub,
          tenantId: actor.tenant_id,
          roles: (actor.roles || []) as UserRole[],
          email: actor.email
        },
        userId,
        newRole as UserRole
      )
      
      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 400 })
      }
      
      return NextResponse.json({ success: true, message: 'Role updated successfully' })
    }

    if (action === 'change_email' && typeof newEmail === 'string') {
      const result = await updateManagedUserEmail({
        actorUserId: actor.sub,
        targetUserId: userId,
        newEmail,
        tenantId: actor.tenant_id,
        auditAction: 'TENANT_USER_EMAIL_CHANGE',
        ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
      })

      if (!result.success) {
        return NextResponse.json({ error: result.error, code: result.code }, { status: result.code === 'NOT_FOUND' ? 404 : result.code === 'FORBIDDEN' ? 403 : 400 })
      }

      return NextResponse.json({
        success: true,
        changed: result.changed,
        user: result.user,
        message: result.changed ? 'Email updated. Verification required before email drafting can be re-enabled.' : 'Email unchanged'
      })
    }

    if (action === 'set_email_drafting_enabled' && typeof enabled === 'boolean') {
      const result = await setManagedUserEmailDraftingEnabled({
        actorUserId: actor.sub,
        targetUserId: userId,
        enabled,
        tenantId: actor.tenant_id,
        auditAction: 'TENANT_USER_EMAIL_DRAFTING_TOGGLE',
        ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
      })

      if (!result.success) {
        return NextResponse.json({ error: result.error, code: result.code }, { status: result.code === 'NOT_FOUND' ? 404 : result.code === 'FORBIDDEN' ? 403 : 400 })
      }

      return NextResponse.json({ success: true, user: result.user, message: 'Email drafting access updated successfully' })
    }

    if (action === 'resend_verification_email') {
      const result = await resendManagedUserEmailVerification({
        actorUserId: actor.sub,
        targetUserId: userId,
        tenantId: actor.tenant_id,
        auditAction: 'TENANT_USER_EMAIL_VERIFICATION_RESEND',
        ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
      })

      if (!result.success) {
        return NextResponse.json({ error: result.error, code: result.code }, { status: result.code === 'NOT_FOUND' ? 404 : result.code === 'FORBIDDEN' ? 403 : 400 })
      }

      return NextResponse.json({ success: true, user: result.user, message: 'Verification email sent successfully' })
    }
    
    // Handle status change (activate/deactivate)
    if (action === 'change_status' && status) {
      // Get target user to verify permissions
      const targetUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { tenantId: true, roles: true }
      })
      
      if (!targetUser || targetUser.tenantId !== actor.tenant_id) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }
      
      // Cannot deactivate someone with equal or higher role
      const actorHighest = getHighestRole((actor.roles || []) as UserRole[])
      const targetHighest = getHighestRole(targetUser.roles)
      
      if (getHighestRole(targetUser.roles) === actorHighest || 
          ['SUPER_ADMIN', 'SUPER_ADMIN_VIEWER'].includes(targetHighest)) {
        return NextResponse.json(
          { error: 'Cannot change status of user with equal or higher role' },
          { status: 403 }
        )
      }
      
      await prisma.user.update({
        where: { id: userId },
        data: { status: status as 'ACTIVE' | 'SUSPENDED' }
      })
      
      // Audit log
      await prisma.auditLog.create({
        data: {
          actorUserId: actor.sub,
          tenantId: actor.tenant_id,
          action: 'USER_STATUS_CHANGE',
          resource: `user:${userId}`,
          meta: { newStatus: status }
        }
      })
      
      return NextResponse.json({ success: true, message: 'Status updated successfully' })
    }
    
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    
  } catch (error) {
    console.error('[TenantAdmin] User update error:', error)
    return NextResponse.json(
      { error: 'Failed to update user' },
      { status: 500 }
    )
  }
}

