import { NextRequest } from 'next/server'
import { verifyJWT } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * Replacement for NextAuth getServerSession
 * Authenticates user from JWT token in Authorization header
 */
export async function authenticateUser(request: NextRequest): Promise<{
  user: any
  error: { code: string; message: string; status: number } | null
}> {
  try {
    // Extract token from Authorization header
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        user: null,
        error: {
          code: 'NO_TOKEN',
          message: 'Authorization token required',
          status: 401
        }
      }
    }

    const token = authHeader.substring(7)
    const payload = verifyJWT(token)

    if (!payload) {
      return {
        user: null,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid or expired token',
          status: 401
        }
      }
    }

    // Get full user data from database
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { tenant: true }
    })

    if (!user) {
      return {
        user: null,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          status: 401
        }
      }
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
        tenant: user.tenant
      },
      error: null
    }
  } catch (error) {
    return {
      user: null,
      error: {
        code: 'AUTH_ERROR',
        message: 'Authentication failed',
        status: 401
      }
    }
  }
}

