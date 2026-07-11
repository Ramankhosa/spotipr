import bcrypt from 'bcryptjs'
import sgMail from '@sendgrid/mail'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config()

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword)
}

export async function sendPasswordResetEmail(email: string, resetToken: string) {
  // For development/demo purposes, we'll just log the reset token
  // In production, you'd configure SendGrid properly
  if (!process.env.SENDGRID_API_KEY) {
    console.log(`Password reset requested for ${email}. Reset token: ${resetToken}`)
    console.log(`Reset URL: ${process.env.NEXTAUTH_URL}/reset-password?token=${resetToken}`)
    return
  }

  sgMail.setApiKey(process.env.SENDGRID_API_KEY)

  const resetUrl = `${process.env.NEXTAUTH_URL}/reset-password?token=${resetToken}`

  const msg = {
    to: email,
    from: 'noreply@patentnest.ai', // Replace with your verified sender
    subject: 'Reset Your Password - PatentNest',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1f2937; margin-bottom: 20px;">Reset Your Password</h2>
        <p style="color: #6b7280; line-height: 1.6; margin-bottom: 20px;">
          You requested a password reset for your PatentNest account. Click the button below to reset your password:
        </p>
        <a href="${resetUrl}" style="display: inline-block; background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500;">
          Reset Password
        </a>
        <p style="color: #9ca3af; font-size: 14px; margin-top: 20px;">
          This link will expire in 1 hour. If you didn't request this reset, please ignore this email.
        </p>
        <p style="color: #9ca3af; font-size: 14px;">
          If the button doesn't work, copy and paste this URL into your browser:<br>
          <a href="${resetUrl}" style="color: #3b82f6;">${resetUrl}</a>
        </p>
      </div>
    `,
  }

  await sgMail.send(msg)
}

// NOTE: A previous `generateResetToken()` helper using Math.random() was removed.
// It was unused (the live password-reset flow uses crypto-strong tokens from
// token-utils.ts) and Math.random() must never generate security tokens.

// JWT utilities
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secure-jwt-secret-change-in-production-min-32-chars'
const JWT_EXPIRES_IN = '15m' // Short-lived access token (15 minutes)
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'your-super-secure-refresh-secret-change-in-production-min-32-chars'
const REFRESH_TOKEN_EXPIRES_IN = '7d' // Long-lived refresh token (7 days)
const REFRESH_TOKEN_EXPIRES_MS = 7 * 24 * 60 * 60 * 1000 // 7 days in milliseconds

export interface JWTPayload {
  sub: string // user_id
  email: string
  tenant_id: string | null
  roles: string[] // Array of roles
  ati_id: string | null
  tenant_ati_id: string | null // For scope validation
  scope: 'platform' | 'tenant' // Unified scope model
  iat: number
  exp: number
}

export function generateJWT(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
}

export function verifyJWT(token: string): JWTPayload | null {
  try {
    if (!token || typeof token !== 'string') {
      console.error('verifyJWT: Token is null, undefined, or not a string');
      return null;
    }

    const payload = jwt.verify(token, JWT_SECRET) as JWTPayload;

    // Additional validation
    if (!payload || typeof payload !== 'object') {
      console.error('verifyJWT: Payload is not a valid object');
      return null;
    }

    return payload;
  } catch (error) {
    console.error('JWT verification failed:', {
      error: error instanceof Error ? error.message : String(error),
      tokenLength: token ? token.length : 0,
      hasSecret: !!JWT_SECRET
    });
    return null;
  }
}

// Refresh token utilities
export interface RefreshTokenPayload {
  sub: string // user_id
  tokenId: string // unique token identifier (maps to DB id)
  familyId: string // token family for rotation detection
  iat: number
  exp: number
}

export interface RefreshTokenResult {
  token: string
  tokenId: string
  familyId: string
  tokenHash: string
  expiresAt: Date
}

/**
 * Generate a new refresh token with family tracking for rotation
 * @param userId - The user's ID
 * @param familyId - Optional family ID for token rotation (new family if not provided)
 */
export function generateRefreshToken(userId: string, familyId?: string): RefreshTokenResult {
  const tokenId = crypto.randomBytes(32).toString('hex')
  const newFamilyId = familyId || crypto.randomBytes(16).toString('hex')
  
  const payload: Omit<RefreshTokenPayload, 'iat' | 'exp'> = {
    sub: userId,
    tokenId,
    familyId: newFamilyId
  }
  
  const token = jwt.sign(payload, REFRESH_TOKEN_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRES_IN })
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRES_MS)
  
  return { token, tokenId, familyId: newFamilyId, tokenHash, expiresAt }
}

/**
 * Verify a refresh token's signature and expiry
 */
export function verifyRefreshToken(token: string): RefreshTokenPayload | null {
  try {
    if (!token || typeof token !== 'string') {
      console.error('verifyRefreshToken: Token is null, undefined, or not a string');
      return null;
    }

    const payload = jwt.verify(token, REFRESH_TOKEN_SECRET) as RefreshTokenPayload;

    if (!payload || typeof payload !== 'object') {
      console.error('verifyRefreshToken: Payload is not a valid object');
      return null;
    }

    return payload;
  } catch (error) {
    // Don't log token expired as error - it's expected
    const isExpired = error instanceof jwt.TokenExpiredError
    if (!isExpired) {
      console.error('Refresh token verification failed:', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return null;
  }
}

/**
 * Hash a refresh token for secure storage
 */
export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/**
 * Store a refresh token in the database
 */
export async function storeRefreshToken(
  userId: string,
  tokenData: RefreshTokenResult,
  metadata?: { userAgent?: string; ipAddress?: string }
): Promise<void> {
  await prisma.refreshToken.create({
    data: {
      id: tokenData.tokenId,
      userId,
      tokenHash: tokenData.tokenHash,
      familyId: tokenData.familyId,
      expiresAt: tokenData.expiresAt,
      userAgent: metadata?.userAgent,
      ipAddress: metadata?.ipAddress
    }
  })
}

/**
 * Validate a refresh token against the database
 * Returns the token record if valid, null otherwise
 */
export async function validateStoredRefreshToken(tokenHash: string): Promise<{
  valid: boolean
  token?: any
  error?: string
}> {
  const storedToken = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: { include: { tenant: true } } }
  })

  if (!storedToken) {
    return { valid: false, error: 'TOKEN_NOT_FOUND' }
  }

  if (storedToken.isRevoked) {
    // Token was revoked - possible token theft, revoke entire family
    await revokeTokenFamily(storedToken.familyId, 'security')
    return { valid: false, error: 'TOKEN_REVOKED' }
  }

  if (new Date() > storedToken.expiresAt) {
    return { valid: false, error: 'TOKEN_EXPIRED' }
  }

  return { valid: true, token: storedToken }
}

/**
 * Revoke a specific refresh token
 */
export async function revokeRefreshToken(tokenHash: string, reason: string = 'logout'): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash },
    data: { 
      isRevoked: true, 
      revokedAt: new Date(),
      revokedReason: reason
    }
  })
}

/**
 * Revoke all tokens in a family (for security - detected reuse)
 */
export async function revokeTokenFamily(familyId: string, reason: string = 'rotation'): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { familyId },
    data: { 
      isRevoked: true, 
      revokedAt: new Date(),
      revokedReason: reason
    }
  })
}

/**
 * Revoke all refresh tokens for a user (logout from all devices)
 */
export async function revokeAllUserTokens(userId: string, reason: string = 'logout_all'): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId },
    data: { 
      isRevoked: true, 
      revokedAt: new Date(),
      revokedReason: reason
    }
  })
}

/**
 * Clean up expired refresh tokens (run periodically)
 */
export async function cleanupExpiredTokens(): Promise<number> {
  const result = await prisma.refreshToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        { isRevoked: true, revokedAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } // 30 days old revoked tokens
      ]
    }
  })
  return result.count
}

// ATI Token utilities
// SECURITY: In production, ATI_PEPPER must be set - reject weak defaults
const ATI_PEPPER = (() => {
  const pepper = process.env.ATI_PEPPER
  if (!pepper) {
    if (process.env.NODE_ENV === 'production') {
      // In production, fail hard if security-critical env vars are missing
      console.error('CRITICAL SECURITY: ATI_PEPPER environment variable is not set!')
      throw new Error('ATI_PEPPER environment variable is required in production')
    }
    // Development mode - use weak default with warning
    console.warn('[SECURITY WARNING] ATI_PEPPER not set - using weak default. Set this in production!')
    return 'default-pepper-change-in-prod'
  }
  // Validate pepper strength
  if (pepper.length < 32) {
    console.warn('[SECURITY WARNING] ATI_PEPPER should be at least 32 characters for security')
  }
  return pepper
})()

export function generateATIToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

export function hashATIToken(token: string): string {
  return crypto.createHash('sha256').update(token + ATI_PEPPER).digest('hex')
}

export function createATIFingerprint(tokenHash: string): string {
  return tokenHash.substring(tokenHash.length - 6).toUpperCase()
}

export async function validateATIToken(token: string, tenantId?: string) {
  const tokenHash = hashATIToken(token)

  const whereClause: any = {
    tokenHash,
    status: { in: ['ACTIVE', 'ISSUED'] } // Only allow active or newly issued tokens
  }

  // For tenant-specific validation, restrict to specific tenant
  // For platform tokens (super admin), tenantId will be null so we allow any tenantId including null
  if (tenantId !== undefined) {
    whereClause.tenantId = tenantId
  }

  const atiToken = await prisma.aTIToken.findFirst({
    where: whereClause
  })

  if (!atiToken) {
    return { valid: false, error: 'INVALID_ATI_TOKEN' }
  }

  // Check expiration
  if (atiToken.expiresAt && new Date() > atiToken.expiresAt) {
    await prisma.aTIToken.update({
      where: { id: atiToken.id },
      data: { status: 'EXPIRED' }
    })
    return { valid: false, error: 'ATI_EXPIRED' }
  }

  // Check if revoked
  if (atiToken.status === 'REVOKED') {
    return { valid: false, error: 'ATI_REVOKED' }
  }

  // Check if used up
  if (atiToken.maxUses && atiToken.usageCount >= atiToken.maxUses) {
    if (atiToken.status !== 'USED_UP') {
      await prisma.aTIToken.update({
        where: { id: atiToken.id },
        data: { status: 'USED_UP' }
      })
    }
    return { valid: false, error: 'ATI_USED_UP' }
  }

  return { valid: true, atiToken }
}

export async function incrementATITokenUsage(tokenId: string) {
  await prisma.$transaction(async (tx) => {
    await consumeATITokenForSignup(tx, tokenId)
  })
}

export async function consumeATITokenForSignup(tx: any, tokenId: string) {
  const consumed = await tx.$queryRaw<Array<{ id: string; usageCount: number; maxUses: number | null }>>`
    UPDATE "ati_tokens"
    SET
      "usageCount" = "usageCount" + 1,
      "status" = CASE
        WHEN "maxUses" IS NOT NULL AND "usageCount" + 1 >= "maxUses" THEN 'USED_UP'::"ATITokenStatus"
        ELSE "status"
      END,
      "updatedAt" = NOW()
    WHERE "id" = ${tokenId}
      AND "status" IN ('ACTIVE'::"ATITokenStatus", 'ISSUED'::"ATITokenStatus")
      AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
      AND ("maxUses" IS NULL OR "usageCount" < "maxUses")
    RETURNING "id", "usageCount", "maxUses"
  `

  if (consumed.length === 1) return consumed[0]

  const currentToken = await tx.aTIToken.findUnique({ where: { id: tokenId } })
  if (!currentToken) throw new Error('ATI_TOKEN_INVALID')
  if (currentToken.expiresAt && new Date() > currentToken.expiresAt) {
    await tx.aTIToken.update({ where: { id: tokenId }, data: { status: 'EXPIRED' } })
    throw new Error('ATI_EXPIRED')
  }
  if (currentToken.maxUses && currentToken.usageCount >= currentToken.maxUses) {
    await tx.aTIToken.update({ where: { id: tokenId }, data: { status: 'USED_UP' } })
    throw new Error('ATI_USED_UP')
  }
  throw new Error('ATI_TOKEN_INVALID')
}

// Token encryption for temporary revelation
// SECURITY: In production, TOKEN_ENCRYPTION_KEY must be set
const ENCRYPTION_KEY = (() => {
  const key = process.env.TOKEN_ENCRYPTION_KEY
  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      console.error('CRITICAL SECURITY: TOKEN_ENCRYPTION_KEY environment variable is not set!')
      throw new Error('TOKEN_ENCRYPTION_KEY environment variable is required in production')
    }
    console.warn('[SECURITY WARNING] TOKEN_ENCRYPTION_KEY not set - using weak default. Set this in production!')
    return 'default-encryption-key-change-in-production-32-chars-minimum'
  }
  if (key.length < 32) {
    console.warn('[SECURITY WARNING] TOKEN_ENCRYPTION_KEY should be at least 32 characters for AES-256')
  }
  return key
})()
const ALGORITHM = 'aes-256-cbc'

export function encryptToken(token: string): string {
  const iv = crypto.randomBytes(16)
  // Ensure key is exactly 32 bytes for AES-256
  const key = Buffer.from(ENCRYPTION_KEY.padEnd(32, '0')).subarray(0, 32)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  let encrypted = cipher.update(token, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  return iv.toString('hex') + ':' + encrypted
}

export function decryptToken(encryptedToken: string): string | null {
  try {
    const [ivHex, encrypted] = encryptedToken.split(':')
    if (!ivHex || !encrypted) return null

    const iv = Buffer.from(ivHex, 'hex')
    // Ensure key is exactly 32 bytes for AES-256
    const key = Buffer.from(ENCRYPTION_KEY.padEnd(32, '0')).subarray(0, 32)
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    let decrypted = decipher.update(encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  } catch (error) {
    console.error('Decryption error:', error instanceof Error ? error.message : String(error))
    return null
  }
}

// Audit logging utilities
export async function createAuditLog({
  actorUserId,
  tenantId,
  action,
  resource,
  ip,
  meta
}: {
  actorUserId?: string
  tenantId?: string
  action: string
  resource: string
  ip?: string
  meta?: any
}) {
  await prisma.auditLog.create({
    data: {
      actorUserId,
      tenantId,
      action,
      resource,
      ip,
      meta: meta ? JSON.parse(JSON.stringify(meta)) : null
    }
  })
}
