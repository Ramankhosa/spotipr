// Test encryption functions
const crypto = require('crypto');

const ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || 'default-encryption-key-change-in-production-32-chars-minimum';
const ALGORITHM = 'aes-256-cbc';

function encryptToken(token) {
  const iv = crypto.randomBytes(16);
  // Ensure key is exactly 32 bytes for AES-256
  const key = Buffer.from(ENCRYPTION_KEY.padEnd(32, '0')).subarray(0, 32);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decryptToken(encryptedToken) {
  try {
    const [ivHex, encrypted] = encryptedToken.split(':');
    if (!ivHex || !encrypted) return null;

    const iv = Buffer.from(ivHex, 'hex');
    // Ensure key is exactly 32 bytes for AES-256
    const key = Buffer.from(ENCRYPTION_KEY.padEnd(32, '0')).subarray(0, 32);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error.message);
    return null;
  }
}

// Test
const testToken = 'ABCDEFGH12345678';
console.log('Original:', testToken);

const encrypted = encryptToken(testToken);
console.log('Encrypted:', encrypted);

const decrypted = decryptToken(encrypted);
console.log('Decrypted:', decrypted);

console.log('Success:', testToken === decrypted);
