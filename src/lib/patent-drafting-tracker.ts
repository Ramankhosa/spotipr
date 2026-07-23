/**
 * Patent Drafting Usage Tracker
 * 
 * Tracks patent drafts toward quota based on PATENTS, not LLM tokens.
 * A patent is counted toward quota when essential sections are drafted:
 * - detailedDescription (required)
 * - claims (required)
 * 
 * Once both essential sections are drafted for a session, the patent
 * is counted ONCE toward daily/monthly quota. Further section drafting
 * for the same session does NOT count again.
 * 
 * This prevents:
 * 1. Users being charged per-section instead of per-patent
 * 2. Users gaming the system by only drafting important sections
 */

import { prisma } from './prisma'
import { getUtcDayWindow } from './usage-periods'
import { resolveBillingPeriod } from './billing-period'

// Essential sections that must be drafted before a patent counts toward quota
const ESSENTIAL_SECTIONS = ['detailedDescription', 'claims'] as const

// All trackable sections
const ALL_SECTIONS = [
  'title',
  'abstract', 
  'fieldOfInvention',
  'background',
  'summary',
  'briefDescriptionOfDrawings',
  'detailedDescription',
  'bestMethod',
  'claims',
  'industrialApplicability',
  'listOfNumerals'
] as const

type EssentialSection = typeof ESSENTIAL_SECTIONS[number]
type AllSection = typeof ALL_SECTIONS[number]

export interface PatentDraftingQuota {
  dailyUsed: number
  dailyLimit: number | null
  monthlyUsed: number
  monthlyLimit: number | null
  dailyRemaining: number | null
  monthlyRemaining: number | null
  // Billing-cycle-aware period (monthly quota window)
  billingPeriodStart?: Date
  billingPeriodEnd?: Date
  billingPeriodKey?: string
  billingPeriodSource?: 'subscription' | 'calendar'
}

async function findPatentUsageRecord(
  client: typeof prisma | any,
  tenantId: string,
  patentId: string,
  sessionId?: string
) {
  const byPatent = await client.patentDraftingUsage.findFirst({
    where: { tenantId, patentId }
  })
  if (byPatent || !sessionId) return byPatent

  return client.patentDraftingUsage.findUnique({
    where: { sessionId }
  })
}

async function upsertPatentUsageRecord(
  client: typeof prisma | any,
  params: {
    tenantId: string
    sessionId: string
    patentId: string
    userId: string
    hasDescription: boolean
    hasClaims: boolean
    isCounted?: boolean
    countedMonth?: string | null
    countedAt?: Date | null
  }
) {
  const existing = await findPatentUsageRecord(client, params.tenantId, params.patentId, params.sessionId)
  if (existing) {
    return client.patentDraftingUsage.update({
      where: { id: existing.id },
      data: {
        patentId: params.patentId,
        sessionId: params.sessionId,
        userId: params.isCounted && !existing.isCounted ? params.userId : existing.userId,
        hasDescription: params.hasDescription,
        hasClaims: params.hasClaims,
        isCounted: params.isCounted ?? existing.isCounted,
        countedMonth: params.countedMonth === undefined ? existing.countedMonth : params.countedMonth,
        countedAt: params.countedAt === undefined ? existing.countedAt : params.countedAt
      }
    })
  }

  return client.patentDraftingUsage.create({
    data: {
      tenantId: params.tenantId,
      sessionId: params.sessionId,
      patentId: params.patentId,
      userId: params.userId,
      hasDescription: params.hasDescription,
      hasClaims: params.hasClaims,
      isCounted: params.isCounted ?? false,
      countedMonth: params.countedMonth ?? null,
      countedAt: params.countedAt ?? null
    }
  })
}

