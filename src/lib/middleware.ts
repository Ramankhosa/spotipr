import { NextRequest, NextResponse } from 'next/server'
import { verifyJWT, JWTPayload } from '@/lib/auth'

export interface AuthenticatedRequest extends NextRequest {
  user?: JWTPayload
}

export async function authenticateRequest(request: NextRequest): Promise<{
  user: JWTPayload | null
  error: NextResponse | null
}> {
  // Extract token from Authorization header
  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      user: null,
      error: NextResponse.json(
        { code: 'NO_TOKEN', message: 'Authorization token required' },
        { status: 401 }
      )
    }
  }

  const token = authHeader.substring(7) // Remove 'Bearer ' prefix

  // Verify JWT
  const payload = verifyJWT(token)
  if (!payload) {
    return {
      user: null,
      error: NextResponse.json(
        { code: 'INVALID_TOKEN', message: 'Invalid or expired token' },
        { status: 401 }
      )
    }
  }

  // Check if token is expired
  const now = Math.floor(Date.now() / 1000)
  if (payload.exp < now) {
    return {
      user: null,
      error: NextResponse.json(
        { code: 'EXPIRED_TOKEN', message: 'Token has expired' },
        { status: 401 }
      )
    }
  }

  return { user: payload, error: null }
}

export function requireRole(allowedRoles: string[]) {
  return async function roleMiddleware(request: NextRequest): Promise<NextResponse | null> {
    const { user, error } = await authenticateRequest(request)
    if (error) return error

    if (!allowedRoles.includes(user!.role)) {
      return NextResponse.json(
        { code: 'FORBIDDEN', message: 'Insufficient permissions' },
        { status: 403 }
      )
    }

    return null // Continue to next handler
  }
}

export function requireTenantRole(allowedRoles: string[]) {
  return async function tenantRoleMiddleware(request: NextRequest): Promise<NextResponse | null> {
    const { user, error } = await authenticateRequest(request)
    if (error) return error

    // For tenant-level operations, ensure user is in tenant scope (not platform scope)
    if (!user!.tenant_id || user!.tenant_ati_id === 'PLATFORM') {
      return NextResponse.json(
        { code: 'FORBIDDEN', message: 'Platform scope users cannot access tenant-specific endpoints' },
        { status: 403 }
      )
    }

    // Check if user has required role within their tenant
    if (!allowedRoles.includes(user!.role)) {
      return NextResponse.json(
        { code: 'FORBIDDEN', message: 'Insufficient permissions for tenant operations' },
        { status: 403 }
      )
    }

    return null // Continue to next handler
  }
}

export function requirePlatformScope() {
  return async function platformScopeMiddleware(request: NextRequest): Promise<NextResponse | null> {
    const { user, error } = await authenticateRequest(request)
    if (error) return error

    // For platform-level operations, ensure user is in platform scope
    if (!user!.tenant_id || user!.tenant_ati_id !== 'PLATFORM') {
      return NextResponse.json(
        { code: 'FORBIDDEN', message: 'Tenant scope users cannot access platform endpoints' },
        { status: 403 }
      )
    }

    // Ensure user has SUPER_ADMIN role for platform operations
    if (user!.role !== 'SUPER_ADMIN') {
      return NextResponse.json(
        { code: 'FORBIDDEN', message: 'Super Admin role required for platform operations' },
        { status: 403 }
      )
    }

    return null // Continue to next handler
  }
}
