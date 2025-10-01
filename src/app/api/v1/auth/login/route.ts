import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { verifyPassword, generateJWT, createAuditLog } from '@/lib/auth'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password } = loginSchema.parse(body)

    // Find user with tenant
    const user = await prisma.user.findUnique({
      where: { email },
      include: { tenant: true }
    })

    if (!user) {
      return NextResponse.json(
        { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
        { status: 401 }
      )
    }

    // Verify password
    if (!user.passwordHash) {
      return NextResponse.json(
        { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
        { status: 401 }
      )
    }
    
    const isPasswordValid = await verifyPassword(password, user.passwordHash)
    if (!isPasswordValid) {
      return NextResponse.json(
        { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
        { status: 401 }
      )
    }

    // Check user status
    if (user.status !== 'ACTIVE') {
      return NextResponse.json(
        { code: 'USER_SUSPENDED', message: 'User account is suspended' },
        { status: 401 }
      )
    }

    // Determine scope based on tenant membership
    const isPlatformScope = user.tenantId && user.tenant?.atiId === 'PLATFORM'
    const isTenantScope = user.tenantId && user.tenant?.atiId !== 'PLATFORM'

    // Validate scope: every user must have exactly one scope
    if (!isPlatformScope && !isTenantScope) {
      return NextResponse.json(
        { code: 'INVALID_SCOPE', message: 'User has invalid tenant association. Please contact administrator.' },
        { status: 401 }
      )
    }

    // Check tenant status
    if (user.tenant && user.tenant.status !== 'ACTIVE') {
      const scopeType = isPlatformScope ? 'platform' : 'tenant'
      return NextResponse.json(
        { code: 'SCOPE_INACTIVE', message: `${scopeType} scope is inactive. Please contact administrator.` },
        { status: 401 }
      )
    }

    // Validate ATI token based on scope
    if (!user.signupAtiTokenId) {
      const scopeType = isPlatformScope ? 'platform' : 'tenant'
      return NextResponse.json(
        { code: 'MISSING_SIGNUP_TOKEN', message: `User ${scopeType} ATI token not found. Please contact your administrator.` },
        { status: 401 }
      )
    }

    const signupToken = await prisma.aTIToken.findUnique({
      where: { id: user.signupAtiTokenId },
      include: { tenant: true }
    })

    if (!signupToken) {
      return NextResponse.json(
        { code: 'SIGNUP_TOKEN_NOT_FOUND', message: 'User signup ATI token not found. Please contact your administrator.' },
        { status: 401 }
      )
    }

    // Verify token belongs to the correct scope
    const tokenScope = signupToken.tenant?.atiId === 'PLATFORM' ? 'platform' : 'tenant'
    const userScope = isPlatformScope ? 'platform' : 'tenant'

    if (tokenScope !== userScope) {
      return NextResponse.json(
        { code: 'SCOPE_MISMATCH', message: 'ATI token scope does not match user scope.' },
        { status: 401 }
      )
    }

    // Check if signup token is still valid
    if (signupToken.status === 'REVOKED') {
      return NextResponse.json(
        { code: 'SIGNUP_TOKEN_REVOKED', message: 'Your signup ATI token has been revoked. Please contact your administrator.' },
        { status: 401 }
      )
    }

    if (signupToken.status === 'EXPIRED' || (signupToken.expiresAt && new Date() > signupToken.expiresAt)) {
      return NextResponse.json(
        { code: 'SIGNUP_TOKEN_EXPIRED', message: 'Your signup ATI token has expired. Please contact your administrator.' },
        { status: 401 }
      )
    }

    if (signupToken.status === 'USED_UP' || (signupToken.maxUses && signupToken.usageCount >= signupToken.maxUses)) {
      return NextResponse.json(
        { code: 'SIGNUP_TOKEN_USED_UP', message: 'Your signup ATI token usage limit has been reached. Please contact your administrator.' },
        { status: 401 }
      )
    }

    // Generate JWT with scope information
    const token = generateJWT({
      sub: user.id,
      email: user.email,
      tenant_id: user.tenantId, // Always set - no more null for super admin
      role: user.role,
      ati_id: user.tenant?.atiId || null,
      tenant_ati_id: user.tenant?.atiId || null, // For middleware validation
      scope: isPlatformScope ? 'platform' : 'tenant' // Add explicit scope
    })

    // Audit log
    const ip = request.headers.get('x-forwarded-for') ||
               request.headers.get('x-real-ip') ||
               'unknown'

    await createAuditLog({
      actorUserId: user.id,
      tenantId: user.tenantId || undefined, // Convert null to undefined for audit log
      action: 'USER_LOGIN',
      resource: `user:${user.id}`,
      ip,
      meta: {
        email: user.email,
        role: user.role,
        scope: isPlatformScope ? 'platform' : 'tenant',
        tenant_ati_id: user.tenant?.atiId
      }
    })

    return NextResponse.json({
      token,
      expires_in: 3600 // 1 hour in seconds
    }, { status: 200 })

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 'INVALID_INPUT', message: 'Invalid input data', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Login error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}
