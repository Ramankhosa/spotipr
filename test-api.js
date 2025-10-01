// Simple test script for the new multi-tenant APIs
const fetch = require('node-fetch');

const BASE_URL = 'http://localhost:3001';

async function testAPIs() {
  try {
    console.log('🧪 Testing Multi-Tenant APIs...\n');

    // First, create a tenant (this would normally require Super Admin auth)
    console.log('1. Creating test tenant...');
    const tenantResponse = await fetch(`${BASE_URL}/api/v1/platform/tenants`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // For testing, we'll skip auth for now
      },
      body: JSON.stringify({
        name: 'Test Corp',
        atiId: 'TEST001'
      })
    });

    if (!tenantResponse.ok) {
      console.log('❌ Failed to create tenant:', await tenantResponse.text());
      return;
    }

    const tenant = await tenantResponse.json();
    console.log('✅ Tenant created:', tenant);

    // Issue an ATI token
    console.log('\n2. Issuing ATI token...');
    const tokenResponse = await fetch(`${BASE_URL}/api/v1/admin/ati/issue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // For testing, we'll skip auth for now
      },
      body: JSON.stringify({
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
        max_uses: 10,
        plan_tier: 'BASIC'
      })
    });

    if (!tokenResponse.ok) {
      console.log('❌ Failed to issue ATI token:', await tokenResponse.text());
      return;
    }

    const tokenResult = await tokenResponse.json();
    console.log('✅ ATI token issued:', {
      fingerprint: tokenResult.fingerprint,
      token_id: tokenResult.token_id
    });

    // Extract the raw token for signup
    const rawToken = tokenResult.token_display_once;
    console.log('📝 Raw token (for signup):', rawToken);

    // Test signup
    console.log('\n3. Testing signup...');
    const signupResponse = await fetch(`${BASE_URL}/api/v1/auth/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'testpassword123',
        atiToken: rawToken
      })
    });

    if (!signupResponse.ok) {
      console.log('❌ Signup failed:', await signupResponse.text());
      return;
    }

    const signupResult = await signupResponse.json();
    console.log('✅ Signup successful:', signupResult);

    // Test login
    console.log('\n4. Testing login...');
    const loginResponse = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'testpassword123'
      })
    });

    if (!loginResponse.ok) {
      console.log('❌ Login failed:', await loginResponse.text());
      return;
    }

    const loginResult = await loginResponse.json();
    console.log('✅ Login successful, got token');

    const jwtToken = loginResult.token;

    // Test whoami
    console.log('\n5. Testing whoami...');
    const whoamiResponse = await fetch(`${BASE_URL}/api/v1/auth/whoami`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${jwtToken}`
      }
    });

    if (!whoamiResponse.ok) {
      console.log('❌ Whoami failed:', await whoamiResponse.text());
      return;
    }

    const whoamiResult = await whoamiResponse.json();
    console.log('✅ Whoami successful:', whoamiResult);

    console.log('\n🎉 All tests passed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the tests
testAPIs();
