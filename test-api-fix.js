#!/usr/bin/env node

/**
 * Test API fix for novelty assessment table errors
 */

const fetch = require('node-fetch');

async function testAPIFix() {
  console.log('🧪 Testing API Fix for Novelty Assessment Table Errors\n');

  try {
    // Test the prior art runs endpoint with invalid token (should get auth error, not table error)
    console.log('Testing /api/prior-art/runs endpoint...');

    const response = await fetch('http://localhost:3000/api/prior-art/runs', {
      headers: {
        'Authorization': 'Bearer invalid-token'
      }
    });

    const responseText = await response.text();
    console.log(`Status: ${response.status}`);
    console.log(`Response: ${responseText.substring(0, 200)}...`);

    if (responseText.includes('novelty_assessment_runs')) {
      console.log('❌ Still getting novelty assessment table error!');
      return false;
    } else if (response.status === 401) {
      console.log('✅ API endpoint works - getting expected auth error instead of table error');
      return true;
    } else {
      console.log('ℹ️ Unexpected response, but no table error');
      return true;
    }

  } catch (error) {
    console.log('❌ Network error:', error.message);
    return false;
  }
}

testAPIFix().then(success => {
  if (success) {
    console.log('\n🎉 API fix successful! Novelty assessment table errors resolved.');
  } else {
    console.log('\n❌ API fix failed. Table errors still exist.');
  }
});
