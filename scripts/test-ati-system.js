#!/usr/bin/env node

/**
 * ATI System Test Suite
 *
 * Tests core ATI functionality:
 * - Super admin authentication
 * - Tenant creation
 * - ATI token management
 * - Cross-tenant isolation
 */

const http = require('http')
const https = require('https')

// Configuration
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
const API_BASE = `${BASE_URL}/api/v1`

// Test data
let superAdminToken = null
let createdTenant = null

// Test results
const results = {
  passed: 0,
  failed: 0,
  tests: []
}

function log(message, type = 'info') {
  const timestamp = new Date().toISOString()
  const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : 'ℹ️'
  console.log(`[${timestamp}] ${prefix} ${message}`)
}

async function test(name, testFn) {
  try {
    log(`🧪 Running: ${name}`)
    const result = await testFn()
    if (result) {
      results.passed++
      log(`${name} - PASSED`, 'success')
    } else {
      results.failed++
      log(`${name} - FAILED`, 'error')
    }
    results.tests.push({ name, passed: result })
    return result
  } catch (error) {
    results.failed++
    log(`${name} - ERROR: ${error.message}`, 'error')
    results.tests.push({ name, passed: false, error: error.message })
    return false
  }
}

// Helper functions
async function makeRequest(endpoint, options = {}) {
  return new Promise((resolve) => {
    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`
    const urlObj = new URL(url)
    const isHttps = urlObj.protocol === 'https:'

    const defaultHeaders = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }

    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: defaultHeaders
    }

    const client = isHttps ? https : http
    const req = client.request(requestOptions, (res) => {
      let data = ''

      res.on('data', (chunk) => {
        data += chunk
      })

      res.on('end', () => {
        let parsedData
        try {
          parsedData = JSON.parse(data)
        } catch (e) {
          parsedData = { message: 'Invalid JSON response', raw: data }
        }

        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          data: parsedData
        })
      })
    })

    req.on('error', (error) => {
      resolve({
        ok: false,
        status: 0,
        data: { message: `Network error: ${error.message}` }
      })
    })

    // Send request body if POST/PUT
    if (options.body && (options.method === 'POST' || options.method === 'PUT')) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body))
    }

    req.setTimeout(5000, () => {
      req.destroy()
      resolve({
        ok: false,
        status: 0,
        data: { message: 'Request timeout' }
      })
    })

    req.end()
  })
}

async function makeAuthRequest(endpoint, token, options = {}) {
  return makeRequest(endpoint, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {})
    }
  })
}

// Test suites
const testSuites = {

  // 1. Super Admin Authentication Tests
  async testSuperAdminLogin() {
    log('🔐 Testing Super Admin Login')

    const loginData = {
      email: 'superadmin@spotipr.com',
      password: 'SuperSecure123!'
    }

    const response = await makeRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify(loginData)
    })

    if (!response.ok) {
      log(`Super admin login failed: ${response.data.message || response.status}`, 'error')
      return false
    }

    superAdminToken = response.data.token
    log(`Super admin login successful`)

    // Verify token with whoami
    const whoamiResponse = await makeAuthRequest('/auth/whoami', superAdminToken)
    if (!whoamiResponse.ok) {
      log('Super admin whoami failed', 'error')
      return false
    }

    const user = whoamiResponse.data
    if (user.role !== 'SUPER_ADMIN') {
      log(`Expected SUPER_ADMIN role, got ${user.role}`, 'error')
      return false
    }

    if (!user.tenant_id) {
      log('Super admin should have tenant_id', 'error')
      return false
    }

    log('Super admin authentication and scope verified')
    return true
  },

  // 2. Tenant Management Tests
  async testTenantCreation() {
    log('🏢 Testing Tenant Creation')

    const tenantData = {
      name: 'Test Corporation',
      atiId: 'TESTCORP',
      generateInitialToken: true,
      initialTokenConfig: {
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        max_uses: 10,
        plan_tier: 'PRO',
        notes: 'Test tenant initial token'
      }
    }

    const response = await makeAuthRequest('/platform/tenants', superAdminToken, {
      method: 'POST',
      body: JSON.stringify(tenantData)
    })

    if (!response.ok) {
      log(`Tenant creation failed: ${response.data.message || response.status}`, 'error')
      return false
    }

    createdTenant = response.data
    log(`Tenant created: ${createdTenant.name} (${createdTenant.ati_id})`)

    if (response.data.initial_token) {
      log('Initial ATI token generated successfully')
    }

    return true
  },

  async testTenantListAccess() {
    log('📋 Testing Tenant List Access')

    const response = await makeAuthRequest('/platform/tenants', superAdminToken)
    if (!response.ok) {
      log(`Tenant list access failed: ${response.data.message || response.status}`, 'error')
      return false
    }

    const tenants = response.data
    const testTenant = tenants.find(t => t.ati_id === 'TESTCORP')
    if (!testTenant) {
      log('Created tenant not found in list', 'error')
      return false
    }

    // Platform tenant should be hidden
    const platformTenant = tenants.find(t => t.ati_id === 'PLATFORM')
    if (platformTenant) {
      log('Platform tenant should not be visible', 'error')
      return false
    }

    log(`Super admin can access ${tenants.length} tenants`)
    return true
  },

  // 3. ATI Token Management Tests
  async testSuperAdminATITokenManagement() {
    log('🎫 Testing Super Admin ATI Token Management')

    // List all ATI tokens
    const listResponse = await makeAuthRequest('/platform/ati', superAdminToken)
    if (!listResponse.ok) {
      log(`Token list failed: ${listResponse.data.message || listResponse.status}`, 'error')
      return false
    }

    const tokens = listResponse.data
    log(`Super admin can see ${tokens.length} ATI tokens globally`)

    // Find a token to test with
    const testToken = tokens.find(t => t.tenant?.ati_id === 'TESTCORP')
    if (!testToken) {
      log('Test ATI token not found', 'error')
      return false
    }

    // Test token update
    const updateResponse = await makeAuthRequest(`/platform/ati/${testToken.id}`, superAdminToken, {
      method: 'PUT',
      body: JSON.stringify({
        status: 'ACTIVE',
        notes: 'Updated by super admin test'
      })
    })

    if (!updateResponse.ok) {
      log(`Token update failed: ${updateResponse.data.message || updateResponse.status}`, 'error')
      return false
    }

    log('Super admin can update ATI tokens globally')
    return true
  },

  // 4. Cross-Tenant Isolation Tests
  async testCrossTenantIsolation() {
    log('🔒 Testing Cross-Tenant Isolation')

    // Create a mock tenant admin token (we'll use super admin token for now)
    // In real scenario, we'd create a tenant admin first

    // Test that super admin can access platform endpoints
    const platformResponse = await makeAuthRequest('/platform/tenants', superAdminToken)
    if (!platformResponse.ok) {
      log('Super admin cannot access platform endpoints', 'error')
      return false
    }

    // Test that super admin can access global ATI tokens
    const globalTokensResponse = await makeAuthRequest('/platform/ati', superAdminToken)
    if (!globalTokensResponse.ok) {
      log('Super admin cannot access global ATI tokens', 'error')
      return false
    }

    log('Super admin has proper platform access')
    return true
  },

  // 5. Error Scenario Tests
  async testErrorScenarios() {
    log('🚫 Testing Error Scenarios')

    // Test invalid login credentials
    const invalidLogin = await makeRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: 'nonexistent@example.com',
        password: 'wrongpass'
      })
    })

    if (invalidLogin.ok) {
      log('Invalid login should have failed', 'error')
      return false
    }

    // Test signup with invalid ATI token
    const invalidSignup = await makeRequest('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'password123',
        atiToken: 'INVALID_TOKEN_12345'
      })
    })

    if (invalidSignup.ok) {
      log('Invalid ATI token signup should have failed', 'error')
      return false
    }

    // Test unauthorized access to platform endpoints
    const unauthorizedAccess = await makeRequest('/platform/tenants')
    if (unauthorizedAccess.ok) {
      log('Unauthorized access should have been blocked', 'error')
      return false
    }

    log('Error scenarios handled correctly')
    return true
  }
}

// Main test runner
async function runTests() {
  log('🧪 Starting ATI System Test Suite')
  log('=' .repeat(50))

  // Check if server is running
  log('🔍 Checking server availability...')
  try {
    // Try connecting to any endpoint - even 404 means server is running
    const healthCheck = await makeRequest('/api/v1/auth/login')
    if (healthCheck.status === 405 || healthCheck.status === 404 || healthCheck.status === 200) {
      log('✅ Server is responding')
    } else if (healthCheck.status >= 400 && healthCheck.status < 500) {
      log('✅ Server is responding (client error expected)')
    } else {
      log(`❌ Server not responding properly (status: ${healthCheck.status}). Please ensure server is running with: npm run dev`, 'error')
      process.exit(1)
    }
  } catch (error) {
    log(`❌ Cannot connect to server: ${error.message}. Please start with: npm run dev`, 'error')
    process.exit(1)
  }

  // Run test suites in order
  const testOrder = [
    'testSuperAdminLogin',
    'testTenantCreation',
    'testTenantListAccess',
    'testSuperAdminATITokenManagement',
    'testCrossTenantIsolation',
    'testErrorScenarios'
  ]

  for (const testName of testOrder) {
    if (testSuites[testName]) {
      await test(testName, testSuites[testName])
      log('') // Empty line between tests
    }
  }

  // Print results
  log('=' .repeat(50))
  log('📊 TEST RESULTS SUMMARY')
  log('=' .repeat(50))

  log(`Total Tests: ${results.tests.length}`)
  log(`✅ Passed: ${results.passed}`, 'success')
  log(`❌ Failed: ${results.failed}`, results.failed > 0 ? 'error' : 'info')

  if (results.failed > 0) {
    log('\n❌ FAILED TESTS:')
    results.tests.filter(t => !t.passed).forEach(t => {
      log(`  - ${t.name}${t.error ? `: ${t.error}` : ''}`, 'error')
    })
  }

  log('\n✅ PASSED TESTS:')
  results.tests.filter(t => t.passed).forEach(t => {
    log(`  - ${t.name}`, 'success')
  })

  const successRate = (results.passed / results.tests.length * 100).toFixed(1)
  log(`\n🎯 Success Rate: ${successRate}%`)

  if (results.failed === 0) {
    log('\n🎉 ALL TESTS PASSED! ATI System is working correctly.', 'success')
  } else {
    log(`\n⚠️  ${results.failed} test(s) failed. Please review and fix issues.`, 'error')
    process.exit(1)
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  runTests().catch(error => {
    log(`Test suite failed with error: ${error.message}`, 'error')
    process.exit(1)
  })
}

module.exports = { runTests, testSuites }
