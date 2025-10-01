// Test LLM Providers - Simple Response Test
// Tests if each LLM provider can respond to basic requests

const { llmProviderRouter, createLLMProvider } = require('./src/lib/metering/index')

async function testLLMProviders() {
  console.log('🧪 Testing LLM Provider Responses\n')

  // Check available providers
  const providers = llmProviderRouter.getAvailableProviders()
  console.log('📋 Available providers:', providers)

  if (providers.length === 0) {
    console.log('❌ No providers available. Check API keys:')
    console.log('   - GOOGLE_AI_API_KEY')
    console.log('   - OPENAI_API_KEY')
    console.log('   - GROK_API_KEY')
    return
  }

  // Test each provider with a simple request
  const testPrompt = "Respond with a simple JSON object containing only: {\"status\": \"success\", \"message\": \"Hello from AI\", \"timestamp\": \"current_time\"}"

  const testRequest = {
    taskCode: 'LLM1_PRIOR_ART', // Use prior art task for testing
    prompt: testPrompt,
    idempotencyKey: `test-${Date.now()}`
  }

  // Mock enforcement decision (allow everything for testing)
  const mockDecision = {
    allowed: true,
    modelClass: 'BASE_S',
    maxTokensIn: 100,
    maxTokensOut: 200,
    reservationId: 'test-reservation-123'
  }

  console.log('🔄 Testing provider responses...\n')

  try {
    const result = await llmProviderRouter.routeAndExecute(testRequest, mockDecision)

    if (result.success) {
      console.log('✅ LLM Gateway Response:')
      console.log('   Output:', result.output.substring(0, 200) + '...')
      console.log('   Output Tokens:', result.outputTokens)
      console.log('   Model Class:', result.modelClass)
      console.log('   Selected Provider:', result.metadata?.selectedProvider)

      // Try to parse as JSON
      try {
        const parsed = JSON.parse(result.output)
        console.log('✅ Valid JSON Response:', parsed)
      } catch (parseError) {
        console.log('⚠️  Response is not valid JSON, but provider responded')
        console.log('   Raw output preview:', result.output.substring(0, 100) + '...')
      }
    } else {
      console.log('❌ LLM Gateway failed:', result.error?.message)
    }

  } catch (error) {
    console.log('❌ Test failed with error:', error.message)

    // Check provider health
    console.log('\n🔍 Provider Health Check:')
    const health = llmProviderRouter.getProviderHealth()
    Object.entries(health).forEach(([provider, healthy]) => {
      console.log(`   ${provider}: ${healthy ? '✅ Healthy' : '❌ Unhealthy'}`)
    })
  }

  console.log('\n✨ LLM Provider test completed')
}

// Test individual providers directly (bypass routing)
async function testIndividualProviders() {
  console.log('\n🧪 Testing Individual Providers Directly\n')

  const { createLLMProvider } = require('./src/lib/metering/providers/llm-provider')

  const providers = [
    { name: 'gemini', config: { apiKey: process.env.GOOGLE_AI_API_KEY, model: 'gemini-2.5-pro', baseURL: 'https://generativelanguage.googleapis.com/v1beta' } },
    { name: 'openai', config: { apiKey: process.env.OPENAI_API_KEY, model: 'gpt-4o', baseURL: 'https://api.openai.com/v1' } },
    { name: 'grok', config: { apiKey: process.env.GROK_API_KEY, model: 'grok-3', baseURL: 'https://api.x.ai/v1' } }
  ]

  for (const { name, config } of providers) {
    if (!config.apiKey) {
      console.log(`⏭️  Skipping ${name} - no API key`)
      continue
    }

    try {
      console.log(`🔄 Testing ${name} provider...`)

      const provider = createLLMProvider(name, config)

      const request = {
        taskCode: 'LLM1_PRIOR_ART',
        prompt: 'Say only: {"test": "ok", "provider": "' + name + '"}',
        idempotencyKey: `direct-test-${name}-${Date.now()}`
      }

      const decision = {
        allowed: true,
        modelClass: 'BASE_S',
        maxTokensIn: 50,
        maxTokensOut: 100
      }

      const result = await provider.execute(request, decision)

      console.log(`✅ ${name} responded:`)
      console.log(`   Output: ${result.output.substring(0, 100)}...`)
      console.log(`   Tokens: ${result.outputTokens}`)

      // Test JSON parsing
      try {
        const parsed = JSON.parse(result.output.trim())
        console.log(`✅ ${name} returned valid JSON:`, parsed)
      } catch (e) {
        console.log(`⚠️  ${name} response not JSON-parseable`)
      }

    } catch (error) {
      console.log(`❌ ${name} failed:`, error.message)
    }

    console.log('') // Empty line between providers
  }
}

// Environment check
function checkEnvironment() {
  console.log('🔍 Environment Check:')
  const envVars = ['GOOGLE_AI_API_KEY', 'OPENAI_API_KEY', 'GROK_API_KEY']

  envVars.forEach(varName => {
    const exists = !!process.env[varName]
    console.log(`   ${varName}: ${exists ? '✅ Set' : '❌ Missing'}`)
  })
  console.log('')
}

// Main test runner
async function runAllTests() {
  checkEnvironment()
  await testLLMProviders()
  await testIndividualProviders()
}

if (require.main === module) {
  runAllTests().catch(console.error)
}

module.exports = { testLLMProviders, testIndividualProviders, runAllTests }
