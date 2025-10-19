const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function validateBundle() {
  try {
    const bundle = await prisma.priorArtSearchBundle.findFirst({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        bundleData: true,
        status: true
      }
    });

    if (!bundle) {
      console.log('No bundles found');
      return;
    }

    console.log(`Bundle ID: ${bundle.id}`);
    console.log(`Status: ${bundle.status}`);
    console.log('Bundle data exists:', !!bundle.bundleData);

    if (bundle.bundleData) {
      const data = bundle.bundleData;

      // Check required fields
      console.log('=== VALIDATION CHECKS ===');

      console.log('1. Source summary title:', !!data.source_summary?.title);
      console.log('2. Core concepts (array):', Array.isArray(data.core_concepts) && data.core_concepts.length > 0);
      console.log('3. Query variants (exactly 3):', Array.isArray(data.query_variants) && data.query_variants.length === 3);

      if (data.query_variants) {
        console.log('4. Query variant labels:');
        const labels = data.query_variants.map(function(v) { return v.label; });
        console.log('   Labels found:', labels);
        console.log('   Has broad:', labels.includes('broad'));
        console.log('   Has baseline:', labels.includes('baseline'));
        console.log('   Has narrow:', labels.includes('narrow'));
      }

      console.log('5. Sensitive tokens check:', !data.sensitive_tokens || data.sensitive_tokens.length === 0);

      // Show the actual data structure
      console.log('\n=== BUNDLE DATA STRUCTURE ===');
      console.log(JSON.stringify(data, null, 2));
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

validateBundle();
