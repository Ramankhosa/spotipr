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
          message: 'Session missing or expired. Please log in again.',
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
          message: 'Session expired or invalid. Please log in again.',
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
          message: 'User not found. Please log in again.',
          status: 401
        }
      }
    }

    // Check if user is active
    if (user.status !== 'ACTIVE') {
      return {
        user: null,
        error: {
          code: 'USER_SUSPENDED',
          message: 'User account is suspended.',
          status: 401
        }
      }
    }

    // For non-social login users, validate ATI token status
    if (!user.oauthProvider) {
      if (!user.signupAtiTokenId) {
        return {
          user: null,
          error: {
            code: 'MISSING_SIGNUP_TOKEN',
            message: 'User signup ATI token not found.',
            status: 401
          }
        }
      }

      // Validate ATI token is still active (not suspended, revoked, etc.)
      const signupToken = await prisma.aTIToken.findUnique({
        where: { id: user.signupAtiTokenId }
      })

      if (!signupToken) {
        return {
          user: null,
          error: {
            code: 'ATI_TOKEN_NOT_FOUND',
            message: 'Your signup ATI token was not found. Please contact your administrator.',
            status: 401
          }
        }
      }

      // Check for revoked status
      if (signupToken.status === 'REVOKED') {
        return {
          user: null,
          error: {
            code: 'ATI_TOKEN_REVOKED',
            message: 'Your ATI token has been revoked. Please contact your administrator.',
            status: 401
          }
        }
      }

      // Check for suspended status
      if (signupToken.status === 'SUSPENDED') {
        return {
          user: null,
          error: {
            code: 'ATI_TOKEN_SUSPENDED',
            message: 'Your ATI token has been suspended. Please contact your administrator.',
            status: 401
          }
        }
      }

      // Check for inactive status
      if (signupToken.status === 'INACTIVE') {
        return {
          user: null,
          error: {
            code: 'ATI_TOKEN_INACTIVE',
            message: 'Your ATI token is inactive. Please contact your administrator.',
            status: 401
          }
        }
      }

      // Check for expired status (either marked as expired or actually expired)
      if (signupToken.status === 'EXPIRED' || (signupToken.expiresAt && new Date() > signupToken.expiresAt)) {
        // Update status to EXPIRED if it was detected via expiration date
        if (signupToken.status !== 'EXPIRED' && signupToken.expiresAt && new Date() > signupToken.expiresAt) {
          await prisma.aTIToken.update({
            where: { id: signupToken.id },
            data: { status: 'EXPIRED' }
          })
        }
        return {
          user: null,
          error: {
            code: 'ATI_TOKEN_EXPIRED',
            message: 'Your ATI token has expired. Please contact your administrator.',
            status: 401
          }
        }
      }

      // Check for used up status (quota exceeded)
      if (signupToken.status === 'USED_UP') {
        return {
          user: null,
          error: {
            code: 'ATI_TOKEN_QUOTA_EXCEEDED',
            message: 'Your ATI token quota has been exceeded. Please contact your administrator.',
            status: 401
          }
        }
      }

      // Only allow ACTIVE or ISSUED tokens
      if (signupToken.status !== 'ACTIVE' && signupToken.status !== 'ISSUED') {
        return {
          user: null,
          error: {
            code: 'ATI_TOKEN_INVALID_STATUS',
            message: 'Your ATI token is not active. Please contact your administrator.',
            status: 401
          }
        }
      }
    }

    // Check tenant status if user has a tenant
    if (user.tenant && user.tenant.status !== 'ACTIVE') {
      return {
        user: null,
        error: {
          code: 'TENANT_INACTIVE',
          message: 'Tenant is not active.',
          status: 401
        }
      }
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roles: user.roles,
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
        message: 'Authentication failed. Please log in again.',
        status: 401
      }
    }
  }
}

