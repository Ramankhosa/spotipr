import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { validateATIToken, consumeATITokenForSignup, generateJWT, generateRefreshToken, storeRefreshToken, createAuditLog } from '@/lib/auth'
import { autoAssignToDefaultTeam } from '@/lib/org-access-service'
import { assignTrialPlanToTenant } from '@/lib/trial-plan-service'

const completeSignupSchema = z.object({
  atiToken: z.string().min(1),
  pendingToken: z.string().min(1) // Token from social OAuth flow
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { atiToken, pendingToken } = completeSignupSchema.parse(body)

    // Decode and validate the pending registration token
    let pendingData: {
      provider: string
      providerId: string
      email: string
      name?: string
      firstName?: string
      lastName?: string
      profile?: any
      exp: number
    }

    try {
      pendingData = JSON.parse(Buffer.from(pendingToken, 'base64url').toString())
    } catch {
      return NextResponse.json(
        { code: 'INVALID_PENDING_TOKEN', message: 'Invalid or expired registration token' },
        { status: 400 }
      )
    }

    // Check if token has expired (15 minutes validity)
    if (Date.now() > pendingData.exp) {
      return NextResponse.json(
        { code: 'TOKEN_EXPIRED', message: 'Registration session has expired. Please try again.' },
        { status: 400 }
      )
    }

    // Check if email is already in use
    const existingUser = await prisma.user.findUnique({
      where: { email: pendingData.email }
    })

    if (existingUser) {
      return NextResponse.json(
        { code: 'EMAIL_IN_USE', message: 'Email address is already registered. Please log in instead.' },
        { status: 400 }
      )
    }

    // Validate ATI token
    const tokenValidation = await validateATIToken(atiToken)

    if (!tokenValidation.valid) {
      return NextResponse.json(
        { code: tokenValidation.error, message: `ATI token validation failed: ${tokenValidation.error}` },
        { status: 400 }
      )
    }

    // Get full token with tenant info
    const fullToken = await prisma.aTIToken.findUnique({
      where: { id: tokenValidation.atiToken!.id },
      include: { tenant: true }
    })

    // Platform tokens cannot be used for regular signup
    if (fullToken?.tenant?.atiId === 'PLATFORM') {
      return NextResponse.json(
        { code: 'INVALID_ATI_TOKEN', message: 'Platform ATI tokens cannot be used for regular user signup' },
        { status: 400 }
      )
    }

    // Get the tenant
    const tenant = await prisma.tenant.findUnique({
      where: { id: tokenValidation.atiToken!.tenantId! }
    })

    if (!tenant || tenant.status !== 'ACTIVE') {
      return NextResponse.json(
        { code: 'TENANT_INACTIVE', message: 'Tenant is not active' },
        { status: 400 }
      )
    }

    // CRITICAL: Ensure tenant has an active TenantPlan - without this, service access fails
    // This is the same check as in the manual signup route for consistency
    const now = new Date()
    const existingTenantPlan = await prisma.tenantPlan.findFirst({
      where: {
        tenantId: tenant.id,
        status: 'ACTIVE',
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } }
        ]
      }
    })

    if (!existingTenantPlan) {
      const anyTenantPlan = await prisma.tenantPlan.findFirst({
        where: { tenantId: tenant.id }
      })

      if (anyTenantPlan) {
        return NextResponse.json(
          { code: 'TENANT_PLAN_INACTIVE', message: 'Tenant subscription is inactive. Please contact your administrator.' },
          { status: 400 }
        )
      }

      console.log(`[SocialSignup] Tenant ${tenant.name} has no TenantPlan - creating one now`)
      
      // Determine plan based on ATI token's planTier
      const planTier = fullToken?.planTier || 'FREE_PLAN'
      
      // Normalize plan code (same logic as manual signup)
      const normalizePlanCode = (input: string): string => {
        const normalized = input.toUpperCase().replace(/[\s-]+/g, '_')
        const aliases: Record<string, string> = {
          'ENTERPRISE': 'ENTERPRISE_PLAN',
          'ENTERPRISE_PLAN': 'ENTERPRISE_PLAN',
          'PRO': 'PRO_PLAN',
          'PRO_PLAN': 'PRO_PLAN',
          'PROFESSIONAL': 'PRO_PLAN',
          'FREE': 'FREE_PLAN',
          'FREE_PLAN': 'FREE_PLAN',
          'BASIC': 'BASIC_PLAN',
          'BASIC_PLAN': 'BASIC_PLAN',
          'TRIAL': 'TRIAL',
          'TRIAL_PLAN': 'TRIAL'
        }
        return aliases[normalized] || normalized
      }
      
      const targetPlanCode = normalizePlanCode(planTier)
      console.log(`[SocialSignup] ATI planTier: "${planTier}" -> normalized: "${targetPlanCode}"`)
      
      // Handle TRIAL plan specially
      if (targetPlanCode === 'TRIAL') {
        try {
          await assignTrialPlanToTenant(tenant.id)
        } catch (e) {
          console.warn('[SocialSignup] Failed to assign trial plan:', e)
        }
      } else {
        let targetPlan = await prisma.plan.findUnique({
          where: { code: targetPlanCode }
        })
        
        // Fallback to any active plan
        if (!targetPlan) {
          targetPlan = await prisma.plan.findFirst({
            where: { status: 'ACTIVE' },
            orderBy: { createdAt: 'asc' }
          })
          console.log(`[SocialSignup] Plan "${targetPlanCode}" not found, falling back to: ${targetPlan?.code}`)
        }
        
        if (targetPlan) {
          await prisma.tenantPlan.create({
            data: {
              tenantId: tenant.id,
              planId: targetPlan.id,
              status: 'ACTIVE',
              effectiveFrom: new Date()
            }
          })
          console.log(`[SocialSignup] Created TenantPlan: ${targetPlan.code} for tenant ${tenant.name}`)
        } else {
          console.warn(`[SocialSignup] WARNING: No plan available to assign to tenant ${tenant.name}`)
        }
      }
    } else {
      console.log(`[SocialSignup] Tenant ${tenant.name} already has plan: ${existingTenantPlan.planId}`)
    }

    // Check tenant user limits
    const existingUsersCount = await prisma.user.count({
      where: { tenantId: tenant.id }
    })

    if (existingUsersCount > 0) {
      const tenantAdmin = await prisma.user.findFirst({
        where: {
          tenantId: tenant.id,
          roles: { hasSome: ['OWNER', 'ADMIN'] }
        },
        select: { signupAtiTokenId: true },
        orderBy: { createdAt: 'asc' }
      })

      if (tenantAdmin?.signupAtiTokenId) {
        const originalToken = await prisma.aTIToken.findUnique({
          where: { id: tenantAdmin.signupAtiTokenId }
        })

        if (originalToken?.maxUses && existingUsersCount >= originalToken.maxUses) {
          return NextResponse.json(
            { code: 'TENANT_USER_LIMIT_EXCEEDED', message: `Tenant has reached its maximum user limit.` },
            { status: 400 }
          )
        }
      }
    }

    // Determine user role
    let userRole = 'ANALYST'
    let roleReason = 'default'

    if (existingUsersCount === 0) {
      userRole = 'OWNER'
      roleReason = 'first_tenant_user'
    } else if (fullToken?.assignedRole && !['SUPER_ADMIN', 'SUPER_ADMIN_VIEWER'].includes(fullToken.assignedRole)) {
      userRole = fullToken.assignedRole
      roleReason = 'ati_token_explicit_role'
    }

    // Create user with social OAuth data
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id" = ${tenant.id} FOR UPDATE`

      const usersCountInTransaction = await tx.user.count({
        where: { tenantId: tenant.id }
      })

      if (usersCountInTransaction > 0) {
        const tenantAdmin = await tx.user.findFirst({
          where: {
            tenantId: tenant.id,
            roles: { hasSome: ['OWNER', 'ADMIN'] }
          },
          select: { signupAtiTokenId: true },
          orderBy: { createdAt: 'asc' }
        })

        if (tenantAdmin?.signupAtiTokenId) {
          const originalToken = await tx.aTIToken.findUnique({
            where: { id: tenantAdmin.signupAtiTokenId }
          })

          if (originalToken?.maxUses && usersCountInTransaction >= originalToken.maxUses) {
            throw new Error(`TENANT_USER_LIMIT_EXCEEDED:${originalToken.maxUses}:${usersCountInTransaction}`)
          }
        }
      }

      await consumeATITokenForSignup(tx, tokenValidation.atiToken!.id)

      const effectiveUserRole = usersCountInTransaction === 0
        ? 'OWNER'
        : userRole === 'OWNER'
          ? 'ANALYST'
          : userRole
      const effectiveRoleReason = usersCountInTransaction === 0
        ? 'first_tenant_user'
        : userRole === 'OWNER'
          ? 'default'
          : roleReason

      const user = await tx.user.create({
        data: {
          email: pendingData.email,
          name: pendingData.name || `${pendingData.firstName || ''} ${pendingData.lastName || ''}`.trim(),
          firstName: pendingData.firstName,
          lastName: pendingData.lastName,
          tenantId: tenant.id,
          signupAtiTokenId: tokenValidation.atiToken!.id,
          roles: [effectiveUserRole as any],
          status: 'ACTIVE',
          emailVerified: true, // Social logins are verified
          oauthProvider: pendingData.provider.toUpperCase() as any,
          oauthProviderId: pendingData.providerId,
          oauthProfile: pendingData.profile
        }
      })

      // Create default project
      await tx.project.create({
        data: {
          name: 'Default Project',
          userId: user.id
        }
      })

      // Audit log
      const ip = request.headers.get('x-forwarded-for') ||
                 request.headers.get('x-real-ip') ||
                 'unknown'

      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          tenantId: tenant.id,
          action: 'USER_SIGNUP',
          resource: `user:${user.id}`,
          ip,
          meta: {
            email: user.email,
            roles: user.roles,
            assigned_role_reason: effectiveRoleReason,
            signup_method: 'social_oauth_with_ati',
            oauth_provider: pendingData.provider,
            ati_token_fingerprint: tokenValidation.atiToken!.fingerprint,
            is_first_tenant_user: usersCountInTransaction === 0
          }
        }
      })

      return user
    })

    const user = result

    // Auto-assign to team
    try {
      await autoAssignToDefaultTeam(user.id, tenant.id, fullToken?.assignedTeamId || undefined)
    } catch (teamError) {
      console.warn('Failed to auto-assign user to team:', teamError)
    }

    // Generate JWT token
    const accessToken = generateJWT({
      sub: user.id,
      email: user.email,
      tenant_id: user.tenantId,
      roles: user.roles,
      ati_id: tenant.atiId,
      tenant_ati_id: tenant.atiId,
      scope: 'tenant'
    })

    // Get request metadata
    const ip = request.headers.get('x-forwarded-for') ||
               request.headers.get('x-real-ip') ||
               'unknown'

    // Generate and store refresh token
    const refreshTokenData = generateRefreshToken(user.id)
    await storeRefreshToken(user.id, refreshTokenData, {
      userAgent: request.headers.get('user-agent') || undefined,
      ipAddress: ip
    })

    // Create response
    const response = NextResponse.json({
      success: true,
      user_id: user.id,
      tenant_id: tenant.id,
      roles: user.roles,
      token: accessToken
    }, { status: 201 })

    // Set refresh token as httpOnly cookie
    response.cookies.set('refresh_token', refreshTokenData.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 7,
      path: '/'
    })

    // Set access token cookie
    response.cookies.set('access_token', accessToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60,
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

    if (error instanceof Error && error.message.startsWith('TENANT_USER_LIMIT_EXCEEDED:')) {
      return NextResponse.json(
        { code: 'TENANT_USER_LIMIT_EXCEEDED', message: 'Tenant has reached its maximum user limit.' },
        { status: 400 }
      )
    }

    if (error instanceof Error && ['ATI_USED_UP', 'ATI_EXPIRED', 'ATI_TOKEN_INVALID'].includes(error.message)) {
      return NextResponse.json(
        { code: error.message, message: `ATI token validation failed: ${error.message}` },
        { status: 400 }
      )
    }

    console.error('Social signup completion error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}

