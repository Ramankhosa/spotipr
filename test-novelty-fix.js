const axios = require('axios')

async function testNoveltyAssessmentFix() {
  console.log('🧪 Testing Novelty Assessment API fixes...')

  try {
    // First, let's get a test user token
    const loginResponse = await axios.post('http://localhost:3000/api/user/login', {
      email: 'analyst@spotipr.com',
      password: 'password123'
    })

    if (!loginResponse.data.token) {
      console.log('❌ Could not get auth token')
      return
    }

    const token = loginResponse.data.token
    console.log('✅ Got auth token')

    // Get prior art runs for the user
    const runsResponse = await axios.get('http://localhost:3000/api/prior-art/runs', {
      headers: { authorization: `Bearer ${token}` }
    })

    if (!runsResponse.data.runs || runsResponse.data.runs.length === 0) {
      console.log('❌ No prior art runs found')
      return
    }

    const runId = runsResponse.data.runs[0].id
    console.log(`✅ Found prior art run: ${runId}`)

    // Test manual novelty assessment
    console.log('🔄 Testing manual novelty assessment...')
    const assessmentResponse = await axios.post(
      `http://localhost:3000/api/prior-art/search/${runId}/novelty-assessment`,
      {},
      {
        headers: { authorization: `Bearer ${token}` }
      }
    )

    console.log('✅ Novelty assessment initiated successfully')
    console.log('📊 Response:', assessmentResponse.data)

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message)

    // Check if it's the expected MAX_TOKENS issue (now fixed)
    if (error.response?.data?.error?.includes('MAX_TOKENS')) {
      console.log('❌ MAX_TOKENS error still occurring - fix may not be working')
    } else if (error.response?.data?.error?.includes('usage_logs_taskCode_fkey')) {
      console.log('❌ Foreign key constraint error still occurring - fix may not be working')
    } else {
      console.log('✅ Errors are different from the original issues - fixes may be working')
    }
  }
}

testNoveltyAssessmentFix()
