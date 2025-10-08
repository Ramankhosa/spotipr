// Test script for Level 2 patent details retrieval
// Note: This requires Node.js 18+ for built-in fetch, or install node-fetch

async function testAPI(baseURL) {
  try {
    const runsResponse = await fetch(`${baseURL}/api/prior-art/runs`);
    return runsResponse.ok;
  } catch {
    return false;
  }
}

async function findServerPort() {
  const ports = [3000, 3001, 3002, 3003, 3004, 3005, 3006];
  for (const port of ports) {
    if (await testAPI(`http://localhost:${port}`)) {
      return port;
    }
  }
  return null;
}

async function testLevel2Details() {
  try {
    console.log('🧪 Testing Level 2 patent details retrieval...');
    console.log('📋 This script tests the Level 2 detailed patent data fetching functionality');
    console.log('');

    // Check if we have fetch available
    if (typeof fetch === 'undefined') {
      console.log('❌ fetch is not available. This script requires Node.js 18+ or install node-fetch');
      return;
    }

    // Find the server port
    console.log('🔍 Finding server port...');
    const port = await findServerPort();
    if (!port) {
      console.log('❌ Could not find running Next.js server on ports 3000-3005');
      console.log('💡 Make sure to run: npm run dev');
      return;
    }

    const baseURL = `http://localhost:${port}`;
    console.log(`✅ Found server on port ${port}`);

    // First, get a run ID from the search history
    console.log('🔍 Checking for existing search runs...');
    const runsResponse = await fetch(`${baseURL}/api/prior-art/runs`);

    if (!runsResponse.ok) {
      console.log('❌ API not accessible or no runs found');
      console.log('💡 Make sure:');
      console.log('   1. The Next.js server is running (npm run dev)');
      console.log('   2. You have performed at least one prior art search');
      console.log('   3. The search has intersection patents selected');
      return;
    }

    const runsData = await runsResponse.json();
    if (!runsData.runs || runsData.runs.length === 0) {
      console.log('❌ No search runs found.');
      console.log('💡 Perform a prior art search first:');
      console.log('   1. Go to http://localhost:3000/prior-art');
      console.log('   2. Click "Start Search" on an approved bundle');
      console.log('   3. Add some patents to intersection in Level 1');
      return;
    }

    const runId = runsData.runs[0].id;
    console.log(`✅ Found search run: ${runId}`);

    // Trigger Level 2 details fetch
    console.log('');
    console.log('🚀 Triggering Level 2 details fetch...');
    console.log('📊 This will fetch detailed patent information for intersection patents');

    const detailsResponse = await fetch(`${baseURL}/api/prior-art/search/${runId}/details`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      }
    });

    if (detailsResponse.ok) {
      const result = await detailsResponse.json();
      console.log('');
      console.log('✅ Level 2 details fetch initiated successfully!');
      console.log(`📊 Results Summary:`);
      console.log(`   • Total patents processed: ${result.results?.length || 0}`);
      console.log(`   • Successfully fetched: ${result.results?.filter(r => r.status === 'completed').length || 0}`);
      console.log(`   • Failed to fetch: ${result.results?.filter(r => r.status === 'failed').length || 0}`);
      console.log('');
      console.log('🎯 Check the UI at http://localhost:3000/prior-art to see detailed results!');
      console.log('   Go to Search History → Level 2: Detailed Analysis tab');
    } else {
      const error = await detailsResponse.json();
      console.log('');
      console.log('❌ Level 2 details fetch failed:', error.error || error);
      console.log('💡 Possible reasons:');
      console.log('   • No intersection patents selected');
      console.log('   • SerpAPI rate limits or authentication issues');
      console.log('   • Network connectivity problems');
    }

  } catch (error) {
    console.error('');
    console.error('❌ Test failed:', error.message);
    console.log('');
    console.log('🔧 Troubleshooting:');
    console.log('   1. Make sure Next.js server is running: npm run dev');
    console.log('   2. Check console logs for API errors');
    console.log('   3. Verify SerpAPI key is configured correctly');
  }
}

// Run the test
testLevel2Details().catch(console.error);