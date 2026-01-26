import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { createPaidSignup } from '@/lib/auto-tenant-service'
import { generateJWT, generateRefreshToken, storeRefreshToken } from '@/lib/auth'

const completePaidSignupSchema = z.object({
  pendingToken: z.string().min(1),
  companyName: z.string().max(200).optional()
})

const PLAN_CODES = new Set(['BASIC', 'PRO', 'ENTERPRISE'])
const BILLING_CYCLES = new Set(['monthly', 'yearly'])

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { pendingToken, companyName } = completePaidSignupSchema.parse(body)

    let pendingData: {
      provider: string
      providerId: string
      email: string
      name?: string
      firstName?: string
      lastName?: string
      profile?: any
      exp: number
      planCode: string
      billingCycle: string
    }

    try {
      pendingData = JSON.parse(Buffer.from(pendingToken, 'base64url').toString())
    } catch {
      return NextResponse.json(
        { code: 'INVALID_PENDING_TOKEN', message: 'Invalid or expired registration token' },
        { status: 400 }
      )
    }

    if (Date.now() > pendingData.exp) {
      return NextResponse.json(
        { code: 'TOKEN_EXPIRED', message: 'Registration session has expired. Please try again.' },
        { status: 400 }
      )
    }

    if (!pendingData.provider || !pendingData.providerId || !pendingData.email) {
      return NextResponse.json(
        { code: 'INVALID_PENDING_TOKEN', message: 'Invalid or expired registration token' },
        { status: 400 }
      )
    }

    const planCode = pendingData.planCode?.toUpperCase()
    const billingCycle = pendingData.billingCycle?.toLowerCase()

    if (!PLAN_CODES.has(planCode) || !BILLING_CYCLES.has(billingCycle)) {
      return NextResponse.json(
        { code: 'INVALID_PLAN', message: 'Invalid plan selection for paid signup.' },
        { status: 400 }
      )
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: pendingData.email }
    })

    if (existingUser) {
      return NextResponse.json(
        { code: 'EMAIL_IN_USE', message: 'Email address is already registered. Please log in instead.' },
        { status: 400 }
      )
    }

    const result = await createPaidSignup({
      email: pendingData.email,
      firstName: pendingData.firstName,
      lastName: pendingData.lastName,
      companyName: companyName || undefined,
      planCode: planCode as 'BASIC' | 'PRO' | 'ENTERPRISE',
      billingCycle: billingCycle as 'monthly' | 'yearly',
      oauthProvider: pendingData.provider.toUpperCase(),
      oauthProviderId: pendingData.providerId,
      oauthProfile: pendingData.profile,
    })

    if (!result.success) {
      return NextResponse.json(
        { code: 'SIGNUP_FAILED', message: result.error || 'Failed to create account' },
        { status: 400 }
      )
    }

    // Create audit log
    const ip = request.headers.get('x-forwarded-for') ||
               request.headers.get('x-real-ip') ||
               'unknown'

    await prisma.auditLog.create({
      data: {
        actorUserId: result.user!.id,
        tenantId: result.tenant!.id,
        action: 'USER_SIGNUP',
        resource: `user:${result.user!.id}`,
        ip,
        meta: {
          email: pendingData.email,
          signup_method: 'paid_social',
          plan_code: planCode,
          billing_cycle: billingCycle,
          tenant_ati_id: result.tenant!.atiId,
          registration_source: 'PAID_SIGNUP',
          oauth_provider: pendingData.provider.toUpperCase()
        }
      }
    })

    const user = await prisma.user.findUnique({
      where: { id: result.user!.id },
      include: { tenant: true }
    })

    if (!user || !user.tenant) {
      return NextResponse.json(
        { code: 'USER_NOT_FOUND', message: 'User creation failed. Please try again.' },
        { status: 500 }
      )
    }

    // Generate full JWT token - service-level checks will block access to product features
    // until payment is completed and tenant status changes from PENDING_PAYMENT to ACTIVE
    const accessToken = generateJWT({
      sub: user.id,
      email: user.email,
      tenant_id: user.tenantId,
      roles: user.roles,
      ati_id: user.tenant?.atiId || null,
      tenant_ati_id: user.tenant?.atiId || null,
      scope: 'tenant'
    })

    // Generate and store refresh token for payment flow continuity
    const refreshTokenData = generateRefreshToken(user.id)
    await storeRefreshToken(user.id, refreshTokenData, {
      userAgent: request.headers.get('user-agent') || undefined,
      ipAddress: ip
    })

    const response = NextResponse.json({
      success: true,
      user_id: user.id,
      tenant_id: user.tenantId,
      roles: user.roles,
      is_paid_signup: true,
      requires_payment: true,
      plan_code: planCode,
      billing_cycle: billingCycle,
      token: accessToken,
      redirect_url: '/pricing?checkout=true'
    }, { status: 201 })

    // Set refresh token as httpOnly cookie
    response.cookies.set('refresh_token', refreshTokenData.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/'
    })

    // Set access token cookie
    response.cookies.set('access_token', accessToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60, // 15 minutes
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

    console.error('Paid social signup completion error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}
