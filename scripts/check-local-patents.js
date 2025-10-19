// Quick check of local patents data
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  try {
    const count = await prisma.localPatent.count();
    console.log(`Total local patents: ${count}`);

    const sample = await prisma.localPatent.findMany({
      take: 5,
      select: {
        publicationNumber: true,
        title: true,
        abstract: true,
      }
    });

    console.log('\nSample patents:');
    sample.forEach((p, i) => {
      console.log(`${i+1}. ${p.publicationNumber}: ${p.title?.substring(0, 50)}...`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
