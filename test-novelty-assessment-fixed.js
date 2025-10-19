const axios = require('axios')

async function testNoveltyAssessmentFixed() {
  console.log('🧪 Testing Novelty Assessment Fixes...')

  const BASE_URL = 'http://localhost:3001'

  try {
    // Step 1: Login as analyst
    console.log('🔐 Logging in as analyst...')
    const loginResponse = await axios.post(`${BASE_URL}/api/user/login`, {
      email: 'analyst@spotipr.com',
      password: 'AnalystPass123!'
    })

    if (!loginResponse.data.token) {
      console.log('❌ Could not get auth token')
      return
    }

    const token = loginResponse.data.token
    console.log('✅ Got auth token')

    // Step 2: Get prior art runs
    console.log('📋 Getting prior art runs...')
    const runsResponse = await axios.get(`${BASE_URL}/api/prior-art/runs`, {
      headers: { authorization: `Bearer ${token}` }
    })

    if (!runsResponse.data.runs || runsResponse.data.runs.length === 0) {
      console.log('❌ No prior art runs found - need to create a prior art search first')
      return
    }

    const runId = runsResponse.data.runs[0].id
    console.log(`✅ Found prior art run: ${runId}`)

    // Step 3: Test manual novelty assessment
    console.log('🧠 Testing manual novelty assessment...')
    const startTime = Date.now()

    const assessmentResponse = await axios.post(
      `${BASE_URL}/api/prior-art/search/${runId}/novelty-assessment`,
      {},
      {
        headers: { authorization: `Bearer ${token}` },
        timeout: 120000 // 2 minute timeout for LLM calls
      }
    )

    const endTime = Date.now()
    const duration = (endTime - startTime) / 1000

    console.log(`✅ Novelty assessment completed in ${duration}s`)
    console.log('📊 Assessment Result:', {
      status: assessmentResponse.data.status,
      determination: assessmentResponse.data.determination,
      confidence: assessmentResponse.data.confidenceLevel,
      hasReport: !!assessmentResponse.data.reportUrl
    })

    // Step 4: Check for errors in the response
    if (assessmentResponse.data.error) {
      console.log('⚠️  Assessment completed with error:', assessmentResponse.data.error)
    } else {
      console.log('🎉 Assessment completed successfully!')
      console.log('📋 Summary:', assessmentResponse.data.remarks?.substring(0, 200) + '...')
    }

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message)

    // Check if it's the old errors (should be fixed now)
    if (error.response?.data?.error?.includes('MAX_TOKENS')) {
      console.log('❌ MAX_TOKENS error still occurring - fix may not be working')
    } else if (error.response?.data?.error?.includes('usage_logs_taskCode_fkey')) {
      console.log('❌ Foreign key constraint error still occurring - fix may not be working')
    } else if (error.code === 'ECONNREFUSED') {
      console.log('❌ Server not running or not accessible')
    } else {
      console.log('✅ Different error - original issues may be fixed')
      console.log('🔍 Error details:', error.response?.data || error.message)
    }
  }
}

testNoveltyAssessmentFixed()
