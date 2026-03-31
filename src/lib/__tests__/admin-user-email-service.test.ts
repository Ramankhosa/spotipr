import { beforeEach, describe, expect, test, vi } from 'vitest'

const prisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  emailVerificationToken: {
    deleteMany: vi.fn(),
    create: vi.fn(),
  },
  $transaction: vi.fn(async (input: Array<Promise<unknown> | unknown> | ((tx: any) => unknown)) => {
    if (typeof input === 'function') {
      return input(prisma)
    }
    return Promise.all(input)
  }),
}))

const createAuditLog = vi.hoisted(() => vi.fn())
const sendEmail = vi.hoisted(() => vi.fn())
const verificationTemplate = vi.hoisted(() =>
  vi.fn(() => ({
    subject: 'Verify your email',
    html: '<p>Verify</p>',
    text: 'Verify',
  }))
)
const generateToken = vi.hoisted(() => vi.fn(() => 'raw-token'))
const hashToken = vi.hoisted(() => vi.fn(() => 'hashed-token'))

vi.mock('@/lib/prisma', () => ({ prisma }))
vi.mock('@/lib/auth', () => ({ createAuditLog }))
vi.mock('@/lib/mailer', () => ({ sendEmail }))
vi.mock('@/lib/email-templates', () => ({ verificationTemplate }))
vi.mock('@/lib/token-utils', () => ({ generateToken, hashToken }))

import {
  forceMarkManagedUserEmailVerified,
  resendManagedUserEmailVerification,
  setManagedUserEmailDraftingEnabled,
  updateManagedUserEmail,
} from '@/lib/admin-user-email-service'

beforeEach(() => {
  vi.clearAllMocks()
  prisma.emailVerificationToken.deleteMany.mockResolvedValue({})
  prisma.emailVerificationToken.create.mockResolvedValue({})
})

describe('admin user email service', () => {
  test('changing a managed user email resets verification and email drafting access', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({
        id: 'user_1',
        email: 'old@example.com',
        name: 'Analyst',
        tenantId: 'tenant_1',
        roles: ['ANALYST'],
        emailVerified: true,
        emailDraftingEnabled: true,
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'user_1',
        email: 'new@example.com',
        name: 'Analyst',
      })

    prisma.user.update.mockResolvedValue({
      id: 'user_1',
      email: 'new@example.com',
      name: 'Analyst',
      tenantId: 'tenant_1',
      emailVerified: false,
      emailDraftingEnabled: false,
    })

    const result = await updateManagedUserEmail({
      actorUserId: 'admin_1',
      targetUserId: 'user_1',
      newEmail: 'NEW@example.com',
      tenantId: 'tenant_1',
      auditAction: 'tenant_admin.change_email',
      ip: '127.0.0.1',
    })

    expect(result).toMatchObject({
      success: true,
      changed: true,
      user: {
        email: 'new@example.com',
        emailVerified: false,
        emailDraftingEnabled: false,
      },
    })
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: {
        email: 'new@example.com',
        emailVerified: false,
        emailDraftingEnabled: false,
      },
      select: {
        id: true,
        email: true,
        name: true,
        tenantId: true,
        emailVerified: true,
        emailDraftingEnabled: true,
      },
    })
    expect(createAuditLog).toHaveBeenCalledTimes(1)
    expect(verificationTemplate).toHaveBeenCalledWith('new@example.com', 'Analyst', 'raw-token')
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  test('cannot enable email drafting for an unverified email address', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user_2',
      tenantId: 'tenant_1',
      roles: ['ANALYST'],
      email: 'user@example.com',
      emailVerified: false,
      emailDraftingEnabled: false,
    })

    const result = await setManagedUserEmailDraftingEnabled({
      actorUserId: 'admin_1',
      targetUserId: 'user_2',
      enabled: true,
      tenantId: 'tenant_1',
      auditAction: 'tenant_admin.set_email_drafting_enabled',
      ip: '127.0.0.1',
    })

    expect(result).toEqual({
      success: false,
      error: 'Email must be verified before enabling email drafting',
      code: 'EMAIL_NOT_VERIFIED',
    })
    expect(prisma.user.update).not.toHaveBeenCalled()
    expect(createAuditLog).not.toHaveBeenCalled()
  })

  test('resends verification email for an unverified managed user', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({
        id: 'user_3',
        email: 'pending@example.com',
        name: 'Pending User',
        tenantId: 'tenant_1',
        roles: ['ANALYST'],
        emailVerified: false,
        emailDraftingEnabled: false,
      })
      .mockResolvedValueOnce({
        id: 'user_3',
        email: 'pending@example.com',
        name: 'Pending User',
      })

    const result = await resendManagedUserEmailVerification({
      actorUserId: 'admin_1',
      targetUserId: 'user_3',
      tenantId: 'tenant_1',
      auditAction: 'tenant_admin.resend_verification_email',
      ip: '127.0.0.1',
    })

    expect(result).toMatchObject({
      success: true,
      user: {
        id: 'user_3',
        email: 'pending@example.com',
      },
    })
    expect(prisma.emailVerificationToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user_3' } })
    expect(prisma.emailVerificationToken.create).toHaveBeenCalledTimes(1)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(createAuditLog).toHaveBeenCalledTimes(1)
  })

  test('superadmin can force mark a managed user email as verified', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user_4',
      email: 'force@example.com',
      name: 'Force User',
      tenantId: 'tenant_1',
      roles: ['ANALYST'],
      emailVerified: false,
      emailDraftingEnabled: false,
    })

    prisma.user.update.mockResolvedValue({
      id: 'user_4',
      email: 'force@example.com',
      name: 'Force User',
      tenantId: 'tenant_1',
      emailVerified: true,
      emailDraftingEnabled: false,
    })

    const result = await forceMarkManagedUserEmailVerified({
      actorUserId: 'superadmin_1',
      targetUserId: 'user_4',
      auditAction: 'platform.force_mark_email_verified',
      ip: '127.0.0.1',
    })

    expect(result).toMatchObject({
      success: true,
      changed: true,
      user: {
        id: 'user_4',
        emailVerified: true,
      },
    })
    expect(prisma.emailVerificationToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user_4' } })
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user_4' },
      data: { emailVerified: true },
      select: {
        id: true,
        email: true,
        name: true,
        tenantId: true,
        emailVerified: true,
        emailDraftingEnabled: true,
      },
    })
    expect(createAuditLog).toHaveBeenCalledTimes(1)
  })
})
