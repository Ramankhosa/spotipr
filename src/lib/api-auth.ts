import { NextRequest } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'

/**
 * Verify user authentication and authorization for patent access
 * Checks if the authenticated user has access to the specified patent
 */
export async function verifyAuthForPatent(
  request: NextRequest,
  patentId: string
): Promise<{
  authorized: boolean
  user?: any
  error?: string
  status?: number
}> {
  try {
    // First authenticate the user
    const authResult = await authenticateUser(request)
    if (authResult.error) {
      return {
        authorized: false,
        error: authResult.error.message,
        status: authResult.error.status
      }
    }

    const user = authResult.user

    // Check if patent exists and user has access to it
    const patent = await prisma.patent.findUnique({
      where: { id: patentId },
      include: {
        project: {
          include: {
            collaborators: {
              where: { userId: user.id },
              select: { role: true }
            }
          }
        }
      }
    })

    if (!patent) {
      return {
        authorized: false,
        error: 'Patent not found',
        status: 404
      }
    }

    // Check if user is the project owner or a collaborator
    const isOwner = patent.project.userId === user.id
    const isCollaborator = patent.project.collaborators.length > 0

    if (!isOwner && !isCollaborator) {
      return {
        authorized: false,
        error: 'Access denied: You do not have permission to access this patent',
        status: 403
      }
    }

    return {
      authorized: true,
      user
    }
  } catch (error) {
    console.error('Error verifying auth for patent:', error)
    return {
      authorized: false,
      error: 'Internal server error during authentication',
      status: 500
    }
  }
}






