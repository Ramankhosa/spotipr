/**
 * Writing Personas API
 * 
 * Manages reusable writing style personas that can be shared within organizations.
 * 
 * Access Control:
 * - ANALYST, MANAGER, ADMIN, OWNER: Can create own personas, use any visible persona
 * - ADMIN, OWNER: Can create organization-wide personas
 * - VIEWER: No access
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyJWT } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canUsePersona, canCreateOwnPersona, canCreateOrgPersona, canManageOrgPersonas } from '@/lib/permissions'
import { enforceServiceAccess } from '@/lib/service-access-middleware'
import { recordServiceCompletion } from '@/lib/service-completion'
import type { PersonaVisibility } from '@prisma/client'

const PERSONA_NAME_PATTERN = /^[\w\s\-\.]+$/

function normalizePersonaName(value: unknown): { value?: string; error?: string; code?: string } {
  if (!value || typeof value !== 'string') {
    return { error: 'Name is required', code: 'NAME_REQUIRED' }
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) return { error: 'Name cannot be empty', code: 'NAME_EMPTY' }
  if (trimmed.length < 2) return { error: 'Name must be at least 2 characters', code: 'NAME_TOO_SHORT' }
  if (trimmed.length > 100) return { error: 'Name must be 100 characters or less', code: 'NAME_TOO_LONG' }
  if (!PERSONA_NAME_PATTERN.test(trimmed)) {
    return {
      error: 'Name can only contain letters, numbers, spaces, hyphens, and dots',
      code: 'NAME_INVALID_CHARS'
    }
  }

  return { value: trimmed }
}

function normalizeOptionalBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function canManagePersonaRecord(user: { id: string; tenantId: string }, persona: { createdBy: string; tenantId: string; visibility: PersonaVisibility }) {
  if (persona.createdBy === user.id) return true
  return persona.tenantId === user.tenantId
    && persona.visibility === 'ORGANIZATION'
    && canManageOrgPersonas(user as any)
}

async function getUserFromRequest(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  const token = authHeader.substring(7)
  const payload = verifyJWT(token)
  if (!payload || !payload.sub) {
    return null
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, name: true, tenantId: true, roles: true }
  })

  return user
}

/**
 * GET /api/personas
 * List personas visible to the user (own + organization-wide)
 * 
 * Query params:
 * - includeOrg: boolean - Include organization personas (default: true)
 * - onlyOwn: boolean - Only return user's own personas
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user || !user.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check permission
    if (!canUsePersona(user as any)) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const includeOrg = searchParams.get('includeOrg') !== 'false'
    const onlyOwn = searchParams.get('onlyOwn') === 'true'

    // Build query
    const whereConditions: any[] = [
      { createdBy: user.id, isActive: true } // Own personas
    ]

    if (includeOrg && !onlyOwn) {
      whereConditions.push({
        tenantId: user.tenantId,
        visibility: 'ORGANIZATION',
        isActive: true
      })
    }

    const personas = await prisma.writingPersona.findMany({
      where: { OR: whereConditions },
      include: {
        creator: {
          select: { id: true, name: true, email: true }
        },
        _count: {
          select: { samples: true }
        }
      },
      orderBy: [
        { isTemplate: 'desc' },
        { name: 'asc' }
      ]
    })

    // Group by ownership
    const myPersonas = personas.filter(p => p.createdBy === user.id)
    const orgPersonas = personas.filter(p => p.createdBy !== user.id && p.visibility === 'ORGANIZATION')

    return NextResponse.json({
      myPersonas: myPersonas.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        visibility: p.visibility,
        isTemplate: p.isTemplate,
        allowCopy: p.allowCopy,
        sampleCount: p._count.samples,
        isOwn: true,
        createdAt: p.createdAt
      })),
      orgPersonas: orgPersonas.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        visibility: p.visibility,
        isTemplate: p.isTemplate,
        allowCopy: p.allowCopy,
        sampleCount: p._count.samples,
        isOwn: false,
        createdBy: {
          id: p.creator.id,
          name: p.creator.name || p.creator.email
        },
        createdAt: p.createdAt
      })),
      total: personas.length
    })

  } catch (error) {
    console.error('[Personas] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch personas' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/personas
 * Create a new persona
 * 
 * Body:
 * - name: string (required, max 100 chars)
 * - description?: string (max 500 chars)
 * - visibility: 'PRIVATE' | 'ORGANIZATION' (default: PRIVATE)
 * - isTemplate?: boolean (admin only)
 * - allowCopy?: boolean
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user || !user.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check permission to create personas
    if (!canCreateOwnPersona(user as any)) {
      return NextResponse.json({
        error: 'Permission denied. Your role does not allow creating personas.',
        code: 'PERMISSION_DENIED'
      }, { status: 403 })
    }

    // PersonaSync is a plan feature (Enterprise by default). It previously had no gate at
    // all, so tenants on plans that exclude PERSONA_SYNC could still train styles.
    const personaAccess = await enforceServiceAccess(user.id, user.tenantId, 'PERSONA_SYNC')
    if (!personaAccess.allowed) {
      return personaAccess.response
    }

    let body: any
    try {
      body = await request.json()
    } catch (parseError) {
      return NextResponse.json({ 
        error: 'Invalid request body',
        code: 'INVALID_JSON'
      }, { status: 400 })
    }

    const { name, description, visibility = 'PRIVATE' } = body
    const isTemplate = normalizeOptionalBoolean(body.isTemplate, false)
    const allowCopy = normalizeOptionalBoolean(body.allowCopy, true)

    // === NAME VALIDATION ===
    const normalizedName = normalizePersonaName(name)
    if (!normalizedName.value) {
      return NextResponse.json({
        error: normalizedName.error,
        code: normalizedName.code
      }, { status: 400 })
    }
    const trimmedName = normalizedName.value

    // === DESCRIPTION VALIDATION ===
    if (description !== undefined && description !== null) {
      if (typeof description !== 'string') {
        return NextResponse.json({ 
          error: 'Description must be a string',
          code: 'DESCRIPTION_INVALID'
        }, { status: 400 })
      }
      if (description.trim().length > 500) {
        return NextResponse.json({ 
          error: 'Description must be 500 characters or less',
          code: 'DESCRIPTION_TOO_LONG'
        }, { status: 400 })
      }
    }

    // === VISIBILITY VALIDATION ===
    if (!['PRIVATE', 'ORGANIZATION'].includes(visibility)) {
      return NextResponse.json({ 
        error: 'Visibility must be "PRIVATE" or "ORGANIZATION"',
        code: 'VISIBILITY_INVALID'
      }, { status: 400 })
    }

    // Check if trying to create org-wide persona
    if (visibility === 'ORGANIZATION' && !canCreateOrgPersona(user as any)) {
      return NextResponse.json({
        error: 'Only OWNER or ADMIN can create organization-wide personas',
        code: 'ORG_PERSONA_PERMISSION_DENIED'
      }, { status: 403 })
    }

    // === CHECK FOR DUPLICATE NAME ===
    // Check both active and inactive personas to prevent confusion
    const existing = await prisma.writingPersona.findFirst({
      where: { 
        createdBy: user.id, 
        name: trimmedName
      }
    })

    if (existing) {
      if (existing.isActive) {
        return NextResponse.json({
          error: `You already have a persona named "${trimmedName}". Please choose a different name.`,
          code: 'DUPLICATE_NAME'
        }, { status: 400 })
      } else {
        // Inactive persona with same name - reactivate it instead
        const reactivated = await prisma.writingPersona.update({
          where: { id: existing.id },
          data: {
            isActive: true,
            description: description?.trim() || existing.description,
            visibility: visibility as PersonaVisibility,
            isTemplate: canCreateOrgPersona(user as any) ? isTemplate : false,
            allowCopy,
            updatedAt: new Date()
          }
        })

        // Audit log
        try {
          await prisma.auditLog.create({
            data: {
              actorUserId: user.id,
              tenantId: user.tenantId,
              action: 'PERSONA_REACTIVATE',
              resource: `persona:${reactivated.id}`,
              meta: { name: reactivated.name, visibility: reactivated.visibility }
            }
          })
        } catch (auditError) {
          console.warn('[Personas] Audit log failed:', auditError)
        }

        // Get sample count
        const sampleCount = await prisma.writingSample.count({
          where: { personaId: reactivated.id }
        })

        return NextResponse.json({
          success: true,
          reactivated: true,
          message: `Persona "${trimmedName}" has been reactivated with ${sampleCount} existing samples`,
          persona: {
            id: reactivated.id,
            name: reactivated.name,
            description: reactivated.description,
            visibility: reactivated.visibility,
            isTemplate: reactivated.isTemplate,
            allowCopy: reactivated.allowCopy,
            sampleCount
          }
        }, { status: 200 })
      }
    }

    // === CREATE PERSONA ===
    const persona = await prisma.writingPersona.create({
      data: {
        tenantId: user.tenantId,
        createdBy: user.id,
        name: trimmedName,
        description: description?.trim() || null,
        visibility: visibility as PersonaVisibility,
        isTemplate: canCreateOrgPersona(user as any) ? isTemplate : false,
        allowCopy
      }
    })

    // Audit log
    try {
      await prisma.auditLog.create({
        data: {
          actorUserId: user.id,
          tenantId: user.tenantId,
          action: 'PERSONA_CREATE',
          resource: `persona:${persona.id}`,
          meta: { name: persona.name, visibility: persona.visibility }
        }
      })
    } catch (auditError) {
      // Don't fail creation if audit logging fails
      console.warn('[Personas] Audit log failed:', auditError)
    }

    // Count the trained persona against the plan's PERSONA_SYNC quota. Keyed on the
    // persona id, so editing it later never consumes a second unit.
    await recordServiceCompletion({
      tenantId: user.tenantId,
      userId: user.id,
      serviceType: 'PERSONA_SYNC',
      operationId: persona.id,
      operationType: 'PERSONA_CREATED',
      metadata: { name: persona.name, visibility: persona.visibility }
    })

    return NextResponse.json({
      success: true,
      persona: {
        id: persona.id,
        name: persona.name,
        description: persona.description,
        visibility: persona.visibility,
        isTemplate: persona.isTemplate,
        allowCopy: persona.allowCopy,
        sampleCount: 0
      }
    }, { status: 201 })

  } catch (error: any) {
    console.error('[Personas] POST error:', error)
    
    // Handle unique constraint violations
    if (error?.code === 'P2002') {
      return NextResponse.json({
        error: 'A persona with this name already exists',
        code: 'DUPLICATE_NAME'
      }, { status: 400 })
    }
    
    return NextResponse.json({
      error: 'Failed to create persona. Please try again.',
      code: 'INTERNAL_ERROR'
    }, { status: 500 })
  }
}

/**
 * PATCH /api/personas
 * Update or copy a persona
 * 
 * Body for update:
 * - action: 'update' (optional, default)
 * - id: string
 * - name?, description?, visibility?, isTemplate?, allowCopy?, isActive?
 * 
 * Body for copy:
 * - action: 'copy'
 * - sourceId: string
 * - newName: string
 */
