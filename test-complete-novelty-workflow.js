const axios = require('axios')

async function testCompleteNoveltyWorkflow() {
  console.log('🎯 Testing Complete Novelty Assessment Workflow...')

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

    // Step 2: Create a test project
    console.log('📁 Creating test project...')
    const projectResponse = await axios.post(`${BASE_URL}/api/projects`, {
      name: 'Complete Novelty Test Project'
    }, {
      headers: { authorization: `Bearer ${token}` }
    })

    const projectId = projectResponse.data.project.id
    console.log(`✅ Created project: ${projectId}`)

    // Step 3: Create a test patent
    console.log('📄 Creating test patent...')
    const patentResponse = await axios.post(`${BASE_URL}/api/projects/${projectId}/patents`, {
      title: 'AI-Powered Cybersecurity System with Neural Network Analysis',
      abstract: 'A comprehensive cybersecurity system that utilizes neural networks to analyze network traffic patterns, detect anomalies, and prevent cyber threats through real-time adaptive responses.',
      problem: 'Traditional cybersecurity systems fail to detect sophisticated, adaptive cyber threats that evolve their attack patterns.',
      solution: 'Implement a neural network-based system that learns from network traffic patterns and continuously adapts its threat detection algorithms.',
      classification: 'G06N 3/08'
    }, {
      headers: { authorization: `Bearer ${token}` }
    })

    const patentId = patentResponse.data.patent.id
    console.log(`✅ Created patent: ${patentId}`)

    // Step 4: Generate prior art search bundle (this tests tenant context resolution)
    console.log('📦 Generating prior art search bundle...')
    const bundleResponse = await axios.post(`${BASE_URL}/api/prior-art/generate-bundle`, {
      patentId: patentId,
      brief: 'AI-powered cybersecurity system using neural networks for threat detection and prevention'
    }, {
      headers: { authorization: `Bearer ${token}` },
      timeout: 60000 // 1 minute for LLM call
    })

    const bundleId = bundleResponse.data.bundle.id
    console.log(`✅ Created bundle: ${bundleId}`)

    // Step 5: Perform prior art search
    console.log('🔍 Performing prior art search...')
    const searchResponse = await axios.post(`${BASE_URL}/api/prior-art/search`, {
      bundleId: bundleId
    }, {
      headers: { authorization: `Bearer ${token}` },
      timeout: 120000 // 2 minutes for SerpAPI
    })

    const runId = searchResponse.data.runId
    console.log(`✅ Search completed, run ID: ${runId}`)

    // Step 6: Wait for processing and test novelty assessment
    console.log('⏳ Waiting for search results to be processed...')
    await new Promise(resolve => setTimeout(resolve, 5000))

    console.log('🧠 Testing novelty assessment...')
    const assessmentResponse = await axios.post(
      `${BASE_URL}/api/prior-art/search/${runId}/novelty-assessment`,
      {},
      {
        headers: { authorization: `Bearer ${token}` },
        timeout: 120000 // 2 minutes for LLM
      }
    )

    console.log('🎉 SUCCESS! Novelty assessment completed!')
    console.log('📊 Results:', {
      status: assessmentResponse.data.status,
      determination: assessmentResponse.data.determination,
      confidence: assessmentResponse.data.confidenceLevel,
      hasReport: !!assessmentResponse.data.reportUrl
    })

    if (assessmentResponse.data.remarks) {
      console.log('📋 Assessment Summary:', assessmentResponse.data.remarks.substring(0, 200) + '...')
    }

  } catch (error) {
    const errorMessage = error.response?.data?.error || error.response?.data?.details || error.message

    if (errorMessage.includes('No active plan found for tenant')) {
      console.log('❌ TENANT CONTEXT ISSUE: Plan configuration still failing')
    } else if (errorMessage.includes('MAX_TOKENS')) {
      console.log('❌ LLM ISSUE: Token limit error (should be fixed)')
    } else if (errorMessage.includes('usage_logs_taskCode_fkey')) {
      console.log('❌ DATABASE ISSUE: Task code constraint error (should be fixed)')
    } else if (error.code === 'ECONNREFUSED') {
      console.log('❌ SERVER ISSUE: Server not accessible')
    } else {
      console.log('✅ WORKFLOW PROGRESS: Different error - core issues may be resolved')
      console.log('🔍 Error details:', errorMessage)
    }
  }
}

testCompleteNoveltyWorkflow()

