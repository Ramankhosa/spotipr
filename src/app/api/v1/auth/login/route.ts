import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { verifyPassword, generateJWT, generateRefreshToken, storeRefreshToken, createAuditLog } from '@/lib/auth'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password } = loginSchema.parse(body)

    // Find user with tenant (include selected plan info for payment-pending users)
    const user = await prisma.user.findUnique({
      where: { email },
      include: { 
        tenant: {
          select: {
            id: true,
            atiId: true,
            status: true,
            registrationSource: true,
            selectedPlanCode: true,
            selectedBillingCycle: true
          }
        } 
      }
    })

    if (!user) {
      return NextResponse.json(
        { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
        { status: 401 }
      )
    }

    // Verify password
    if (!user.passwordHash) {
      // Check if this is a social login user
      if (user.oauthProvider) {
        const providerName = user.oauthProvider.charAt(0) + user.oauthProvider.slice(1).toLowerCase()
        return NextResponse.json(
          {
            code: 'SOCIAL_LOGIN_REQUIRED',
            message: `This account uses ${providerName} login. Please sign in with ${providerName} instead.`,
            provider: user.oauthProvider.toLowerCase()
          },
          { status: 401 }
        )
      }
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

    // Require verified email (disabled by default; enable with ENFORCE_EMAIL_VERIFICATION=true)
    if (process.env.ENFORCE_EMAIL_VERIFICATION === 'true' && !user.emailVerified) {
      return NextResponse.json(
        { code: 'EMAIL_NOT_VERIFIED', message: 'Please verify your email address. Check your inbox for the verification link.' },
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

    // Check if this is a social login user (OAuth users don't need ATI token validation)
    const isSocialLogin = !!user.oauthProvider

    // Determine scope based on tenant membership
    const isPlatformScope = !!(user.tenantId && user.tenant?.atiId === 'PLATFORM')
    const isTenantScope = !!(user.tenantId && user.tenant?.atiId !== 'PLATFORM')

    // For non-social login users, validate ATI token
    if (!isSocialLogin && user.signupAtiTokenId) {
      const signupToken = await prisma.aTIToken.findUnique({
        where: { id: user.signupAtiTokenId },
        include: { tenant: true }
      })

      if (signupToken) {
        // Check if signup token is still valid - enforce all inactive statuses
        if (signupToken.status === 'REVOKED') {
          return NextResponse.json(
            { code: 'SIGNUP_TOKEN_REVOKED', message: 'Your signup ATI token has been revoked. Please contact your administrator.' },
            { status: 401 }
          )
        }

        if (signupToken.status === 'SUSPENDED') {
          return NextResponse.json(
            { code: 'SIGNUP_TOKEN_SUSPENDED', message: 'Your signup ATI token has been suspended. Please contact your administrator.' },
            { status: 401 }
          )
        }

        if (signupToken.status === 'INACTIVE') {
          return NextResponse.json(
            { code: 'SIGNUP_TOKEN_INACTIVE', message: 'Your signup ATI token is inactive. Please contact your administrator.' },
            { status: 401 }
          )
        }

        if (signupToken.status === 'EXPIRED' || (signupToken.expiresAt && new Date() > signupToken.expiresAt)) {
          return NextResponse.json(
            { code: 'SIGNUP_TOKEN_EXPIRED', message: 'Your signup ATI token has expired. Please contact your administrator.' },
            { status: 401 }
          )
        }

        // ==========================================================================
        // USED_UP STATUS - DO NOT BLOCK FOR LOGIN
        // ==========================================================================
        // USED_UP only affects NEW signups, not existing users logging in.
        // The token's maxUses controls how many users can sign up with it,
        // not whether existing users can log in.
        // 
        // Existing users retain access until:
        // - Token expiry (expiresAt) - checked above
        // - Token revocation (REVOKED status) - checked above
        // - Token suspension (SUSPENDED status) - checked above
        // - Token made inactive (INACTIVE status) - checked above
        // - Tenant status changes - checked below
        if (signupToken.status === 'USED_UP') {
          // Log for monitoring but ALLOW login - this is expected behavior
          console.log(`[Login] User ${user.email} logging in with USED_UP token ${signupToken.fingerprint} (type: ${signupToken.tokenType})`)
          // Continue - do NOT return an error here
        }
      }
    }

    // Validate scope: every user must have exactly one scope
    if (!isPlatformScope && !isTenantScope) {
      return NextResponse.json(
        { code: 'INVALID_SCOPE', message: 'User has invalid tenant association. Please contact administrator.' },
        { status: 401 }
      )
    }

    // Check tenant status - allow PENDING_PAYMENT for login (service checks handle blocking)
    if (user.tenant && user.tenant.status !== 'ACTIVE' && user.tenant.status !== 'PENDING_PAYMENT') {
      const scopeType = isPlatformScope ? 'platform' : 'tenant'
      return NextResponse.json(
        { code: 'SCOPE_INACTIVE', message: `${scopeType} scope is inactive. Please contact administrator.` },
        { status: 401 }
      )
    }

    // Track if user needs to complete payment (for frontend redirect)
    const isPendingPayment = user.tenant?.status === 'PENDING_PAYMENT'

    // Generate JWT with scope information (short-lived access token)
    const accessToken = generateJWT({
      sub: user.id,
      email: user.email,
      tenant_id: user.tenantId, // Always set - no more null for super admin
      roles: user.roles,
      ati_id: user.tenant?.atiId || null,
      tenant_ati_id: user.tenant?.atiId || null, // For middleware validation
      scope: isPlatformScope ? 'platform' : 'tenant' // Add explicit scope
    })

    // Get request metadata for token tracking
    const ip = request.headers.get('x-forwarded-for') ||
               request.headers.get('x-real-ip') ||
               'unknown'
    const userAgent = request.headers.get('user-agent') || undefined

    // Generate and store refresh token (long-lived, in httpOnly cookie)
    const refreshTokenData = generateRefreshToken(user.id)
    await storeRefreshToken(user.id, refreshTokenData, { userAgent, ipAddress: ip })

    // Audit log
    await createAuditLog({
      actorUserId: user.id,
      tenantId: user.tenantId || undefined, // Convert null to undefined for audit log
      action: 'USER_LOGIN',
      resource: `user:${user.id}`,
      ip,
      meta: {
        email: user.email,
        roles: user.roles,
        scope: isPlatformScope ? 'platform' : 'tenant',
        tenant_ati_id: user.tenant?.atiId
      }
    })

    // Create response with access token in body
    // Include payment_required flag for frontend to handle redirect
    const responseData: Record<string, any> = {
      token: accessToken,
      expires_in: 900 // 15 minutes in seconds (matches JWT_EXPIRES_IN)
    }

    // If payment pending, include info for frontend to redirect
    if (isPendingPayment) {
      responseData.payment_required = true
      responseData.redirect_url = '/pricing?checkout=true'
      responseData.plan_code = user.tenant?.selectedPlanCode
      responseData.billing_cycle = user.tenant?.selectedBillingCycle
    }

    const response = NextResponse.json(responseData, { status: 200 })

    // Set refresh token as httpOnly cookie (not accessible via JavaScript - XSS protection)
    response.cookies.set('refresh_token', refreshTokenData.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/'
    })

    return response

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


