const axios = require('axios')

async function testGeminiShort() {
  console.log('🧪 Testing Gemini with short prompt and conservative limits...')

  const BASE_URL = 'http://localhost:3000'

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

    // Step 2: Test bundle generation with very short brief
    console.log('📦 Testing bundle generation with very short brief...')
    const bundleResponse = await axios.post(`${BASE_URL}/api/prior-art/generate-bundle`, {
      patentId: 'test-patent-id',
      brief: 'A simple system for user authentication using passwords and two-factor authentication.'
    }, {
      headers: { authorization: `Bearer ${token}` },
      timeout: 30000
    })

    console.log('✅ Bundle generation succeeded!')
    console.log('Response status:', bundleResponse.status)

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message)

    // Check if it's still a token issue
    if (error.response?.data?.error?.includes('truncated') ||
        error.response?.data?.error?.includes('MAX_TOKENS')) {
      console.log('❌ STILL A TOKEN LIMIT ISSUE')
    } else {
      console.log('✅ TOKEN LIMIT ISSUE FIXED - different error now')
    }
  }
}

testGeminiShort()