export async function PATCH(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user || !user.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: any
    try {
      body = await request.json()
    } catch (parseError) {
      return NextResponse.json({ 
        error: 'Invalid request body',
        code: 'INVALID_JSON'
      }, { status: 400 })
    }

    const { action } = body

    // === COPY OPERATION ===
    if (action === 'copy') {
      const { sourceId, newName } = body

      if (!sourceId || typeof sourceId !== 'string') {
        return NextResponse.json({ 
          error: 'sourceId is required for copy operation',
          code: 'SOURCE_ID_REQUIRED'
        }, { status: 400 })
      }

      const normalizedNewName = normalizePersonaName(newName)
      if (!normalizedNewName.value) {
        return NextResponse.json({
          error: normalizedNewName.error?.replace(/^Name/, 'New name') || 'Invalid new name',
          code: normalizedNewName.code || 'NEW_NAME_INVALID'
        }, { status: 400 })
      }
      const trimmedNewName = normalizedNewName.value

      // Check if user already has a persona with this name
      const existingWithName = await prisma.writingPersona.findFirst({
        where: { createdBy: user.id, name: trimmedNewName, isActive: true }
      })

      if (existingWithName) {
        return NextResponse.json({ 
          error: `You already have a persona named "${trimmedNewName}"`,
          code: 'DUPLICATE_NAME'
        }, { status: 400 })
      }

      // Get source persona with samples
      const source = await prisma.writingPersona.findUnique({
        where: { id: sourceId },
        include: { samples: { where: { isActive: true } } }
      })

      if (!source) {
        return NextResponse.json({ 
          error: 'Source persona not found',
          code: 'SOURCE_NOT_FOUND'
        }, { status: 404 })
      }

      if (!source.isActive) {
        return NextResponse.json({ 
          error: 'Cannot copy a deleted persona',
          code: 'SOURCE_DELETED'
        }, { status: 400 })
      }

      // Check visibility - can only copy org personas or own
      const isSourceOwner = source.createdBy === user.id
      const isOrgPersona = source.visibility === 'ORGANIZATION'
      const isSameTenant = source.tenantId === user.tenantId

      if (!isSourceOwner && !(isOrgPersona && isSameTenant)) {
        return NextResponse.json({ 
          error: 'You can only copy your own personas or organization-shared personas',
          code: 'COPY_PERMISSION_DENIED'
        }, { status: 403 })
      }

      if (!source.allowCopy && !isSourceOwner) {
        return NextResponse.json({ 
          error: 'The owner of this persona has disabled copying',
          code: 'COPY_DISABLED'
        }, { status: 403 })
      }

      // Create copy
      const copied = await prisma.writingPersona.create({
        data: {
          tenantId: user.tenantId,
          createdBy: user.id,
          name: trimmedNewName,
          description: source.description 
            ? `Copied from: ${source.name}. ${source.description}` 
            : `Copied from: ${source.name}`,
          visibility: 'PRIVATE', // Copies are always private initially
          isTemplate: false,
          allowCopy: true
        }
      })

      // Copy samples
      let copiedSampleCount = 0
      if (source.samples.length > 0) {
        const result = await prisma.writingSample.createMany({
          data: source.samples.map(s => ({
            userId: user.id,
            tenantId: user.tenantId!,
            personaId: copied.id,
            personaName: trimmedNewName,
            jurisdiction: s.jurisdiction,
            sectionKey: s.sectionKey,
            sampleText: s.sampleText,
            notes: s.notes,
            wordCount: s.wordCount,
            isActive: true
          })),
          skipDuplicates: true // Skip any that might violate constraints
        })
        copiedSampleCount = result.count
      }

      // Audit log
      try {
        await prisma.auditLog.create({
          data: {
            actorUserId: user.id,
            tenantId: user.tenantId,
            action: 'PERSONA_COPY',
            resource: `persona:${copied.id}`,
            meta: { 
              newName: copied.name, 
              sourceId: source.id,
              sourceName: source.name,
              samplesCopied: copiedSampleCount
            }
          }
        })
      } catch (auditError) {
        console.warn('[Personas] Audit log failed:', auditError)
      }

      return NextResponse.json({
        success: true,
        message: `Created "${trimmedNewName}" with ${copiedSampleCount} samples`,
        persona: {
          id: copied.id,
          name: copied.name,
          description: copied.description,
          sampleCount: copiedSampleCount
        }
      })
    }

    // === UPDATE OPERATION ===
    const { id, name, description, visibility, isTemplate, allowCopy, isActive } = body

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ 
        error: 'Persona ID is required',
        code: 'ID_REQUIRED'
      }, { status: 400 })
    }

    const persona = await prisma.writingPersona.findUnique({
      where: { id }
    })

    if (!persona) {
      return NextResponse.json({ 
        error: 'Persona not found',
        code: 'PERSONA_NOT_FOUND'
      }, { status: 404 })
    }

    // Check ownership or same-tenant organization admin rights
    const isOwner = persona.createdBy === user.id
    const canManage = canManagePersonaRecord(user as any, persona)

    if (!canManage) {
      return NextResponse.json({ 
        error: 'You can only update your own personas',
        code: 'PERMISSION_DENIED'
      }, { status: 403 })
    }

    // Validate name if provided
    let trimmedUpdateName: string | undefined
    if (name !== undefined) {
      const normalizedUpdateName = normalizePersonaName(name)
      if (!normalizedUpdateName.value) {
        return NextResponse.json({
          error: normalizedUpdateName.error,
          code: normalizedUpdateName.code
        }, { status: 400 })
      }
      trimmedUpdateName = normalizedUpdateName.value

      // Check for duplicate name (excluding self)
      const existingWithName = await prisma.writingPersona.findFirst({
        where: { 
          createdBy: persona.createdBy,
          name: trimmedUpdateName,
          isActive: true,
          NOT: { id: persona.id }
        }
      })

      if (existingWithName) {
        return NextResponse.json({ 
          error: `A persona named "${trimmedUpdateName}" already exists for this creator`,
          code: 'DUPLICATE_NAME'
        }, { status: 400 })
      }
    }

    // Non-owners can't change visibility to ORGANIZATION
    if (visibility === 'ORGANIZATION' && !canCreateOrgPersona(user as any)) {
      return NextResponse.json({
        error: 'Only OWNER or ADMIN can make personas organization-wide',
        code: 'ORG_VISIBILITY_DENIED'
      }, { status: 403 })
    }

    // Build update data
    const updateData: any = {}
    if (trimmedUpdateName !== undefined) updateData.name = trimmedUpdateName
    if (description !== undefined) updateData.description = description?.trim() || null
    if (visibility !== undefined && (isOwner || canManage)) {
      // Only allow visibility change if user has permission
      if (visibility === 'ORGANIZATION' && canCreateOrgPersona(user as any)) {
        updateData.visibility = visibility
      } else if (visibility === 'PRIVATE') {
        updateData.visibility = visibility
      }
    }
    if (typeof isTemplate === 'boolean' && canManage) updateData.isTemplate = isTemplate
    if (typeof allowCopy === 'boolean') updateData.allowCopy = allowCopy
    if (typeof isActive === 'boolean') updateData.isActive = isActive

    // Prevent empty updates
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ 
        error: 'No valid fields to update',
        code: 'NO_CHANGES'
      }, { status: 400 })
    }

    const updated = await prisma.writingPersona.update({
      where: { id },
      data: {
        ...updateData,
        updatedAt: new Date()
      }
    })

    return NextResponse.json({ 
      success: true, 
      persona: {
        id: updated.id,
        name: updated.name,
        description: updated.description,
        visibility: updated.visibility,
        isTemplate: updated.isTemplate,
        allowCopy: updated.allowCopy,
        isActive: updated.isActive
      }
    })

  } catch (error: any) {
    console.error('[Personas] PATCH error:', error)
    
    // Handle unique constraint violations
    if (error?.code === 'P2002') {
      return NextResponse.json({
        error: 'A persona with this name already exists',
        code: 'DUPLICATE_NAME'
      }, { status: 400 })
    }
    
    return NextResponse.json({
      error: 'Failed to update persona. Please try again.',
      code: 'INTERNAL_ERROR'
    }, { status: 500 })
  }
}

