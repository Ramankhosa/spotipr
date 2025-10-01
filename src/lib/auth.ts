import bcrypt from 'bcryptjs'
import sgMail from '@sendgrid/mail'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'

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
    from: 'noreply@spotipr.com', // Replace with your verified sender
    subject: 'Reset Your Password - Spotipr',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1f2937; margin-bottom: 20px;">Reset Your Password</h2>
        <p style="color: #6b7280; line-height: 1.6; margin-bottom: 20px;">
          You requested a password reset for your Spotipr account. Click the button below to reset your password:
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

export function generateResetToken(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

// JWT utilities
const JWT_SECRET = process.env.JWT_SECRET!
const JWT_EXPIRES_IN = '1h'

export interface JWTPayload {
  sub: string // user_id
  email: string
  tenant_id: string | null
  role: string
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
    return jwt.verify(token, JWT_SECRET) as JWTPayload
  } catch {
    return null
  }
}

// ATI Token utilities
const ATI_PEPPER = process.env.ATI_PEPPER || 'default-pepper-change-in-prod'

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
  // Get current token state first
  const currentToken = await prisma.aTIToken.findUnique({
    where: { id: tokenId }
  })

  if (!currentToken) {
    throw new Error('Token not found')
  }

  // Atomically increment and check in a transaction to avoid race conditions
  await prisma.$transaction(async (tx) => {
    // Increment usage count
    await tx.aTIToken.update({
      where: { id: tokenId },
      data: {
        usageCount: { increment: 1 }
      }
    })

    // Check if now used up (current usage + 1 >= max uses)
    const newUsageCount = currentToken.usageCount + 1
    if (currentToken.maxUses && newUsageCount >= currentToken.maxUses) {
      await tx.aTIToken.update({
        where: { id: tokenId },
        data: { status: 'USED_UP' }
      })
    }
  })
}

// Token encryption for temporary revelation
const ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || 'default-encryption-key-change-in-production-32-chars-minimum'
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

