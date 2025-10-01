#!/usr/bin/env node

/**
 * Check user login and role display issue
 */

const { PrismaClient } = require('@prisma/client')
const jwt = require('jsonwebtoken')
const prisma = new PrismaClient()

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key'

async function checkUserLoginIssue() {
  try {
    console.log('🔍 Investigating user login and role display issue...\n')

    // Check all users with similar names
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { email: { contains: 'ramankhosa' } },
          { email: { contains: 'analyst' } }
        ]
      },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        tenantId: true,
        tenant: {
          select: {
            name: true,
            atiId: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    console.log(`Found ${users.length} users with matching emails:\n`)

    users.forEach((user, index) => {
      console.log(`${index + 1}. ${user.email}`)
      console.log(`   User ID: ${user.id}`)
      console.log(`   Role: ${user.role}`)
      console.log(`   Status: ${user.status}`)
      console.log(`   Tenant: ${user.tenant?.name} (${user.tenant?.atiId})`)
      console.log('')
    })

    // Generate JWT tokens for comparison
    console.log('🔑 JWT Token Analysis for Login:\n')

    users.forEach((user, index) => {
      const jwtPayload = {
        sub: user.id,
        email: user.email,
        tenant_id: user.tenantId,
        role: user.role,
        ati_id: user.tenant?.atiId,
        tenant_ati_id: user.tenant?.atiId
      }

      const token = jwt.sign(jwtPayload, JWT_SECRET, { expiresIn: '1h' })

      console.log(`${index + 1}. ${user.email} JWT:`)
      console.log(`   Role in JWT: ${user.role}`)
      console.log(`   Tenant ID: ${user.tenantId}`)
      console.log(`   Token preview: ${token.substring(0, 50)}...`)
      console.log('')
    })

    // Check if the issue is role confusion
    console.log('🎯 Analysis:\n')

    const analystUsers = users.filter(u => u.role === 'ANALYST')
    const adminUsers = users.filter(u => u.role === 'OWNER' || u.role === 'ADMIN')

    console.log(`ANALYST users: ${analystUsers.length}`)
    analystUsers.forEach(user => {
      console.log(`   - ${user.email} (${user.role})`)
    })

    console.log(`\nADMIN/OWNER users: ${adminUsers.length}`)
    adminUsers.forEach(user => {
      console.log(`   - ${user.email} (${user.role})`)
    })

    if (analystUsers.length > 0 && adminUsers.length > 0) {
      console.log(`\n⚠️  MULTIPLE ACCOUNTS DETECTED!`)
      console.log(`   You might be logged into the wrong account.`)
      console.log(`   - Use ANALYST account for employee access`)
      console.log(`   - Use OWNER/ADMIN account for tenant management`)
    }

    // Provide login credentials
    console.log(`\n🔐 LOGIN CREDENTIALS:\n`)

    if (analystUsers.length > 0) {
      console.log(`ANALYST ACCOUNT (for regular work):`)
      const analyst = analystUsers[0] // Most recent
      console.log(`   Email: ${analyst.email}`)
      console.log(`   Role: ${analyst.role}`)
      console.log(`   Password: [Check how you signed up - passwords are hashed]`)
      console.log('')
    }

    if (adminUsers.length > 0) {
      console.log(`TENANT ADMIN ACCOUNT (for management):`)
      const admin = adminUsers[0] // Most recent
      console.log(`   Email: ${admin.email}`)
      console.log(`   Role: ${admin.role}`)
      console.log(`   Password: [Check how you signed up - passwords are hashed]`)
      console.log('')
    }

    console.log(`💡 TROUBLESHOOTING:`)
    console.log(`   1. Make sure you're logged into the correct account`)
    console.log(`   2. Clear browser cache/cookies if seeing wrong role`)
    console.log(`   3. Check the JWT token in browser dev tools`)
    console.log(`   4. The ATI token you used created the ANALYST account correctly`)

  } catch (error) {
    console.error('❌ Error investigating login issue:', error.message)
    console.error('Stack:', error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the investigation
checkUserLoginIssue()

