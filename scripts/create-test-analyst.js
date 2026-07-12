#!/usr/bin/env node

/**
 * Create a test analyst user with known credentials for login testing
 */

const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')
const prisma = new PrismaClient()

async function createTestAnalyst() {
  try {
    console.log('🔧 Creating test analyst user with known credentials...\n')

    // Test credentials
    const testEmail = 'analyst@test.com'
    const testPassword = 'TestPass123!'
    const testName = 'Test Analyst'

    // Hash the password
    console.log('🔒 Hashing password...')
    const passwordHash = await bcrypt.hash(testPassword, 12)

    // Create or update test tenant
    console.log('🏢 Setting up test tenant...')
    const testTenant = await prisma.tenant.upsert({
      where: { atiId: 'test-tenant-ati' },
      update: {},
      create: {
        name: 'Test Analyst Tenant',
        atiId: 'test-tenant-ati',
        status: 'ACTIVE'
      }
    })

    // Assign FREE_PLAN to tenant
    const freePlan = await prisma.plan.findUnique({ where: { code: 'FREE_PLAN' } })
    if (freePlan) {
      await prisma.tenantPlan.upsert({
        where: {
          tenantId_planId_effectiveFrom: {
            tenantId: testTenant.id,
            planId: freePlan.id,
            effectiveFrom: new Date()
          }
        },
        update: {},
        create: {
          tenantId: testTenant.id,
          planId: freePlan.id,
          effectiveFrom: new Date(),
          status: 'ACTIVE'
        }
      })
      console.log('✅ Assigned FREE_PLAN to tenant')
    }

    // Create ATI token for the tenant (required by auth middleware)
    console.log('🔑 Setting up ATI token...')
    const crypto = require('crypto')
    const tokenHash = crypto.createHash('sha256').update('test-analyst-ati-token').digest('hex')
    const atiToken = await prisma.aTIToken.upsert({
      where: { id: 'test-analyst-ati-token-id' },
      update: { status: 'ACTIVE' },
      create: {
        id: 'test-analyst-ati-token-id',
        tenantId: testTenant.id,
        tokenHash,
        fingerprint: 'test-analyst-fingerprint',
        status: 'ACTIVE',
        tokenType: 'MANUAL',
        assignedRole: 'ANALYST'
      }
    })
    console.log('✅ ATI token ready')

    // Create the test analyst user
    console.log('👤 Creating test analyst user...')
    const testUser = await prisma.user.upsert({
      where: { email: testEmail },
      update: {
        passwordHash,
        name: testName,
        roles: ['ANALYST'],
        status: 'ACTIVE',
        signupAtiTokenId: atiToken.id
      },
      create: {
        email: testEmail,
        passwordHash,
        name: testName,
        roles: ['ANALYST'],
        tenantId: testTenant.id,
        status: 'ACTIVE',
        signupAtiTokenId: atiToken.id
      }
    })

    console.log('\n🎉 Test analyst user created successfully!')
    console.log('================================')
    console.log('📧 EMAIL: analyst@test.com')
    console.log('🔑 PASSWORD: TestPass123!')
    console.log('👤 ROLE: ANALYST')
    console.log('🏢 TENANT: Test Analyst Tenant')
    console.log('================================')
    console.log('\n💡 You can now login with these credentials!')
    console.log('   1. Go to your application login page')
    console.log('   2. Use email: analyst@test.com')
    console.log('   3. Use password: TestPass123!')
    console.log('   4. This user has FREE_PLAN with metering enabled')

  } catch (error) {
    console.error('❌ Error creating test analyst:', error.message)
    console.error('Stack:', error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the script
createTestAnalyst()
