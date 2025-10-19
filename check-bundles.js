const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkBundles() {
  try {
    const bundles = await prisma.priorArtSearchBundle.findMany({
      select: {
        id: true,
        status: true,
        patentId: true,
        createdBy: true,
        bundleData: true
      },
      orderBy: { createdAt: 'desc' },
      take: 5
    });

    console.log('Recent bundles:');
    bundles.forEach(bundle => {
      console.log(`ID: ${bundle.id}`);
      console.log(`Status: ${bundle.status}`);
      console.log(`Patent ID: ${bundle.patentId}`);
      console.log(`Bundle data exists: ${!!bundle.bundleData}`);
      console.log('---');
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkBundles();
