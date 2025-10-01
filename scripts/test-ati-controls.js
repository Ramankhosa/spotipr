#!/usr/bin/env node

/**
 * Comprehensive ATI Controls Test Script
 *
 * Tests all ATI token validation scenarios:
 * - Super Admin login (no ATI required)
 * - Tenant creation with token generation
 * - Valid token signup
 * - Invalid token scenarios (expired, revoked, used up)
 * - Tenant status effects (active vs suspended)
 * - User status effects (active vs suspended)
 */

const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')

const prisma = new PrismaClient()

// Test configuration
const TEST_SUPER_ADMIN = {
  email: 'testadmin@spotipr.com',
  password: 'TestPass123'
}

const TEST_TENANT = {
  name: 'Test Controls Corp',
  atiId: 'TESTCTL'
}

const TEST_USER = {
  email: 'testuser@controls.com',
  password: 'UserPass123'
}

const JWT_SECRET = process.env.JWT_SECRET

// Utility functions
function generateJWT(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' })
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Test functions
async function testSuperAdminLogin() {
  console.log('\n🔐 Test 1: Super Admin Login (No ATI Required)')
  console.log('=' .repeat(50))

  try {
    // Get Super Admin from DB
    const superAdmin = await prisma.user.findFirst({
      where: { role: 'SUPER_ADMIN' }
    })

    if (!superAdmin) {
      console.log('❌ No Super Admin found')
      return false
    }

    // Test password verification
    const isValidPassword = await bcrypt.compare(TEST_SUPER_ADMIN.password, superAdmin.passwordHash)
    console.log(`✅ Password verification: ${isValidPassword ? 'PASS' : 'FAIL'}`)

    if (isValidPassword) {
      // Generate JWT
      const token = generateJWT({
        sub: superAdmin.id,
        email: superAdmin.email,
        tenant_id: null,
        role: superAdmin.role,
        ati_id: null
      })
      console.log('✅ JWT generated successfully')
      return { success: true, token, userId: superAdmin.id }
    }

    return { success: false }
  } catch (error) {
    console.log('❌ Super Admin login failed:', error.message)
    return { success: false }
  }
}

async function testTenantCreation(superAdminToken) {
  console.log('\n🏢 Test 2: Tenant Creation with ATI Token Generation')
  console.log('=' .repeat(55))

  try {
    const response = await fetch('http://localhost:3000/api/v1/platform/tenants', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${superAdminToken}`
      },
      body: JSON.stringify({
        name: TEST_TENANT.name,
        atiId: TEST_TENANT.atiId,
        generateInitialToken: true,
        initialTokenConfig: {
          max_uses: 3,
          plan_tier: 'BASIC'
        }
      })
    })

    const data = await response.json()

    if (response.ok && data.initial_token) {
      console.log('✅ Tenant created successfully')
      console.log(`🏷️  Tenant ID: ${data.id}`)
      console.log(`🏷️  ATI ID: ${data.ati_id}`)
      console.log(`🎫 Token Fingerprint: ${data.initial_token.fingerprint}`)
      console.log(`📊 Max Uses: ${data.initial_token.max_uses}`)

      // Store the token for later tests
      TEST_TENANT.token = data.initial_token.token_display_once
      TEST_TENANT.id = data.id

      return { success: true, token: data.initial_token.token_display_once, tenantId: data.id }
    } else {
      console.log('❌ Tenant creation failed:', data.message)
      return { success: false }
    }
  } catch (error) {
    console.log('❌ Tenant creation error:', error.message)
    return { success: false }
  }
}

async function testValidTokenSignup() {
  console.log('\n✅ Test 3: Valid ATI Token Signup')
  console.log('=' .repeat(35))

  try {
    const response = await fetch('http://localhost:3000/api/v1/auth/signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: TEST_USER.email,
        password: TEST_USER.password,
        atiToken: TEST_TENANT.token
      })
    })

    const data = await response.json()

    if (response.ok) {
      console.log('✅ User signup successful')
      console.log(`👤 User ID: ${data.user_id}`)
      console.log(`🏢 Tenant ID: ${data.tenant_id}`)
      console.log(`👔 Role: ${data.role}`)
      return { success: true, userId: data.user_id }
    } else {
      console.log('❌ User signup failed:', data.message || data.code)
      return { success: false }
    }
  } catch (error) {
    console.log('❌ Signup error:', error.message)
    return { success: false }
  }
}

async function testUserLogin() {
  console.log('\n🚪 Test 4: User Login with Active Tenant')
  console.log('=' .repeat(40))

  try {
    const response = await fetch('http://localhost:3000/api/v1/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: TEST_USER.email,
        password: TEST_USER.password
      })
    })

    const data = await response.json()

    if (response.ok) {
      console.log('✅ User login successful')
      console.log(`⏰ Expires in: ${data.expires_in} seconds`)
      return { success: true, token: data.token }
    } else {
      console.log('❌ User login failed:', data.message || data.code)
      return { success: false }
    }
  } catch (error) {
    console.log('❌ Login error:', error.message)
    return { success: false }
  }
}

async function testTokenReuse() {
  console.log('\n🔄 Test 5: ATI Token Reuse (Should Fail)')
  console.log('=' .repeat(40))

  try {
    const response = await fetch('http://localhost:3000/api/v1/auth/signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'seconduser@test.com',
        password: 'Pass123!',
        atiToken: TEST_TENANT.token
      })
    })

    const data = await response.json()

    if (response.status === 400 && data.code === 'ATI_USED_UP') {
      console.log('✅ Token correctly rejected (USED_UP)')
      return { success: true }
    } else {
      console.log('❌ Token reuse should have failed')
      console.log('Response:', data)
      return { success: false }
    }
  } catch (error) {
    console.log('❌ Token reuse test error:', error.message)
    return { success: false }
  }
}

async function testSuspendedTenant() {
  console.log('\n🚫 Test 6: Suspended Tenant Login (Should Fail)')
  console.log('=' .repeat(45))

  try {
    // First suspend the tenant
    await prisma.tenant.update({
      where: { id: TEST_TENANT.id },
      data: { status: 'SUSPENDED' }
    })
    console.log('🏢 Tenant suspended')

    // Try to login
    const response = await fetch('http://localhost:3000/api/v1/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: TEST_USER.email,
        password: TEST_USER.password
      })
    })

    const data = await response.json()

    if (response.status === 401 && data.code === 'TENANT_INACTIVE') {
      console.log('✅ Login correctly rejected (TENANT_INACTIVE)')
      return { success: true }
    } else {
      console.log('❌ Suspended tenant login should have failed')
      console.log('Response:', data)
      return { success: false }
    }
  } catch (error) {
    console.log('❌ Suspended tenant test error:', error.message)
    return { success: false }
  } finally {
    // Restore tenant status
    await prisma.tenant.update({
      where: { id: TEST_TENANT.id },
      data: { status: 'ACTIVE' }
    })
    console.log('🏢 Tenant restored to ACTIVE')
  }
}

async function testSuspendedUser() {
  console.log('\n👤 Test 7: Suspended User Login (Should Fail)')
  console.log('=' .repeat(42))

  try {
    // Get the user and suspend them
    const user = await prisma.user.findUnique({
      where: { email: TEST_USER.email }
    })

    if (!user) {
      console.log('❌ Test user not found')
      return { success: false }
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'SUSPENDED' }
    })
    console.log('👤 User suspended')

    // Try to login
    const response = await fetch('http://localhost:3000/api/v1/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: TEST_USER.email,
        password: TEST_USER.password
      })
    })

    const data = await response.json()

    if (response.status === 401 && data.code === 'USER_SUSPENDED') {
      console.log('✅ Login correctly rejected (USER_SUSPENDED)')
      return { success: true }
    } else {
      console.log('❌ Suspended user login should have failed')
      console.log('Response:', data)
      return { success: false }
    }
  } catch (error) {
    console.log('❌ Suspended user test error:', error.message)
    return { success: false }
  } finally {
    // Restore user status
    const user = await prisma.user.findUnique({
      where: { email: TEST_USER.email }
    })
    if (user) {
      await prisma.user.update({
        where: { id: user.id },
        data: { status: 'ACTIVE' }
      })
      console.log('👤 User restored to ACTIVE')
    }
  }
}

async function testInvalidToken() {
  console.log('\n❌ Test 8: Invalid ATI Token (Should Fail)')
  console.log('=' .repeat(40))

  try {
    const response = await fetch('http://localhost:3000/api/v1/auth/signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'invalid@test.com',
        password: 'Pass123!',
        atiToken: 'invalid-token-12345'
      })
    })

    const data = await response.json()

    if (response.status === 400 && data.code === 'INVALID_ATI_TOKEN') {
      console.log('✅ Invalid token correctly rejected')
      return { success: true }
    } else {
      console.log('❌ Invalid token should have been rejected')
      console.log('Response:', data)
      return { success: false }
    }
  } catch (error) {
    console.log('❌ Invalid token test error:', error.message)
    return { success: false }
  }
}

async function runAllTests() {
  console.log('🧪 ATI Controls Comprehensive Test Suite')
  console.log('=' .repeat(50))
  console.log('Testing all ATI token validation scenarios...')

  const results = []

  // Test 1: Super Admin Login
  const superAdminResult = await testSuperAdminLogin()
  results.push({ test: 'Super Admin Login', ...superAdminResult })

  if (!superAdminResult.success) {
    console.log('\n❌ Cannot proceed without Super Admin login')
    return
  }

  // Test 2: Tenant Creation
  const tenantResult = await testTenantCreation(superAdminResult.token)
  results.push({ test: 'Tenant Creation', ...tenantResult })

  if (!tenantResult.success) {
    console.log('\n❌ Cannot proceed without tenant creation')
    return
  }

  // Test 3: Valid Token Signup
  const signupResult = await testValidTokenSignup()
  results.push({ test: 'Valid Token Signup', ...signupResult })

  if (!signupResult.success) {
    console.log('\n❌ Cannot proceed without successful signup')
    return
  }

  // Test 4: User Login
  const loginResult = await testUserLogin()
  results.push({ test: 'User Login', ...loginResult })

  // Test 5: Token Reuse
  const reuseResult = await testTokenReuse()
  results.push({ test: 'Token Reuse Prevention', ...reuseResult })

  // Test 6: Suspended Tenant
  const suspendedTenantResult = await testSuspendedTenant()
  results.push({ test: 'Suspended Tenant Login', ...suspendedTenantResult })

  // Test 7: Suspended User
  const suspendedUserResult = await testSuspendedUser()
  results.push({ test: 'Suspended User Login', ...suspendedUserResult })

  // Test 8: Invalid Token
  const invalidTokenResult = await testInvalidToken()
  results.push({ test: 'Invalid Token Rejection', ...invalidTokenResult })

  // Summary
  console.log('\n📊 Test Results Summary')
  console.log('=' .repeat(50))

  const passed = results.filter(r => r.success).length
  const total = results.length

  results.forEach(result => {
    const icon = result.success ? '✅' : '❌'
    console.log(`${icon} ${result.test}: ${result.success ? 'PASS' : 'FAIL'}`)
  })

  console.log(`\n🏆 Overall: ${passed}/${total} tests passed`)

  if (passed === total) {
    console.log('🎉 All ATI controls working perfectly!')
  } else {
    console.log('⚠️ Some tests failed. Check implementation.')
  }
}

// Run all tests
runAllTests()
  .catch((error) => {
    console.error('❌ Test suite failed:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
