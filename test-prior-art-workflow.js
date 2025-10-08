const { PrismaClient } = require('@prisma/client');
const { priorArtSearchService } = require('./src/lib/prior-art-search.ts');
const { PriorArtLLMService } = require('./src/lib/prior-art-llm.ts');

const prisma = new PrismaClient();

async function testPriorArtWorkflow() {
  console.log('🧪 Testing Complete Prior Art Search Workflow...\n');

  try {
    // Step 1: Create dummy user and project
    console.log('1️⃣ Creating dummy user and project...');

    const dummyUser = await prisma.user.upsert({
      where: { email: 'test@example.com' },
      update: {},
      create: {
        email: 'test@example.com',
        name: 'Test User',
        role: 'ANALYST',
        status: 'ACTIVE',
      },
    });

    const dummyProject = await prisma.project.upsert({
      where: { id: 'test-project-123' },
      update: {},
      create: {
        id: 'test-project-123',
        name: 'Test Patent Project',
        userId: dummyUser.id,
      },
    });

    console.log(`✅ Created user: ${dummyUser.email}`);
    console.log(`✅ Created project: ${dummyProject.name}\n`);

    // Step 2: Create dummy patent
    console.log('2️⃣ Creating dummy patent...');

    const dummyPatent = await prisma.patent.upsert({
      where: { id: 'test-patent-123' },
      update: {},
      create: {
        id: 'test-patent-123',
        title: 'Smart Home Automation System',
        projectId: dummyProject.id,
        createdBy: dummyUser.id,
      },
    });

    console.log(`✅ Created patent: ${dummyPatent.title}\n`);

    // Step 3: Create prior art search bundle manually
    console.log('3️⃣ Creating prior art search bundle...');

    const bundleData = {
      source_summary: {
        title: 'Smart Home Automation System',
        problem_statement: 'Existing home automation systems lack intelligent coordination between devices and fail to adapt to user behavior patterns.',
        solution_summary: 'A centralized AI-powered system that learns user preferences and automatically coordinates smart home devices.',
      },
      core_concepts: ['smart home', 'automation', 'AI coordination', 'device integration'],
      technical_features: ['machine learning', 'device coordination', 'user preference learning'],
      synonym_groups: [
        ['smart home', 'intelligent home', 'automated residence'],
        ['automation', 'control system', 'coordination'],
        ['AI', 'artificial intelligence', 'machine learning']
      ],
      cpc_candidates: ['G05B', 'H04L', 'G06N'],
      ipc_candidates: ['G05B15/00', 'H04L12/28', 'G06N20/00'],
      query_variants: [
        {
          label: 'BROAD',
          q: 'smart home automation AI coordination',
          num: 10,
          page: 1,
          notes: 'Broad search covering main concepts'
        },
        {
          label: 'BASELINE',
          q: '"smart home" AND "automation" AND "AI"',
          num: 10,
          page: 1,
          notes: 'Balanced search with key phrases'
        },
        {
          label: 'NARROW',
          q: '"intelligent home automation" AND "device coordination"',
          num: 10,
          page: 1,
          notes: 'Narrow search focusing on specific features'
        }
      ],
      phrases: ['device coordination', 'user preference learning'],
      exclude_terms: ['legacy', 'obsolete'],
      spec_limits: [],
      domain_tags: ['IoT', 'consumer electronics'],
      date_window: { from: '2015-01-01' },
      jurisdictions_preference: ['US', 'EP'],
      ambiguous_terms: [],
      sensitive_tokens: [],
      serpapi_defaults: {
        engine: 'google_patents',
        hl: 'en',
        no_cache: false
      },
      fields_for_details: ['title', 'abstract', 'claims', 'classifications'],
      detail_priority_rules: 'Prioritize recent publications with high citation counts'
    };

    const bundle = await prisma.priorArtSearchBundle.create({
      data: {
        patentId: dummyPatent.id,
        mode: 'MANUAL',
        status: 'APPROVED',
        inventionBrief: 'Smart home automation system with AI coordination',
        bundleData: bundleData,
        createdBy: dummyUser.id,
        approvedBy: dummyUser.id,
        approvedAt: new Date(),
      },
    });

    console.log(`✅ Created bundle: ${bundle.id}`);
    console.log(`📋 Bundle status: ${bundle.status}\n`);

    // Step 4: Execute the search
    console.log('4️⃣ Executing prior art search...');

    const runId = await priorArtSearchService.executeSearch(bundle.id, dummyUser.id);

    console.log(`✅ Search execution started: ${runId}\n`);

    // Step 5: Check search results
    console.log('5️⃣ Checking search results...');

    // Wait a moment for the search to complete
    await new Promise(resolve => setTimeout(resolve, 3000));

    const run = await prisma.priorArtRun.findUnique({
      where: { id: runId },
      include: {
        queryVariants: true,
        unifiedResults: {
          include: { patent: true },
          orderBy: { score: 'desc' },
          take: 5,
        },
      },
    });

    if (run) {
      console.log(`📊 Search Status: ${run.status}`);
      console.log(`⏱️ Duration: ${run.startedAt} - ${run.finishedAt || 'In Progress'}`);
      console.log(`📞 API Calls Made: ${run.apiCallsMade}`);
      console.log(`💰 Credits Consumed: ${run.creditsConsumed}`);
      console.log(`📈 Results Found: ${run.unifiedResults.length}\n`);

      if (run.unifiedResults.length > 0) {
        console.log('🏆 Top 5 Results:');
        run.unifiedResults.forEach((result, index) => {
          console.log(`${index + 1}. ${result.patent.title}`);
          console.log(`   Score: ${result.score}, Intersection: ${result.intersectionType}`);
          console.log(`   Variants: ${result.foundInVariants.join(', ')}\n`);
        });
      }

      // Check variant executions
      console.log('🔍 Variant Execution Details:');
      run.queryVariants.forEach(variant => {
        console.log(`- ${variant.label}: ${variant.resultsCount} results, ${variant.apiCalls} API calls`);
      });
    }

    // Step 6: Clean up (optional)
    console.log('\n🧹 Cleaning up test data...');

    // Delete in reverse order to maintain foreign key constraints
    if (run) {
      await prisma.priorArtUnifiedResult.deleteMany({ where: { runId } });
      await prisma.priorArtRawResult.deleteMany({ where: { runId } });
      await prisma.priorArtVariantHit.deleteMany({ where: { runId } });
      await prisma.priorArtQueryVariantExecution.deleteMany({ where: { runId } });
      await prisma.priorArtRun.delete({ where: { id: runId } });
    }

    await prisma.priorArtSearchBundle.delete({ where: { id: bundle.id } });
    await prisma.priorArtSearchHistory.deleteMany({ where: { bundleId: bundle.id } });
    await prisma.priorArtQueryVariant.deleteMany({ where: { bundleId: bundle.id } });

    await prisma.patent.delete({ where: { id: dummyPatent.id } });
    await prisma.project.delete({ where: { id: dummyProject.id } });

    // Don't delete the user as it might be used elsewhere
    // await prisma.user.delete({ where: { id: dummyUser.id } });

    console.log('✅ Test data cleaned up');

  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Stack:', error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testPriorArtWorkflow().catch(console.error);
