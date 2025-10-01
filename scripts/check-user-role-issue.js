#!/usr/bin/env node

/**
 * Check why user got ADMIN role instead of ANALYST when using ATI token
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function checkUserRoleIssue() {
  try {
    console.log('🔍 Investigating user role assignment issue...\n')

    // Find the user who signed up with the ATI token
    // Since we don't have the exact email, let's check recent signups
    const recentUsers = await prisma.user.findMany({
      where: {
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
        }
      },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        tenantId: true,
        signupAtiTokenId: true,
        tenant: {
          select: {
            name: true,
            atiId: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    console.log(`Found ${recentUsers.length} recently created users:`)
    recentUsers.forEach((user, index) => {
      console.log(`${index + 1}. ${user.email} - ${user.role} - ${user.tenant?.name} - Token: ${user.signupAtiTokenId || 'None'}`)
    })

    // Check if there's a user named something like ramankhosa1
    const potentialUsers = recentUsers.filter(user =>
      user.email.toLowerCase().includes('ramankhosa') ||
      user.email.toLowerCase().includes('analyst')
    )

    if (potentialUsers.length === 0) {
      console.log('\n❌ No matching users found with "ramankhosa" or "analyst" in email')
      return
    }

    console.log(`\n🎯 Found ${potentialUsers.length} potential matching user(s):`)
    const targetUser = potentialUsers[0] // Take the most recent one

    console.log(`\nInvestigating user: ${targetUser.email} (${targetUser.role})`)

    // Check their signup token
    if (!targetUser.signupAtiTokenId) {
      console.log('❌ User has no signup ATI token')
      return
    }

    const signupToken = await prisma.aTIToken.findUnique({
      where: { id: targetUser.signupAtiTokenId },
      select: {
        id: true,
        planTier: true,
        status: true,
        tenantId: true,
        rawToken: true
      }
    })

    if (!signupToken) {
      console.log('❌ Signup token not found')
      return
    }

    console.log(`✅ Signup token: ${signupToken.id} (${signupToken.planTier})`)

    // Check who created this token (from audit logs)
    const tokenCreationLog = await prisma.auditLog.findFirst({
      where: {
        resource: `ati_token:${signupToken.id}`,
        action: 'ATI_ISSUE'
      },
      select: {
        actorUserId: true,
        createdAt: true,
        meta: true
      },
      orderBy: { createdAt: 'desc' }
    })

    if (!tokenCreationLog) {
      console.log('❌ No audit log found for token creation')
      return
    }

    // Check the token creator
    const tokenCreator = await prisma.user.findUnique({
      where: { id: tokenCreationLog.actorUserId },
      select: {
        id: true,
        email: true,
        role: true,
        tenantId: true,
        tenant: {
          select: { atiId: true }
        }
      }
    })

    console.log(`\n🔍 Token Creation Analysis:`)
    console.log(`   Token created by: ${tokenCreator?.email} (${tokenCreator?.role})`)
    console.log(`   Creator tenant: ${tokenCreator?.tenant?.atiId || 'None'}`)

    // Apply the same logic as signup route
    let expectedRole = 'ANALYST' // Default

    // Check if this was the first user in tenant
    const tenantUserCount = await prisma.user.count({
      where: { tenantId: targetUser.tenantId }
    })

    console.log(`   Was first user in tenant: ${tenantUserCount === 1 ? 'YES' : 'NO'}`)

    if (tenantUserCount === 1) {
      expectedRole = 'OWNER'
      console.log(`   → First user → Should get OWNER role`)
    } else {
      // Check token creator
      if (tokenCreator?.role === 'SUPER_ADMIN' || tokenCreator?.tenant?.atiId === 'PLATFORM') {
        expectedRole = 'ADMIN'
        console.log(`   → Token created by super admin → Should get ADMIN role`)
      } else {
        expectedRole = 'ANALYST'
        console.log(`   → Token created by tenant admin → Should get ANALYST role`)
      }
    }

    console.log(`\n📊 Role Assignment Analysis:`)
    console.log(`   Expected role: ${expectedRole}`)
    console.log(`   Actual role: ${targetUser.role}`)
    console.log(`   Match: ${expectedRole === targetUser.role ? '✅ YES' : '❌ NO'}`)

    if (expectedRole !== targetUser.role) {
      console.log(`\n❌ ROLE MISMATCH DETECTED!`)
      console.log(`   User expected: ${expectedRole}`)
      console.log(`   User got: ${targetUser.role}`)

      if (targetUser.role === 'ADMIN' && expectedRole === 'ANALYST') {
        console.log(`\n💡 This happens when:`)
        console.log(`   1. Token was created by SUPER_ADMIN (assigns ADMIN role)`)
        console.log(`   2. User expected ANALYST role from tenant-issued token`)
        console.log(`   3. For analyst accounts, tokens must be issued by tenant admins, not super admins`)
      }
    } else {
      console.log(`\n✅ Role assignment is correct`)
    }

    // Provide solution
    console.log(`\n🔧 Solution:`)
    if (targetUser.role === 'ADMIN' && tokenCreator?.role === 'SUPER_ADMIN') {
      console.log(`   To create ANALYST users, tenant admins should issue ATI tokens`)
      console.log(`   Super admin tokens create ADMIN accounts for tenant management`)
    }

  } catch (error) {
    console.error('❌ Error investigating role issue:', error.message)
    console.error('Stack:', error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the investigation
checkUserRoleIssue()

