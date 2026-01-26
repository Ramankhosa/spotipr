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
  
  const currentDay = new Date().toISOString().substring(0, 10)
  const currentMonth = new Date().toISOString().substring(0, 7)

  const whereClause = tenantId ? { tenantId } : {}

  const [dailyCount, monthlyCount, totalRecords] = await Promise.all([
    prisma.patentDraftingUsage.count({
      where: { ...whereClause, isCounted: true, countedDate: currentDay }
    }),
    prisma.patentDraftingUsage.count({
      where: { ...whereClause, isCounted: true, countedMonth: currentMonth }
    }),
    prisma.patentDraftingUsage.count({
      where: whereClause
    })
  ])

  console.log(`  Today (${currentDay}): ${dailyCount} patents counted`)
  console.log(`  This month (${currentMonth}): ${monthlyCount} patents counted`)
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
