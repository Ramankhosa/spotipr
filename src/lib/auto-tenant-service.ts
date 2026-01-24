/**
 * Auto Tenant Service
 * 
 * Handles automatic tenant and ATI token creation for self-service paid signups.
 * This service enables users to sign up and purchase plans without requiring
 * a manually-created ATI token from an admin.
 */

import crypto from 'crypto'
import { prisma } from './prisma'
import type { RegistrationSource, TenantStatus, UserRole } from '@prisma/client'

// ============================================================================
// TYPES
// ============================================================================

export interface CreatePaidTenantParams {
  email: string
  companyName?: string
  planCode: 'BASIC' | 'PRO' | 'ENTERPRISE'
  billingCycle: 'monthly' | 'yearly'
}

export interface CreatePaidTenantResult {
  success: boolean
  tenant?: {
    id: string
    name: string
    atiId: string
  }
  atiToken?: {
    id: string
    rawToken: string
    fingerprint: string
  }
  error?: string
}

export interface AutoSignupParams {
  email: string
  password?: string
  firstName?: string
  lastName?: string
  companyName?: string
  planCode: 'BASIC' | 'PRO' | 'ENTERPRISE'
  billingCycle: 'monthly' | 'yearly'
  oauthProvider?: string
  oauthProviderId?: string
  oauthProfile?: any
}

export interface AutoSignupResult {
  success: boolean
  user?: {
    id: string
    email: string
    tenantId: string
  }
  tenant?: {
    id: string
    name: string
    atiId: string
  }
  error?: string
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a unique ATI ID for paid signups
 * Format: PAID-XXXXXX (6 alphanumeric characters)
 */
function generatePaidAtiId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = 'PAID-'
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

/**
 * Generate a secure ATI token
 */
function generateAtiToken(): { rawToken: string; tokenHash: string; fingerprint: string } {
  // Generate raw token (32 bytes = 64 hex chars)
  const rawToken = crypto.randomBytes(32).toString('hex')
  
  // Hash the token for storage
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
  
  // Generate fingerprint (first 8 chars of hash)
  const fingerprint = tokenHash.substring(0, 8).toUpperCase()
  
  return { rawToken, tokenHash, fingerprint }
}

/**
 * Extract company name from email domain
 */
function extractCompanyFromEmail(email: string): string {
  const domain = email.split('@')[1]
  if (!domain) return 'My Company'
  
  // Common email providers - use generic name
  const commonProviders = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'protonmail.com', 'aol.com']
  if (commonProviders.includes(domain.toLowerCase())) {
    return 'My Company'
  }
  
  // Extract company name from domain
  const domainParts = domain.split('.')
  const companyPart = domainParts[0]
  
  // Capitalize first letter
  return companyPart.charAt(0).toUpperCase() + companyPart.slice(1)
}

/**
 * Get max users allowed based on plan
 */
function getMaxUsersForPlan(planCode: string): number {
  switch (planCode) {
    case 'BASIC':
      return 1
    case 'PRO':
      return 3
    case 'ENTERPRISE':
      return 5  // Default, can be extended
    default:
      return 1
  }
}

// ============================================================================
// MAIN SERVICE FUNCTIONS
// ============================================================================

/**
 * Create a new tenant with auto-generated ATI token for paid signup
 */
export async function createPaidTenant(params: CreatePaidTenantParams): Promise<CreatePaidTenantResult> {
  try {
    const { email, companyName, planCode, billingCycle } = params

    // Generate unique ATI ID
    let atiId = generatePaidAtiId()
    let attempts = 0
    const maxAttempts = 10

    // Ensure ATI ID is unique
    while (attempts < maxAttempts) {
      const existing = await prisma.tenant.findUnique({ where: { atiId } })
      if (!existing) break
      atiId = generatePaidAtiId()
      attempts++
    }

    if (attempts >= maxAttempts) {
      return { success: false, error: 'Failed to generate unique tenant ID. Please try again.' }
    }

    // Determine tenant name
    const tenantName = companyName || extractCompanyFromEmail(email)

    // Generate ATI token
    const { rawToken, tokenHash, fingerprint } = generateAtiToken()
    const maxUses = getMaxUsersForPlan(planCode)

    // Create tenant and ATI token in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create tenant with PENDING_PAYMENT status
      const tenant = await tx.tenant.create({
        data: {
          name: tenantName,
          atiId,
          type: planCode === 'ENTERPRISE' ? 'ENTERPRISE' : 'INDIVIDUAL',
          status: 'PENDING_PAYMENT',
          registrationSource: 'PAID_SIGNUP',
          selectedPlanCode: planCode,
          selectedBillingCycle: billingCycle,
        },
      })

      // Create auto-generated ATI token
      const atiToken = await tx.aTIToken.create({
        data: {
          tenantId: tenant.id,
          tokenHash,
          rawToken, // Store temporarily for immediate use
          rawTokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
          fingerprint,
          status: 'ISSUED',
          tokenType: 'AUTO_GENERATED',
          maxUses,
          planTier: planCode,
          assignedRole: 'OWNER',
          notes: `Auto-generated for ${planCode} plan signup`,
        },
      })

      return { tenant, atiToken }
    })

    console.log(`[AutoTenantService] Created paid tenant: ${result.tenant.atiId} for plan ${planCode}`)

    return {
      success: true,
      tenant: {
        id: result.tenant.id,
        name: result.tenant.name,
        atiId: result.tenant.atiId,
      },
      atiToken: {
        id: result.atiToken.id,
        rawToken,
        fingerprint: result.atiToken.fingerprint,
      },
    }
  } catch (error) {
    console.error('[AutoTenantService] Create paid tenant error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create tenant',
    }
  }
}

