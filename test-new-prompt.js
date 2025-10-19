function testNewPrompt() {
  console.log('🧪 Testing new LLM prompt structure...\n');

  // Import the prompt directly
  const { PRIOR_ART_LLM_PROMPT } = require('./src/lib/prior-art-llm.ts');

  console.log('📋 Prompt Analysis:');
  console.log('=====================================\n');

  // Basic structure checks
  const checks = [
    { name: 'Contains exclude_terms in schema', pass: PRIOR_ART_LLM_PROMPT.includes('"exclude_terms"') },
    { name: 'Has invention brief placeholder', pass: PRIOR_ART_LLM_PROMPT.includes('{invention_brief}') },
    { name: 'Contains JSON schema section', pass: PRIOR_ART_LLM_PROMPT.includes('Response JSON Schema') },
    { name: 'Has clear instructions about JSON only', pass: PRIOR_ART_LLM_PROMPT.includes('valid JSON only') },
    { name: 'Mentions dynamic exclude_terms generation', pass: PRIOR_ART_LLM_PROMPT.includes('dynamic list of exclude_terms') },
    { name: 'Has fallback exclude_terms mentioned', pass: PRIOR_ART_LLM_PROMPT.includes('default fallback set') },
    { name: 'Contains query variant requirements', pass: PRIOR_ART_LLM_PROMPT.includes('exactly 3 objects') },
    { name: 'Mentions Google syntax requirements', pass: PRIOR_ART_LLM_PROMPT.includes('Google Boolean syntax') }
  ];

  checks.forEach(check => {
    console.log(`${check.pass ? '✅' : '❌'} ${check.name}`);
  });

  console.log('\n📊 Prompt Structure Score:', checks.filter(c => c.pass).length + '/' + checks.length);

  // Show prompt length and key sections
  console.log('\n📏 Prompt Statistics:');
  console.log(`   Total length: ${PRIOR_ART_LLM_PROMPT.length} characters`);
  console.log(`   Lines: ${PRIOR_ART_LLM_PROMPT.split('\n').length}`);

  console.log('\n🔍 Key Sections Check:');
  const sections = [
    'IMPORTANT:',
    'Response JSON Schema',
    'Final Instruction',
    'INVENTION BRIEF:'
  ];

  sections.forEach(section => {
    const found = PRIOR_ART_LLM_PROMPT.includes(section);
    console.log(`   ${found ? '✅' : '❌'} Contains "${section}"`);
  });

  // Show sample exclude_terms examples from prompt
  console.log('\n📝 Exclude Terms Examples in Prompt:');
  const excludeExamples = [];
  if (PRIOR_ART_LLM_PROMPT.includes('mechanical inventions')) {
    console.log('   ✅ Contains mechanical invention examples');
  }
  if (PRIOR_ART_LLM_PROMPT.includes('AI/ML inventions')) {
    console.log('   ✅ Contains AI/ML invention examples');
  }
  if (PRIOR_ART_LLM_PROMPT.includes('biotech inventions')) {
    console.log('   ✅ Contains biotech invention examples');
  }

  console.log('\n🎯 Expected LLM Output Structure:');
  console.log('=====================================');
  console.log('The new prompt should generate bundles with this structure:');
  console.log(`
{
  "source_summary": { "title": "...", "problem_statement": "...", "solution_summary": "..." },
  "core_concepts": ["concept1", "concept2"],
  "technical_features": ["feature1", "feature2"],
  "synonym_groups": [["term", "synonym1", "synonym2"]],
  "cpc_candidates": ["CPC1", "CPC2"],
  "ipc_candidates": ["IPC1", "IPC2"],
  "exclude_terms": ["irrelevant1", "irrelevant2"],  // 🆕 NEW FIELD
  "query_variants": [
    { "label": "broad", "q": "...", "notes": "..." },
    { "label": "baseline", "q": "...", "notes": "..." },
    { "label": "narrow", "q": "...", "notes": "..." }
  ]
}`);

  const allPassed = checks.every(c => c.pass);
  console.log('\n🏁 Test Result:', allPassed ? '✅ PASSED' : '❌ FAILED');

  if (allPassed) {
    console.log('🎉 New LLM prompt structure is correctly implemented!');
    console.log('📤 Ready to test with actual LLM calls (requires authentication).');
  } else {
    console.log('⚠️  Some issues found with the prompt structure.');
  }

  return allPassed;
}

// Run the test
try {
  const result = testNewPrompt();
  console.log('\n🏁 Test completed');
  process.exit(result ? 0 : 1);
} catch (error) {
  console.error('💥 Test crashed:', error);
  process.exit(1);
}
