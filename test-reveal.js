const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

// Replicate auth functions for testing
function generateATIToken() {
  return crypto.randomBytes(32).toString('hex').toUpperCase();
}

function hashATIToken(token) {
  return bcrypt.hashSync(token, 12);
}

const ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const ALGORITHM = 'aes-256-cbc';

function encryptToken(token) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY.slice(0, 32)), iv);
  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decryptToken(encryptedToken) {
  try {
    const [ivHex, encrypted] = encryptedToken.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY.slice(0, 32)), iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    return null;
  }
}

async function testTokenRevelation() {
  try {
    console.log('🔍 Testing Token Revelation Feature\n');

    // Find an existing tenant
    let tenant = await prisma.tenant.findFirst({
      where: { atiId: { not: 'PLATFORM' } }
    });

    if (!tenant) {
      console.log('📝 Creating test tenant...');
      tenant = await prisma.tenant.create({
        data: {
          name: 'Test Tenant',
          atiId: 'TESTTENANT',
          status: 'ACTIVE'
        }
      });
    }

    console.log('📍 Using tenant:', tenant.name, '(' + tenant.atiId + ')');

    // Create a test token
    const rawToken = generateATIToken();
    const tokenHash = hashATIToken(rawToken);
    const encryptedRawToken = encryptToken(rawToken);
    const rawTokenExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const token = await prisma.aTIToken.create({
      data: {
        tenantId: tenant.id,
        tokenHash,
        rawToken: encryptedRawToken,
        rawTokenExpiry,
        fingerprint: tokenHash.substring(tokenHash.length - 6).toUpperCase(),
        notes: 'Test token for revelation feature'
      }
    });

    console.log('✅ Test token created:');
    console.log('   ID:', token.id);
    console.log('   Fingerprint:', token.fingerprint);
    console.log('   Original raw token:', rawToken.substring(0, 20) + '...');

    // Test decryption
    const decrypted = decryptToken(token.rawToken);
    console.log('\n🔓 Decryption test:');
    console.log('   Decrypted token:', decrypted ? decrypted.substring(0, 20) + '...' : 'FAILED');
    console.log('   Match:', decrypted === rawToken ? '✅ YES' : '❌ NO');

    await prisma.$disconnect();
    console.log('\n🎉 Token revelation feature is working!');

  } catch (error) {
    console.error('❌ Error:', error);
    await prisma.$disconnect();
  }
}

testTokenRevelation();
