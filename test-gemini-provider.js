// Test script for Gemini provider with increased token limits
const dotenv = require('dotenv');
dotenv.config();

// Dynamic import of the GoogleGenerativeAI library
async function testGeminiProvider() {
  try {
    console.log('Starting Gemini provider test...');
    
    // Validate API key
    if (!process.env.GOOGLE_AI_API_KEY) {
      console.error('❌ GOOGLE_AI_API_KEY not found in environment variables');
      return;
    }
    
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const client = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
    
    // Use the same configuration as in the provider
    const model = client.getGenerativeModel({
      model: 'gemini-2.5-pro',
      generationConfig: {
        maxOutputTokens: 4096, // Using our new increased limit
        temperature: 0.7,
      }
    });
    
    console.log('✅ Gemini client initialized');
    
    // Use a test prompt similar to the patent search to verify token handling
    const testPrompt = `Generate a JSON bundle for patent search queries for the following invention:
    
An invention that relates to an improved system for detecting and mitigating cyber threats using artificial intelligence. The system employs a neural network architecture to analyze network traffic patterns and identify anomalies that may indicate potential security breaches. The solution incorporates real-time monitoring, automated response mechanisms, and a learning algorithm that continuously improves detection accuracy based on historical data. A key innovation is the system's ability to distinguish between legitimate unusual activity and actual threats, reducing false positives common in conventional security systems. The technology can be deployed on premise or as a cloud-based service.

Generate the bundle with fields including:
- source_summary with title, problem and solution
- core_concepts (array of key invention concepts)
- technical_features (array of specific technical elements)
- synonym_groups (arrays of terms with their synonyms)
- query_variants including broad, baseline and narrow search queries
- exclude_terms that should be filtered out`;
    
    console.log('Sending request to Gemini API...');
    const result = await model.generateContent(testPrompt);
    const response = result.response;
    
    const output = response.text();
    const usage = response.usageMetadata;
    
    console.log('🔍 Gemini API response details:', {
      hasCandidates: !!response.candidates,
      candidatesCount: response.candidates?.length || 0,
      finishReason: response.candidates?.[0]?.finishReason,
      outputLength: output?.length || 0,
      usage: usage
    });
    
    if (!output || output.trim().length === 0) {
      console.error('❌ Gemini API returned empty response');
    } else {
      console.log('✅ Gemini API returned response with length:', output.length);
      console.log('\nFirst 200 characters of response:');
      console.log(output.substring(0, 200) + '...');
    }
  } catch (error) {
    console.error('❌ Test failed with error:', error);
  }
}

testGeminiProvider();
