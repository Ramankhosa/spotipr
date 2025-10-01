import { NextRequest, NextResponse } from 'next/server'

// Force dynamic rendering for API routes that use headers
export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { verifyJWT } from '@/lib/auth'

async function getUserFromRequest(request: NextRequest) {
  // Extract token from Authorization header
  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  const token = authHeader.substring(7)

  // Verify JWT
  const payload = verifyJWT(token)
  if (!payload) {
    return null
  }

  // Check if token is expired
  const now = Math.floor(Date.now() / 1000)
  if (payload.exp < now) {
    return null
  }

  return payload.email
}

export async function POST(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const userEmail = await getUserFromRequest(request)

    if (!userEmail) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { projectId } = params
    const body = await request.json()
    const { userId } = body

    if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
    }

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

    // Check if the user to add exists (support both user ID and email)
    const trimmedInput = userId.trim()
    const userToAdd = await prisma.user.findFirst({
      where: {
        OR: [
          { id: trimmedInput },
          { email: trimmedInput }
        ]
      }
    })

    if (!userToAdd) {
      return NextResponse.json({ error: 'User not found. Please enter a valid user ID or email address.' }, { status: 404 })
    }

    // Check if user is already a collaborator
    const existingCollaborator = await prisma.projectCollaborator.findFirst({
      where: {
        projectId,
        userId: userToAdd.id
      }
    })

    if (existingCollaborator) {
      return NextResponse.json({ error: 'User is already a collaborator on this project' }, { status: 400 })
    }

    // Add collaborator
    await prisma.projectCollaborator.create({
      data: {
        projectId,
        userId: userToAdd.id,
        addedBy: projectAccess.userId // The owner who added them
      }
    })

    // Fetch updated project with collaborators
    const updatedProject = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        collaborators: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true
              }
            }
          }
        }
      }
    })

    return NextResponse.json({ project: updatedProject })
  } catch (error) {
    console.error('Failed to add collaborator:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
