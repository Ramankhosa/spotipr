import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyJWT } from '@/lib/auth'

async function getUserFromRequest(request: NextRequest) {
  // Extract token from Authorization header
  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  const token = authHeader.substring(7) // Remove 'Bearer ' prefix

  // Verify JWT
  const payload = verifyJWT(token)
  if (!payload || !payload.email) {
    return null
  }

  return payload.email
}

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string; patentId: string } }
) {
  try {
    const userEmail = await getUserFromRequest(request)

    if (!userEmail) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { projectId, patentId } = params

    // Check if user has access to the project (owner or collaborator)
    const projectAccess = await prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { user: { email: userEmail } },
          { collaborators: { some: { user: { email: userEmail } } } }
        ]
      }
    })

    if (!projectAccess) {
      return NextResponse.json({ error: 'Project not found or access denied' }, { status: 404 })
    }

    // Fetch patent
    const patent = await prisma.patent.findFirst({
      where: {
        id: patentId,
        projectId
      }
    })

    if (!patent) {
      return NextResponse.json({ error: 'Patent not found' }, { status: 404 })
    }

    return NextResponse.json({
      patent,
      project: { id: projectAccess.id, name: projectAccess.name }
    })
  } catch (error) {
    console.error('Failed to fetch patent:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
