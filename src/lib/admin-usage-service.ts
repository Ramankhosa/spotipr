import { prisma } from './prisma'
import { calculateCost, CONTINGENCY_MULTIPLIER, ensurePricingLoaded } from './metering/cost-calculator'
import { getBillableOutputTokens, getMetaActualCost, getMetaSeparatelyBilledThoughtTokens } from './usage-log-cost'
import { normalizeUsageDateRange, toInclusiveDateRange } from './usage-periods'

export interface TenantUsageMetrics {
  tenantId: string | null
  tenantName: string | null
  tenantType: string | null
  totalInputTokens: number
  totalOutputTokens: number
  totalApiCalls: number
  totalCost: number
  patentDrafts: number
  noveltySearches: number
  ideasReserved: number
}

export interface GlobalUsageSummary {
  totalInputTokens: number
  totalOutputTokens: number
  totalApiCalls: number
  totalCost: number
  totalPatentsDrafted: number
  totalNoveltySearches: number
  totalIdeasReserved: number
}

export interface UsageSummaryResult {
  startDate: Date
  endDate: Date
  global: GlobalUsageSummary
  tenants: TenantUsageMetrics[]
}

export interface UnifiedAdminUsageUserRow {
  userId: string
  userName: string
  userEmail: string
  tenantId: string | null
  tenantName: string | null
  tenantType: string | null
  registrationSource: string | null
  signupAtiTokenId: string | null
  signupAtiFingerprint: string | null
  totalInputTokens: number
  totalOutputTokens: number
  totalApiCalls: number
  totalCost: number
  patentsDrafted: number
  draftingSessionsStarted: number
  patentDraftsInProgress: number
  noveltySearches: number
  ideasReserved: number
  lastActivity: Date | null
}

export interface UnifiedAdminUsageTenantRow extends TenantUsageMetrics {
  registrationSource: string | null
  atiTokenCount: number
  users: UnifiedAdminUsageUserRow[]
  draftingSessionsStarted: number
  patentDraftsInProgress: number
}

export interface UnifiedAdminUsagePatentRow {
  patentId: string
  patentTitle: string
  tenantId: string
  userId: string
  sessionId: string
  hasDescription: boolean
  hasClaims: boolean
  isCounted: boolean
  countedAt: Date | null
  createdAt: Date
}

export interface UnifiedAdminUsageResult {
  startDate: Date
  endDate: Date
  summary: GlobalUsageSummary & {
    totalDraftingSessionsStarted: number
    totalPatentDraftsInProgress: number
  }
  tenants: UnifiedAdminUsageTenantRow[]
  users: UnifiedAdminUsageUserRow[]
  patents: UnifiedAdminUsagePatentRow[]
}

/**
 * Calculate cost for a usage log using centralized cost-calculator
 * This ensures consistent pricing with terminal logs and other cost calculations
 * 
 * @param log - Usage log with token counts and model class
 * @returns Cost in USD
 */
function calculateCostForLog(
  log: { inputTokens: number | null; outputTokens: number | null; modelClass: string | null; meta?: unknown }
): number {
  const inputTokens = log.inputTokens ?? 0
  const outputTokens = log.outputTokens ?? 0
  const metaCost = getMetaActualCost(log.meta)
  if (metaCost !== null && (metaCost > 0 || (inputTokens === 0 && outputTokens === 0))) {
    return metaCost
  }

  // Use the centralized cost-calculator which reads from LLMModel table (llm-config)
  // This ensures consistent pricing across terminal logs and admin reports
  if (log.modelClass) {
    const costBreakdown = calculateCost(
      log.modelClass,
      inputTokens,
      outputTokens,
      getMetaSeparatelyBilledThoughtTokens(log.meta) || undefined
    )
    return costBreakdown.actualCost
  }

  // Fallback for logs without model class (shouldn't happen normally)
  // Uses DEFAULT_PRICING from cost-calculator.ts ($1/$4 per million)
  const inputCost = inputTokens * 0.000001
  const outputCost = getBillableOutputTokens(outputTokens, log.meta) * 0.000004
  return inputCost + outputCost
}

