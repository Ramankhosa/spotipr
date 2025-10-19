const axios = require('axios')

async function testNoveltyFixSimple() {
  console.log('🧪 Testing Novelty Assessment Fixes (Simple)...')

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

    // Step 2: Check for existing prior art runs
    console.log('📋 Checking for existing prior art runs...')
    const runsResponse = await axios.get(`${BASE_URL}/api/prior-art/runs`, {
      headers: { authorization: `Bearer ${token}` }
    })

    if (!runsResponse.data.runs || runsResponse.data.runs.length === 0) {
      console.log('❌ No prior art runs found - cannot test novelty assessment')
      console.log('💡 To test novelty assessment, you need to:')
      console.log('   1. Create a project and patent through the UI')
      console.log('   2. Generate a prior art search bundle')
      console.log('   3. Run a prior art search')
      console.log('   4. Then test novelty assessment')
      return
    }

    const run = runsResponse.data.runs[0]
    console.log(`✅ Found prior art run: ${run.id}`)
    console.log(`   Status: ${run.status}`)
    console.log(`   Novelty Assessment: ${run.noveltyAssessment ? 'Present' : 'Not present'}`)

    // Step 3: If no novelty assessment exists, try to create one
    if (!run.noveltyAssessment) {
      console.log('🧠 Attempting to trigger novelty assessment...')
      try {
        const assessmentResponse = await axios.post(
          `${BASE_URL}/api/prior-art/search/${run.id}/novelty-assessment`,
          {},
          {
            headers: { authorization: `Bearer ${token}` },
            timeout: 120000 // 2 minute timeout
          }
        )

        console.log('✅ Novelty assessment initiated successfully!')
        console.log('📊 Response:', {
          status: assessmentResponse.data.status,
          determination: assessmentResponse.data.determination,
          confidence: assessmentResponse.data.confidenceLevel
        })

      } catch (assessmentError) {
        console.error('❌ Novelty assessment failed:', assessmentError.response?.data || assessmentError.message)

        // Check if it's the old errors
        if (assessmentError.response?.data?.error?.includes('MAX_TOKENS')) {
          console.log('❌ MAX_TOKENS error still occurring - fix may not be working')
        } else if (assessmentError.response?.data?.error?.includes('usage_logs_taskCode_fkey')) {
          console.log('❌ Foreign key constraint error still occurring - fix may not be working')
        } else {
          console.log('✅ Different error - original issues appear to be fixed!')
        }
      }
    } else {
      console.log('✅ Novelty assessment already exists for this run')
      console.log('📊 Status:', run.noveltyAssessment.status)
      console.log('🎯 Determination:', run.noveltyAssessment.determination)
    }

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message)

    if (error.code === 'ECONNREFUSED') {
      console.log('❌ Server not running or not accessible')
      console.log('💡 Make sure the dev server is running: npm run dev')
    }
  }
}

testNoveltyFixSimple()