async function getPatentDraftingQuotaForClient(
  client: typeof prisma | any,
  tenantId: string,
  now: Date
): Promise<PatentDraftingQuota> {
  const billingPeriod = await resolveBillingPeriod(tenantId, now, client)
  const periodEndInclusive = new Date(billingPeriod.endExclusive.getTime() - 1)
  const dayWindow = getUtcDayWindow(now)

  const [dailyCount, monthlyCount, tenantPlan] = await Promise.all([
    client.patentDraftingUsage.count({
      where: {
        tenantId,
        isCounted: true,
        countedAt: { gte: dayWindow.start, lte: dayWindow.endInclusive }
      }
    }),
    client.patentDraftingUsage.count({
      where: {
        tenantId,
        isCounted: true,
        countedAt: { gte: billingPeriod.start, lte: periodEndInclusive }
      }
    }),
    client.tenantPlan.findFirst({
      where: {
        tenantId,
        status: 'ACTIVE',
        effectiveFrom: { lte: now },
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } }
        ]
      },
      include: {
        plan: {
          include: {
            planFeatures: {
              include: { feature: true }
            }
          }
        }
      }
    })
  ])

  let dailyLimit: number | null = null
  let monthlyLimit: number | null = null

  if (tenantPlan) {
    const patentFeature = tenantPlan.plan.planFeatures?.find(
      (pf: any) => pf.feature.code === 'PATENT_DRAFTING'
    )
    if (patentFeature) {
      dailyLimit = patentFeature.dailyQuota
      monthlyLimit = patentFeature.monthlyQuota
    }
  }

  return {
    dailyUsed: dailyCount,
    dailyLimit,
    monthlyUsed: monthlyCount,
    monthlyLimit,
    dailyRemaining: dailyLimit !== null ? Math.max(0, dailyLimit - dailyCount) : null,
    monthlyRemaining: monthlyLimit !== null ? Math.max(0, monthlyLimit - monthlyCount) : null,
    billingPeriodStart: billingPeriod.start,
    billingPeriodEnd: periodEndInclusive,
    billingPeriodKey: billingPeriod.key,
    billingPeriodSource: billingPeriod.source
  }
}

function essentialFlagsFromSections(sectionKeys: string[]) {
  return {
    hasDescription: sectionKeys.some(s => s === 'detailedDescription' || s === 'description'),
    hasClaims: sectionKeys.includes('claims')
  }
}

/**
 * Track that a section has been drafted for a session
 * Returns whether this section drafting caused the patent to be counted
 */
export async function trackSectionDrafted(
  tenantId: string,
  sessionId: string,
  patentId: string,
  userId: string,
  sectionKey: string
): Promise<{ counted: boolean; quotaExceeded: boolean }> {
  const { hasDescription: isDescription, hasClaims: isClaims } = essentialFlagsFromSections([sectionKey])
  
  if (!isDescription && !isClaims) {
    // Non-essential section - no impact on quota counting
    return { counted: false, quotaExceeded: false }
  }
  
  const now = new Date()

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const existing = await findPatentUsageRecord(tx, tenantId, patentId, sessionId)
        const nextHasDescription = Boolean(existing?.hasDescription || isDescription)
        const nextHasClaims = Boolean(existing?.hasClaims || isClaims)
        const shouldCount = nextHasDescription && nextHasClaims && !existing?.isCounted

        if (shouldCount) {
          const quota = await getPatentDraftingQuotaForClient(tx, tenantId, now)
          if (quota.dailyLimit !== null && quota.dailyUsed >= quota.dailyLimit) {
            return { counted: false, quotaExceeded: true }
          }
          if (quota.monthlyLimit !== null && quota.monthlyUsed >= quota.monthlyLimit) {
            return { counted: false, quotaExceeded: true }
          }

          const billingPeriod = await resolveBillingPeriod(tenantId, now, tx)
          await upsertPatentUsageRecord(tx, {
            tenantId,
            sessionId,
            patentId,
            userId,
            hasDescription: nextHasDescription,
            hasClaims: nextHasClaims,
            isCounted: true,
            countedMonth: billingPeriod.key,
            countedAt: now
          })

          console.log(`[PatentDraftingTracker] Patent counted for patent ${patentId} (tenant: ${tenantId})`)
          return { counted: true, quotaExceeded: false }
        }

        await upsertPatentUsageRecord(tx, {
          tenantId,
          sessionId,
          patentId,
          userId,
          hasDescription: nextHasDescription,
          hasClaims: nextHasClaims,
          isCounted: existing?.isCounted ?? false,
          countedMonth: existing?.countedMonth ?? null,
          countedAt: existing?.countedAt ?? null
        })

        return { counted: false, quotaExceeded: false }
      }, { isolationLevel: 'Serializable' } as any)
    } catch (error: any) {
      if (attempt === 0 && (error?.code === 'P2002' || error?.code === 'P2034')) {
        continue
      }
      throw error
    }
  }

  return { counted: false, quotaExceeded: false }
}

