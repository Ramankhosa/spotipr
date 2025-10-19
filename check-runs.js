const { PrismaClient } = require('@prisma/client');

async function checkRuns() {
  const prisma = new PrismaClient();

  try {
    const runs = await prisma.priorArtRun.findMany({
      where: { userId: 'cmgqg3xs1000d51nyvlsmirp2' },
      include: { bundle: true }
    });

    console.log('Prior art runs for analyst:', runs.length);
    if (runs.length > 0) {
      console.log('Run ID:', runs[0].id);
      console.log('Bundle ID:', runs[0].bundleId);
      console.log('Status:', runs[0].status);
    } else {
      console.log('No prior art runs found - need to create one first');
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkRuns();