/**
 * DELETE /api/personas
 * Soft delete a persona (set isActive = false)
 * 
 * This preserves the persona and its samples in case user wants to recover.
 * To permanently delete, admin would need to use a separate hard-delete function.
 * 
 * Query params:
 * - id: string
 */
export async function DELETE(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user || !user.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ 
        error: 'Persona ID is required',
        code: 'ID_REQUIRED'
      }, { status: 400 })
    }

    // Get persona with sample count for better feedback
    const persona = await prisma.writingPersona.findUnique({
      where: { id },
      include: {
        _count: { select: { samples: true } }
      }
    })

    if (!persona) {
      return NextResponse.json({ 
        error: 'Persona not found',
        code: 'PERSONA_NOT_FOUND'
      }, { status: 404 })
    }

    if (!persona.isActive) {
      return NextResponse.json({ 
        error: 'This persona has already been deleted',
        code: 'ALREADY_DELETED'
      }, { status: 400 })
    }

    // Check ownership or same-tenant organization admin rights
    const isOwner = persona.createdBy === user.id
    const canManage = canManagePersonaRecord(user as any, persona)
    const isOrgPersona = persona.visibility === 'ORGANIZATION'

    if (!canManage) {
      if (isOrgPersona) {
        return NextResponse.json({ 
          error: 'Only the creator or an admin can delete organization personas',
          code: 'ORG_PERSONA_PERMISSION_DENIED'
        }, { status: 403 })
      }
      return NextResponse.json({ 
        error: 'You can only delete your own personas',
        code: 'PERMISSION_DENIED'
      }, { status: 403 })
    }

    // Soft delete (preserves samples for potential recovery)
    await prisma.writingPersona.update({
      where: { id },
      data: { isActive: false }
    })

    // Audit log
    try {
      await prisma.auditLog.create({
        data: {
          actorUserId: user.id,
          tenantId: user.tenantId,
          action: 'PERSONA_DELETE',
          resource: `persona:${id}`,
          meta: { 
            name: persona.name,
            visibility: persona.visibility,
            sampleCount: persona._count.samples,
            deletedByOwner: isOwner
          }
        }
      })
    } catch (auditError) {
      console.warn('[Personas] Audit log failed:', auditError)
    }

    return NextResponse.json({ 
      success: true,
      message: `Persona "${persona.name}" has been deleted`,
      deletedSamplesPreserved: persona._count.samples > 0,
      sampleCount: persona._count.samples
    })

  } catch (error: any) {
    console.error('[Personas] DELETE error:', error)
    return NextResponse.json({
      error: 'Failed to delete persona. Please try again.',
      code: 'INTERNAL_ERROR'
    }, { status: 500 })
  }
}

