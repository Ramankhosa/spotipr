/**
 * API Routes for DD (Detailed Description) User Data Sidecar
 * 
 * This data is ONLY accessible for sections with sectionKey='detailedDescription'.
 * It is stored separately from normalizedData and is never merged into global context.
 * 
 * Endpoints:
 * - GET: Retrieve user data for a session
 * - POST: Create/update user data
 * - DELETE: Remove user data
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyAuthForPatent } from '@/lib/api-auth'
import { DD_USER_DATA_DISPLAY_WRAPPER } from '@/lib/dd-user-data-wrapper'
import {
  buildDetailedDescriptionEvidencePreview,
  updateDetailedDescriptionInjectionControls,
} from '@/lib/support-data-sources'

// Maximum size for user data (50KB)
const MAX_USER_DATA_SIZE = 50 * 1024

// Fixed legal wrapper text - NEVER modify without legal review
// Moved inside functions to avoid Next.js API route export constraints

/**
 * GET /api/patents/[patentId]/drafting/dd-user-data
 * 
 * Query params:
 * - sessionId: Required drafting session ID
 * - sectionKey: Required - must be 'detailedDescription' (access control)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ patentId: string }> }
) {
  const DD_USER_DATA_LEGAL_WRAPPER = DD_USER_DATA_DISPLAY_WRAPPER

  try {
    const { patentId } = await params
    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get('sessionId')
    const sectionKey = searchParams.get('sectionKey')
    const jurisdiction = searchParams.get('jurisdiction') || 'US'

    // Access control: Only allow access for detailedDescription sections
    if (sectionKey !== 'detailedDescription') {
      return NextResponse.json(
        { error: 'Access denied: DD user data is only available for detailedDescription sections' },
        { status: 403 }
      )
    }

    if (!sessionId) {
      return NextResponse.json(
        { error: 'sessionId is required' },
        { status: 400 }
      )
    }

    // Verify user has access to this patent
    const authResult = await verifyAuthForPatent(request, patentId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    // Verify session belongs to this patent and user
    const session = await prisma.draftingSession.findFirst({
      where: {
        id: sessionId,
        patentId,
        userId: authResult.user.id
      },
      include: { ideaRecord: true }
    })

    if (!session) {
      return NextResponse.json(
        { error: 'Session not found or access denied' },
        { status: 404 }
      )
    }

    // Fetch DD user data
    const ddUserData = await prisma.dDUserData.findUnique({
      where: { sessionId }
    })

    return NextResponse.json({
      data: ddUserData ? {
        userData: ddUserData.userData,
        jurisdictionToggles: ddUserData.jurisdictionToggles,
        createdAt: ddUserData.createdAt,
        updatedAt: ddUserData.updatedAt
      } : null,
      evidencePreview: buildDetailedDescriptionEvidencePreview((session.ideaRecord?.normalizedData as any) || {}, jurisdiction),
      legalWrapper: DD_USER_DATA_LEGAL_WRAPPER
    })

  } catch (error) {
    console.error('[DD-User-Data:GET] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch DD user data' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/patents/[patentId]/drafting/dd-user-data
 * 
 * Body:
 * - sessionId: Required drafting session ID
 * - sectionKey: Required - must be 'detailedDescription' (access control)
 * - userData: Required - plain text user data (max 50KB)
 * - jurisdictionToggles: Optional - { "REFERENCE": false, "US": false, ... } - defaults to all OFF
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ patentId: string }> }
) {
  try {
    const { patentId } = await params
    const body = await request.json()
    const { sessionId, sectionKey, userData, jurisdictionToggles } = body

    // Access control: Only allow access for detailedDescription sections
    if (sectionKey !== 'detailedDescription') {
      return NextResponse.json(
        { error: 'Access denied: DD user data can only be saved for detailedDescription sections' },
        { status: 403 }
      )
    }

    if (!sessionId) {
      return NextResponse.json(
        { error: 'sessionId is required' },
        { status: 400 }
      )
    }

    if (typeof userData !== 'string') {
      return NextResponse.json(
        { error: 'userData must be a string' },
        { status: 400 }
      )
    }

    // Reject empty or whitespace-only data
    const trimmedData = userData.trim()
    if (!trimmedData) {
      return NextResponse.json(
        { error: 'userData cannot be empty. Use DELETE to remove existing data.' },
        { status: 400 }
      )
    }

    // Enforce 50KB limit
    const dataSize = new TextEncoder().encode(trimmedData).length
    if (dataSize > MAX_USER_DATA_SIZE) {
      return NextResponse.json(
        { error: `User data exceeds maximum size of ${MAX_USER_DATA_SIZE / 1024}KB (current: ${Math.round(dataSize / 1024)}KB)` },
        { status: 400 }
      )
    }

    // Verify user has access to this patent
    const authResult = await verifyAuthForPatent(request, patentId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    // Verify session belongs to this patent and user
    const session = await prisma.draftingSession.findFirst({
      where: {
        id: sessionId,
        patentId,
        userId: authResult.user.id
      }
    })

    if (!session) {
      return NextResponse.json(
        { error: 'Session not found or access denied' },
        { status: 404 }
      )
    }

    // Use toggles as provided by frontend - NO defaults to true
    // User must explicitly enable injection after providing data
    const resolvedToggles = jurisdictionToggles || {}

    // Upsert DD user data (use trimmed data)
    const ddUserData = await prisma.dDUserData.upsert({
      where: { sessionId },
      update: {
        userData: trimmedData,
        jurisdictionToggles: resolvedToggles,
        updatedBy: authResult.user.id
      },
      create: {
        sessionId,
        userData: trimmedData,
        jurisdictionToggles: resolvedToggles,
        createdBy: authResult.user.id
      }
    })

    return NextResponse.json({
      success: true,
      data: {
        userData: ddUserData.userData,
        jurisdictionToggles: ddUserData.jurisdictionToggles,
        createdAt: ddUserData.createdAt,
        updatedAt: ddUserData.updatedAt
      }
    })

  } catch (error) {
    console.error('[DD-User-Data:POST] Error:', error)
    return NextResponse.json(
      { error: 'Failed to save DD user data' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/patents/[patentId]/drafting/dd-user-data
 *
 * Body:
 * - sessionId: Required drafting session ID
 * - sectionKey: Required - must be 'detailedDescription'
 * - jurisdiction: Required jurisdiction key for evidence controls, e.g. 'US' or 'REFERENCE'
 * - coveragePreset: Optional 'lean' | 'balanced' | 'full' | 'custom'
 * - excludedSelectedSourceIds: Optional string[]
 * - excludedGuardrailSourceIds: Optional string[]
 * - sourceTextOverrides: Optional { [sourceId]: { text } }
 * - removeSourceTextOverrideIds: Optional string[]
 * - customIncludeInstruction: Optional string
 * - customIntegrationInstruction: Optional string
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ patentId: string }> }
) {
  try {
    const { patentId } = await params
    const body = await request.json()
    const {
      sessionId,
      sectionKey,
      jurisdiction,
      coveragePreset,
      excludedSelectedSourceIds,
      excludedGuardrailSourceIds,
      sourceTextOverrides,
      removeSourceTextOverrideIds,
      customIncludeInstruction,
      customIntegrationInstruction,
    } = body

    if (sectionKey !== 'detailedDescription') {
      return NextResponse.json(
        { error: 'Access denied: DD evidence controls can only be saved for detailedDescription sections' },
        { status: 403 }
      )
    }

    if (!sessionId) {
      return NextResponse.json(
        { error: 'sessionId is required' },
        { status: 400 }
      )
    }

    const normalizedJurisdiction = String(jurisdiction || '').trim().toUpperCase()
    if (!normalizedJurisdiction) {
      return NextResponse.json(
        { error: 'jurisdiction is required' },
        { status: 400 }
      )
    }

    const authResult = await verifyAuthForPatent(request, patentId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const session = await prisma.draftingSession.findFirst({
      where: {
        id: sessionId,
        patentId,
        userId: authResult.user.id
      },
      include: { ideaRecord: true }
    })

    if (!session?.ideaRecord) {
      return NextResponse.json(
        { error: 'Session not found or access denied' },
        { status: 404 }
      )
    }

    const normalizedData = (session.ideaRecord.normalizedData as Record<string, any>) || {}
    const controls = updateDetailedDescriptionInjectionControls(normalizedData, normalizedJurisdiction, {
      coveragePreset,
      excludedSelectedSourceIds,
      excludedGuardrailSourceIds,
      sourceTextOverrides,
      removeSourceTextOverrideIds,
      customIncludeInstruction,
      customIntegrationInstruction,
    })
    const updatedNormalizedData = {
      ...normalizedData,
      detailedDescriptionInjectionControls: controls,
    }

    await prisma.ideaRecord.update({
      where: { sessionId },
      data: { normalizedData: updatedNormalizedData },
    })

    return NextResponse.json({
      success: true,
      evidencePreview: buildDetailedDescriptionEvidencePreview(updatedNormalizedData, normalizedJurisdiction),
    })
  } catch (error) {
    console.error('[DD-User-Data:PATCH] Error:', error)
    return NextResponse.json(
      { error: 'Failed to save DD evidence controls' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/patents/[patentId]/drafting/dd-user-data
 * 
 * Query params:
 * - sessionId: Required drafting session ID
 * - sectionKey: Required - must be 'detailedDescription' (access control)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ patentId: string }> }
) {
  try {
    const { patentId } = await params
    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get('sessionId')
    const sectionKey = searchParams.get('sectionKey')

    // Access control: Only allow access for detailedDescription sections
    if (sectionKey !== 'detailedDescription') {
      return NextResponse.json(
        { error: 'Access denied: DD user data can only be deleted for detailedDescription sections' },
        { status: 403 }
      )
    }

    if (!sessionId) {
      return NextResponse.json(
        { error: 'sessionId is required' },
        { status: 400 }
      )
    }

    // Verify user has access to this patent
    const authResult = await verifyAuthForPatent(request, patentId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    // Verify session belongs to this patent and user
    const session = await prisma.draftingSession.findFirst({
      where: {
        id: sessionId,
        patentId,
        userId: authResult.user.id
      }
    })

    if (!session) {
      return NextResponse.json(
        { error: 'Session not found or access denied' },
        { status: 404 }
      )
    }

    // Delete DD user data
    await prisma.dDUserData.deleteMany({
      where: { sessionId }
    })

    return NextResponse.json({
      success: true,
      message: 'DD user data deleted successfully'
    })

  } catch (error) {
    console.error('[DD-User-Data:DELETE] Error:', error)
    return NextResponse.json(
      { error: 'Failed to delete DD user data' },
      { status: 500 }
    )
  }
}


