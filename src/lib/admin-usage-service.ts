import { prisma } from './prisma'
import { calculateCost, CONTINGENCY_MULTIPLIER, ensurePricingLoaded, isModelPriced } from './metering/cost-calculator'
import { getBillableOutputTokens, getMetaActualCost, getMetaSeparatelyBilledThoughtTokens } from './usage-log-cost'
import { normalizeUsageDateRange, toInclusiveDateRange } from './usage-periods'

export interface TenantUsageMetrics {
  tenantId: string | null
  tenantName: string | null
  tenantAtiId: string | null
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
  tenantAtiId: string | null
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
export function calculateCostForLog(
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
  const usage = await computeUnifiedAdminUsage(startDate, endDate, tenantFilterId)

  const global: GlobalUsageSummary = {
    totalInputTokens: usage.summary.totalInputTokens,
    totalOutputTokens: usage.summary.totalOutputTokens,
    totalApiCalls: usage.summary.totalApiCalls,
    totalCost: usage.summary.totalCost,
    totalPatentsDrafted: usage.summary.totalPatentsDrafted,
    totalNoveltySearches: usage.summary.totalNoveltySearches,
    totalIdeasReserved: usage.summary.totalIdeasReserved
  }

  const tenants: TenantUsageMetrics[] = usage.tenants.map(tenant => ({
    tenantId: tenant.tenantId,
    tenantName: tenant.tenantName,
    tenantAtiId: tenant.tenantAtiId,
    tenantType: tenant.tenantType,
    totalInputTokens: tenant.totalInputTokens,
    totalOutputTokens: tenant.totalOutputTokens,
    totalApiCalls: tenant.totalApiCalls,
    totalCost: tenant.totalCost,
    patentDrafts: tenant.patentDrafts,
    noveltySearches: tenant.noveltySearches,
    ideasReserved: tenant.ideasReserved
  }))

  return {
    startDate: usage.startDate,
    endDate: usage.endDate,
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
      select: { id: true, name: true, atiId: true, type: true, registrationSource: true }
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
          tenant: { select: { id: true, name: true, atiId: true, type: true, registrationSource: true } },
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
      tenantAtiId: tenant?.atiId || null,
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

  const isCountedPatentUsageInRange = (row: typeof patentUsageRows[number]) =>
    Boolean(row.isCounted && row.countedAt && row.countedAt >= range.start && row.countedAt <= range.endInclusive)

  const isInProgressPatentUsageInRange = (row: typeof patentUsageRows[number]) =>
    Boolean(!row.isCounted && row.createdAt >= range.start && row.createdAt <= range.endInclusive)

  const patents: UnifiedAdminUsagePatentRow[] = patentUsageRows.filter(row =>
    isCountedPatentUsageInRange(row) || isInProgressPatentUsageInRange(row)
  ).map(row => ({
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
    const countedInRange = isCountedPatentUsageInRange(row)
    const inProgressInRange = isInProgressPatentUsageInRange(row)
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
      tenantAtiId: tenantId ? (tenant?.atiId ?? null) : null,
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

  await ensurePricingLoaded()

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

export interface CostStageBreakdown {
  stage: string
  inputTokens: number
  outputTokens: number
  actualCost: number
  contingencyCost: number
  callCount: number
}

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
  stageBreakdown: CostStageBreakdown[]
}

/**
 * LLM spend that could not be tied to a single patent, grouped by the task that
 * produced it. Novelty search, report generation and office-action work land here:
 * they are real runs a tenant paid for, they just are not patent-scoped.
 */
export interface UnattributedCostGroup {
  taskCode: string
  label: string
  totalInputTokens: number
  totalOutputTokens: number
  totalApiCalls: number
  actualCost: number
  contingencyCost: number
  logCount: number
  stageBreakdown: CostStageBreakdown[]
}

export interface RunCostTotals {
  // Patent-attributed
  totalInputTokens: number
  totalOutputTokens: number
  totalApiCalls: number
  actualCost: number
  contingencyCost: number
  patentCount: number
  // Everything else the tenant was billed for in the same window
  unattributedInputTokens: number
  unattributedOutputTokens: number
  unattributedApiCalls: number
  unattributedActualCost: number
  unattributedContingencyCost: number
  unattributedLogCount: number
  // Patent + unattributed. Reconciles with the tenant total on the summary cards.
  tenantActualCost: number
  tenantContingencyCost: number
}

export interface RunCostResult {
  patents: PatentCostMetrics[]
  unattributed: UnattributedCostGroup[]
  /** Model codes billed at DEFAULT_PRICING because nothing is configured for them. */
  pricingWarnings: { modelClass: string; logCount: number }[]
  totals: RunCostTotals
}

/**
 * Human labels for the task codes that show up in the cost panel. Anything not
 * listed falls back to its raw code, which is still readable for a super admin.
 */
const TASK_COST_LABELS: Record<string, string> = {
  LLM1_PRIOR_ART: 'Prior art search',
  LLM1_CLAIM_REFINEMENT: 'Claim refinement',
  LLM2_DRAFT: 'Patent drafting',
  LLM3_DIAGRAM: 'Diagram / sketch generation',
  LLM4_NOVELTY_SCREEN: 'Novelty screening',
  LLM5_NOVELTY_ASSESS: 'Novelty search & assessment',
  LLM6_REPORT_GENERATION: 'Novelty report generation',
  LLM7_ADVANCED_MANUAL_SEARCH: 'Advanced manual search',
  LLM8_OA_RESPONSE: 'Office action response',
  IDEATION_GENERATE: 'Ideation - generate',
  IDEATION_EXPAND: 'Ideation - expand',
  IDEATION_NORMALIZE: 'Ideation - normalize',
  IDEATION_CLASSIFY: 'Ideation - classify',
  IDEATION_NOVELTY: 'Ideation - novelty check',
  FILING_INVENTOR_PARSE: 'Filing - inventor parsing',
  WS_SCOPE: 'Whitespace - scope',
  WS_DIMENSIONS: 'Whitespace - dimensions',
  WS_VALIDATE: 'Whitespace - validate',
  WS_REDTEAM: 'Whitespace - red team'
}

export function getTaskCostLabel(taskCode: string | null | undefined): string {
  if (!taskCode) return 'Other LLM operations'
  return TASK_COST_LABELS[taskCode] || taskCode
}

function addToStage(
  breakdown: CostStageBreakdown[],
  stage: string,
  inputTokens: number,
  outputTokens: number,
  actualCost: number,
  callCount: number
): void {
  let entry = breakdown.find(s => s.stage === stage)
  if (!entry) {
    entry = { stage, inputTokens: 0, outputTokens: 0, actualCost: 0, contingencyCost: 0, callCount: 0 }
    breakdown.push(entry)
  }
  entry.inputTokens += inputTokens
  entry.outputTokens += outputTokens
  entry.actualCost += actualCost
  entry.callCount += callCount
}

export async function computePatentCosts(
  tenantId: string,
  startDate: Date,
  endDate: Date,
  userId?: string
): Promise<RunCostResult> {
  const normalizedRange = normalizeUsageDateRange(startDate, endDate)
  const dateRange = toInclusiveDateRange(normalizedRange)

  await ensurePricingLoaded()

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

  const readMetaId = (meta: unknown, key: string): string | null => {
    const value = (meta as any)?.[key]
    return typeof value === 'string' && value.length > 0 ? value : null
  }

  const patentIdsFromUsage = Array.from(new Set(
    usageLogs
      .map(log => readMetaId(log.meta, 'patentId'))
      .filter((patentId): patentId is string => patentId !== null)
  ))

  // Not every drafting log stamps meta.patentId - a large share only carries
  // meta.sessionId. Resolving those through the session keeps that spend on the
  // patent it belongs to instead of dropping it out of the report entirely.
  const sessionIdsFromUsage = Array.from(new Set(
    usageLogs
      .map(log => readMetaId(log.meta, 'sessionId'))
      .filter((sessionId): sessionId is string => sessionId !== null)
  ))

  const sessionWhere: any = {
    tenantId,
    OR: [
      { createdAt: dateRange },
      ...(patentIdsFromUsage.length ? [{ patentId: { in: patentIdsFromUsage } }] : []),
      ...(sessionIdsFromUsage.length ? [{ id: { in: sessionIdsFromUsage } }] : [])
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
  const sessionToPatent = new Map(sessions.map(session => [session.id, session.patentId]))

  // Map sessions to metrics
  const patentMap = new Map<string, PatentCostMetrics>()

  // Initialize patents from sessions. A patent can have several sessions, so seed
  // identity from the earliest one - otherwise the row's owner and creation date
  // depend on whatever order the database happened to return.
  const orderedSessions = sessions
    .slice()
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

  for (const session of orderedSessions) {
    if (!patentMap.has(session.patentId)) {
      patentMap.set(session.patentId, {
        patentId: session.patentId,
        patentTitle: session.patent?.title || patentTitleMap.get(session.patentId) || 'Untitled Patent',
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

  const unattributedMap = new Map<string, UnattributedCostGroup>()
  const unpricedModels = new Map<string, number>()

  // Process usage logs and associate with patents
  for (const log of usageLogs) {
    const meta = log.meta as any
    const sessionId = readMetaId(log.meta, 'sessionId')
    const patentId = readMetaId(log.meta, 'patentId')
      || (sessionId ? sessionToPatent.get(sessionId) ?? null : null)

    // Use ?? (nullish coalescing) to handle 0 as a valid value
    const input = log.inputTokens ?? 0
    const output = getBillableOutputTokens(log.outputTokens, log.meta)
    // Match the tenant-level "API calls" card, which also treats a missing count
    // as zero. Differing defaults made the same log count once here and not there.
    const calls = log.apiCalls ?? 0
    const actualCost = calculateCostForLog(log)
    const stageCode = meta?.stageCode || log.taskCode || 'OTHER'

    if (log.modelClass && !isModelPriced(log.modelClass)) {
      unpricedModels.set(log.modelClass, (unpricedModels.get(log.modelClass) || 0) + 1)
    }

    if (!patentId) {
      // Novelty runs, report generation, ideation and office-action work never
      // carry a patent id. Bucketing them by task keeps the report's totals equal
      // to what the tenant was actually billed.
      const taskCode = log.taskCode || 'OTHER'
      let group = unattributedMap.get(taskCode)
      if (!group) {
        group = {
          taskCode,
          label: getTaskCostLabel(log.taskCode),
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalApiCalls: 0,
          actualCost: 0,
          contingencyCost: 0,
          logCount: 0,
          stageBreakdown: []
        }
        unattributedMap.set(taskCode, group)
      }
      group.totalInputTokens += input
      group.totalOutputTokens += output
      group.totalApiCalls += calls
      group.actualCost += actualCost
      group.logCount += 1
      addToStage(group.stageBreakdown, stageCode, input, output, actualCost, calls)
      continue
    }

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
    metrics.totalInputTokens += input
    metrics.totalOutputTokens += output
    metrics.totalApiCalls += calls
    metrics.actualCost += actualCost
    addToStage(metrics.stageBreakdown, stageCode, input, output, actualCost, calls)
  }

  // Calculate contingency costs
  const patents = Array.from(patentMap.values())
  for (const metrics of patents) {
    metrics.contingencyCost = metrics.actualCost * CONTINGENCY_MULTIPLIER
    for (const stage of metrics.stageBreakdown) {
      stage.contingencyCost = stage.actualCost * CONTINGENCY_MULTIPLIER
    }
    metrics.stageBreakdown.sort((a, b) => b.actualCost - a.actualCost)
  }

  const unattributed = Array.from(unattributedMap.values())
  for (const group of unattributed) {
    group.contingencyCost = group.actualCost * CONTINGENCY_MULTIPLIER
    for (const stage of group.stageBreakdown) {
      stage.contingencyCost = stage.actualCost * CONTINGENCY_MULTIPLIER
    }
    group.stageBreakdown.sort((a, b) => b.actualCost - a.actualCost)
  }
  unattributed.sort((a, b) => b.actualCost - a.actualCost)

  patents.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

  const totals = patents.reduce<RunCostTotals>((acc, p) => {
    acc.totalInputTokens += p.totalInputTokens
    acc.totalOutputTokens += p.totalOutputTokens
    acc.totalApiCalls += p.totalApiCalls
    acc.actualCost += p.actualCost
    acc.contingencyCost += p.contingencyCost
    acc.patentCount += 1
    return acc
  }, {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalApiCalls: 0,
    actualCost: 0,
    contingencyCost: 0,
    patentCount: 0,
    unattributedInputTokens: 0,
    unattributedOutputTokens: 0,
    unattributedApiCalls: 0,
    unattributedActualCost: 0,
    unattributedContingencyCost: 0,
    unattributedLogCount: 0,
    tenantActualCost: 0,
    tenantContingencyCost: 0
  })

  for (const group of unattributed) {
    totals.unattributedInputTokens += group.totalInputTokens
    totals.unattributedOutputTokens += group.totalOutputTokens
    totals.unattributedApiCalls += group.totalApiCalls
    totals.unattributedActualCost += group.actualCost
    totals.unattributedContingencyCost += group.contingencyCost
    totals.unattributedLogCount += group.logCount
  }

  totals.tenantActualCost = totals.actualCost + totals.unattributedActualCost
  totals.tenantContingencyCost = totals.contingencyCost + totals.unattributedContingencyCost

  return {
    patents,
    unattributed,
    pricingWarnings: Array.from(unpricedModels.entries())
      .map(([modelClass, logCount]) => ({ modelClass, logCount }))
      .sort((a, b) => b.logCount - a.logCount),
    totals
  }
}
