import { prisma } from '@/lib/prisma'
import { createAuditLog } from '@/lib/auth'
import { generateToken, hashToken } from '@/lib/token-utils'
import { verificationTemplate } from '@/lib/email-templates'
import { sendEmail } from '@/lib/mailer'

export function normalizeManagedEmail(email: string): string {
  return email.trim().toLowerCase()
}

export async function issueEmailVerificationForUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true }
  })

  if (!user) {
    throw new Error('User not found')
  }

  const rawToken = generateToken()
  const tokenHash = hashToken(rawToken)
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

  await prisma.$transaction([
    prisma.emailVerificationToken.deleteMany({ where: { userId } }),
    prisma.emailVerificationToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt
      }
    })
  ])

  const tpl = verificationTemplate(user.email, user.name, rawToken)
  await sendEmail({
    to: user.email,
    toName: user.name || undefined,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text
  })
}

async function getManagedTargetUser(targetUserId: string, tenantId?: string) {
  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      email: true,
      name: true,
      tenantId: true,
      roles: true,
      emailVerified: true,
      emailDraftingEnabled: true
    }
  })

  if (!targetUser) {
    return { success: false as const, error: 'User not found', code: 'NOT_FOUND' }
  }

  if (tenantId && targetUser.tenantId !== tenantId) {
    return { success: false as const, error: 'Cannot modify users from a different tenant', code: 'FORBIDDEN' }
  }

  if (targetUser.roles.some(role => role === 'SUPER_ADMIN' || role === 'SUPER_ADMIN_VIEWER')) {
    return { success: false as const, error: 'Cannot modify super admin accounts', code: 'FORBIDDEN' }
  }

  return { success: true as const, user: targetUser }
}

export async function updateManagedUserEmail(params: {
  actorUserId: string
  targetUserId: string
  newEmail: string
  tenantId?: string
  auditAction: string
  ip?: string
}) {
  const normalizedEmail = normalizeManagedEmail(params.newEmail)
  const targetResult = await getManagedTargetUser(params.targetUserId, params.tenantId)
  if (!targetResult.success) {
    return targetResult
  }
  const targetUser = targetResult.user

  if (!normalizedEmail) {
    return { success: false as const, error: 'Email is required', code: 'INVALID_INPUT' }
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true }
  })

  if (existingUser && existingUser.id !== targetUser.id) {
    return { success: false as const, error: 'Email is already in use', code: 'EMAIL_IN_USE' }
  }

  if (normalizedEmail === targetUser.email) {
    return { success: true as const, changed: false, user: targetUser }
  }

  const updatedUser = await prisma.user.update({
    where: { id: targetUser.id },
    data: {
      email: normalizedEmail,
      emailVerified: false,
      emailDraftingEnabled: false
    },
    select: {
      id: true,
      email: true,
      name: true,
      tenantId: true,
      emailVerified: true,
      emailDraftingEnabled: true
    }
  })

  await createAuditLog({
    actorUserId: params.actorUserId,
    tenantId: targetUser.tenantId || undefined,
    action: params.auditAction,
    resource: `user:${targetUser.id}`,
    ip: params.ip,
    meta: {
      previousEmail: targetUser.email,
      newEmail: updatedUser.email,
      previousEmailVerified: targetUser.emailVerified,
      previousEmailDraftingEnabled: targetUser.emailDraftingEnabled,
      emailVerified: updatedUser.emailVerified,
      emailDraftingEnabled: updatedUser.emailDraftingEnabled
    }
  })

  try {
    await issueEmailVerificationForUser(updatedUser.id)
  } catch (error) {
    console.warn('[AdminUserEmailService] Failed to send verification email after admin email change:', error)
  }

  return { success: true as const, changed: true, user: updatedUser }
}

export async function resendManagedUserEmailVerification(params: {
  actorUserId: string
  targetUserId: string
  tenantId?: string
  auditAction: string
  ip?: string
}) {
  const targetResult = await getManagedTargetUser(params.targetUserId, params.tenantId)
  if (!targetResult.success) {
    return targetResult
  }
  const targetUser = targetResult.user

  if (targetUser.emailVerified) {
    return { success: false as const, error: 'Email is already verified', code: 'EMAIL_ALREADY_VERIFIED' }
  }

  await issueEmailVerificationForUser(targetUser.id)

  await createAuditLog({
    actorUserId: params.actorUserId,
    tenantId: targetUser.tenantId || undefined,
    action: params.auditAction,
    resource: `user:${targetUser.id}`,
    ip: params.ip,
    meta: {
      email: targetUser.email,
      emailVerified: targetUser.emailVerified,
      emailDraftingEnabled: targetUser.emailDraftingEnabled
    }
  })

  return { success: true as const, user: targetUser }
}

export async function forceMarkManagedUserEmailVerified(params: {
  actorUserId: string
  targetUserId: string
  auditAction: string
  ip?: string
}) {
  const targetResult = await getManagedTargetUser(params.targetUserId)
  if (!targetResult.success) {
    return targetResult
  }
  const targetUser = targetResult.user

  if (targetUser.emailVerified) {
    return { success: true as const, changed: false, user: targetUser }
  }

  const updatedUser = await prisma.$transaction(async (tx) => {
    await tx.emailVerificationToken.deleteMany({ where: { userId: targetUser.id } })
    return tx.user.update({
      where: { id: targetUser.id },
      data: { emailVerified: true },
      select: {
        id: true,
        email: true,
        name: true,
        tenantId: true,
        emailVerified: true,
        emailDraftingEnabled: true
      }
    })
  })

  await createAuditLog({
    actorUserId: params.actorUserId,
    tenantId: targetUser.tenantId || undefined,
    action: params.auditAction,
    resource: `user:${targetUser.id}`,
    ip: params.ip,
    meta: {
      email: updatedUser.email,
      previousEmailVerified: targetUser.emailVerified,
      emailVerified: updatedUser.emailVerified
    }
  })

  return { success: true as const, changed: true, user: updatedUser }
}

export async function setManagedUserEmailDraftingEnabled(params: {
  actorUserId: string
  targetUserId: string
  enabled: boolean
  tenantId?: string
  auditAction: string
  ip?: string
}) {
  const targetResult = await getManagedTargetUser(params.targetUserId, params.tenantId)
  if (!targetResult.success) {
    return targetResult
  }
  const targetUser = targetResult.user

  if (params.enabled && !targetUser.emailVerified) {
    return { success: false as const, error: 'Email must be verified before enabling email drafting', code: 'EMAIL_NOT_VERIFIED' }
  }

  const updatedUser = await prisma.user.update({
    where: { id: targetUser.id },
    data: { emailDraftingEnabled: params.enabled },
    select: {
      id: true,
      email: true,
      emailVerified: true,
      emailDraftingEnabled: true
    }
  })

  await createAuditLog({
    actorUserId: params.actorUserId,
    tenantId: targetUser.tenantId || undefined,
    action: params.auditAction,
    resource: `user:${targetUser.id}`,
    ip: params.ip,
    meta: {
      email: updatedUser.email,
      previousEnabled: targetUser.emailDraftingEnabled,
      enabled: updatedUser.emailDraftingEnabled
    }
  })

  return { success: true as const, user: updatedUser }
}
