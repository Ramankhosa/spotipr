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

export async function DELETE(
  request: NextRequest,
  { params }: { params: { projectId: string; collaboratorId: string } }
) {
  try {
    const userEmail = await getUserFromRequest(request)

    if (!userEmail) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { projectId, collaboratorId } = params

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

    // Only project owners can remove collaborators (for now)
    if (projectAccess.userId !== await prisma.user.findUnique({ where: { email: userEmail } }).then(u => u?.id)) {
      return NextResponse.json({ error: 'Only project owners can remove collaborators' }, { status: 403 })
    }

    // Remove collaborator
    const result = await prisma.projectCollaborator.deleteMany({
      where: {
        id: collaboratorId,
        projectId
      }
    })

    if (result.count === 0) {
      return NextResponse.json({ error: 'Collaborator not found' }, { status: 404 })
    }

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
    console.error('Failed to remove collaborator:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
