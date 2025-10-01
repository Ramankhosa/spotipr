#!/usr/bin/env node

/**
 * Check tenant admin details and recent ATI tokens
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function checkTenantAdmin() {
  try {
    console.log('🔍 Checking tenant admin details...\n')

    // Find tenants with admin users
    const tenantsWithAdmins = await prisma.tenant.findMany({
      include: {
        users: {
          where: { role: { in: ['ADMIN', 'OWNER'] } },
          select: {
            id: true,
            email: true,
            role: true,
            status: true
          }
        },
        tenantPlans: {
          include: { plan: true },
          orderBy: { effectiveFrom: 'desc' },
          take: 1
        },
        atiTokens: {
          where: { status: { in: ['ACTIVE', 'ISSUED'] } },
          orderBy: { createdAt: 'desc' },
          take: 3
        }
      }
    })

    console.log(`✅ Found ${tenantsWithAdmins.length} tenants\n`)

    tenantsWithAdmins.forEach((tenant, index) => {
      console.log(`${index + 1}. Tenant: ${tenant.name} (${tenant.atiId})`)
      console.log(`   Status: ${tenant.status}`)
      console.log(`   Plan: ${tenant.tenantPlans[0]?.plan?.name || 'No plan'} (${tenant.tenantPlans[0]?.plan?.code || 'N/A'})`)

      if (tenant.users.length > 0) {
        console.log(`   Admin Users: ${tenant.users.length}`)
        tenant.users.forEach(user => {
          console.log(`     - ${user.email} (${user.role}) - ${user.status}`)
        })
      } else {
        console.log(`   Admin Users: None`)
      }

      if (tenant.atiTokens.length > 0) {
        console.log(`   Recent ATI Tokens: ${tenant.atiTokens.length}`)
        tenant.atiTokens.forEach(token => {
          console.log(`     - ${token.id}: ${token.status} - ${token.planTier} - Expires: ${token.expiresAt || 'Never'}`)
          if (token.rawToken) {
            console.log(`       Raw Token: ${token.rawToken.substring(0, 20)}...`)
          }
        })
      }

      console.log('')
    })

    // Specifically check the POLU tenant that had the PRO token
    console.log('🔍 Checking POLU tenant specifically...\n')
    const poluTenant = await prisma.tenant.findUnique({
      where: { atiId: 'POLU' },
      include: {
        users: {
          where: { role: { in: ['ADMIN', 'OWNER'] } },
          select: {
            id: true,
            email: true,
            role: true,
            status: true
          }
        },
        atiTokens: {
          orderBy: { createdAt: 'desc' },
          take: 5
        }
      }
    })

    if (poluTenant) {
      console.log('POLU Tenant Details:')
      console.log(`   Name: ${poluTenant.name}`)
      console.log(`   ATI ID: ${poluTenant.atiId}`)
      console.log(`   Status: ${poluTenant.status}`)

      console.log(`   Admin Users: ${poluTenant.users.length}`)
      poluTenant.users.forEach(user => {
        console.log(`     - ${user.email} (${user.role}) - Status: ${user.status}`)
      })

      console.log(`   ATI Tokens: ${poluTenant.atiTokens.length}`)
      poluTenant.atiTokens.forEach(token => {
        console.log(`     - ID: ${token.id}`)
        console.log(`       Status: ${token.status}`)
        console.log(`       Plan Tier: ${token.planTier}`)
        console.log(`       Expires: ${token.expiresAt || 'Never'}`)
        console.log(`       Raw Token: ${token.rawToken ? token.rawToken.substring(0, 20) + '...' : 'Cleared'}`)
        console.log('')
      })
    } else {
      console.log('❌ POLU tenant not found')
    }

  } catch (error) {
    console.error('❌ Error checking tenant admin:', error.message)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the script
checkTenantAdmin()