export async function computeUsageSummary(
  startDate: Date,
  endDate: Date,
  tenantFilterId?: string
): Promise<UsageSummaryResult> {
  const normalizedRange = normalizeUsageDateRange(startDate, endDate)
  const dateRange = toInclusiveDateRange(normalizedRange)

  const usageWhere: any = {
    startedAt: dateRange,
    status: 'COMPLETED'
  }

  if (tenantFilterId) {
    usageWhere.tenantId = tenantFilterId
  }

  // Ensure pricing is loaded from database before calculating costs
  await ensurePricingLoaded()

  const [usageLogs, draftsByTenant, noveltyRuns, reservations] = await Promise.all([
    prisma.usageLog.findMany({
      where: usageWhere,
      select: {
        tenantId: true,
        inputTokens: true,
        outputTokens: true,
        apiCalls: true,
        modelClass: true,
        meta: true
      }
    }),
    prisma.patentDraftingUsage.groupBy({
      by: ['tenantId'],
      where: {
        isCounted: true,
        ...(tenantFilterId ? { tenantId: tenantFilterId } : {}),
        countedAt: dateRange
      },
      _count: { _all: true }
    }),
    prisma.noveltySearchRun.findMany({
      where: {
        createdAt: dateRange,
        status: 'COMPLETED'
      },
      select: {
        user: {
          select: { tenantId: true }
        }
      }
    }),
    prisma.ideaBankReservation.findMany({
      where: {
        reservedAt: dateRange
      },
      select: {
        user: {
          select: { tenantId: true }
        }
      }
    })
  ])

  const tenantMap = new Map<
    string,
    {
      totalInputTokens: number
      totalOutputTokens: number
      totalApiCalls: number
      totalCost: number
      patentDrafts: number
      noveltySearches: number
      ideasReserved: number
    }
  >()

  const global: GlobalUsageSummary = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalApiCalls: 0,
    totalCost: 0,
    totalPatentsDrafted: 0,
    totalNoveltySearches: 0,
    totalIdeasReserved: 0
  }

  // Token + cost aggregation from usage logs
  for (const log of usageLogs) {
    const tId = log.tenantId || 'no-tenant'
    if (!tenantMap.has(tId)) {
      tenantMap.set(tId, {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalApiCalls: 0,
        totalCost: 0,
        patentDrafts: 0,
        noveltySearches: 0,
        ideasReserved: 0
      })
    }
    const bucket = tenantMap.get(tId)!

    // Use ?? (nullish coalescing) to handle 0 as a valid value
    const input = log.inputTokens ?? 0
    const output = getBillableOutputTokens(log.outputTokens, log.meta)
    const calls = log.apiCalls ?? 0
    const cost = calculateCostForLog(log)

    bucket.totalInputTokens += input
    bucket.totalOutputTokens += output
    bucket.totalApiCalls += calls
    bucket.totalCost += cost

    global.totalInputTokens += input
    global.totalOutputTokens += output
    global.totalApiCalls += calls
    global.totalCost += cost
  }

  // Counted patent drafts per tenant (quota-aligned)
  for (const row of draftsByTenant) {
    const tId = row.tenantId || 'no-tenant'
    if (tenantFilterId && tId !== tenantFilterId) continue
    if (!tenantMap.has(tId)) {
      tenantMap.set(tId, {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalApiCalls: 0,
        totalCost: 0,
        patentDrafts: 0,
        noveltySearches: 0,
        ideasReserved: 0
      })
    }
    const bucket = tenantMap.get(tId)!
    bucket.patentDrafts += row._count._all
    global.totalPatentsDrafted += row._count._all
  }

  // Novelty searches per tenant (via user.tenantId)
  for (const run of noveltyRuns) {
    const tId = run.user?.tenantId || 'no-tenant'
    if (tenantFilterId && tId !== tenantFilterId) continue
    if (!tenantMap.has(tId)) {
      tenantMap.set(tId, {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalApiCalls: 0,
        totalCost: 0,
        patentDrafts: 0,
        noveltySearches: 0,
        ideasReserved: 0
      })
    }
    const bucket = tenantMap.get(tId)!
    bucket.noveltySearches += 1
    global.totalNoveltySearches += 1
  }

  // Idea reservations per tenant (via user.tenantId)
  for (const res of reservations) {
    const tId = res.user?.tenantId || 'no-tenant'
    if (tenantFilterId && tId !== tenantFilterId) continue
    if (!tenantMap.has(tId)) {
      tenantMap.set(tId, {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalApiCalls: 0,
        totalCost: 0,
        patentDrafts: 0,
        noveltySearches: 0,
        ideasReserved: 0
      })
    }
    const bucket = tenantMap.get(tId)!
    bucket.ideasReserved += 1
    global.totalIdeasReserved += 1
  }

  const tenantIds = Array.from(tenantMap.keys()).filter(id => id !== 'no-tenant')
  const tenantRecords = tenantIds.length
    ? await prisma.tenant.findMany({
        where: { id: { in: tenantIds } },
        select: { id: true, name: true, type: true }
      })
    : []

  const tenantMeta = new Map<string, { name: string | null; type: string | null }>()
  for (const t of tenantRecords) {
    tenantMeta.set(t.id, { name: t.name, type: t.type })
  }

  const tenants: TenantUsageMetrics[] = Array.from(tenantMap.entries()).map(([id, metrics]) => {
    const meta = tenantMeta.get(id)
    const isNoTenant = id === 'no-tenant'
    return {
      tenantId: isNoTenant ? null : id,
      tenantName: isNoTenant ? 'No tenant' : (meta?.name ?? 'Unknown tenant'),
      tenantType: isNoTenant ? null : (meta?.type ?? null),
      totalInputTokens: metrics.totalInputTokens,
      totalOutputTokens: metrics.totalOutputTokens,
      totalApiCalls: metrics.totalApiCalls,
      totalCost: metrics.totalCost,
      patentDrafts: metrics.patentDrafts,
      noveltySearches: metrics.noveltySearches,
      ideasReserved: metrics.ideasReserved
    }
  })

  return {
    startDate: normalizedRange.start,
    endDate: normalizedRange.endInclusive,
    global,
    tenants
  }
}

