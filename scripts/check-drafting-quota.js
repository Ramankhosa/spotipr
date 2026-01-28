/**
 * Diagnostic script to check patent drafting quota status
 * 
 * This script will help identify WHY the quota is being counted
 * when it shouldn't be (e.g., only Stage 1 completed).
 * 
 * Run with: node scripts/check-drafting-quota.js [tenantId] [sessionId]
 * If no tenantId provided, shows ALL records across all tenants.
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

function getUtcDayWindow(now) {
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const day = now.getUTCDate()
  const start = new Date(Date.UTC(year, month, day, 0, 0, 0, 0))
  const endInclusive = new Date(Date.UTC(year, month, day, 23, 59, 59, 999))
  return { start, endInclusive }
}

function getUtcMonthWindow(now) {
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0))
  const endExclusive = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0))
  return { start, endExclusive }
}

function addMonthsClampedUtc(base, months) {
  const year = base.getUTCFullYear()
  const month = base.getUTCMonth() + months
  const day = base.getUTCDate()
  const hours = base.getUTCHours()
  const minutes = base.getUTCMinutes()
  const seconds = base.getUTCSeconds()
  const ms = base.getUTCMilliseconds()

  const firstOfTarget = new Date(Date.UTC(year, month, 1, hours, minutes, seconds, ms))
  const daysInTarget = new Date(Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth() + 1, 0)).getUTCDate()
  const clampedDay = Math.min(day, daysInTarget)
  return new Date(Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth(), clampedDay, hours, minutes, seconds, ms))
}

function resolveAnchoredMonthlyWindow(now, anchorStart) {
  const monthsDiff =
    (now.getUTCFullYear() - anchorStart.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - anchorStart.getUTCMonth())

  let monthsFromAnchor = monthsDiff
  let start = addMonthsClampedUtc(anchorStart, monthsFromAnchor)
  if (start > now) {
    monthsFromAnchor -= 1
    start = addMonthsClampedUtc(anchorStart, monthsFromAnchor)
  }
  const endExclusive = addMonthsClampedUtc(anchorStart, monthsFromAnchor + 1)
  return { start, endExclusive }
}

async function resolveBillingPeriod(tenantId, now) {
  const calendar = getUtcMonthWindow(now)
  if (!tenantId) {
    return { ...calendar, source: 'calendar' }
  }

  const subscription = await prisma.subscription.findFirst({
    where: {
      tenantId,
      status: { in: ['ACTIVE', 'PENDING', 'AUTHENTICATED'] },
      currentPeriodStart: { not: null },
      currentPeriodEnd: { not: null }
    },
    orderBy: { currentPeriodStart: 'desc' },
    select: {
      billingCycle: true,
      currentPeriodStart: true,
      currentPeriodEnd: true
    }
  })

  if (subscription?.currentPeriodStart && subscription?.currentPeriodEnd) {
    const start = subscription.currentPeriodStart
    const endExclusive = subscription.currentPeriodEnd
    const cycle = (subscription.billingCycle || '').toLowerCase()

    if (cycle === 'monthly') {
      if (now >= start && now < endExclusive) {
        return { start, endExclusive, source: 'subscription' }
      }
    } else if (cycle === 'yearly') {
      if (now >= start && now < endExclusive) {
        const window = resolveAnchoredMonthlyWindow(now, start)
        return { start: window.start, endExclusive: window.endExclusive, source: 'subscription' }
      }
    }
  }

  return { ...calendar, source: 'calendar' }
}

async function main() {
  const tenantId = process.argv[2]
  const sessionId = process.argv[3]

  // If no tenantId provided, we'll show all records
  if (!tenantId) {
    console.log('No tenantId provided - showing ALL patent drafting usage records')
    console.log('')
  }

  console.log('='.repeat(80))
  console.log('PATENT DRAFTING QUOTA DIAGNOSTIC')
  console.log('='.repeat(80))
  console.log('')

  // 1. Get tenant plan limits (skip if no tenantId)
  if (tenantId) {
    console.log('1. TENANT PLAN LIMITS')
    console.log('-'.repeat(40))
    
    const tenantPlan = await prisma.tenantPlan.findFirst({
      where: {
        tenantId,
        status: 'ACTIVE',
        effectiveFrom: { lte: new Date() },
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } }
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

    if (!tenantPlan) {
      console.log('  No active tenant plan found!')
    } else {
      const patentFeature = tenantPlan.plan.planFeatures?.find(
        pf => pf.feature.code === 'PATENT_DRAFTING'
      )
      console.log(`  Plan: ${tenantPlan.plan.name} (${tenantPlan.plan.code})`)
      console.log(`  Daily Limit: ${patentFeature?.dailyQuota ?? 'unlimited'}`)
      console.log(`  Monthly Limit: ${patentFeature?.monthlyQuota ?? 'unlimited'}`)
    }
    console.log('')
  }

  // 2. Get current usage counts
  console.log('2. CURRENT USAGE (PatentDraftingUsage table)')
  console.log('-'.repeat(40))
  
  const now = new Date()
  const dayWindow = getUtcDayWindow(now)
  const billingPeriod = await resolveBillingPeriod(tenantId, now)
  const periodEndInclusive = new Date(billingPeriod.endExclusive.getTime() - 1)

  const whereClause = tenantId ? { tenantId } : {}

  const [dailyCount, monthlyCount, totalRecords] = await Promise.all([
    prisma.patentDraftingUsage.count({
      where: {
        ...whereClause,
        isCounted: true,
        countedAt: { gte: dayWindow.start, lte: dayWindow.endInclusive }
      }
    }),
    prisma.patentDraftingUsage.count({
      where: {
        ...whereClause,
        isCounted: true,
        countedAt: { gte: billingPeriod.start, lte: periodEndInclusive }
      }
    }),
    prisma.patentDraftingUsage.count({
      where: whereClause
    })
  ])

  const dayKey = dayWindow.start.toISOString().substring(0, 10)
  const periodStartKey = billingPeriod.start.toISOString().substring(0, 10)
  const periodEndKey = periodEndInclusive.toISOString().substring(0, 10)
  console.log(`  Today (UTC ${dayKey}): ${dailyCount} patents counted`)
  console.log(`  Billing period (${billingPeriod.source} ${periodStartKey} to ${periodEndKey}): ${monthlyCount} patents counted`)
  console.log(`  Total records: ${totalRecords}`)
  console.log('')

  // 3. Show ALL patent drafting usage records
  console.log('3. ALL PATENT DRAFTING USAGE RECORDS')
  console.log('-'.repeat(40))
  
  const allRecords = await prisma.patentDraftingUsage.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
    take: 20
  })

  if (allRecords.length === 0) {
    console.log('  No records found.')
  } else {
    console.log('  TenantId | SessionId | hasDesc | hasClaims | isCounted | countedAt')
    console.log('  ' + '-'.repeat(85))
    for (const r of allRecords) {
      console.log(`  ${r.tenantId.substring(0, 8)}... | ${r.sessionId.substring(0, 8)}... | ${r.hasDescription ? 'YES' : 'no '} | ${r.hasClaims ? 'YES' : 'no '} | ${r.isCounted ? 'YES' : 'no '} | ${r.countedAt || 'N/A'}`)
    }
  }
  console.log('')

  // 4. If a specific session was provided, show its details
  if (sessionId) {
    console.log('4. SPECIFIC SESSION DETAILS')
    console.log('-'.repeat(40))
    
    const session = await prisma.draftingSession.findUnique({
      where: { id: sessionId },
      include: {
        ideaRecord: true,
        annexureDrafts: {
          orderBy: { version: 'desc' },
          take: 1
        }
      }
    })

    if (!session) {
      console.log(`  ❌ Session not found: ${sessionId}`)
    } else {
      console.log(`  Session ID: ${session.id}`)
      console.log(`  Current Stage: ${session.status}`)
      console.log(`  Created: ${session.createdAt}`)
      
      // Check if there's an AnnexureDraft
      const draft = session.annexureDrafts?.[0]
      if (draft) {
        console.log('')
        console.log('  AnnexureDraft exists:')
        console.log(`    - Has claims: ${draft.claims ? 'YES' : 'no'}`)
        console.log(`    - Has detailedDescription: ${draft.detailedDescription ? 'YES' : 'no'}`)
        console.log(`    - Created: ${draft.createdAt}`)
      } else {
        console.log('')
        console.log('  ⚠️  No AnnexureDraft exists for this session')
        console.log('     (This means sections have NOT been saved to the drafting stage)')
      }
      
      // Check PatentDraftingUsage for this session
      const usage = await prisma.patentDraftingUsage.findUnique({
        where: { sessionId }
      })
      
      if (usage) {
        console.log('')
        console.log('  PatentDraftingUsage record:')
        console.log(`    - hasDescription: ${usage.hasDescription}`)
        console.log(`    - hasClaims: ${usage.hasClaims}`)
        console.log(`    - isCounted: ${usage.isCounted}`)
        console.log(`    - countedAt: ${usage.countedAt || 'N/A'}`)
        
        if (usage.isCounted && !draft) {
          console.log('')
          console.log('  🐛 BUG DETECTED: isCounted is TRUE but no AnnexureDraft exists!')
          console.log('     This should not happen - quota was counted without sections being saved.')
        }
      } else {
        console.log('')
        console.log('  ✅ No PatentDraftingUsage record exists for this session')
        console.log('     (This is expected if no sections have been saved)')
      }
    }
    console.log('')
  }

  // 5. Check for buggy records (isCounted without both sections)
  console.log('5. CHECKING FOR BUGGY RECORDS')
  console.log('-'.repeat(40))
  
  const buggyRecords = await prisma.patentDraftingUsage.findMany({
    where: {
      ...whereClause,
      isCounted: true,
      OR: [
        { hasDescription: false },
        { hasClaims: false }
      ]
    }
  })

  if (buggyRecords.length === 0) {
    console.log('  ✅ No buggy records found (all counted records have both sections)')
  } else {
    console.log(`  🐛 FOUND ${buggyRecords.length} BUGGY RECORD(S):`)
    for (const r of buggyRecords) {
      console.log(`     - Session: ${r.sessionId}`)
      console.log(`       hasDescription: ${r.hasDescription}, hasClaims: ${r.hasClaims}, isCounted: ${r.isCounted}`)
    }
  }
  console.log('')

  console.log('='.repeat(80))
  console.log('DIAGNOSTIC COMPLETE')
  console.log('='.repeat(80))
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
