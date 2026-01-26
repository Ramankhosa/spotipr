import { NextRequest, NextResponse } from 'next/server'
import { 
  verifyRefreshToken, 
  generateJWT, 
  generateRefreshToken,
  hashRefreshToken,
  validateStoredRefreshToken,
  revokeRefreshToken,
  storeRefreshToken
} from '@/lib/auth'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  try {
    // Get refresh token from HTTP-only cookie
    const cookieStore = await cookies()
    const refreshToken = cookieStore.get('refresh_token')?.value

    if (!refreshToken) {
      return NextResponse.json(
        { code: 'NO_REFRESH_TOKEN', message: 'No refresh token provided' },
        { status: 401 }
      )
    }

    // Step 1: Verify JWT signature and expiry
    const refreshPayload = verifyRefreshToken(refreshToken)
    if (!refreshPayload) {
      // Clear invalid refresh token cookie
      const response = NextResponse.json(
        { code: 'INVALID_REFRESH_TOKEN', message: 'Session expired. Please log in again.' },
        { status: 401 }
      )
      response.cookies.set('refresh_token', '', { maxAge: 0, path: '/' })
      return response
    }

    // Step 2: Validate token against database (check revocation, expiry)
    const tokenHash = hashRefreshToken(refreshToken)
    const validation = await validateStoredRefreshToken(tokenHash)
    
    if (!validation.valid) {
      const response = NextResponse.json(
        { 
          code: validation.error === 'TOKEN_REVOKED' ? 'SESSION_REVOKED' : 'SESSION_EXPIRED',
          message: validation.error === 'TOKEN_REVOKED' 
            ? 'Your session was revoked for security reasons. Please log in again.'
            : 'Session expired. Please log in again.'
        },
        { status: 401 }
      )
      response.cookies.set('refresh_token', '', { maxAge: 0, path: '/' })
      return response
    }

    const storedToken = validation.token
    const user = storedToken.user

    // Step 3: Check if user is still active
    if (user.status !== 'ACTIVE') {
      const response = NextResponse.json(
        { code: 'USER_INACTIVE', message: 'Your account has been deactivated. Please contact support.' },
        { status: 401 }
      )
      response.cookies.set('refresh_token', '', { maxAge: 0, path: '/' })
      return response
    }

    // Step 3.5: Validate ATI token status for enterprise users (non-OAuth users)
    if (!user.oauthProvider && user.signupAtiTokenId) {
      const signupToken = await prisma.aTIToken.findUnique({
        where: { id: user.signupAtiTokenId }
      })

      if (signupToken) {
        // Check for revoked status
        if (signupToken.status === 'REVOKED') {
          const response = NextResponse.json(
            { code: 'ATI_TOKEN_REVOKED', message: 'Your ATI token has been revoked. Please contact your administrator.' },
            { status: 401 }
          )
          response.cookies.set('refresh_token', '', { maxAge: 0, path: '/' })
          return response
        }

        // Check for suspended status
        if (signupToken.status === 'SUSPENDED') {
          const response = NextResponse.json(
            { code: 'ATI_TOKEN_SUSPENDED', message: 'Your ATI token has been suspended. Please contact your administrator.' },
            { status: 401 }
          )
          response.cookies.set('refresh_token', '', { maxAge: 0, path: '/' })
          return response
        }

        // Check for inactive status
        if (signupToken.status === 'INACTIVE') {
          const response = NextResponse.json(
            { code: 'ATI_TOKEN_INACTIVE', message: 'Your ATI token is inactive. Please contact your administrator.' },
            { status: 401 }
          )
          response.cookies.set('refresh_token', '', { maxAge: 0, path: '/' })
          return response
        }

        // Check for expired status
        if (signupToken.status === 'EXPIRED' || (signupToken.expiresAt && new Date() > signupToken.expiresAt)) {
          // Update status to EXPIRED if detected via expiration date
          if (signupToken.status !== 'EXPIRED' && signupToken.expiresAt && new Date() > signupToken.expiresAt) {
            await prisma.aTIToken.update({
              where: { id: signupToken.id },
              data: { status: 'EXPIRED' }
            })
          }
          const response = NextResponse.json(
            { code: 'ATI_TOKEN_EXPIRED', message: 'Your ATI token has expired. Please contact your administrator.' },
            { status: 401 }
          )
          response.cookies.set('refresh_token', '', { maxAge: 0, path: '/' })
          return response
        }

        // ==========================================================================
        // USED_UP STATUS - DO NOT BLOCK FOR TOKEN REFRESH
        // ==========================================================================
        // USED_UP only affects NEW signups, not existing users refreshing tokens.
        // The token's maxUses controls how many users can sign up with it,
        // not whether existing users can refresh their sessions.
        //
        // Existing users retain access until:
        // - Token expiry (expiresAt) - checked above
        // - Token revocation (REVOKED status) - checked above
        // - Token suspension (SUSPENDED status) - checked above
        // - Token made inactive (INACTIVE status) - checked above
        // - Tenant status changes - checked below
        if (signupToken.status === 'USED_UP') {
          // Log for monitoring but ALLOW refresh - this is expected behavior
          console.log(`[Refresh] User ${user.email} refreshing token with USED_UP ATI ${signupToken.fingerprint} (type: ${signupToken.tokenType})`)
          // Continue - do NOT return an error here
        }

        // Only allow ACTIVE, ISSUED, or USED_UP tokens for existing users
        // USED_UP is valid for existing users who already signed up
        const validStatusesForExistingUsers = ['ACTIVE', 'ISSUED', 'USED_UP']
        if (!validStatusesForExistingUsers.includes(signupToken.status)) {
          const response = NextResponse.json(
            { code: 'ATI_TOKEN_INVALID', message: 'Your ATI token is not active. Please contact your administrator.' },
            { status: 401 }
          )
          response.cookies.set('refresh_token', '', { maxAge: 0, path: '/' })
          return response
        }
      }
    }

    // Step 4: Determine user scope
    const isPlatformScope = user.tenantId && user.tenant?.atiId === 'PLATFORM'
    const isTenantScope = user.tenantId && user.tenant?.atiId !== 'PLATFORM'

    if (!isPlatformScope && !isTenantScope) {
      const response = NextResponse.json(
        { code: 'INVALID_SCOPE', message: 'User has invalid tenant association. Please contact support.' },
        { status: 401 }
      )
      response.cookies.set('refresh_token', '', { maxAge: 0, path: '/' })
      return response
    }

    // Step 5: Revoke the old refresh token (token rotation for security)
    await revokeRefreshToken(tokenHash, 'rotation')

    // Step 6: Generate new access token
    const newAccessToken = generateJWT({
      sub: user.id,
      email: user.email,
      tenant_id: user.tenantId,
      roles: user.roles,
      ati_id: user.tenant?.atiId || null,
      tenant_ati_id: user.tenant?.atiId || null,
      scope: isPlatformScope ? 'platform' : 'tenant'
    })

    // Step 7: Generate new refresh token (same family for rotation tracking)
    const ip = request.headers.get('x-forwarded-for') ||
               request.headers.get('x-real-ip') ||
               'unknown'
    const userAgent = request.headers.get('user-agent') || undefined
    
    const newRefreshTokenData = generateRefreshToken(user.id, storedToken.familyId)
    await storeRefreshToken(user.id, newRefreshTokenData, { userAgent, ipAddress: ip })

    // Step 8: Return new tokens
    const response = NextResponse.json({
      token: newAccessToken,
      expires_in: 900 // 15 minutes in seconds
    })

    // Set new refresh token as HTTP-only cookie
    response.cookies.set('refresh_token', newRefreshTokenData.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/'
    })

    return response

  } catch (error) {
    console.error('Token refresh error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Failed to refresh session. Please try again.' },
      { status: 500 }
    )
  }
}
