#!/usr/bin/env node

/**
 * Script to find ATI-based users and their details
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function getATIUsers() {
  try {
    console.log('🔍 Finding ATI-based users...\n')

    // Find users that are associated with ATI tokens (either through signup or tenant association)
    const atiUsers = await prisma.user.findMany({
      where: {
        OR: [
          { signupAtiTokenId: { not: null } },
          { tenantId: { not: null } }
        ]
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
            id: true,
            name: true,
            atiId: true,
            status: true
          }
        },
        signupAtiToken: {
          select: {
            id: true,
            tokenHash: true,
            status: true,
            planTier: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    })

    if (atiUsers.length === 0) {
      console.log('❌ No ATI-based users found in database')
      console.log('\n💡 This might mean:')
      console.log('   1. No users have signed up through ATI tokens yet')
      console.log('   2. Users were created through other methods')
      console.log('   3. ATI tokens exist but no users are associated with them')
      return
    }

    console.log(`✅ Found ${atiUsers.length} ATI-based user(s):\n`)

    atiUsers.forEach((user, index) => {
      console.log(`${index + 1}. ATI User Details:`)
      console.log(`   User ID: ${user.id}`)
      console.log(`   Email: ${user.email}`)
      console.log(`   Role: ${user.role}`)
      console.log(`   Status: ${user.status}`)
      console.log(`   Created: ${user.createdAt}`)

      if (user.tenant) {
        console.log(`   Tenant: ${user.tenant.name} (${user.tenant.atiId})`)
        console.log(`   Tenant Status: ${user.tenant.status}`)
      } else {
        console.log(`   Tenant: None`)
      }

      if (user.signupAtiToken) {
        console.log(`   Signup ATI Token: ${user.signupAtiToken.id}`)
        console.log(`   ATI Token Status: ${user.signupAtiToken.status}`)
        console.log(`   Plan Tier: ${user.signupAtiToken.planTier || 'Not set'}`)
      } else {
        console.log(`   Signup ATI Token: None`)
      }

      console.log('')
    })

    // Also check for ATI tokens that might exist without users
    console.log('🔍 Checking for ATI tokens without associated users...\n')

    const atiTokens = await prisma.aTIToken.findMany({
      where: {
        status: { in: ['ACTIVE', 'ISSUED'] }
      },
      select: {
        id: true,
        tokenHash: true,
        status: true,
        planTier: true,
        expiresAt: true,
        tenantId: true,
        tenant: {
          select: {
            name: true,
            atiId: true
          }
        },
        signupUsers: {
          select: {
            id: true,
            email: true,
            role: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 10
    })

    if (atiTokens.length > 0) {
      console.log(`✅ Found ${atiTokens.length} active ATI token(s):\n`)

      atiTokens.forEach((token, index) => {
        console.log(`${index + 1}. ATI Token:`)
        console.log(`   Token ID: ${token.id}`)
        console.log(`   Status: ${token.status}`)
        console.log(`   Plan Tier: ${token.planTier || 'Not set'}`)
        console.log(`   Expires: ${token.expiresAt || 'Never'}`)

        if (token.tenant) {
          console.log(`   Tenant: ${token.tenant.name} (${token.tenant.atiId})`)
        }

        if (token.signupUsers.length > 0) {
          console.log(`   Signup Users: ${token.signupUsers.length}`)
          token.signupUsers.forEach(user => {
            console.log(`     - ${user.email} (${user.role})`)
          })
        } else {
          console.log(`   Signup Users: None`)
        }

        console.log('')
      })
    } else {
      console.log('❌ No active ATI tokens found')
    }

    console.log('📝 Note: Passwords are hashed in the database.')
    console.log('   To login as an ATI user, you may need to:')
    console.log('   1. Use the signup process with the ATI token')
    console.log('   2. Reset password if you have access')
    console.log('   3. Check application logs for any default passwords')

  } catch (error) {
    console.error('❌ Error fetching ATI users:', error.message)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the script
getATIUsers()
