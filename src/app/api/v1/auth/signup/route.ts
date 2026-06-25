import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { hashPassword, validateATIToken, incrementATITokenUsage, createAuditLog, generateJWT, generateRefreshToken, storeRefreshToken } from '@/lib/auth'
import { generateToken, hashToken } from '@/lib/token-utils'
import { sendEmail } from '@/lib/mailer'
import { verificationTemplate } from '@/lib/email-templates'
import { autoAssignToDefaultTeam } from '@/lib/org-access-service'
import { validateInviteToken, recordSignup } from '@/lib/trial-invite-service'
import { assignTrialPlanToTenant } from '@/lib/trial-plan-service'
import { createPaidSignup } from '@/lib/auto-tenant-service'

// Schema for manual ATI-based signup
const atiSignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  atiToken: z.string().min(1),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  isTrialInvite: z.boolean().optional() // Flag for trial invite tokens
})

// Schema for self-service paid signup (no ATI token required)
const paidSignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  planCode: z.enum(['BASIC', 'PRO', 'ENTERPRISE']),
  billingCycle: z.enum(['monthly', 'yearly']),
  companyName: z.string().max(200).optional(),
})

// Combined schema that accepts either flow
const signupSchema = z.union([
  atiSignupSchema,
  paidSignupSchema,
])

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    // Determine which signup flow based on presence of atiToken vs planCode
    const hasAtiToken = body.atiToken && body.atiToken.length > 0
    const hasPlanCode = body.planCode && ['BASIC', 'PRO', 'ENTERPRISE'].includes(body.planCode)

    // ===========================================================================
    // FLOW 1: Self-Service Paid Signup (no ATI token, has plan selection)
    // ===========================================================================
    if (!hasAtiToken && hasPlanCode) {
      return handlePaidSignup(request, body)
    }

    // ===========================================================================
    // FLOW 2: Manual ATI-Based Signup (traditional invitation flow)
    // ===========================================================================
    const { email, password, atiToken, firstName, lastName, isTrialInvite } = atiSignupSchema.parse(body)

    // Check if email is already in use globally
    const existingUser = await prisma.user.findUnique({
      where: { email }
    })

    if (existingUser) {
      return NextResponse.json(
        { code: 'EMAIL_IN_USE', message: 'Email address is already registered' },
        { status: 400 }
      )
    }

    // Check if this is a trial invite token (email-locked)
    let trialInvite = null
    if (isTrialInvite) {
      const inviteValidation = await validateInviteToken(atiToken, email)
      if (!inviteValidation.valid) {
        return NextResponse.json(
          { code: 'INVALID_INVITE', message: inviteValidation.error || 'Invalid trial invite' },
          { status: 400 }
        )
      }
      trialInvite = inviteValidation.invite
    }

    // Validate ATI token by finding the tenant it belongs to
    // For trial invites, we use the campaign's trial ATI or create a trial tenant
    const tokenValidation = trialInvite 
      ? await getTrialTokenValidation(trialInvite)
      : await validateATIToken(atiToken)

    // Get full token with tenant info for scope checking
    let fullToken = null
    if (tokenValidation.valid && tokenValidation.atiToken) {
      fullToken = await prisma.aTIToken.findUnique({
        where: { id: tokenValidation.atiToken.id },
        include: { tenant: true }
      })
    }

    if (!tokenValidation.valid) {
      return NextResponse.json(
        { code: 'ATI_TOKEN_INVALID', message: 'ATI token validation failed' },
        { status: 400 }
      )
    }

    // Determine scope of the token
    const isPlatformToken = fullToken?.tenant?.atiId === 'PLATFORM'

    // Platform tokens can only be used for super admin creation (not regular signup)
    if (isPlatformToken) {
      return NextResponse.json(
        { code: 'INVALID_ATI_TOKEN', message: 'Platform ATI tokens cannot be used for regular user signup' },
        { status: 400 }
      )
    }

    // Get the tenant that owns this token
    const tenant = await prisma.tenant.findUnique({
      where: { id: tokenValidation.atiToken!.tenantId! } // All tokens now have tenantId
    })

    if (!tenant) {
      return NextResponse.json(
        { code: 'INVALID_ATI_TOKEN', message: 'Tenant not found for ATI token' },
        { status: 400 }
      )
    }

    if (tenant.status !== 'ACTIVE') {
      return NextResponse.json(
        { code: 'TENANT_INACTIVE', message: 'Tenant is not active' },
        { status: 400 }
      )
    }

    // CRITICAL: Ensure tenant has an active TenantPlan - without this, service access fails
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

      console.log(`[Signup] Tenant ${tenant.name} has no TenantPlan - creating one now`)
      
      // Determine plan based on ATI token's planTier
      const planTier = fullToken?.planTier || 'FREE_PLAN'
      
      // Normalize plan code
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
      console.log(`[Signup] ATI planTier: "${planTier}" -> normalized: "${targetPlanCode}"`)
      
      let targetPlan = await prisma.plan.findUnique({
        where: { code: targetPlanCode }
      })
      
      // Fallback to any active plan
      if (!targetPlan) {
        targetPlan = await prisma.plan.findFirst({
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'asc' }
        })
        console.log(`[Signup] Plan "${targetPlanCode}" not found, falling back to: ${targetPlan?.code}`)
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
        console.log(`[Signup] Created TenantPlan: ${targetPlan.code} for tenant ${tenant.name}`)
      } else {
        console.warn(`[Signup] WARNING: No plan available to assign to tenant ${tenant.name}`)
      }
    } else {
      console.log(`[Signup] Tenant ${tenant.name} already has plan: ${existingTenantPlan.planId}`)
    }

    // Pre-fetch data for role determination (these are read-only checks)
    // The actual user limit check happens atomically inside the transaction
    const existingUsersCountPreCheck = await prisma.user.count({
      where: { tenantId: tenant.id }
    })

    // Pre-fetch tenant admin info for role logic (used outside transaction)
    let tenantAdminTokenInfo: { signupAtiTokenId: string | null; maxUses: number | null } | null = null
    if (existingUsersCountPreCheck > 0) {
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
          where: { id: tenantAdmin.signupAtiTokenId },
          select: { maxUses: true }
        })
        tenantAdminTokenInfo = {
          signupAtiTokenId: tenantAdmin.signupAtiTokenId,
          maxUses: originalToken?.maxUses ?? null
        }
      }
    }

    // Determine role based on context
    // Priority: 1. First user = OWNER, 2. Explicit assignedRole on token, 3. Token creator logic, 4. Default ANALYST
    let userRole = 'ANALYST' // Default role
    let tokenCreator = null
    let roleReason = 'default'

    if (existingUsersCountPreCheck === 0) {
      // First user for this tenant - make them OWNER (cannot be overridden)
      userRole = 'OWNER'
      roleReason = 'first_tenant_user'
    } else if (fullToken?.assignedRole) {
      // Explicit role set on the ATI token (highest priority for non-first users)
      // Validate the role is not SUPER_ADMIN or SUPER_ADMIN_VIEWER
      const explicitRole = fullToken.assignedRole
      if (['SUPER_ADMIN', 'SUPER_ADMIN_VIEWER'].includes(explicitRole)) {
        console.warn('ATI token has invalid assignedRole:', explicitRole)
        // Fall through to default logic
      } else {
        userRole = explicitRole
        roleReason = 'ati_token_explicit_role'
        console.log('Using explicit assignedRole from ATI token:', userRole)
      }
    } else {
      // Legacy logic: check if this token was created by super admin (platform scope)
      // or by tenant admin
      tokenCreator = await prisma.auditLog.findFirst({
        where: {
          resource: `ati_token:${tokenValidation.atiToken!.id}`,
          action: 'ATI_ISSUE'
        },
        orderBy: { createdAt: 'desc' }
      })

      // If token was created by super admin (platform scope), assign ADMIN role
      // Otherwise, use the default ANALYST role (can be changed later by tenant admin)
      if (tokenCreator && tokenCreator.actorUserId) {
        const creatorUser = await prisma.user.findUnique({
          where: { id: tokenCreator.actorUserId },
          select: {
            roles: true,
            tenantId: true,
            tenant: {
              select: { atiId: true }
            }
          }
        })

        console.log('Token creator details:', {
          creatorId: tokenCreator.actorUserId,
          creatorRoles: creatorUser?.roles,
          creatorTenantId: creatorUser?.tenantId,
          creatorTenantAtiId: creatorUser?.tenant?.atiId
        })

        // If creator is super admin or belongs to platform tenant, assign ADMIN
        if (creatorUser?.roles?.includes('SUPER_ADMIN') || creatorUser?.tenant?.atiId === 'PLATFORM') {
          userRole = 'ADMIN'
          roleReason = 'super_admin_token_creator'
          console.log('Assigned ADMIN role due to super admin token creator')
        } else {
          roleReason = 'tenant_admin_token_creator'
          console.log('Keeping ANALYST role for tenant-admin-created token')
        }
      } else {
        roleReason = 'no_token_creator_found'
        console.log('No token creator found, keeping ANALYST role')
      }
    }

    // Hash password
    const passwordHash = await hashPassword(password)

    // Use a transaction to ensure atomicity - either everything succeeds or nothing does
    // This includes the user limit check to prevent race conditions in parallel signups
    const result = await prisma.$transaction(async (tx) => {
      // ATOMIC CHECK: Re-count users inside transaction to prevent race conditions
      // Two parallel signup requests could both pass the pre-check, but this ensures
      // only one succeeds when the limit would be exceeded
      const existingUsersCount = await tx.user.count({
        where: { tenantId: tenant.id }
      })

      // Validate tenant user limit atomically
      if (tenantAdminTokenInfo?.maxUses && existingUsersCount >= tenantAdminTokenInfo.maxUses) {
        throw new Error(`TENANT_USER_LIMIT_EXCEEDED:${tenantAdminTokenInfo.maxUses}:${existingUsersCount}`)
      }

      // Create user
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          tenantId: tenant.id,
          signupAtiTokenId: tokenValidation.atiToken!.id, // Track which ATI token was used
          roles: [userRole as any],
          status: 'ACTIVE',
          emailVerified: true,
          firstName,
          lastName,
          name: `${firstName} ${lastName}`
        }
      })

      // Create default project for the user
      const defaultProjectName = 'Default Project'
      const defaultProject = await tx.project.create({
        data: {
          name: defaultProjectName,
          userId: user.id
        }
      })

      // Get current token state for status update logic
      const currentToken = await tx.aTIToken.findUnique({
        where: { id: tokenValidation.atiToken!.id }
      })

      // Increment ATI token usage atomically
      await tx.aTIToken.update({
        where: { id: tokenValidation.atiToken!.id },
        data: {
          usageCount: { increment: 1 },
          // Update status if usage limit reached
          ...(currentToken && currentToken.maxUses && currentToken.usageCount + 1 >= currentToken.maxUses
            ? { status: 'USED_UP' }
            : {})
        }
      })

      // Audit log within transaction
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
            assigned_role_reason: roleReason,
            signup_method: 'ati_token',
            ati_token_fingerprint: tokenValidation.atiToken!.fingerprint,
            ati_token_creator: tokenCreator?.actorUserId || null,
            ati_explicit_role: fullToken?.assignedRole || null,
            ati_assigned_team: fullToken?.assignedTeamId || null,
            is_first_tenant_user: existingUsersCountPreCheck === 0
          }
        }
      })

      return user
    })

    const user = result
    
    // Auto-assign to team (outside transaction for flexibility)
    // Priority: 1. Explicit team from ATI token, 2. Default team
    try {
      await autoAssignToDefaultTeam(
        user.id,
        tenant.id,
        fullToken?.assignedTeamId || undefined
      )
      console.log('User auto-assigned to team:', fullToken?.assignedTeamId || 'default')
    } catch (teamError) {
      // Non-fatal - log but don't fail signup
      console.warn('Failed to auto-assign user to team:', teamError)
    }

    // Email verification disabled by default; enable with ENFORCE_EMAIL_VERIFICATION=true
    if (process.env.ENFORCE_EMAIL_VERIFICATION === 'true') {
      try {
        const raw = generateToken()
        const tokenHash = hashToken(raw)
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
        await prisma.emailVerificationToken.create({ data: { userId: user.id, tokenHash, expiresAt } })
        const tpl = verificationTemplate(user.email, user.name, raw)
        await sendEmail({ to: user.email, toName: user.name || undefined, subject: tpl.subject, html: tpl.html, text: tpl.text })
      } catch (e) {
        console.warn('Failed to send verification email:', e)
      }
    }

    // Record trial invite signup if applicable
    if (trialInvite) {
      try {
        await recordSignup(atiToken, user.id)
        console.log('Trial signup recorded for invite:', trialInvite.id)
      } catch (trialError) {
        console.warn('Failed to record trial signup:', trialError)
      }
    }

    return NextResponse.json({
      user_id: user.id,
      tenant_id: tenant.id,
      roles: user.roles,
      is_trial: !!trialInvite
    }, { status: 201 })

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 'INVALID_INPUT', message: 'Invalid input data', details: error.errors },
        { status: 400 }
      )
    }

    // Handle atomic tenant user limit exceeded error from transaction
    if (error instanceof Error && error.message.startsWith('TENANT_USER_LIMIT_EXCEEDED:')) {
      const parts = error.message.split(':')
      const maxUsers = parseInt(parts[1], 10)
      const currentUsers = parseInt(parts[2], 10)
      return NextResponse.json(
        {
          code: 'TENANT_USER_LIMIT_EXCEEDED',
          message: `Tenant has reached its maximum user limit of ${maxUsers} users.`,
          current_users: currentUsers,
          max_users: maxUsers
        },
        { status: 400 }
      )
    }

    console.error('Signup error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Handle self-service paid signup (Flow 1)
 * Creates tenant, user, and redirects to payment
 */
async function handlePaidSignup(request: NextRequest, body: any) {
  try {
    const { email, password, firstName, lastName, planCode, billingCycle, companyName } = paidSignupSchema.parse(body)

    // Check if email is already in use
    const existingUser = await prisma.user.findUnique({
      where: { email }
    })

    if (existingUser) {
      return NextResponse.json(
        { code: 'EMAIL_IN_USE', message: 'Email address is already registered' },
        { status: 400 }
      )
    }

    // Create paid signup (tenant + user in one transaction)
    const result = await createPaidSignup({
      email,
      password,
      firstName,
      lastName,
      companyName,
      planCode,
      billingCycle,
    })

    if (!result.success) {
      return NextResponse.json(
        { code: 'SIGNUP_FAILED', message: result.error || 'Failed to create account' },
        { status: 400 }
      )
    }

    // Get request metadata
    const ip = request.headers.get('x-forwarded-for') ||
               request.headers.get('x-real-ip') ||
               'unknown'

    // Create audit log
    await prisma.auditLog.create({
      data: {
        actorUserId: result.user!.id,
        tenantId: result.tenant!.id,
        action: 'USER_SIGNUP',
        resource: `user:${result.user!.id}`,
        ip,
        meta: {
          email,
          signup_method: 'paid_self_service',
          plan_code: planCode,
          billing_cycle: billingCycle,
          tenant_ati_id: result.tenant!.atiId,
          registration_source: 'PAID_SIGNUP',
        }
      }
    })

    console.log(`[Signup] Paid self-service signup complete: ${email} → Plan: ${planCode}`)

    // Generate JWT token for authentication - service-level checks will block product access
    // until payment is completed and tenant status changes from PENDING_PAYMENT to ACTIVE
    const accessToken = generateJWT({
      sub: result.user!.id,
      email: result.user!.email,
      tenant_id: result.tenant!.id,
      roles: ['OWNER'],
      ati_id: result.tenant!.atiId,
      tenant_ati_id: result.tenant!.atiId,
      scope: 'tenant'
    })

    // Generate and store refresh token
    const refreshTokenData = generateRefreshToken(result.user!.id)
    await storeRefreshToken(result.user!.id, refreshTokenData, {
      userAgent: request.headers.get('user-agent') || undefined,
      ipAddress: ip
    })

    const response = NextResponse.json({
      success: true,
      user_id: result.user!.id,
      tenant_id: result.tenant!.id,
      roles: ['OWNER'],
      is_paid_signup: true,
      requires_payment: true,
      plan_code: planCode,
      billing_cycle: billingCycle,
      token: accessToken,
      redirect_url: '/pricing?checkout=true',
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

    console.error('Paid signup error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Get token validation for trial invites
 * Uses the campaign's trial ATI token or creates a pseudo-validation for trial tenant
 */
async function getTrialTokenValidation(trialInvite: any) {
  // If campaign has a specific trial ATI token, use it
  if (trialInvite.campaign.trialAtiTokenId) {
    const atiToken = await prisma.aTIToken.findUnique({
      where: { id: trialInvite.campaign.trialAtiTokenId },
      include: { tenant: true }
    })
    if (atiToken) {
      return {
        valid: true,
        atiToken: {
          id: atiToken.id,
          tenantId: atiToken.tenantId,
          fingerprint: atiToken.fingerprint,
          planTier: atiToken.planTier
        }
      }
    }
  }

  // Otherwise, use a trial tenant (create if needed)
  let trialTenant = await prisma.tenant.findFirst({
    where: { atiId: 'TRIAL' }
  })

  if (!trialTenant) {
    // Create trial tenant
    trialTenant = await prisma.tenant.create({
      data: {
        name: 'Trial Users',
        atiId: 'TRIAL',
        type: 'INDIVIDUAL',
        status: 'ACTIVE'
      }
    })
  }

  // Ensure trial tenant has TRIAL plan assigned
  try {
    await assignTrialPlanToTenant(trialTenant.id)
  } catch (e) {
    console.warn('Failed to assign trial plan:', e)
  }

  // Get or create a default trial ATI token
  let trialAtiToken = await prisma.aTIToken.findFirst({
    where: { 
      tenantId: trialTenant.id,
      fingerprint: 'TRIAL_DEFAULT',
      status: { in: ['ACTIVE', 'ISSUED'] }
    }
  })

  if (!trialAtiToken) {
    const crypto = await import('crypto')
    // Use tenant ID in hash to ensure uniqueness per tenant
    const tokenHash = crypto.createHash('sha256')
      .update(`TRIAL_DEFAULT_${trialTenant.id}_${Date.now()}`)
      .digest('hex')
    
    try {
      trialAtiToken = await prisma.aTIToken.create({
        data: {
          tenantId: trialTenant.id,
          tokenHash,
          fingerprint: 'TRIAL_DEFAULT',
          status: 'ACTIVE',
          planTier: 'TRIAL', // Use TRIAL tier instead of BASIC
          notes: 'Default trial token for trial invites'
        }
      })
    } catch (error: any) {
      // Handle race condition - token might have been created by another request
      if (error.code === 'P2002') {
        trialAtiToken = await prisma.aTIToken.findFirst({
          where: { 
            tenantId: trialTenant.id,
            fingerprint: 'TRIAL_DEFAULT',
            status: { in: ['ACTIVE', 'ISSUED'] }
          }
        })
      }
      if (!trialAtiToken) {
        throw error
      }
    }
  }

  return {
    valid: true,
    atiToken: {
      id: trialAtiToken.id,
      tenantId: trialAtiToken.tenantId,
      fingerprint: trialAtiToken.fingerprint,
      planTier: trialAtiToken.planTier
    }
  }
}

