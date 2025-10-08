const { default: fetch } = require('node-fetch');

const BASE_URL = 'http://localhost:3000';

// Test user credentials
const TEST_USER = {
  email: 'analyst@spotipr.com',
  password: 'AnalystPass123!'
};

async function testBundleFlow() {
  console.log('🧪 Testing complete bundle flow...\n');

  try {
    // Step 1: Login to get auth token
    console.log('1️⃣ Logging in...');
    const loginResponse = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(TEST_USER)
    });

    if (!loginResponse.ok) {
      console.log('❌ Login failed - user may not exist. Creating test user...');

      // Try to signup first
      const signupResponse = await fetch(`${BASE_URL}/api/v1/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: TEST_USER.email,
          password: TEST_USER.password,
          atiToken: 'TEST123'
        })
      });

      if (!signupResponse.ok) {
        console.log('❌ Signup failed, skipping test');
        return;
      }

      // Now login
      const loginResponse2 = await fetch(`${BASE_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(TEST_USER)
      });

      if (!loginResponse2.ok) {
        console.log('❌ Login failed after signup');
        return;
      }

      const loginData2 = await loginResponse2.json();
      token = loginData2.token;
    } else {
      const loginData = await loginResponse.json();
      token = loginData.token;
    }

    console.log('✅ Login successful');

    // Step 2: Create project
    console.log('2️⃣ Creating project...');
    const projectResponse = await fetch(`${BASE_URL}/api/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        name: 'Test Project for Bundle Flow',
        description: 'Testing the complete bundle approval flow'
      })
    });

    if (!projectResponse.ok) {
      console.log('❌ Project creation failed');
      return;
    }

    const projectData = await projectResponse.json();
    const projectId = projectData.project.id;
    console.log(`✅ Project created: ${projectId}`);

    // Step 3: Create patent
    console.log('3️⃣ Creating patent...');
    const patentResponse = await fetch(`${BASE_URL}/api/projects/${projectId}/patents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        title: 'Test Patent for Bundle Flow',
        description: 'A test patent for verifying bundle creation and approval'
      })
    });

    if (!patentResponse.ok) {
      console.log('❌ Patent creation failed');
      return;
    }

    const patentData = await patentResponse.json();
    const patentId = patentData.patent.id;
    console.log(`✅ Patent created: ${patentId}`);

    // Step 4: Create prior art bundle
    console.log('4️⃣ Creating prior art bundle...');
    const bundleResponse = await fetch(`${BASE_URL}/api/patents/${patentId}/prior-art`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        mode: 'LLM',
        inventionBrief: 'A machine learning system that uses neural networks to classify images with high accuracy and efficiency.'
      })
    });

    if (!bundleResponse.ok) {
      console.log('❌ Bundle creation failed');
      const errorData = await bundleResponse.json();
      console.log('Error:', errorData);
      return;
    }

    const bundleData = await bundleResponse.json();
    const bundleId = bundleData.bundle.id;
    console.log(`✅ Bundle created: ${bundleId}`);

    // Step 5: Approve the bundle
    console.log('5️⃣ Approving bundle...');
    const approveResponse = await fetch(`${BASE_URL}/api/patents/${patentId}/prior-art/${bundleId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        bundleData: bundleData.bundle.bundleData,
        action: 'approve'
      })
    });

    if (!approveResponse.ok) {
      console.log('❌ Bundle approval failed');
      const errorData = await approveResponse.json();
      console.log('Error:', errorData);
      return;
    }

    console.log('✅ Bundle approved');

    // Step 6: Check if bundle appears in prior-art API
    console.log('6️⃣ Checking if approved bundle appears in prior-art API...');
    const bundlesResponse = await fetch(`${BASE_URL}/api/prior-art/bundles`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!bundlesResponse.ok) {
      console.log('❌ Failed to fetch bundles from prior-art API');
      return;
    }

    const bundlesData = await bundlesResponse.json();
    const approvedBundles = bundlesData.bundles.filter(b => b.status === 'APPROVED');

    console.log(`✅ Found ${approvedBundles.length} approved bundles in prior-art API`);

    const ourBundle = approvedBundles.find(b => b.id === bundleId);
    if (ourBundle) {
      console.log('🎉 SUCCESS: Our approved bundle is visible in the prior-art API!');
      console.log(`   Bundle ID: ${ourBundle.id}`);
      console.log(`   Status: ${ourBundle.status}`);
      console.log(`   Created: ${ourBundle.createdAt}`);
    } else {
      console.log('❌ FAILURE: Our approved bundle is NOT visible in the prior-art API');
      console.log('Available approved bundles:', approvedBundles.map(b => b.id));
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  }
}

testBundleFlow();
