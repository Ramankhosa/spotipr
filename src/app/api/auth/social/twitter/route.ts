import { NextRequest, NextResponse } from 'next/server'
import { getRedirectUri, validateOAuthConfig } from '@/lib/oauth-config'
import { encodeOAuthState, normalizePaidSignupParams } from '@/lib/oauth-state'
import crypto from 'crypto'

export async function GET(request: NextRequest) {
  try {
    // Validate OAuth configuration
    if (!validateOAuthConfig('twitter')) {
      return NextResponse.json(
        { code: 'OAUTH_CONFIG_MISSING', message: 'Twitter OAuth configuration is missing' },
        { status: 500 }
      )
    }

    // Generate PKCE challenge for Twitter OAuth 2.0
    const codeVerifier = crypto.randomBytes(32).toString('base64url')
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest().toString('base64url')

    const searchParams = request.nextUrl.searchParams
    const flowParam = searchParams.get('flow')
    const paidParams = flowParam === 'paid'
      ? normalizePaidSignupParams(searchParams.get('plan'), searchParams.get('cycle'))
      : null

    // Generate state parameter for CSRF protection
    const state = crypto.randomUUID()

    // Store PKCE verifier and state in session (in production, use secure session store)
    // For now, we'll encode them in the state parameter
    const encodedState = encodeOAuthState({
      state,
      codeVerifier,
      ...(paidParams ? {
        flow: 'paid',
        planCode: paidParams.planCode,
        billingCycle: paidParams.billingCycle,
      } : {})
    })

    const redirectUri = getRedirectUri('twitter', request.nextUrl.origin)
    const params = new URLSearchParams({
      client_id: process.env.TWITTER_CLIENT_ID!,
      redirect_uri: redirectUri,
      scope: 'tweet.read users.read offline.access',
      response_type: 'code',
      state: encodedState,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    })

    const authUrl = `https://twitter.com/i/oauth2/authorize?${params.toString()}`

    return NextResponse.redirect(authUrl)
  } catch (error) {
    console.error('Twitter OAuth initiation error:', error)
    return NextResponse.json(
      { code: 'OAUTH_INIT_ERROR', message: 'Failed to initiate Twitter OAuth' },
      { status: 500 }
    )
  }
}
