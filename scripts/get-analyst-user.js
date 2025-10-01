#!/usr/bin/env node

/**
 * Script to fetch analyst user credentials
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function getAnalystUsers() {
  try {
    console.log('🔍 Finding analyst users...\n')

    const analystUsers = await prisma.user.findMany({
      where: {
        role: 'ANALYST'
      },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        tenant: {
          select: {
            id: true,
            name: true,
            atiId: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 10
    })

    if (analystUsers.length === 0) {
      console.log('❌ No analyst users found in database')
      return
    }

    console.log(`✅ Found ${analystUsers.length} analyst user(s):\n`)

    analystUsers.forEach((user, index) => {
      console.log(`${index + 1}. Analyst User Details:`)
      console.log(`   User ID: ${user.id}`)
      console.log(`   Email: ${user.email}`)
      console.log(`   Role: ${user.role}`)
      console.log(`   Created: ${user.createdAt}`)
      console.log(`   Tenant: ${user.tenant?.name || 'None'} (${user.tenant?.atiId || 'N/A'})`)
      console.log(`   Tenant ID: ${user.tenant?.id || 'None'}`)
      console.log('')
    })

    // Check if any have default passwords or if we need to show how to login
    console.log('📝 Note: If this is a test user, the password might be hashed.')
    console.log('   You may need to:')
    console.log('   1. Check the user creation script for default passwords')
    console.log('   2. Use password reset functionality')
    console.log('   3. Or create a new test user with known credentials')

  } catch (error) {
    console.error('❌ Error fetching analyst users:', error.message)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the script
getAnalystUsers()