/**
 * Complete signup flow for paid users
 * Creates tenant, ATI token, and user in one transaction
 */
export async function createPaidSignup(params: AutoSignupParams): Promise<AutoSignupResult> {
  try {
    const {
      email,
      password,
      firstName,
      lastName,
      companyName,
      planCode,
      billingCycle,
      oauthProvider,
      oauthProviderId,
      oauthProfile,
    } = params

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({ where: { email } })
    if (existingUser) {
      return { success: false, error: 'Email address is already registered' }
    }

    // Generate unique ATI ID
    let atiId = generatePaidAtiId()
    let attempts = 0
    while (attempts < 10) {
      const existing = await prisma.tenant.findUnique({ where: { atiId } })
      if (!existing) break
      atiId = generatePaidAtiId()
      attempts++
    }

    // Determine tenant name
    const tenantName = companyName || extractCompanyFromEmail(email)

    // Generate ATI token
    const { rawToken, tokenHash, fingerprint } = generateAtiToken()
    const maxUses = getMaxUsersForPlan(planCode)

    // Hash password if provided
    let passwordHash: string | null = null
    if (password) {
      const bcrypt = await import('bcryptjs')
      passwordHash = await bcrypt.hash(password, 12)
    }

    // Create everything in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create tenant
      const tenant = await tx.tenant.create({
        data: {
          name: tenantName,
          atiId,
          type: planCode === 'ENTERPRISE' ? 'ENTERPRISE' : 'INDIVIDUAL',
          status: 'PENDING_PAYMENT',
          registrationSource: 'PAID_SIGNUP',
          selectedPlanCode: planCode,
          selectedBillingCycle: billingCycle,
        },
      })

      // Create ATI token
      const atiToken = await tx.aTIToken.create({
        data: {
          tenantId: tenant.id,
          tokenHash,
          fingerprint,
          status: 'USED_UP', // Mark as used since we're using it immediately
          tokenType: 'AUTO_GENERATED',
          maxUses,
          usageCount: 1, // First user
          planTier: planCode,
          assignedRole: 'OWNER',
          notes: `Auto-generated for ${planCode} plan signup`,
        },
      })

      // Create user
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          firstName,
          lastName,
          name: `${firstName || ''} ${lastName || ''}`.trim() || email.split('@')[0],
          tenantId: tenant.id,
          signupAtiTokenId: atiToken.id,
          roles: ['OWNER'],
          status: 'ACTIVE',
          emailVerified: !!oauthProvider, // Social logins are pre-verified
          oauthProvider: oauthProvider as any,
          oauthProviderId,
          oauthProfile,
        },
      })

      // Create default project
      await tx.project.create({
        data: {
          name: 'My Patents',
          userId: user.id,
        },
      })

      return { tenant, atiToken, user }
    })

    console.log(`[AutoTenantService] Paid signup complete: ${email} → Tenant ${result.tenant.atiId}`)

    return {
      success: true,
      user: {
        id: result.user.id,
        email: result.user.email,
        tenantId: result.user.tenantId!,
      },
      tenant: {
        id: result.tenant.id,
        name: result.tenant.name,
        atiId: result.tenant.atiId,
      },
    }
  } catch (error) {
    console.error('[AutoTenantService] Paid signup error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Signup failed',
    }
  }
}

/**
 * Activate a pending tenant after successful payment
 */
export async function activatePaidTenant(tenantId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
    
    if (!tenant) {
      return { success: false, error: 'Tenant not found' }
    }

    if (tenant.status === 'ACTIVE') {
      return { success: true } // Already active
    }

    await prisma.tenant.update({
      where: { id: tenantId },
      data: { status: 'ACTIVE' },
    })

    console.log(`[AutoTenantService] Tenant activated: ${tenant.atiId}`)

    return { success: true }
  } catch (error) {
    console.error('[AutoTenantService] Activate tenant error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to activate tenant',
    }
  }
}

/**
 * Check if a tenant is pending payment
 */
export async function isTenantPendingPayment(tenantId: string): Promise<boolean> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { status: true, registrationSource: true },
  })
  
  return tenant?.status === 'PENDING_PAYMENT' && tenant?.registrationSource === 'PAID_SIGNUP'
}

/**
 * Get pending payment info for a tenant
 */
export async function getPendingPaymentInfo(tenantId: string): Promise<{
  isPending: boolean
  planCode?: string
  billingCycle?: string
} | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      status: true,
      registrationSource: true,
      selectedPlanCode: true,
      selectedBillingCycle: true,
    },
  })

  if (!tenant) return null

  return {
    isPending: tenant.status === 'PENDING_PAYMENT',
    planCode: tenant.selectedPlanCode || undefined,
    billingCycle: tenant.selectedBillingCycle || undefined,
  }
}

/**
 * Clean up expired pending tenants (for scheduled job)
 * Deletes tenants that have been in PENDING_PAYMENT status for more than gracePeriodDays
 */
export async function cleanupExpiredPendingTenants(gracePeriodDays = 7): Promise<number> {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - gracePeriodDays)

  const result = await prisma.tenant.deleteMany({
    where: {
      status: 'PENDING_PAYMENT',
      registrationSource: 'PAID_SIGNUP',
      createdAt: { lt: cutoffDate },
    },
  })

  if (result.count > 0) {
    console.log(`[AutoTenantService] Cleaned up ${result.count} expired pending tenants`)
  }

  return result.count
}

