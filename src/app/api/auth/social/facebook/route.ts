import { NextRequest, NextResponse } from 'next/server'
import { getAuthorizationUrl, validateOAuthConfig } from '@/lib/oauth-config'
import { encodeOAuthState, normalizePaidSignupParams } from '@/lib/oauth-state'

export async function GET(request: NextRequest) {
  try {
    // Validate OAuth configuration
    if (!validateOAuthConfig('facebook')) {
      return NextResponse.json(
        { code: 'OAUTH_CONFIG_MISSING', message: 'Facebook OAuth configuration is missing' },
        { status: 500 }
      )
    }

    const searchParams = request.nextUrl.searchParams
    const flowParam = searchParams.get('flow')
    const paidParams = flowParam === 'paid'
      ? normalizePaidSignupParams(searchParams.get('plan'), searchParams.get('cycle'))
      : null

    const state = paidParams
      ? encodeOAuthState({
          flow: 'paid',
          planCode: paidParams.planCode,
          billingCycle: paidParams.billingCycle,
          nonce: crypto.randomUUID(),
        })
      : crypto.randomUUID()

    // Generate authorization URL
    const authUrl = getAuthorizationUrl('facebook', state, request.nextUrl.origin)

    return NextResponse.redirect(authUrl)
  } catch (error) {
    console.error('Facebook OAuth initiation error:', error)
    return NextResponse.json(
      { code: 'OAUTH_INIT_ERROR', message: 'Failed to initiate Facebook OAuth' },
      { status: 500 }
    )
  }
}