export async function computeUnifiedAdminUsage(
  startDate: Date,
  endDate: Date,
  tenantFilterId?: string
): Promise<UnifiedAdminUsageResult> {
  const range = normalizeUsageDateRange(startDate, endDate)
  const dateRange = toInclusiveDateRange(range)

  await ensurePricingLoaded()

  const usageWhere: any = {
    startedAt: dateRange,
    status: 'COMPLETED'
  }
  if (tenantFilterId) usageWhere.tenantId = tenantFilterId

  const [usageLogs, patentUsageRows, sessionsStarted, noveltyRuns, reservations, tenantRecords, atiTokens] = await Promise.all([
    prisma.usageLog.findMany({
      where: usageWhere,
      select: {
        tenantId: true,
        userId: true,
        inputTokens: true,
        outputTokens: true,
        apiCalls: true,
        modelClass: true,
        meta: true,
        startedAt: true
      }
    }),
    prisma.patentDraftingUsage.findMany({
      where: {
        ...(tenantFilterId ? { tenantId: tenantFilterId } : {}),
        OR: [
          { countedAt: dateRange },
          { createdAt: dateRange }
        ]
      },
      select: {
        tenantId: true,
        sessionId: true,
        patentId: true,
        userId: true,
        hasDescription: true,
        hasClaims: true,
        isCounted: true,
        countedAt: true,
        createdAt: true
      }
    }),
    prisma.draftingSession.findMany({
      where: {
        ...(tenantFilterId ? { tenantId: tenantFilterId } : {}),
        createdAt: dateRange
      },
      select: {
        tenantId: true,
        userId: true,
        createdAt: true
      }
    }),
    prisma.noveltySearchRun.findMany({
      where: {
        createdAt: dateRange,
        status: 'COMPLETED',
        ...(tenantFilterId ? { user: { tenantId: tenantFilterId } } : {})
      },
      select: {
        userId: true,
        user: { select: { tenantId: true } }
      }
    }),
    prisma.ideaBankReservation.findMany({
      where: {
        reservedAt: dateRange,
        ...(tenantFilterId ? { user: { tenantId: tenantFilterId } } : {})
      },
      select: {
        userId: true,
        user: { select: { tenantId: true } }
      }
    }),
    prisma.tenant.findMany({
      where: tenantFilterId ? { id: tenantFilterId } : {},
      select: { id: true, name: true, type: true, registrationSource: true }
    }),
    prisma.aTIToken.findMany({
      where: tenantFilterId ? { tenantId: tenantFilterId } : {},
      select: { id: true, tenantId: true }
    })
  ])

  const userIds = new Set<string>()
  for (const log of usageLogs) if (log.userId) userIds.add(log.userId)
  for (const row of patentUsageRows) userIds.add(row.userId)
  for (const row of sessionsStarted) userIds.add(row.userId)
  for (const row of noveltyRuns) userIds.add(row.userId)
  for (const row of reservations) userIds.add(row.userId)

  const users = userIds.size
    ? await prisma.user.findMany({
        where: { id: { in: Array.from(userIds) } },
        select: {
          id: true,
          name: true,
          email: true,
          tenantId: true,
          tenant: { select: { id: true, name: true, type: true, registrationSource: true } },
          signupAtiTokenId: true,
          signupAtiToken: { select: { id: true, fingerprint: true } }
        }
      })
    : []

  const patentIds = Array.from(new Set(patentUsageRows.map(row => row.patentId)))
  const patentRecords = patentIds.length
    ? await prisma.patent.findMany({
        where: { id: { in: patentIds } },
        select: { id: true, title: true }
      })
    : []

  const userMeta = new Map(users.map(user => [user.id, user]))
  const tenantMeta = new Map(tenantRecords.map(t => [t.id, t]))
  for (const user of users) {
    if (user.tenant) tenantMeta.set(user.tenant.id, user.tenant)
  }
  const patentTitleMap = new Map(patentRecords.map(p => [p.id, p.title || 'Untitled Patent']))

  const atiTokenCounts = new Map<string, number>()
  for (const token of atiTokens) {
    if (!token.tenantId) continue
    atiTokenCounts.set(token.tenantId, (atiTokenCounts.get(token.tenantId) || 0) + 1)
  }

  const userBuckets = new Map<string, UnifiedAdminUsageUserRow>()
  const ensureUser = (userId: string, tenantIdHint?: string | null): UnifiedAdminUsageUserRow => {
    if (userBuckets.has(userId)) return userBuckets.get(userId)!
    const user = userMeta.get(userId)
    const tenantId = user?.tenantId || tenantIdHint || null
    const tenant = tenantId ? tenantMeta.get(tenantId) : undefined
    const row: UnifiedAdminUsageUserRow = {
      userId,
      userName: user?.name || user?.email || userId,
      userEmail: user?.email || '',
      tenantId,
      tenantName: tenant?.name || null,
      tenantType: tenant?.type || null,
      registrationSource: tenant?.registrationSource || null,
      signupAtiTokenId: user?.signupAtiTokenId || null,
      signupAtiFingerprint: user?.signupAtiToken?.fingerprint || null,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalApiCalls: 0,
      totalCost: 0,
      patentsDrafted: 0,
      draftingSessionsStarted: 0,
      patentDraftsInProgress: 0,
      noveltySearches: 0,
      ideasReserved: 0,
      lastActivity: null
    }
    userBuckets.set(userId, row)
    return row
  }

  const global: UnifiedAdminUsageResult['summary'] = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalApiCalls: 0,
    totalCost: 0,
    totalPatentsDrafted: 0,
    totalNoveltySearches: 0,
    totalIdeasReserved: 0,
    totalDraftingSessionsStarted: 0,
    totalPatentDraftsInProgress: 0
  }

  for (const log of usageLogs) {
    const input = log.inputTokens ?? 0
    const output = getBillableOutputTokens(log.outputTokens, log.meta)
    const calls = log.apiCalls ?? 0
    const cost = calculateCostForLog(log)

    global.totalInputTokens += input
    global.totalOutputTokens += output
    global.totalApiCalls += calls
    global.totalCost += cost

    if (!log.userId) continue
    const row = ensureUser(log.userId, log.tenantId)
    row.totalInputTokens += input
    row.totalOutputTokens += output
    row.totalApiCalls += calls
    row.totalCost += cost
    if (!row.lastActivity || log.startedAt > row.lastActivity) {
      row.lastActivity = log.startedAt
    }
  }

  const patents: UnifiedAdminUsagePatentRow[] = patentUsageRows.map(row => ({
    patentId: row.patentId,
    patentTitle: patentTitleMap.get(row.patentId) || 'Untitled Patent',
    tenantId: row.tenantId,
    userId: row.userId,
    sessionId: row.sessionId,
    hasDescription: row.hasDescription,
    hasClaims: row.hasClaims,
    isCounted: row.isCounted,
    countedAt: row.countedAt,
    createdAt: row.createdAt
  }))

  for (const row of patentUsageRows) {
    const bucket = ensureUser(row.userId, row.tenantId)
    const countedInRange = row.isCounted && row.countedAt && row.countedAt >= range.start && row.countedAt <= range.endInclusive
    const inProgressInRange = !row.isCounted && row.createdAt >= range.start && row.createdAt <= range.endInclusive
    if (countedInRange) {
      bucket.patentsDrafted += 1
      global.totalPatentsDrafted += 1
    }
    if (inProgressInRange) {
      bucket.patentDraftsInProgress += 1
      global.totalPatentDraftsInProgress += 1
    }
  }

  for (const session of sessionsStarted) {
    const bucket = ensureUser(session.userId, session.tenantId)
    bucket.draftingSessionsStarted += 1
    global.totalDraftingSessionsStarted += 1
  }

  for (const run of noveltyRuns) {
    const bucket = ensureUser(run.userId, run.user?.tenantId)
    bucket.noveltySearches += 1
    global.totalNoveltySearches += 1
  }

  for (const reservation of reservations) {
    const bucket = ensureUser(reservation.userId, reservation.user?.tenantId)
    bucket.ideasReserved += 1
    global.totalIdeasReserved += 1
  }

  const usersCombined = Array.from(userBuckets.values()).sort((a, b) => {
    const tokenDiff = (b.totalInputTokens + b.totalOutputTokens) - (a.totalInputTokens + a.totalOutputTokens)
    if (tokenDiff !== 0) return tokenDiff
    const actionDiff =
      (b.patentsDrafted + b.noveltySearches + b.ideasReserved) -
      (a.patentsDrafted + a.noveltySearches + a.ideasReserved)
    if (actionDiff !== 0) return actionDiff
    return a.userName.localeCompare(b.userName)
  })

  const tenantBuckets = new Map<string, UnifiedAdminUsageTenantRow>()
  const ensureTenant = (tenantId: string | null): UnifiedAdminUsageTenantRow => {
    const key = tenantId || 'no-tenant'
    if (tenantBuckets.has(key)) return tenantBuckets.get(key)!
    const tenant = tenantId ? tenantMeta.get(tenantId) : undefined
    const row: UnifiedAdminUsageTenantRow = {
      tenantId,
      tenantName: tenantId ? (tenant?.name ?? 'Unknown tenant') : 'No tenant',
      tenantType: tenant?.type ?? null,
      registrationSource: tenant?.registrationSource ?? null,
      atiTokenCount: tenantId ? (atiTokenCounts.get(tenantId) || 0) : 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalApiCalls: 0,
      totalCost: 0,
      patentDrafts: 0,
      noveltySearches: 0,
      ideasReserved: 0,
      users: [],
      draftingSessionsStarted: 0,
      patentDraftsInProgress: 0
    }
    tenantBuckets.set(key, row)
    return row
  }

  for (const user of usersCombined) {
    const tenant = ensureTenant(user.tenantId)
    tenant.users.push(user)
    tenant.totalInputTokens += user.totalInputTokens
    tenant.totalOutputTokens += user.totalOutputTokens
    tenant.totalApiCalls += user.totalApiCalls
    tenant.totalCost += user.totalCost
    tenant.patentDrafts += user.patentsDrafted
    tenant.noveltySearches += user.noveltySearches
    tenant.ideasReserved += user.ideasReserved
    tenant.draftingSessionsStarted += user.draftingSessionsStarted
    tenant.patentDraftsInProgress += user.patentDraftsInProgress
  }

  if (tenantFilterId) {
    for (const tenant of tenantRecords) {
      ensureTenant(tenant.id)
    }
  }

  return {
    startDate: range.start,
    endDate: range.endInclusive,
    summary: global,
    tenants: Array.from(tenantBuckets.values()).sort((a, b) => b.totalInputTokens - a.totalInputTokens),
    users: usersCombined,
    patents
  }
}

