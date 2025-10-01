const { PrismaClient } = require('@prisma/client');
const { encryptToken, decryptToken } = require('./src/lib/auth');
const prisma = new PrismaClient();

async function testTokenReveal() {
  try {
    console.log('🔍 Testing Token Revelation...\n');

    // Find a token with rawToken
    const token = await prisma.aTIToken.findFirst({
      where: {
        rawToken: { not: null },
        tenant: { atiId: { not: 'PLATFORM' } }
      },
      include: { tenant: true },
      orderBy: { createdAt: 'desc' }
    });

    if (!token) {
      console.log('❌ No tokens with rawToken found');
      return;
    }

    console.log('📝 Found token:', token.fingerprint);
    console.log('RawToken exists:', !!token.rawToken);
    console.log('RawTokenExpiry:', token.rawTokenExpiry);

    if (token.rawToken && token.rawTokenExpiry) {
      const now = new Date();
      const isExpired = now > token.rawTokenExpiry;

      console.log('Token expired:', isExpired);

      if (!isExpired) {
        console.log('Attempting decryption...');
        const decrypted = decryptToken(token.rawToken);
        console.log('Decryption result:', decrypted ? 'SUCCESS' : 'FAILED');

        if (decrypted) {
          console.log('Decrypted token preview:', decrypted.substring(0, 20) + '...');
        }
      }
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testTokenReveal();
