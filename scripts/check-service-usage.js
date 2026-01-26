const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const tenantId = process.argv[2] || 'cmkux8i3y0001l6uxlr5vqoe3'
  
  console.log('='.repeat(80))
  console.log('SERVICE USAGE DIAGNOSTIC')
  console.log('='.repeat(80))
  console.log('Tenant ID:', tenantId)
  console.log('')

  // 1. Get tenant plan and its limits
  console.log('1. TENANT PLAN LIMITS')
  console.log('-'.repeat(40))
  
  const tenantPlan = await prisma.tenantPlan.findFirst({
    where: {
      tenantId,
      status: 'ACTIVE'
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
    console.log('  NO ACTIVE PLAN!')
    return
  }

  console.log('  Plan:', tenantPlan.plan.name, '(' + tenantPlan.plan.code + ')')
  console.log('')
  console.log('  Feature Limits:')
  
  for (const pf of tenantPlan.plan.planFeatures || []) {
    console.log(`    ${pf.feature.code}:`)
    console.log(`      Daily Tokens: ${pf.dailyTokenQuota ?? 'unlimited'}`)
    console.log(`      Monthly Tokens: ${pf.monthlyTokenQuota ?? 'unlimited'}`)
    console.log(`      Daily Completions: ${pf.dailyQuota ?? 'unlimited'}`)
    console.log(`      Monthly Completions: ${pf.monthlyQuota ?? 'unlimited'}`)
  }
  console.log('')

  // 2. Get current service completion usage
  console.log('2. SERVICE COMPLETION USAGE (ServiceCompletionUsage table)')
  console.log('-'.repeat(40))
  
  const currentDay = new Date().toISOString().substring(0, 10)
  const currentMonth = new Date().toISOString().substring(0, 7)

  const completionUsage = await prisma.serviceCompletionUsage.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: 20
  })

  if (completionUsage.length === 0) {
    console.log('  No completion usage records found.')
  } else {
    // Aggregate by service type
    const byService = {}
    for (const u of completionUsage) {
      if (!byService[u.serviceType]) {
        byService[u.serviceType] = { daily: 0, monthly: 0, dailyTokens: 0, monthlyTokens: 0 }
      }
      if (u.usageDate === currentDay) {
        byService[u.serviceType].daily += u.completions
        byService[u.serviceType].dailyTokens += u.tokensUsed
      }
      if (u.usageMonth === currentMonth) {
        byService[u.serviceType].monthly += u.completions
        byService[u.serviceType].monthlyTokens += u.tokensUsed
      }
    }
    
    console.log('  Service | Today Completions | Today Tokens | Month Completions | Month Tokens')
    console.log('  ' + '-'.repeat(80))
    for (const [service, usage] of Object.entries(byService)) {
      console.log(`  ${service.padEnd(15)} | ${String(usage.daily).padStart(17)} | ${String(usage.dailyTokens).padStart(12)} | ${String(usage.monthly).padStart(17)} | ${usage.monthlyTokens}`)
    }
  }
  console.log('')

  // 3. Check the metering table directly
  console.log('3. RAW METERING DATA (last 10 records)')
  console.log('-'.repeat(40))
  
  const meteringRecords = await prisma.serviceCompletionUsage.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: 10
  })

  if (meteringRecords.length === 0) {
    console.log('  No metering records found.')
  } else {
    for (const r of meteringRecords) {
      console.log(`  ${r.usageDate} | ${r.serviceType} | completions: ${r.completions} | tokens: ${r.tokensUsed}`)
    }
  }
  console.log('')

  // 4. Check if there's a specific quota issue
  console.log('4. QUOTA CHECK SIMULATION')
  console.log('-'.repeat(40))
  
  // Find the PATENT_DRAFTING or LLM2_DRAFT feature limits
  const draftFeature = tenantPlan.plan.planFeatures?.find(
    pf => pf.feature.code === 'PATENT_DRAFTING' || pf.feature.code === 'LLM2_DRAFT'
  )
  
  if (draftFeature) {
    const dailyTokenLimit = draftFeature.dailyTokenQuota
    const monthlyTokenLimit = draftFeature.monthlyTokenQuota
    const dailyCompletionLimit = draftFeature.dailyQuota
    const monthlyCompletionLimit = draftFeature.monthlyQuota
    
    // Sum up usage for today and this month
    const todayUsage = await prisma.serviceCompletionUsage.aggregate({
      where: { tenantId, usageDate: currentDay, serviceType: 'PATENT_DRAFTING' },
      _sum: { completions: true, tokensUsed: true }
    })
    
    const monthUsage = await prisma.serviceCompletionUsage.aggregate({
      where: { tenantId, usageMonth: currentMonth, serviceType: 'PATENT_DRAFTING' },
      _sum: { completions: true, tokensUsed: true }
    })
    
    console.log(`  Daily Token Usage: ${todayUsage._sum.tokensUsed || 0} / ${dailyTokenLimit ?? 'unlimited'}`)
    console.log(`  Monthly Token Usage: ${monthUsage._sum.tokensUsed || 0} / ${monthlyTokenLimit ?? 'unlimited'}`)
    console.log(`  Daily Completions: ${todayUsage._sum.completions || 0} / ${dailyCompletionLimit ?? 'unlimited'}`)
    console.log(`  Monthly Completions: ${monthUsage._sum.completions || 0} / ${monthlyCompletionLimit ?? 'unlimited'}`)
    
    // Check if exceeded
    if (dailyTokenLimit && (todayUsage._sum.tokensUsed || 0) >= dailyTokenLimit) {
      console.log('  !! DAILY TOKEN QUOTA EXCEEDED !!')
    }
    if (monthlyTokenLimit && (monthUsage._sum.tokensUsed || 0) >= monthlyTokenLimit) {
      console.log('  !! MONTHLY TOKEN QUOTA EXCEEDED !!')
    }
    if (dailyCompletionLimit && (todayUsage._sum.completions || 0) >= dailyCompletionLimit) {
      console.log('  !! DAILY COMPLETION QUOTA EXCEEDED !!')
    }
    if (monthlyCompletionLimit && (monthUsage._sum.completions || 0) >= monthlyCompletionLimit) {
      console.log('  !! MONTHLY COMPLETION QUOTA EXCEEDED !!')
    }
  } else {
    console.log('  No PATENT_DRAFTING feature found in plan!')
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
