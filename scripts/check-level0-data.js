// Check what Level 0 data is stored in the database
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkLevel0Data() {
  try {
    // Get the most recent prior art run
    const recentRun = await prisma.priorArtRun.findFirst({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        level0Checked: true,
        level0Determination: true,
        level0Results: true,
        level0ReportUrl: true,
        status: true,
        createdAt: true,
      }
    });

    if (!recentRun) {
      console.log('No prior art runs found');
      return;
    }

    console.log('Most recent run:', recentRun.id);
    console.log('Status:', recentRun.status);
    console.log('Level 0 checked:', recentRun.level0Checked);
    console.log('Level 0 determination:', recentRun.level0Determination);
    console.log('Level 0 report URL:', recentRun.level0ReportUrl);
    console.log('Created at:', recentRun.createdAt);

    if (recentRun.level0Results) {
      const level0Data = recentRun.level0Results;
      console.log('\nLevel 0 results structure:');
      console.log('Has patent_assessments:', !!level0Data.patent_assessments);

      if (level0Data.patent_assessments) {
        console.log('Number of assessments:', level0Data.patent_assessments.length);
        console.log('Sample assessment:');
        if (level0Data.patent_assessments.length > 0) {
          console.log(JSON.stringify(level0Data.patent_assessments[0], null, 2));
        }
      }

      console.log('Overall determination:', level0Data.overall_determination);
      console.log('Summary remarks:', level0Data.summary_remarks);
    } else {
      console.log('No Level 0 results stored');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkLevel0Data();
