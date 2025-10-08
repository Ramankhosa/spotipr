const { default: fetch } = require('node-fetch');

async function testSerpApiDirect() {
  console.log('🧪 Testing SerpAPI directly...\n');

  // Test a simple patent search query
  const testQueries = [
    'machine learning neural network image classification',
    '(machine learning OR neural network) AND (image OR classification)',
    'machine learning neural networks image classification accuracy efficiency'
  ];

  for (let i = 0; i < testQueries.length; i++) {
    const query = testQueries[i];
    console.log(`\n🔍 Testing query ${i + 1}: "${query}"`);

    try {
      const response = await fetch(`https://serpapi.com/search?engine=google_patents&q=${encodeURIComponent(query)}&api_key=${process.env.Serp_API_KEY}&num=5`);

      if (response.ok) {
        const data = await response.json();
        const results = data.organic_results || [];
        console.log(`✅ Found ${results.length} results`);

        results.slice(0, 3).forEach((result, idx) => {
          console.log(`  ${idx + 1}. ${result.publication_number || result.patent_id}: ${result.title?.substring(0, 60)}...`);
        });
      } else {
        const error = await response.text();
        console.log(`❌ API Error: ${response.status} - ${error}`);
      }
    } catch (error) {
      console.log(`❌ Network Error: ${error.message}`);
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

testSerpApiDirect();
