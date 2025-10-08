#!/usr/bin/env node

/**
 * Test JSON parsing improvements for LLM responses
 */

function extractAndParseJSON(rawResponse) {
  try {
    console.log('🔍 Testing raw response:', rawResponse);
    console.log();

    let jsonText = rawResponse.trim();

    // Try to extract JSON from markdown code blocks
    const jsonBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/
    const match = jsonText.match(jsonBlockRegex);
    if (match) {
      jsonText = match[1].trim();
      console.log('📝 Extracted from code block:', jsonText);
    }

    // Remove any leading/trailing text that might not be JSON
    // Look for the first '{' and last '}'
    const startBrace = jsonText.indexOf('{');
    const lastBrace = jsonText.lastIndexOf('}');

    if (startBrace !== -1 && lastBrace !== -1 && lastBrace > startBrace) {
      jsonText = jsonText.substring(startBrace, lastBrace + 1);
      console.log('✂️ Extracted between braces:', jsonText);
    }

    const bundle = JSON.parse(jsonText);
    console.log('✅ Successfully parsed JSON');
    return { success: true, bundle };
  } catch (error) {
    console.log('❌ Failed to parse:', error.message);
    return { success: false, error: error.message };
  }
}

// Test cases
const testCases = [
  // Case 1: Direct JSON
  '{"source_summary":{"title":"Test"},"query_variants":[{"label":"broad","q":"test query","num":20,"page":1,"notes":"test"}]}',

  // Case 2: JSON in code block
  '```json\n{"source_summary":{"title":"Test"},"query_variants":[{"label":"broad","q":"test query","num":20,"page":1,"notes":"test"}]}\n```',

  // Case 3: JSON with explanation text before
  'Here is the JSON response:\n{"source_summary":{"title":"Test"},"query_variants":[{"label":"broad","q":"test query","num":20,"page":1,"notes":"test"}]}',

  // Case 4: JSON with trailing text
  '{"source_summary":{"title":"Test"},"query_variants":[{"label":"broad","q":"test query","num":20,"page":1,"notes":"test"}]}\n\nThis is a great response!',

  // Case 5: JSON wrapped in text
  'Based on the invention brief, here is the prior art search bundle:\n\n```json\n{"source_summary":{"title":"Test"},"query_variants":[{"label":"broad","q":"test query","num":20,"page":1,"notes":"test"}]}\n```\n\nHope this helps!'
];

console.log('🧪 Testing JSON extraction and parsing...\n');

testCases.forEach((testCase, index) => {
  console.log(`=== Test Case ${index + 1} ===`);
  const result = extractAndParseJSON(testCase);
  console.log('Result:', result.success ? 'SUCCESS' : 'FAILED');
  if (!result.success) {
    console.log('Error:', result.error);
  }
  console.log('\n');
});

console.log('🎉 JSON parsing tests complete!');
