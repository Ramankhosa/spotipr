// Simple LLM Provider Test - Direct imports
// Tests individual providers without full metering system

// Load environment variables from .env file
require('dotenv').config()

// Import providers directly
const { GoogleGenerativeAI } = require('@google/generative-ai')

async function testGeminiDirect() {
  console.log('🔄 Testing Gemini Provider (Direct API)...')

  if (!process.env.GOOGLE_AI_API_KEY) {
    console.log('⏭️  Skipping Gemini - no API key')
    return null
  }

  try {
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' })

    const result = await model.generateContent('Return only valid JSON: {"status": "success", "message": "Hello from Gemini", "provider": "gemini", "timestamp": "' + new Date().toISOString() + '"}')
    const response = result.response
    const text = response.text()

    console.log('✅ Gemini Response:', text.substring(0, 200))

    // Clean up the response (remove markdown code blocks if present)
    let cleanText = text.trim()
    if (cleanText.startsWith('```json')) {
      cleanText = cleanText.replace(/^```json\s*/, '').replace(/\s*```$/, '')
    } else if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```\s*/, '').replace(/\s*```$/, '')
    }

    // Try to parse JSON
    try {
      const parsed = JSON.parse(cleanText.trim())
      console.log('✅ Valid JSON:', parsed)
      return parsed
    } catch (e) {
      console.log('⚠️  Response not JSON-parseable')
      console.log('   Cleaned text:', cleanText.substring(0, 100))
      return { raw: text }
    }
  } catch (error) {
    console.log('❌ Gemini failed:', error.message)
    return null
  }
}

async function testOpenAIDirect() {
  console.log('🔄 Testing OpenAI Provider (Direct API)...')

  if (!process.env.OPENAI_API_KEY) {
    console.log('⏭️  Skipping OpenAI - no API key')
    return null
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'user',
              content: 'Return only valid JSON: {"status": "success", "message": "Hello from ChatGPT", "provider": "openai", "timestamp": "' + new Date().toISOString() + '"}'
            }
          ],
          max_tokens: 150,
          temperature: 0.1, // Lower temperature for more consistent JSON
        }),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = await response.json()
    const text = data.choices[0].message.content

    console.log('✅ OpenAI Response:', text.substring(0, 200))

    // Clean up the response (remove markdown code blocks if present)
    let cleanText = text.trim()
    if (cleanText.startsWith('```json')) {
      cleanText = cleanText.replace(/^```json\s*/, '').replace(/\s*```$/, '')
    } else if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```\s*/, '').replace(/\s*```$/, '')
    }

    // Try to parse JSON
    try {
      const parsed = JSON.parse(cleanText.trim())
      console.log('✅ Valid JSON:', parsed)
      return parsed
    } catch (e) {
      console.log('⚠️  Response not JSON-parseable')
      console.log('   Cleaned text:', cleanText.substring(0, 100))
      return { raw: text }
    }
  } catch (error) {
    console.log('❌ OpenAI failed:', error.message)
    return null
  }
}

async function testGrokDirect() {
  console.log('🔄 Testing Grok Provider (Direct API)...')

  if (!process.env.GROK_API_KEY) {
    console.log('⏭️  Skipping Grok - no API key')
    return null
  }

  try {
    // Note: Using placeholder endpoint - may need adjustment
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROK_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'grok-3',
        messages: [
          {
            role: 'user',
            content: 'Respond with simple JSON: {"status": "success", "message": "Hello from Grok", "provider": "grok"}'
          }
        ],
        max_tokens: 100,
        temperature: 0.7,
      }),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = await response.json()
    const text = data.choices?.[0]?.message?.content || data.message || 'Unknown response format'

    console.log('✅ Grok Response:', text.substring(0, 200))

    // Try to parse JSON
    try {
      const parsed = JSON.parse(text.trim())
      console.log('✅ Valid JSON:', parsed)
      return parsed
    } catch (e) {
      console.log('⚠️  Response not JSON-parseable')
      return { raw: text }
    }
  } catch (error) {
    console.log('❌ Grok failed:', error.message)
    return null
  }
}

async function runSimpleTests() {
  console.log('🧪 Simple LLM Provider Tests\n')
  console.log('Environment Variables:')
  console.log(`  GOOGLE_AI_API_KEY: ${process.env.GOOGLE_AI_API_KEY ? '✅ Set' : '❌ Missing'}`)
  console.log(`  OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? '✅ Set' : '❌ Missing'}`)
  console.log(`  GROK_API_KEY: ${process.env.GROK_API_KEY ? '✅ Set' : '❌ Missing'}`)
  console.log('')

  const results = {
    gemini: await testGeminiDirect(),
    openai: await testOpenAIDirect(),
    grok: await testGrokDirect()
  }

  console.log('\n📊 Test Results Summary:')
  Object.entries(results).forEach(([provider, result]) => {
    if (result === null) {
      console.log(`  ${provider}: ⏭️  Skipped (no API key)`)
    } else if (result.raw) {
      console.log(`  ${provider}: ⚠️  Responded (not JSON)`)
    } else {
      console.log(`  ${provider}: ✅ Success`)
    }
  })

  console.log('\n✨ Simple LLM provider tests completed')
}

if (require.main === module) {
  runSimpleTests().catch(console.error)
}

module.exports = { testGeminiDirect, testOpenAIDirect, testGrokDirect, runSimpleTests }
