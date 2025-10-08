console.log('🔍 Environment Variables Test:');
console.log('SERP_RATE:', process.env.SERP_RATE);
console.log('Serp_API_KEY exists:', !!process.env.Serp_API_KEY);
console.log('Serp_API_KEY length:', process.env.Serp_API_KEY?.length);
console.log('Serp_API_KEY preview:', process.env.Serp_API_KEY?.substring(0, 10) + '...');

console.log('All env vars starting with SERP:', Object.keys(process.env).filter(key => key.toUpperCase().includes('SERP')));