/**
 * Get current patent drafting quota status for a tenant
 */
export async function getPatentDraftingQuota(tenantId: string): Promise<PatentDraftingQuota> {
  const now = new Date()
  return getPatentDraftingQuotaForClient(prisma, tenantId, now)
}

/**
 * Check if tenant can draft a new patent (has quota remaining)
 * This should be called BEFORE starting to draft sections
 */
export async function canDraftPatent(tenantId: string, sessionId?: string, patentId?: string): Promise<{
  allowed: boolean
  reason?: string
  quota: PatentDraftingQuota
}> {
  // If session already exists and is counted, always allow (continue drafting)
  if (sessionId || patentId) {
    const existingUsage = patentId
      ? await findPatentUsageRecord(prisma, tenantId, patentId, sessionId)
      : await prisma.patentDraftingUsage.findUnique({
          where: { sessionId }
        })
    
    if (existingUsage?.isCounted) {
      // Patent already counted - allow continued drafting
      const quota = await getPatentDraftingQuota(tenantId)
      return { allowed: true, quota }
    }
    
    // Check if essential sections are partially drafted
    if (existingUsage && (existingUsage.hasDescription || existingUsage.hasClaims) && !(existingUsage.hasDescription && existingUsage.hasClaims)) {
      // Allow completing the patent
      const quota = await getPatentDraftingQuota(tenantId)
      return { allowed: true, quota }
    }
  }
  
  const quota = await getPatentDraftingQuota(tenantId)
  
  // Check daily quota
  if (quota.dailyLimit !== null && quota.dailyUsed >= quota.dailyLimit) {
    return {
      allowed: false,
      reason: `Tenant daily quota exceeded for PATENT_DRAFTING`,
      quota
    }
  }
  
  // Check monthly quota  
  if (quota.monthlyLimit !== null && quota.monthlyUsed >= quota.monthlyLimit) {
    return {
      allowed: false,
      reason: `Tenant monthly quota exceeded for PATENT_DRAFTING`,
      quota
    }
  }
  
  return { allowed: true, quota }
}

export async function canTrackSectionDrafts(
  tenantId: string,
  sessionId: string,
  patentId: string,
  sectionKeys: string[]
): Promise<{
  allowed: boolean
  reason?: string
  quota: PatentDraftingQuota
}> {
  const flags = essentialFlagsFromSections(sectionKeys)
  const quota = await getPatentDraftingQuota(tenantId)

  if (!flags.hasDescription && !flags.hasClaims) {
    return { allowed: true, quota }
  }

  const existing = await findPatentUsageRecord(prisma, tenantId, patentId, sessionId)
  if (existing?.isCounted) {
    return { allowed: true, quota }
  }

  const nextHasDescription = Boolean(existing?.hasDescription || flags.hasDescription)
  const nextHasClaims = Boolean(existing?.hasClaims || flags.hasClaims)
  const wouldCount = nextHasDescription && nextHasClaims

  if (!wouldCount) {
    return { allowed: true, quota }
  }

  if (quota.dailyLimit !== null && quota.dailyUsed >= quota.dailyLimit) {
    return {
      allowed: false,
      reason: 'Tenant daily quota exceeded for PATENT_DRAFTING',
      quota
    }
  }

  if (quota.monthlyLimit !== null && quota.monthlyUsed >= quota.monthlyLimit) {
    return {
      allowed: false,
      reason: 'Tenant monthly quota exceeded for PATENT_DRAFTING',
      quota
    }
  }

  return { allowed: true, quota }
}

/**
 * Get drafting status for a specific session
 */
export async function getSessionDraftingStatus(sessionId: string): Promise<{
  exists: boolean
  hasDescription: boolean
  hasClaims: boolean
  isCounted: boolean
} | null> {
  const usage = await prisma.patentDraftingUsage.findUnique({
    where: { sessionId }
  })
  
  if (!usage) {
    return null
  }
  
  return {
    exists: true,
    hasDescription: usage.hasDescription,
    hasClaims: usage.hasClaims,
    isCounted: usage.isCounted
  }
}

/**
 * Initialize tracking for a session (called when starting a new drafting session)
 */
