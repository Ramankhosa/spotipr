// Test LLM Gateway Integration
// Demonstrates how the gateway works with existing metering hierarchy

const { llmGateway } = require('./src/lib/metering/index')

async function testLLMGateway() {
  console.log('🧪 Testing LLM Gateway Integration\n')

  // Mock request with JWT headers (simulating authenticated user)
  const mockRequest = {
    headers: {
      'authorization': 'Bearer mock-jwt-token-with-ati-id',
      'x-correlation-id': 'test-123'
    }
  }

  try {
    console.log('1. Testing Prior Art Search...')
    const priorArtResult = await llmGateway.executeLLMOperation(mockRequest, {
      taskCode: 'LLM1_PRIOR_ART',
      prompt: 'Search for prior art on machine learning patent classification',
      idempotencyKey: 'test-prior-art-123'
    })

    console.log('   Result:', priorArtResult.success ? '✅ Success' : '❌ Failed')
    if (!priorArtResult.success) {
      console.log('   Error:', priorArtResult.error?.message)
    }

    console.log('\n2. Testing Patent Drafting...')
    const draftingResult = await llmGateway.executeLLMOperation(mockRequest, {
      taskCode: 'LLM2_DRAFT',
      prompt: 'Draft a patent for a novel algorithm for image recognition',
      idempotencyKey: 'test-drafting-123'
    })

    console.log('   Result:', draftingResult.success ? '✅ Success' : '❌ Failed')
    if (!draftingResult.success) {
      console.log('   Error:', draftingResult.error?.message)
    }

    console.log('\n3. Testing Diagram Generation...')
    const diagramResult = await llmGateway.executeLLMOperation(mockRequest, {
      taskCode: 'LLM3_DIAGRAM',
      prompt: 'Create a PlantUML diagram for a microservices architecture',
      idempotencyKey: 'test-diagram-123'
    })

    console.log('   Result:', diagramResult.success ? '✅ Success' : '❌ Failed')
    if (!diagramResult.success) {
      console.log('   Error:', diagramResult.error?.message)
    }

    console.log('\n4. Provider Status Check...')
    const providers = llmGateway.getAvailableProviders()
    const health = llmGateway.getProviderHealth()

    console.log('   Available providers:', providers)
    console.log('   Provider health:', health)

  } catch (error) {
    console.error('❌ Test failed:', error.message)
  }

  console.log('\n✨ LLM Gateway integration test completed')
}

// Expected behavior in this test:
// - Will fail on tenant resolution (no real JWT/mock ATI token)
// - Demonstrates the integration flow without breaking existing functionality
// - Shows how metering checks happen before LLM calls
// - Illustrates provider routing and fallback

if (require.main === module) {
  testLLMGateway()
}

module.exports = { testLLMGateway }
