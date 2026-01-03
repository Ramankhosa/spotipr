#!/usr/bin/env node

/**
 * Fix Tenant Missing TenantPlan
 * 
 * This script assigns a plan to tenants that don't have any TenantPlan record.
 * This is critical for service access - without a TenantPlan, tenant resolution fails
 * with "Unable to resolve tenant context" error.
 * 
 * Usage: 
 *   node scripts/fix-tenant-missing-plan.js [atiId] [planCode]
 * 
 * Examples:
 *   node scripts/fix-tenant-missing-plan.js                    # Fix all tenants without plan
 *   node scripts/fix-tenant-missing-plan.js ENTERPRISE1        # Fix specific tenant
 *   node scripts/fix-tenant-missing-plan.js ENTERPRISE1 ENTERPRISE_PLAN  # Fix with specific plan
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function fixTenantMissingPlan(targetAtiId = null, planCode = 'FREE_PLAN') {
  try {
    console.log('🔧 Fixing Tenants Without TenantPlan Records\n')

    // Build query based on whether we're targeting a specific tenant
    const whereClause = targetAtiId ? { atiId: targetAtiId } : {}

    // Find tenants without active plans
    const tenantsWithoutPlan = await prisma.tenant.findMany({
      where: {
        ...whereClause,
        NOT: {
          tenantPlans: {
            some: {
              status: 'ACTIVE'
            }
          }
        }
      },
      include: {
        tenantPlans: true,
        _count: { select: { users: true } }
      }
    })

    if (tenantsWithoutPlan.length === 0) {
      console.log('✅ All tenants already have active TenantPlan records.')
      if (targetAtiId) {
        console.log(`   Checked tenant: ${targetAtiId}`)
      }
      return
    }

    console.log(`Found ${tenantsWithoutPlan.length} tenant(s) without active plans:\n`)
    tenantsWithoutPlan.forEach(t => {
      console.log(`  - ${t.name} (ATI: ${t.atiId})`)
      console.log(`    Users: ${t._count.users}, Current plans: ${t.tenantPlans.length}`)
    })

    // Find the plan to assign
    let plan = await prisma.plan.findUnique({
      where: { code: planCode }
    })

    if (!plan) {
      console.log(`\n⚠️  Plan '${planCode}' not found. Trying alternatives...`)
      
      // Try common plan codes in order of preference
      const fallbackCodes = ['ENTERPRISE_PLAN', 'PRO_PLAN', 'FREE_PLAN', 'TRIAL']
      for (const code of fallbackCodes) {
        plan = await prisma.plan.findUnique({ where: { code } })
        if (plan) {
          console.log(`   Found fallback plan: ${code}`)
          break
        }
      }
      
      // If still no plan, get any active plan
      if (!plan) {
        plan = await prisma.plan.findFirst({
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'asc' }
        })
        if (plan) {
          console.log(`   Using first available plan: ${plan.code}`)
        }
      }
    }

    if (!plan) {
      console.error('\n❌ ERROR: No plans exist in the database!')
      console.error('   Please run the seed script first: npx prisma db seed')
      process.exit(1)
    }

    console.log(`\n📋 Assigning plan: ${plan.name} (${plan.code})\n`)

    // Create TenantPlan records
    for (const tenant of tenantsWithoutPlan) {
      try {
        await prisma.tenantPlan.create({
          data: {
            tenantId: tenant.id,
            planId: plan.id,
            effectiveFrom: new Date(),
            status: 'ACTIVE'
          }
        })
        console.log(`✅ Assigned ${plan.code} to ${tenant.name} (${tenant.atiId})`)
      } catch (error) {
        if (error.code === 'P2002') {
          console.log(`⏭️  ${tenant.name} already has a plan (race condition)`)
        } else {
          console.error(`❌ Failed to assign plan to ${tenant.name}:`, error.message)
        }
      }
    }

    console.log('\n✅ Done! Tenants can now access services.')

    // Verification
    console.log('\n🔍 Verification:')
    for (const tenant of tenantsWithoutPlan) {
      const updated = await prisma.tenant.findUnique({
        where: { id: tenant.id },
        include: {
          tenantPlans: {
            where: { status: 'ACTIVE' },
            include: { plan: true }
          }
        }
      })
      
      if (updated?.tenantPlans[0]) {
        console.log(`  ✅ ${tenant.name}: ${updated.tenantPlans[0].plan.code}`)
      } else {
        console.log(`  ❌ ${tenant.name}: Still no active plan!`)
      }
    }

  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// Parse command line arguments
const args = process.argv.slice(2)
const targetAtiId = args[0] || null
const planCode = args[1] || 'ENTERPRISE_PLAN' // Default to enterprise for new signups

fixTenantMissingPlan(targetAtiId, planCode)

