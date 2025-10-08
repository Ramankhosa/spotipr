const { default: fetch } = require('node-fetch');

async function checkResults() {
  try {
    // Login
    const loginResponse = await fetch('http://localhost:3000/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'analyst@spotipr.com', password: 'AnalystPass123!' })
    });

    const loginData = await loginResponse.json();
    const token = loginData.token;

    // Get runs
    const runsResponse = await fetch('http://localhost:3000/api/prior-art/runs', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const runsData = await runsResponse.json();
    console.log('Runs:', runsData.runs.length);

    if (runsData.runs.length > 0) {
      const runId = runsData.runs[0].id;
      console.log('Latest run ID:', runId);

      // Get results
      const resultsResponse = await fetch(`http://localhost:3000/api/prior-art/search/${runId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const resultsData = await resultsResponse.json();
      console.log('Results count:', resultsData.results ? resultsData.results.length : 0);

      if (resultsData.results && resultsData.results.length > 0) {
        console.log('Sample result:', JSON.stringify(resultsData.results[0], null, 2));
      }
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkResults();
