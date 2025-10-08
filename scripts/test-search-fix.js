const { default: fetch } = require('node-fetch');

const BASE_URL = 'http://localhost:3000';

// Test user credentials
const TEST_USER = {
  email: 'analyst@spotipr.com',
  password: 'AnalystPass123!'
};

async function testSearchFix() {
  console.log('🧪 Testing search fix...\n');

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
    console.log(`🔍 Testing search with bundle: ${bundleId}`);

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
      console.log('🎉 SUCCESS: Search started successfully!');
      console.log(`   Run ID: ${searchData.runId}`);
      console.log(`   Credits remaining: ${searchData.creditsRemaining}`);
    } else {
      const errorData = await searchResponse.json();
      console.log('❌ Search failed:', errorData);
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  }
}

testSearchFix();
