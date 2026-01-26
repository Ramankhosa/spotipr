import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateJWT, generateRefreshToken, storeRefreshToken, createAuditLog } from '@/lib/auth'
import { getAppOrigin, getRedirectUri, oauthConfig } from '@/lib/oauth-config'
import { parsePaidSignupState } from '@/lib/oauth-state'

// Force dynamic rendering since we access search params
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const appOrigin = getAppOrigin(request.nextUrl.origin)
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    // Handle OAuth errors
    if (error) {
      console.error('Facebook OAuth error:', error)
      return NextResponse.redirect(
        new URL('/login?error=oauth_error', appOrigin)
      )
    }

    if (!code) {
      return NextResponse.redirect(
        new URL('/login?error=no_code', appOrigin)
      )
    }

    const redirectUri = getRedirectUri('facebook', request.nextUrl.origin)

    // Exchange authorization code for access token
    const tokenParams = new URLSearchParams({
      client_id: oauthConfig.facebook.clientId!,
      client_secret: oauthConfig.facebook.clientSecret!,
      redirect_uri: redirectUri,
      code: code
    })

    const tokenResponse = await fetch(`${oauthConfig.facebook.tokenUrl}?${tokenParams.toString()}`, {
      method: 'GET'
    })

    if (!tokenResponse.ok) {
      throw new Error('Failed to exchange code for access token')
    }

    const tokenData = await tokenResponse.json()
    const accessToken = tokenData.access_token

    // Get user info from Facebook
    const userInfoResponse = await fetch(oauthConfig.facebook.userInfoUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    })

    if (!userInfoResponse.ok) {
      throw new Error('Failed to fetch Facebook user info')
    }

    const facebookUser = await userInfoResponse.json()

    // Check if user already exists with this Facebook account
    let user = await prisma.user.findFirst({
      where: {
        oauthProvider: 'FACEBOOK',
        oauthProviderId: facebookUser.id
      },
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
      // Check if user exists with same email
      const existingUser = await prisma.user.findUnique({
        where: { email: facebookUser.email },
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

      if (existingUser) {
        // Link existing account with Facebook OAuth
        user = await prisma.user.update({
          where: { id: existingUser.id },
          data: {
            oauthProvider: 'FACEBOOK',
            oauthProviderId: facebookUser.id,
            oauthProfile: facebookUser,
            emailVerified: true
          },
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
      } else {
        const paidState = parsePaidSignupState(state)

        // New user - redirect to registration completion
        const pendingData = {
          provider: 'facebook',
          providerId: facebookUser.id,
          email: facebookUser.email,
          name: facebookUser.name,
          firstName: facebookUser.first_name,
          lastName: facebookUser.last_name,
          profile: facebookUser,
          exp: Date.now() + 15 * 60 * 1000,
          ...(paidState ? {
            flow: 'paid',
            planCode: paidState.planCode,
            billingCycle: paidState.billingCycle,
          } : {})
        }

        const pendingToken = Buffer.from(JSON.stringify(pendingData)).toString('base64url')

        const completionPath = paidState
          ? '/register/complete-social-paid'
          : '/institutional-access/complete-social'

        return NextResponse.redirect(
          new URL(`${completionPath}?token=${pendingToken}&provider=facebook`, appOrigin)
        )
      }
    }

    // User exists - proceed with login
    // Get request metadata
    const ip = request.headers.get('x-forwarded-for') ||
               request.headers.get('x-real-ip') ||
               'unknown'

    // Check for inactive tenant statuses (SUSPENDED, etc.) - but allow PENDING_PAYMENT
    const allowedStatuses = ['ACTIVE', 'PENDING_PAYMENT']
    if (user.tenant && !allowedStatuses.includes(user.tenant.status)) {
      return NextResponse.redirect(
        new URL('/login?error=tenant_inactive', appOrigin)
      )
    }

    // Track if payment is pending (for redirect destination)
    const isPendingPayment = user.tenant?.status === 'PENDING_PAYMENT'

    // Generate full JWT token (service-level checks will handle access control)
    const accessTokenJWT = generateJWT({
      sub: user.id,
      email: user.email,
      tenant_id: user.tenantId,
      roles: user.roles,
      ati_id: user.tenant?.atiId || null,
      tenant_ati_id: user.tenant?.atiId || null,
      scope: user.tenant?.atiId === 'PLATFORM' ? 'platform' : 'tenant'
    })

    // Generate and store refresh token
    const refreshTokenData = generateRefreshToken(user.id)
    await storeRefreshToken(user.id, refreshTokenData, {
      userAgent: request.headers.get('user-agent') || undefined,
      ipAddress: ip
    })

    // Audit log
    await createAuditLog({
      actorUserId: user.id,
      tenantId: user.tenantId || undefined,
      action: 'USER_LOGIN',
      resource: `user:${user.id}`,
      ip,
      meta: {
        email: user.email,
        roles: user.roles,
        login_method: 'facebook_oauth',
        oauth_provider: 'FACEBOOK'
      }
    })

    // Redirect to appropriate page based on payment status
    const redirectPath = isPendingPayment ? '/pricing?checkout=true' : '/dashboard'
    const response = NextResponse.redirect(
      new URL(redirectPath, appOrigin)
    )

    // Set tokens as cookies
    response.cookies.set('refresh_token', refreshTokenData.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 7,
      path: '/'
    })

    response.cookies.set('access_token', accessTokenJWT, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60,
      path: '/'
    })

    return response

  } catch (error) {
    console.error('Facebook OAuth callback error:', error)
    return NextResponse.redirect(
      new URL('/login?error=oauth_callback_failed', getAppOrigin(request.nextUrl.origin))
    )
  }
}
