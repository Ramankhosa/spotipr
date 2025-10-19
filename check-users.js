const { PrismaClient } = require('@prisma/client');

async function checkUsers() {
  const prisma = new PrismaClient();

  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true }
    });
    console.log('Users in database:', users);

    // Also check if there's an analyst user
    const analystUser = await prisma.user.findFirst({
      where: { email: 'analyst@spotipr.com' }
    });
    console.log('Analyst user exists:', analystUser ? 'YES' : 'NO');
    if (analystUser) {
      console.log('Analyst user ID:', analystUser.id);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkUsers();