// ============================================================================
// USER-WISE COST TRACKING
// ============================================================================

export interface UserCostMetrics {
  userId: string
  userName: string | null
  userEmail: string
  totalInputTokens: number
  totalOutputTokens: number
  totalApiCalls: number
  actualCost: number
  contingencyCost: number  // 10% buffer
  patentDrafts: number
  noveltySearches: number
}

export async function computeUserCostsByTenant(
  tenantId: string,
  startDate: Date,
  endDate: Date
): Promise<UserCostMetrics[]> {
  const normalizedRange = normalizeUsageDateRange(startDate, endDate)
  const dateRange = toInclusiveDateRange(normalizedRange)

  // Get all usage logs for this tenant with user info
  const usageLogs = await prisma.usageLog.findMany({
    where: {
      tenantId,
      startedAt: dateRange,
      status: 'COMPLETED'
    },
    select: {
      userId: true,
      inputTokens: true,
      outputTokens: true,
      apiCalls: true,
      modelClass: true,
      meta: true
    }
  })

  // Get counted patent drafts per user (quota-aligned)
  const draftingByUser = await prisma.patentDraftingUsage.groupBy({
    by: ['userId'],
    where: {
      tenantId,
      isCounted: true,
      countedAt: dateRange
    },
    _count: { _all: true }
  })

  // Get novelty searches per user
  const noveltyRuns = await prisma.noveltySearchRun.findMany({
    where: {
      user: { tenantId },
      createdAt: dateRange,
      status: 'COMPLETED'
    },
    select: {
      userId: true
    }
  })

  // Aggregate by user
  const userMap = new Map<string, {
    totalInputTokens: number
    totalOutputTokens: number
    totalApiCalls: number
    actualCost: number
    patentDrafts: number
    noveltySearches: number
  }>()

  for (const log of usageLogs) {
    const userId = log.userId || 'unknown'
    if (!userMap.has(userId)) {
      userMap.set(userId, {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalApiCalls: 0,
        actualCost: 0,
        patentDrafts: 0,
        noveltySearches: 0
      })
    }
    const bucket = userMap.get(userId)!

    // Use ?? (nullish coalescing) to handle 0 as a valid value
    const input = log.inputTokens ?? 0
    const output = getBillableOutputTokens(log.outputTokens, log.meta)
    const calls = log.apiCalls ?? 0

    bucket.totalInputTokens += input
    bucket.totalOutputTokens += output
    bucket.totalApiCalls += calls

    // Calculate cost using centralized calculator (meta-aware)
    bucket.actualCost += calculateCostForLog(log)
  }

  // Add counted patent drafts per user
  for (const row of draftingByUser) {
    const userId = row.userId
    if (!userMap.has(userId)) {
      userMap.set(userId, {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalApiCalls: 0,
        actualCost: 0,
        patentDrafts: 0,
        noveltySearches: 0
      })
    }
    userMap.get(userId)!.patentDrafts += row._count._all
  }

  // Add novelty search counts
  for (const run of noveltyRuns) {
    if (!userMap.has(run.userId)) {
      userMap.set(run.userId, {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalApiCalls: 0,
        actualCost: 0,
        patentDrafts: 0,
        noveltySearches: 0
      })
    }
    userMap.get(run.userId)!.noveltySearches += 1
  }

  // Get user metadata
  const userIds = Array.from(userMap.keys()).filter(id => id !== 'unknown')
  const users = userIds.length ? await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, email: true }
  }) : []

  const userMeta = new Map<string, { name: string | null; email: string }>()
  for (const u of users) {
    userMeta.set(u.id, { name: u.name, email: u.email })
  }

  return Array.from(userMap.entries()).map(([userId, metrics]) => {
    const meta = userMeta.get(userId)
    return {
      userId,
      userName: meta?.name ?? null,
      userEmail: meta?.email ?? 'unknown@unknown.com',
      totalInputTokens: metrics.totalInputTokens,
      totalOutputTokens: metrics.totalOutputTokens,
      totalApiCalls: metrics.totalApiCalls,
      actualCost: metrics.actualCost,
      contingencyCost: metrics.actualCost * CONTINGENCY_MULTIPLIER,
      patentDrafts: metrics.patentDrafts,
      noveltySearches: metrics.noveltySearches
    }
  })
}

