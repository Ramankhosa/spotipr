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
  // Fixed legal wrapper text - NEVER modify without legal review
  const DD_USER_DATA_LEGAL_WRAPPER = `
────────────────────────────────────────
INVENTOR-PROVIDED ILLUSTRATIVE DATA
────────────────────────────────────────
The following data is provided by the inventor for illustrative purposes only.

LEGAL NOTICE:
- This data is NON-LIMITING and does not establish thresholds, ranges, or requirements.
- This data must NOT be used to narrow the scope of any claims.
- This data must NOT be used for comparison, superiority claims, or to imply preferred values.
- This data is exemplary only and does not define the boundaries of the invention.
- Other values, ranges, and configurations are expressly contemplated within the scope of the claims.

ILLUSTRATIVE DATA:
`.trim()

  try {
    const { patentId } = await params
    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get('sessionId')
    const sectionKey = searchParams.get('sectionKey')

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
      }
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


