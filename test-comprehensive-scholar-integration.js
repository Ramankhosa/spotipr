// Comprehensive test suite for scholarly content integration
// Tests all possible configurations and edge cases

async function testScholarIntegration() {
  console.log('🧪 COMPREHENSIVE SCHOLAR INTEGRATION TEST SUITE');
  console.log('=' .repeat(60));

  const results = {
    passed: 0,
    failed: 0,
    tests: []
  };

  function logTest(testName, passed, details = '') {
    const status = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} ${testName}`);
    if (details) console.log(`   ${details}`);
    results.tests.push({ name: testName, passed, details });

    if (passed) results.passed++;
    else results.failed++;
  }

  // Test 1: Basic API connectivity
  try {
    console.log('\n🔗 TESTING API CONNECTIVITY');
    const response = await fetch('http://localhost:3005/api/health');
    logTest('API Connectivity', response.ok, response.ok ? 'Server responding' : `Status: ${response.status}`);
  } catch (error) {
    logTest('API Connectivity', false, `Error: ${error.message}`);
  }

  // Test 2: Bundle creation with patents only
  try {
    console.log('\n📄 TESTING BUNDLE CREATION - PATENTS ONLY');
    const bundleData = {
      inventionBrief: 'A novel method for wireless data transmission',
      bundleData: {
        invention_title: 'Wireless Data Transmission System',
        technical_field: 'Telecommunications',
        background: 'Wireless communication is essential for modern devices',
        core_concepts: ['wireless transmission', 'data modulation', 'signal processing'],
        jurisdictions_preference: ['US', 'EP', 'CN'],
        ambiguous_terms: [],
        sensitive_tokens: [],
        query_variants: [
          { label: 'broad', q: 'wireless data transmission method', num: 10, page: 1 },
          { label: 'baseline', q: 'wireless communication data system', num: 10, page: 1 },
          { label: 'narrow', q: 'wireless data transmission modulation signal', num: 10, page: 1 }
        ],
        serpapi_defaults: {
          engine: 'google_patents',
          hl: 'en'
        }
      }
    };

    const response = await fetch('http://localhost:3005/api/prior-art/bundles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bundleData)
    });

    if (response.ok) {
      const result = await response.json();
      logTest('Bundle Creation - Patents Only', true, `Bundle ID: ${result.bundleId}`);
    } else {
      const error = await response.json();
      logTest('Bundle Creation - Patents Only', false, `Error: ${error.error}`);
    }
  } catch (error) {
    logTest('Bundle Creation - Patents Only', false, `Exception: ${error.message}`);
  }

  // Test 3: Bundle creation with scholar only
  try {
    console.log('\n📚 TESTING BUNDLE CREATION - SCHOLAR ONLY');
    const bundleData = {
      inventionBrief: 'A novel method for wireless data transmission',
      bundleData: {
        invention_title: 'Wireless Data Transmission System',
        technical_field: 'Telecommunications',
        background: 'Wireless communication is essential for modern devices',
        core_concepts: ['wireless transmission', 'data modulation', 'signal processing'],
        jurisdictions_preference: ['US', 'EP', 'CN'],
        ambiguous_terms: [],
        sensitive_tokens: [],
        query_variants: [
          { label: 'broad', q: 'wireless data transmission method', num: 5, page: 1 },
          { label: 'baseline', q: 'wireless communication data system', num: 5, page: 1 },
          { label: 'narrow', q: 'wireless data transmission modulation signal', num: 5, page: 1 }
        ],
        serpapi_defaults: {
          engine: 'google_scholar',
          hl: 'en'
        }
      }
    };

    const response = await fetch('http://localhost:3005/api/prior-art/bundles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bundleData)
    });

    if (response.ok) {
      const result = await response.json();
      logTest('Bundle Creation - Scholar Only', true, `Bundle ID: ${result.bundleId}`);
    } else {
      const error = await response.json();
      logTest('Bundle Creation - Scholar Only', false, `Error: ${error.error}`);
    }
  } catch (error) {
    logTest('Bundle Creation - Scholar Only', false, `Exception: ${error.message}`);
  }

  // Test 4: Bundle creation with both engines (default behavior)
  try {
    console.log('\n🔄 TESTING BUNDLE CREATION - BOTH ENGINES');
    const bundleData = {
      inventionBrief: 'A novel method for wireless data transmission',
      bundleData: {
        invention_title: 'Wireless Data Transmission System',
        technical_field: 'Telecommunications',
        background: 'Wireless communication is essential for modern devices',
        core_concepts: ['wireless transmission', 'data modulation', 'signal processing'],
        jurisdictions_preference: ['US', 'EP', 'CN'],
        ambiguous_terms: [],
        sensitive_tokens: [],
        query_variants: [
          { label: 'broad', q: 'wireless data transmission method', num: 3, page: 1 },
          { label: 'baseline', q: 'wireless communication data system', num: 3, page: 1 },
          { label: 'narrow', q: 'wireless data transmission modulation signal', num: 3, page: 1 }
        ],
        serpapi_defaults: {
          hl: 'en'
          // No engine specified - should default to both
        }
      }
    };

    const response = await fetch('http://localhost:3005/api/prior-art/bundles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bundleData)
    });

    if (response.ok) {
      const result = await response.json();
      logTest('Bundle Creation - Both Engines', true, `Bundle ID: ${result.bundleId}`);
    } else {
      const error = await response.json();
      logTest('Bundle Creation - Both Engines', false, `Error: ${error.error}`);
    }
  } catch (error) {
    logTest('Bundle Creation - Both Engines', false, `Exception: ${error.message}`);
  }

  // Test 5: Invalid engine configuration
  try {
    console.log('\n❌ TESTING INVALID ENGINE CONFIGURATION');
    const bundleData = {
      inventionBrief: 'Test bundle',
      bundleData: {
        invention_title: 'Test',
        technical_field: 'Test',
        background: 'Test',
        core_concepts: ['test'],
        jurisdictions_preference: ['US'],
        ambiguous_terms: [],
        sensitive_tokens: [],
        query_variants: [
          { label: 'broad', q: 'test query', num: 5, page: 1 }
        ],
        serpapi_defaults: {
          engine: 'invalid_engine', // Invalid engine
          hl: 'en'
        }
      }
    };

    const response = await fetch('http://localhost:3005/api/prior-art/bundles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bundleData)
    });

    if (response.status === 400) {
      const error = await response.json();
      const hasEngineError = error.errors?.some(e => e.includes('engine'));
      logTest('Invalid Engine Rejection', hasEngineError, hasEngineError ? 'Correctly rejected invalid engine' : `Unexpected error: ${error.errors}`);
    } else {
      logTest('Invalid Engine Rejection', false, `Expected 400, got ${response.status}`);
    }
  } catch (error) {
    logTest('Invalid Engine Rejection', false, `Exception: ${error.message}`);
  }

  // Test 6: Search runs retrieval
  try {
    console.log('\n📊 TESTING SEARCH RUNS RETRIEVAL');
    const response = await fetch('http://localhost:3005/api/prior-art/runs');

    if (response.ok) {
      const data = await response.json();
      logTest('Search Runs Retrieval', true, `Found ${data.runs?.length || 0} runs`);
    } else {
      logTest('Search Runs Retrieval', false, `Status: ${response.status}`);
    }
  } catch (error) {
    logTest('Search Runs Retrieval', false, `Error: ${error.message}`);
  }

  // Test 7: Schema validation edge cases
  try {
    console.log('\n🔍 TESTING SCHEMA VALIDATION');
    const testCases = [
      { name: 'Empty serpapi_defaults', data: { serpapi_defaults: {} } },
      { name: 'Null serpapi_defaults', data: { serpapi_defaults: null } },
      { name: 'Missing serpapi_defaults', data: {} }
    ];

    for (const testCase of testCases) {
      const bundleData = {
        inventionBrief: 'Test',
        bundleData: {
          invention_title: 'Test',
          technical_field: 'Test',
          background: 'Test',
          core_concepts: ['test'],
          jurisdictions_preference: ['US'],
          ambiguous_terms: [],
          sensitive_tokens: [],
          query_variants: [{ label: 'broad', q: 'test', num: 5, page: 1 }],
          ...testCase.data
        }
      };

      const response = await fetch('http://localhost:3005/api/prior-art/bundles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bundleData)
      });

      const passed = response.status === 201 || (response.status === 400 &&
        !(await response.json()).errors?.some(e => e.includes('engine')));

      logTest(`Schema Validation: ${testCase.name}`, passed,
        passed ? 'Handled correctly' : 'Unexpected validation error');
    }
  } catch (error) {
    logTest('Schema Validation Tests', false, `Exception: ${error.message}`);
  }

  // Test 8: System health check
  try {
    console.log('\n🏥 TESTING SYSTEM HEALTH');
    const endpoints = [
      '/api/health',
      '/api/prior-art/bundles',
      '/api/prior-art/runs'
    ];

    let healthy = true;
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(`http://localhost:3005${endpoint}`);
        if (!response.ok && response.status !== 401) { // 401 is expected for auth-required endpoints
          healthy = false;
          break;
        }
      } catch {
        healthy = false;
        break;
      }
    }

    logTest('System Health Check', healthy, healthy ? 'All endpoints responding' : 'Some endpoints not responding');
  } catch (error) {
    logTest('System Health Check', false, `Error: ${error.message}`);
  }

  // Summary
  console.log('\n' + '=' .repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('=' .repeat(60));
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`📈 Success Rate: ${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%`);

  if (results.failed > 0) {
    console.log('\n❌ FAILED TESTS:');
    results.tests.filter(t => !t.passed).forEach(test => {
      console.log(`   • ${test.name}: ${test.details}`);
    });
  }

  console.log('\n🎯 CONCLUSION:');
  if (results.failed === 0) {
    console.log('✅ ALL TESTS PASSED - Scholar integration is fully compatible!');
  } else if (results.failed <= 2) {
    console.log('⚠️ MINOR ISSUES - Scholar integration mostly compatible, minor fixes needed');
  } else {
    console.log('❌ SIGNIFICANT ISSUES - Scholar integration needs major fixes');
  }

  return results;
}

// Run the comprehensive test suite
testScholarIntegration().catch(console.error);
