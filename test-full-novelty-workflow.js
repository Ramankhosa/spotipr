const axios = require('axios')

async function testFullNoveltyWorkflow() {
  console.log('🧪 Testing Full Novelty Assessment Workflow...')

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

    // Step 2: Create a test project and patent first
    console.log('📁 Creating test project...')
    const projectResponse = await axios.post(`${BASE_URL}/api/projects`, {
      name: 'Test Novelty Project'
    }, {
      headers: { authorization: `Bearer ${token}` }
    })

    const projectId = projectResponse.data.project.id
    console.log(`✅ Created project: ${projectId}`)

    // Step 3: Create a test patent
    console.log('📄 Creating test patent...')
    const patentResponse = await axios.post(`${BASE_URL}/api/projects/${projectId}/patents`, {
      title: 'AI-Powered Network Security System',
      abstract: 'A neural network-based security system that continuously learns from network traffic patterns to identify sophisticated cyber threats that traditional systems cannot detect.',
      problem: 'Traditional network security systems struggle to detect sophisticated cyber threats that do not follow predefined patterns.',
      solution: 'Implement a neural network that learns from network traffic in real-time and adapts to new threat patterns.',
      classification: 'G06N 3/08'
    }, {
      headers: { authorization: `Bearer ${token}` }
    })

    const patentId = patentResponse.data.patent.id
    console.log(`✅ Created patent: ${patentId}`)

    // Step 4: Generate prior art search bundle
    console.log('📦 Generating prior art search bundle...')
    const bundleResponse = await axios.post(`${BASE_URL}/api/prior-art/generate-bundle`, {
      patentId: patentId,
      brief: 'AI-powered network security system using neural networks to detect sophisticated cyber threats in real-time'
    }, {
      headers: { authorization: `Bearer ${token}` },
      timeout: 120000 // 2 minute timeout for LLM calls
    })

    const bundleId = bundleResponse.data.bundle.id
    console.log(`✅ Created bundle: ${bundleId}`)

    // Step 5: Perform prior art search
    console.log('🔍 Performing prior art search...')
    const searchStartTime = Date.now()

    const searchResponse = await axios.post(`${BASE_URL}/api/prior-art/search`, {
      bundleId: bundleId
    }, {
      headers: { authorization: `Bearer ${token}` },
      timeout: 180000 // 3 minute timeout for SerpAPI calls
    })

    const searchEndTime = Date.now()
    const searchDuration = (searchEndTime - searchStartTime) / 1000

    console.log(`✅ Prior art search completed in ${searchDuration}s`)
    const runId = searchResponse.data.runId
    console.log(`📋 Search run ID: ${runId}`)

    // Step 5: Wait a moment for processing
    console.log('⏳ Waiting for search results to be processed...')
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Step 6: Test manual novelty assessment
    console.log('🧠 Testing manual novelty assessment...')
    const assessmentStartTime = Date.now()

    const assessmentResponse = await axios.post(
      `${BASE_URL}/api/prior-art/search/${runId}/novelty-assessment`,
      {},
      {
        headers: { authorization: `Bearer ${token}` },
        timeout: 120000 // 2 minute timeout for LLM calls
      }
    )

    const assessmentEndTime = Date.now()
    const assessmentDuration = (assessmentEndTime - assessmentStartTime) / 1000

    console.log(`✅ Novelty assessment completed in ${assessmentDuration}s`)
    console.log('📊 Assessment Result:', {
      status: assessmentResponse.data.status,
      determination: assessmentResponse.data.determination,
      confidence: assessmentResponse.data.confidenceLevel,
      hasReport: !!assessmentResponse.data.reportUrl
    })

    // Step 7: Check for errors
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

testFullNoveltyWorkflow()
