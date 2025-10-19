const axios = require('axios')

async function testBundleSimple() {
  console.log('🧪 Testing simple bundle generation...')

  const BASE_URL = 'http://localhost:3001'

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

    // Step 2: Test bundle generation
    console.log('📦 Testing bundle generation...')
    const bundleResponse = await axios.post(`${BASE_URL}/api/prior-art/generate-bundle`, {
      patentId: 'test-patent-id', // This will fail but we want to see if we get past the plan check
      brief: 'Test invention brief'
    }, {
      headers: { authorization: `Bearer ${token}` },
      timeout: 30000
    })

    console.log('✅ Bundle generation succeeded!')
    console.log('Response:', bundleResponse.data)

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message)

    // Check if it's the old plan error
    if (error.response?.data?.error?.includes('plan') && error.response?.data?.error?.includes('not found')) {
      console.log('❌ STILL HAS PLAN ERROR - fix not working')
    } else {
      console.log('✅ PLAN ERROR FIXED - different error now')
    }
  }
}

testBundleSimple()