// ============================================================================
// PATENT-WISE COST TRACKING
// ============================================================================

export interface PatentCostMetrics {
  patentId: string
  patentTitle: string
  userId: string
  userName: string | null
  userEmail: string
  totalInputTokens: number
  totalOutputTokens: number
  totalApiCalls: number
  actualCost: number
  contingencyCost: number  // 10% buffer
  createdAt: Date
  // Cost breakdown by stage/operation
  stageBreakdown: {
    stage: string
    inputTokens: number
    outputTokens: number
    actualCost: number
    contingencyCost: number
    callCount: number
  }[]
}

export async function computePatentCosts(
  tenantId: string,
  startDate: Date,
  endDate: Date,
  userId?: string
): Promise<PatentCostMetrics[]> {
  const normalizedRange = normalizeUsageDateRange(startDate, endDate)
  const dateRange = toInclusiveDateRange(normalizedRange)

  // Get usage logs that have patent IDs in their metadata
  const usageLogs = await prisma.usageLog.findMany({
    where: {
      tenantId,
      startedAt: dateRange,
      status: 'COMPLETED',
      ...(userId ? { userId } : {})
    },
    select: {
      userId: true,
      startedAt: true,
      inputTokens: true,
      outputTokens: true,
      apiCalls: true,
      modelClass: true,
      taskCode: true,
      meta: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true
        }
      }
    }
  })

  const patentIdsFromUsage = Array.from(new Set(
    usageLogs
      .map(log => (log.meta as any)?.patentId)
      .filter((patentId): patentId is string => typeof patentId === 'string' && patentId.length > 0)
  ))

  const sessionWhere: any = {
    tenantId,
    OR: [
      { createdAt: dateRange },
      ...(patentIdsFromUsage.length ? [{ patentId: { in: patentIdsFromUsage } }] : [])
    ]
  }
  if (userId) {
    sessionWhere.userId = userId
  }

  const [sessions, patentRecords] = await Promise.all([
    prisma.draftingSession.findMany({
      where: sessionWhere,
      select: {
        id: true,
        patentId: true,
        userId: true,
        createdAt: true,
        patent: {
          select: {
            id: true,
            title: true
          }
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    }),
    patentIdsFromUsage.length
      ? prisma.patent.findMany({
          where: { id: { in: patentIdsFromUsage } },
          select: { id: true, title: true, createdBy: true }
        })
      : Promise.resolve([])
  ])

  const patentTitleMap = new Map(patentRecords.map(p => [p.id, p.title || 'Untitled Patent']))

  // Map sessions to metrics
  const patentMap = new Map<string, PatentCostMetrics>()

  // Initialize patents from sessions
  for (const session of sessions) {
    if (!patentMap.has(session.patentId)) {
      patentMap.set(session.patentId, {
        patentId: session.patentId,
        patentTitle: session.patent?.title || 'Untitled Patent',
        userId: session.userId,
        userName: session.user?.name ?? null,
        userEmail: session.user?.email || 'unknown@unknown.com',
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalApiCalls: 0,
        actualCost: 0,
        contingencyCost: 0,
        createdAt: session.createdAt,
        stageBreakdown: []
      })
    }
  }

  // Process usage logs and associate with patents
  for (const log of usageLogs) {
    const meta = log.meta as any
    const patentId = meta?.patentId
    
    if (!patentId) continue
    if (!patentMap.has(patentId)) {
      patentMap.set(patentId, {
        patentId,
        patentTitle: patentTitleMap.get(patentId) || 'Untitled Patent',
        userId: log.userId || 'unknown',
        userName: log.user?.name ?? null,
        userEmail: log.user?.email || 'unknown@unknown.com',
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalApiCalls: 0,
        actualCost: 0,
        contingencyCost: 0,
        createdAt: log.startedAt,
        stageBreakdown: []
      })
    }

    const metrics = patentMap.get(patentId)!
    // Use ?? (nullish coalescing) to handle 0 as a valid value
    const input = log.inputTokens ?? 0
    const output = getBillableOutputTokens(log.outputTokens, log.meta)
    const calls = log.apiCalls ?? 1

    metrics.totalInputTokens += input
    metrics.totalOutputTokens += output
    metrics.totalApiCalls += calls

    // Calculate cost (honour explicit overrides stored in metadata.cost)
    const metaCost = meta?.cost
    let actualCost = 0
    if (metaCost && typeof metaCost.actualCost === 'number') {
      actualCost = metaCost.actualCost
    } else if (log.modelClass) {
      const costBreakdown = calculateCost(
        log.modelClass,
        input,
        log.outputTokens ?? 0,
        getMetaSeparatelyBilledThoughtTokens(meta) || undefined
      )
      actualCost = costBreakdown.actualCost
    } else {
      // Fallback pricing: matches DEFAULT_PRICING in cost-calculator.ts ($1/$4 per million)
      actualCost = (input * 0.000001) + (output * 0.000004)
    }
    metrics.actualCost += actualCost

    // Track stage breakdown
    const stageCode = meta?.stageCode || log.taskCode || 'OTHER'
    let stageEntry = metrics.stageBreakdown.find(s => s.stage === stageCode)
    if (!stageEntry) {
      stageEntry = {
        stage: stageCode,
        inputTokens: 0,
        outputTokens: 0,
        actualCost: 0,
        contingencyCost: 0,
        callCount: 0
      }
      metrics.stageBreakdown.push(stageEntry)
    }
    stageEntry.inputTokens += input
    stageEntry.outputTokens += output
    stageEntry.actualCost += actualCost
    stageEntry.callCount += calls
  }

  // Calculate contingency costs
  Array.from(patentMap.values()).forEach(metrics => {
    metrics.contingencyCost = metrics.actualCost * CONTINGENCY_MULTIPLIER
    for (const stage of metrics.stageBreakdown) {
      stage.contingencyCost = stage.actualCost * CONTINGENCY_MULTIPLIER
    }
  })

  return Array.from(patentMap.values()).sort((a, b) => 
    b.createdAt.getTime() - a.createdAt.getTime()
  )
}
