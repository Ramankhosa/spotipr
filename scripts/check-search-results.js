const { default: fetch } = require('node-fetch');

const BASE_URL = 'http://localhost:3000';

// Test user credentials
const TEST_USER = {
  email: 'analyst@spotipr.com',
  password: 'AnalystPass123!'
};

async function checkSearchResults(runId) {
  console.log('🔍 Checking search results...\n');

  try {
    // Step 1: Login to get auth token
    console.log('1️⃣ Logging in...');
    const loginResponse = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(TEST_USER)
    });

    if (!loginResponse.ok) {
      console.log('❌ Login failed');
      return;
    }

    const loginData = await loginResponse.json();
    const token = loginData.token;
    console.log('✅ Login successful');

    // Step 2: Get results for the specific run
    console.log(`2️⃣ Getting results for run: ${runId}...`);
    const resultsResponse = await fetch(`${BASE_URL}/api/prior-art/search/${runId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (resultsResponse.ok) {
      const runData = await resultsResponse.json();

      console.log(`✅ Run Status: ${runData.status}`);
      console.log(`   Started: ${runData.startedAt}`);
      if (runData.finishedAt) {
        console.log(`   Finished: ${runData.finishedAt}`);
      }
      console.log(`   Credits consumed: ${runData.creditsConsumed || 0}`);
      console.log(`   API calls made: ${runData.apiCallsMade || 0}`);

      const results = runData.results || [];
      console.log(`\n📊 Found ${results.length} intersecting patents`);

      if (results.length > 0) {
        console.log('\n🏆 Top intersecting patents:');
        results.slice(0, 5).forEach((result, index) => {
          console.log(`${index + 1}. ${result.publicationNumber}`);
          console.log(`   Score: ${result.score?.toFixed(3) || 'N/A'}`);
          console.log(`   Found in: ${result.foundInVariants?.join(', ') || 'N/A'}`);
          console.log(`   Ranks - Broad: ${result.ranks?.broad || 'N/A'}, Baseline: ${result.ranks?.baseline || 'N/A'}, Narrow: ${result.ranks?.narrow || 'N/A'}`);
          console.log(`   Shortlisted: ${result.shortlisted ? '✅' : '❌'}`);
          if (result.patent?.title) {
            console.log(`   Title: ${result.patent.title.substring(0, 80)}${result.patent.title.length > 80 ? '...' : ''}`);
          }
          console.log('');
        });
      }

      // Check shortlisted patents
      const shortlisted = results.filter(r => r.shortlisted);
      console.log(`🎯 Shortlisted for details: ${shortlisted.length} patents`);

      if (shortlisted.length > 0) {
        console.log('\n🔍 Shortlisted patents:');
        shortlisted.forEach((result, index) => {
          console.log(`${index + 1}. ${result.publicationNumber} (Score: ${result.score?.toFixed(3) || 'N/A'})`);
        });
      }

      if (runData.status === 'COMPLETED') {
        console.log('\n🎉 Search completed successfully!');
        console.log(`   Total intersecting patents found: ${results.length}`);
        console.log(`   Patents selected for detailed analysis: ${shortlisted.length}`);
      } else if (runData.status === 'RUNNING') {
        console.log('\n⏳ Search is still running...');
      } else if (runData.status === 'FAILED') {
        console.log('\n❌ Search failed');
      }

    } else {
      console.log('❌ Failed to get results');
      const errorData = await resultsResponse.json();
      console.log('Error:', errorData);
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  }
}

// Run a search first, then check results
async function runSearchAndCheckResults() {
  console.log('🚀 Running search and checking results...\n');

  try {
    // Step 1: Login to get auth token
    console.log('1️⃣ Logging in...');
    const loginResponse = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(TEST_USER)
    });

    if (!loginResponse.ok) {
      console.log('❌ Login failed');
      return;
    }

    const loginData = await loginResponse.json();
    const token = loginData.token;
    console.log('✅ Login successful');

    // Step 2: Get approved bundles
    console.log('2️⃣ Getting approved bundles...');
    const bundlesResponse = await fetch(`${BASE_URL}/api/prior-art/bundles`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!bundlesResponse.ok) {
      console.log('❌ Failed to get bundles');
      return;
    }

    const bundlesData = await bundlesResponse.json();
    const approvedBundles = bundlesData.bundles.filter(b => b.status === 'APPROVED');

    console.log(`✅ Found ${approvedBundles.length} approved bundles`);

    if (approvedBundles.length === 0) {
      console.log('❌ No approved bundles found');
      return;
    }

    const bundleId = approvedBundles[0].id;
    console.log(`🔍 Using bundle: ${bundleId}`);

    // Step 3: Start search
    console.log('3️⃣ Starting search...');
    const searchResponse = await fetch(`${BASE_URL}/api/prior-art/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ bundleId })
    });

    if (searchResponse.ok) {
      const searchData = await searchResponse.json();
      const runId = searchData.runId;
      console.log('🎉 SUCCESS: Search started successfully!');
      console.log(`   Run ID: ${runId}`);
      console.log(`   Credits remaining: ${searchData.creditsRemaining}`);

      // Wait a bit for the search to complete
      console.log('\n⏳ Waiting 10 seconds for search to complete...');
      await new Promise(resolve => setTimeout(resolve, 10000));

      // Check results
      await checkSearchResults(runId);

    } else {
      const errorData = await searchResponse.json();
      console.log('❌ Search failed:', errorData);
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  }
}

runSearchAndCheckResults();
