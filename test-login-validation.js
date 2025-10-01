const { PrismaClient } = require('@prisma/client')

async function testLoginValidation() {
  const prisma = new PrismaClient()

  try {
    console.log('=== TESTING LOGIN ATI VALIDATION ===\n')

    // Get a tenant user
    const user = await prisma.user.findFirst({
      where: {
        email: 'student@lpu.edu',
        tenantId: { not: null }
      },
      include: { tenant: true }
    })

    if (!user) {
      console.log('❌ No tenant user found')
      return
    }

    console.log(`Testing login for: ${user.email} (Tenant: ${user.tenant.name})`)

    // Simulate the ATI validation logic from login API
    const now = new Date()
    const tokens = await prisma.aTIToken.findMany({
      where: {
        tenantId: user.tenantId,
        status: { in: ['ACTIVE', 'ISSUED'] }
      }
    })

    console.log(`Found ${tokens.length} tokens for tenant`)

    // Check if any token is still valid (not expired and not used up)
    const hasValidToken = tokens.some(token => {
      // Check expiration
      if (token.expiresAt && token.expiresAt <= now) {
        console.log(`❌ Token ${token.fingerprint} is expired`)
        return false
      }
      // Check usage limit
      if (token.maxUses !== null && token.usageCount >= token.maxUses) {
        console.log(`❌ Token ${token.fingerprint} is used up (${token.usageCount}/${token.maxUses})`)
        return false
      }
      console.log(`✅ Token ${token.fingerprint} is valid`)
      return true
    })

    if (hasValidToken) {
      console.log('✅ LOGIN ALLOWED: User has valid ATI tokens')
    } else {
      console.log('❌ LOGIN BLOCKED: No valid ATI tokens available')
    }

    // Test suspending all tokens
    console.log('\n--- TESTING TOKEN SUSPENSION ---')
    for (const token of tokens) {
      await prisma.aTIToken.update({
        where: { id: token.id },
        data: { status: 'SUSPENDED' }
      })
      console.log(`🔄 Suspended token: ${token.fingerprint}`)
    }

    // Check again
    const suspendedTokens = await prisma.aTIToken.findMany({
      where: {
        tenantId: user.tenantId,
        status: { in: ['ACTIVE', 'ISSUED'] }
      }
    })

    const hasValidAfterSuspend = suspendedTokens.some(token => {
      if (token.expiresAt && token.expiresAt <= now) return false
      if (token.maxUses !== null && token.usageCount >= token.maxUses) return false
      return true
    })

    if (hasValidAfterSuspend) {
      console.log('✅ LOGIN STILL ALLOWED: User still has valid tokens')
    } else {
      console.log('❌ LOGIN NOW BLOCKED: All tokens suspended')
    }

    // Restore tokens
    for (const token of tokens) {
      await prisma.aTIToken.update({
        where: { id: token.id },
        data: { status: token.status === 'ACTIVE' ? 'ACTIVE' : 'ISSUED' }
      })
      console.log(`🔄 Restored token: ${token.fingerprint}`)
    }

    console.log('\n✅ LOGIN ATI VALIDATION TEST COMPLETE')

  } catch (error) {
    console.error('Test error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

testLoginValidation()
