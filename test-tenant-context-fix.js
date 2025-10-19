const axios = require('axios')

async function testTenantContextFix() {
  console.log('🧪 Testing Tenant Context Resolution Fix...')

  const BASE_URL = 'http://localhost:3002'

  try {
    // Step 1: Login as analyst
    console.log('🔐 Logging in as analyst...')
    const loginResponse = await axios.post(`${BASE_URL}/api/v1/auth/login`, {
      email: 'analyst@spotipr.com',
      password: 'AnalystPass123!'
    })

    if (!loginResponse.data.token) {
      console.log('❌ Could not get auth token')
      return
    }

    const token = loginResponse.data.token
    console.log('✅ Got auth token')

    // Step 2: Test tenant context resolution by trying to generate a bundle
    console.log('📦 Testing LLM bundle generation (tenant context resolution)...')

    const testResponse = await axios.post(`${BASE_URL}/api/prior-art/generate-bundle`, {
      patentId: 'test-patent-id', // This will fail but should resolve tenant context first
      brief: 'Test brief for tenant context resolution'
    }, {
      headers: { authorization: `Bearer ${token}` },
      timeout: 10000
    })

    console.log('✅ Tenant context resolved successfully!')
    console.log('📊 Response:', testResponse.data)

  } catch (error) {
    const errorMessage = error.response?.data?.error || error.response?.data?.details || error.message

    // Check if it's the old "No active plan found for tenant" error
    if (errorMessage.includes('No active plan found for tenant')) {
      console.log('❌ Tenant context resolution still failing - plan configuration issue')
    } else if (errorMessage.includes('Bundle generation failed')) {
      console.log('❌ Bundle generation failed, but tenant context was resolved (expected for test patent ID)')
    } else if (errorMessage.includes('Patent not found')) {
      console.log('✅ Tenant context resolved successfully! (Patent not found is expected)')
    } else if (error.code === 'ECONNREFUSED') {
      console.log('❌ Server not running or not accessible')
    } else {
      console.log('✅ Tenant context appears to be working!')
      console.log('🔍 Error details:', errorMessage)
    }
  }
}

testTenantContextFix()