export async function initializeSessionTracking(
  tenantId: string,
  sessionId: string,
  patentId: string,
  userId: string
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await findPatentUsageRecord(tx, tenantId, patentId, sessionId)
    if (existing) {
      await tx.patentDraftingUsage.update({
        where: { id: existing.id },
        data: { sessionId }
      })
      return
    }

    await tx.patentDraftingUsage.create({
      data: {
        tenantId,
        sessionId,
        patentId,
        userId,
        hasDescription: false,
        hasClaims: false,
        isCounted: false
      }
    })
  })
}

/**
 * Manually mark sections as drafted (for existing drafts that need syncing)
 * Checks quota before counting to prevent exceeding limits
 */
export async function syncExistingSections(
  tenantId: string,
  sessionId: string,
  patentId: string,
  userId: string,
  draftedSections: string[]
): Promise<{ counted: boolean; quotaExceeded: boolean }> {
  const hasDescription = draftedSections.some(s => 
    s === 'detailedDescription' || s === 'description'
  )
  const hasClaims = draftedSections.includes('claims')
  
  const now = new Date()
  const billingPeriod = await resolveBillingPeriod(tenantId, now)
  const periodKey = billingPeriod.key
  
  const existing = await findPatentUsageRecord(prisma, tenantId, patentId, sessionId)
  
  if (existing?.isCounted) {
    // Already counted, nothing to do
    return { counted: false, quotaExceeded: false }
  }
  
  const shouldCount = hasDescription && hasClaims
  
  // Check quota before counting
  if (shouldCount) {
    const quota = await getPatentDraftingQuota(tenantId)
    
    // Check daily quota
    if (quota.dailyLimit !== null && quota.dailyUsed >= quota.dailyLimit) {
      // Update tracking without counting
      await upsertPatentUsageRecord(prisma, {
        tenantId,
        sessionId,
        patentId,
        userId,
        hasDescription,
        hasClaims,
        isCounted: false
      })
      return { counted: false, quotaExceeded: true }
    }
    
    // Check monthly quota
    if (quota.monthlyLimit !== null && quota.monthlyUsed >= quota.monthlyLimit) {
      // Update tracking without counting
      await upsertPatentUsageRecord(prisma, {
        tenantId,
        sessionId,
        patentId,
        userId,
        hasDescription,
        hasClaims,
        isCounted: false
      })
      return { counted: false, quotaExceeded: true }
    }
  }
  
  await upsertPatentUsageRecord(prisma, {
    tenantId,
    sessionId,
    patentId,
    userId,
    hasDescription,
    hasClaims,
    isCounted: shouldCount,
    countedMonth: shouldCount ? periodKey : (existing?.countedMonth ?? null),
    countedAt: shouldCount ? new Date() : (existing?.countedAt ?? null)
  })
  
  return { counted: shouldCount, quotaExceeded: false }
}


/**
 * Resolve the tenant that owns a drafting session, backfilling it when missing.
 *
 * Historically `DraftingSession.tenantId` was left null by some creation paths, and every
 * quota check in the drafting route is written as `if (session.tenantId) { ...check... }`.
 * A null therefore meant *unmetered drafting* rather than a blocked one - the single most
 * valuable thing to game in the system.
 *
 * The creation paths now always set it, but sessions created before that fix still exist.
 * This resolves the tenant from the session's owning user and persists it, so an old
 * session becomes metered the next time it is touched. Returns null only when the user
 * genuinely has no tenant, which callers MUST treat as "deny", never as "skip".
 */
export async function resolveSessionTenantId(session: {
  id: string
  tenantId?: string | null
  userId?: string | null
}): Promise<string | null> {
  if (session.tenantId) return session.tenantId
  if (!session.userId) return null

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { tenantId: true }
  })

  if (!user?.tenantId) return null

  // Best-effort backfill. A failure here must not block drafting - the caller still has a
  // usable tenantId and will enforce quota with it.
  await prisma.draftingSession
    .update({ where: { id: session.id }, data: { tenantId: user.tenantId } })
    .catch(() => {})

  console.warn(
    `[PatentDraftingTracker] Backfilled tenantId on legacy session ${session.id} (tenant ${user.tenantId})`
  )

  return user.tenantId
}
