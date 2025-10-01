const { PrismaClient } = require('@prisma/client')

async function createTestUsers() {
  const prisma = new PrismaClient()

  try {
    // Get the LPU tenant
    const tenant = await prisma.tenant.findFirst({ where: { atiId: 'LPU123' } })
    if (!tenant) {
      console.log('LPU tenant not found')
      return
    }

    console.log(`Found tenant: ${tenant.name} (${tenant.atiId})`)

    // Create tenant admin
    const admin = await prisma.user.create({
      data: {
        email: 'admin@lpu.edu',
        passwordHash: '$2b$10$dummy.hash.for.testing.purposes.only',
        tenantId: tenant.id,
        role: 'ADMIN',
        status: 'ACTIVE',
        name: 'LPU Admin'
      }
    })
    console.log('✓ Created tenant admin:', admin.email)

    // Create regular user
    const user = await prisma.user.create({
      data: {
        email: 'student@lpu.edu',
        passwordHash: '$2b$10$dummy.hash.for.testing.purposes.only',
        tenantId: tenant.id,
        role: 'ANALYST',
        status: 'ACTIVE',
        name: 'LPU Student'
      }
    })
    console.log('✓ Created regular user:', user.email)

    // Create another ATI token for testing
    const atiToken = await prisma.aTIToken.create({
      data: {
        tenantId: tenant.id,
        tokenHash: 'test-token-hash-' + Date.now(),
        fingerprint: 'TEST' + Math.random().toString(36).substring(2, 8).toUpperCase(),
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
        maxUses: 10,
        planTier: 'BASIC',
        notes: 'Test token for validation'
      }
    })
    console.log('✓ Created additional ATI token:', atiToken.fingerprint)

  } catch (error) {
    console.error('Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

createTestUsers()
