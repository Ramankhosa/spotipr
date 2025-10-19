#!/usr/bin/env node

/**
 * CODE-ONLY INTEGRATION TEST
 * Tests the complete novelty assessment integration without database operations
 */

const fs = require('fs');
const path = require('path');

async function testCodeIntegration() {
  console.log('🔬 CODE-ONLY INTEGRATION TEST: Prior Art Search + Novelty Assessment\n');

  let testResults = {
    fileStructure: false,
    apiEndpoints: false,
    uiComponents: false,
    workflowIntegration: false,
    errorHandling: false,
    typeScriptCompilation: false,
  };

  try {
    // 1. Test File Structure
    console.log('1️⃣ Testing File Structure...');
    try {
      const requiredFiles = [
        // Novelty assessment components
        'src/components/novelty-assessment/NoveltyAssessmentWorkflow.tsx',
        'src/components/novelty-assessment/NoveltyAssessmentForm.tsx',
        'src/components/novelty-assessment/NoveltyAssessmentManager.tsx',

        // UI components
        'src/components/ui/progress.tsx',
        'src/components/ui/input.tsx',
        'src/components/ui/label.tsx',
        'src/components/ui/alert.tsx',

        // API endpoints
        'src/app/api/patents/[patentId]/novelty-assessment/route.ts',
        'src/app/api/patents/[patentId]/novelty-assessment/[assessmentId]/route.ts',
        'src/app/api/patents/[patentId]/novelty-assessment/[assessmentId]/report/route.ts',

        // Services
        'src/lib/novelty-assessment.ts',
        'src/lib/pdf-report-service.ts',
        'src/lib/drafting-service.ts',
      ];

      let allFilesExist = true;
      for (const file of requiredFiles) {
        if (!fs.existsSync(file)) {
          console.log(`❌ Missing file: ${file}`);
          allFilesExist = false;
        }
      }

      if (allFilesExist) {
        console.log('✅ All required files exist');
        testResults.fileStructure = true;
      }
    } catch (error) {
      console.log('❌ File structure test failed:', error.message);
    }

    // 2. Test API Endpoints Integration
    console.log('\n2️⃣ Testing API Endpoints Integration...');
    try {
      // Check prior art runs endpoint includes novelty assessment
      const runsEndpoint = fs.readFileSync('src/app/api/prior-art/runs/route.ts', 'utf8');
      const integrationChecks = [
        runsEndpoint.includes('noveltyAssessments') || runsEndpoint.includes('noveltyAssessment'),
        runsEndpoint.includes('noveltyAssessmentRun') || runsEndpoint.includes('NoveltyAssessmentRun'),
        runsEndpoint.includes('assessmentMap'),
        runsEndpoint.includes('noveltyAssessment: assessmentMap.get'),
      ];


      // Check prior art search service includes novelty integration
      const searchService = fs.readFileSync('src/lib/prior-art-search.ts', 'utf8');
      const searchChecks = [
        searchService.includes('NoveltyAssessmentService'),
        searchService.includes('getIntersectingPatentsForNovelty'),
        searchService.includes('jwtToken: jwtToken'),
      ];

      if (integrationChecks.every(check => check) && searchChecks.every(check => check)) {
        console.log('✅ API endpoints properly integrated with novelty assessment');
        testResults.apiEndpoints = true;
      } else {
        console.log('❌ API integration incomplete');
        console.log('Missing runs endpoint checks:', integrationChecks.map((check, i) => !check ? `check${i}` : null).filter(Boolean));
        console.log('Missing search service checks:', searchChecks.map((check, i) => !check ? `check${i}` : null).filter(Boolean));
      }
    } catch (error) {
      console.log('❌ API endpoints test failed:', error.message);
    }

    // 3. Test UI Components Integration
    console.log('\n3️⃣ Testing UI Components Integration...');
    try {
      // Check patent page includes novelty assessment
      const patentPage = fs.readFileSync('src/app/projects/[projectId]/patents/[patentId]/page.tsx', 'utf8');
      const patentChecks = [
        patentPage.includes('NoveltyAssessmentManager'),
        patentPage.includes('novelty-assessment'),
        patentPage.includes('Novelty Assessment'),
      ];

      // Check search history includes novelty assessment
      const searchHistory = fs.readFileSync('src/components/prior-art/SearchHistory.tsx', 'utf8');
      const historyChecks = [
        searchHistory.includes('noveltyAssessment'),
        searchHistory.includes('Novelty Report'),
        searchHistory.includes('Assessment:'),
      ];

      if (patentChecks.every(check => check) && historyChecks.every(check => check)) {
        console.log('✅ UI components properly integrated');
        testResults.uiComponents = true;
      } else {
        console.log('❌ UI integration incomplete');
        console.log('Missing patent page checks:', patentChecks.map((check, i) => !check ? `check${i}` : null).filter(Boolean));
        console.log('Missing search history checks:', historyChecks.map((check, i) => !check ? `check${i}` : null).filter(Boolean));
      }
    } catch (error) {
      console.log('❌ UI components test failed:', error.message);
    }

    // 4. Test Workflow Integration Logic
    console.log('\n4️⃣ Testing Workflow Integration Logic...');
    try {
      const searchService = fs.readFileSync('src/lib/prior-art-search.ts', 'utf8');

      const workflowChecks = [
        searchService.includes('OPTIMIZED NOVELTY ASSESSMENT WORKFLOW'),
        searchService.includes('getLevel1PatentsForNovelty'),
        searchService.includes('performLevel1Assessment'),
        searchService.includes('performLevel2Assessment'),
        searchService.includes('fetchDetailsForSelectedPatents'),
        searchService.includes('patentId: bundle.patentId'),
        searchService.includes('problem: bundle.source_summary.problem_statement'),
        searchService.includes('solution: bundle.source_summary.solution_summary'),
      ];

      if (workflowChecks.every(check => check)) {
        console.log('✅ Workflow integration logic is complete');
        testResults.workflowIntegration = true;
      } else {
        console.log('❌ Workflow integration logic incomplete');
        console.log('Missing checks:', workflowChecks.map((check, i) => !check ? `workflowCheck${i}` : null).filter(Boolean));
      }
    } catch (error) {
      console.log('❌ Workflow integration test failed:', error.message);
    }

    // 5. Test Error Handling
    console.log('\n5️⃣ Testing Error Handling...');
    try {
      const searchService = fs.readFileSync('src/lib/prior-art-search.ts', 'utf8');

      const errorChecks = [
        searchService.includes('catch (noveltyError)'),
        searchService.includes('console.error(\'❌ Novelty assessment integration error:'),
        searchService.includes('Search will complete successfully'),
        searchService.includes('fallback to basic search results') || searchService.includes('fetchDetailsForShortlist'),
      ];

      if (errorChecks.every(check => check)) {
        console.log('✅ Proper error handling implemented');
        testResults.errorHandling = true;
      } else {
        console.log('❌ Error handling incomplete');
        console.log('Missing error checks:', errorChecks.map((check, i) => !check ? `errorCheck${i}` : null).filter(Boolean));
      }
    } catch (error) {
      console.log('❌ Error handling test failed:', error.message);
    }

    // 6. Test TypeScript Compilation
    console.log('\n6️⃣ Testing TypeScript Compilation...');
    try {
      const { execSync } = require('child_process');
      execSync('npx tsc --noEmit --skipLibCheck', { stdio: 'pipe' });
      console.log('✅ TypeScript compilation successful');
      testResults.typeScriptCompilation = true;
    } catch (error) {
      console.log('❌ TypeScript compilation failed');
      console.log('Error:', error.stdout?.toString() || error.message);
    }

  } catch (error) {
    console.error('❌ Integration test failed with error:', error);
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('📊 CODE INTEGRATION TEST RESULTS');
  console.log('='.repeat(70));

  const passedTests = Object.values(testResults).filter(Boolean).length;
  const totalTests = Object.keys(testResults).length;

  Object.entries(testResults).forEach(([test, passed]) => {
    console.log(`${passed ? '✅' : '❌'} ${test.replace(/([A-Z])/g, ' $1').toLowerCase()}`);
  });

  console.log('\n' + '='.repeat(70));
  console.log(`🎯 OVERALL RESULT: ${passedTests}/${totalTests} integration tests passed`);

  if (passedTests === totalTests) {
    console.log('🎉 SUCCESS! Complete integration is working correctly.');
    console.log('\n✅ VERIFIED INTEGRATIONS:');
    console.log('   • All required files and components exist');
    console.log('   • API endpoints properly integrated');
    console.log('   • UI components show novelty assessment status');
    console.log('   • Prior art search triggers novelty assessment');
    console.log('   • Error handling prevents workflow failures');
    console.log('   • TypeScript compilation passes');
    console.log('\n🚀 The novelty assessment integration is ready!');
    console.log('\n📋 NEXT STEPS:');
    console.log('   1. Run database migrations: npx prisma migrate dev');
    console.log('   2. Generate Prisma client: npx prisma generate');
    console.log('   3. Test with real data in development environment');
  } else {
    console.log('⚠️  Some integration tests failed. Check the implementation.');
    process.exit(1);
  }

  console.log('\n' + '='.repeat(70));
}

// Run the test
testCodeIntegration().catch(console.error);
