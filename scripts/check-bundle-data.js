// Check bundle data to understand search query construction
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkBundleData() {
  try {
    const bundles = await prisma.priorArtSearchBundle.findMany({
      take: 2,
      select: {
        id: true,
        bundleData: true,
      }
    });

    console.log('Bundle data samples:');
    bundles.forEach((bundle, i) => {
      console.log(`\nBundle ${i+1}: ${bundle.id}`);
      const data = bundle.bundleData;
      console.log('Title:', data.source_summary?.title);
      console.log('Core concepts:', data.core_concepts);
      console.log('Phrases:', data.phrases);
      console.log('Technical features:', data.technical_features);

      // Show what query would be constructed
      const broadQuery = [
        data.source_summary?.title,
        data.core_concepts?.join(' '),
        data.phrases?.join(' '),
        data.technical_features?.join(' '),
      ].filter(Boolean).join(' ');

      console.log('Constructed query:', broadQuery);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkBundleData();
