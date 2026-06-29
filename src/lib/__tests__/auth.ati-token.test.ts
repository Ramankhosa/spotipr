import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const prisma = {
  aTIToken: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
}

vi.mock('@/lib/prisma', () => ({ prisma }))

async function loadAuth() {
  vi.resetModules()
  process.env.ATI_PEPPER = 'test-pepper-should-be-long-enough-for-hash'
  process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-32-chars-minimum'
  return import('@/lib/auth')
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2024-01-10T00:00:00.000Z'))
  vi.clearAllMocks()
  prisma.$transaction.mockImplementation(async (callback: any) => callback(prisma))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('validateATIToken', () => {
  test('marks expired tokens and rejects them', async () => {
    prisma.aTIToken.findFirst.mockResolvedValue({
      id: 'ati_1',
      status: 'ACTIVE',
      expiresAt: new Date('2024-01-01T00:00:00.000Z'),
      maxUses: null,
      usageCount: 0,
    })

    const { validateATIToken } = await loadAuth()
    const result = await validateATIToken('token_1')

    expect(result).toEqual({ valid: false, error: 'ATI_EXPIRED' })
    expect(prisma.aTIToken.update).toHaveBeenCalledWith({
      where: { id: 'ati_1' },
      data: { status: 'EXPIRED' },
    })
  }, 10000)

  test('marks used-up tokens and rejects them', async () => {
    prisma.aTIToken.findFirst.mockResolvedValue({
      id: 'ati_2',
      status: 'ACTIVE',
      expiresAt: new Date('2024-12-01T00:00:00.000Z'),
      maxUses: 3,
      usageCount: 3,
    })

    const { validateATIToken } = await loadAuth()
    const result = await validateATIToken('token_2')

    expect(result).toEqual({ valid: false, error: 'ATI_USED_UP' })
    expect(prisma.aTIToken.update).toHaveBeenCalledWith({
      where: { id: 'ati_2' },
      data: { status: 'USED_UP' },
    })
  })

  test('returns valid tokens without updating status', async () => {
    prisma.aTIToken.findFirst.mockResolvedValue({
      id: 'ati_3',
      status: 'ACTIVE',
      expiresAt: new Date('2024-12-01T00:00:00.000Z'),
      maxUses: null,
      usageCount: 0,
    })

    const { validateATIToken } = await loadAuth()
    const result = await validateATIToken('token_3')

    expect(result.valid).toBe(true)
    expect(prisma.aTIToken.update).not.toHaveBeenCalled()
  })
})

describe('consumeATITokenForSignup', () => {
  test('atomically consumes an available token', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 'ati_4', usageCount: 1, maxUses: 1 }])

    const { consumeATITokenForSignup } = await loadAuth()
    const result = await consumeATITokenForSignup(prisma, 'ati_4')

    expect(result).toEqual({ id: 'ati_4', usageCount: 1, maxUses: 1 })
    expect(prisma.aTIToken.findUnique).not.toHaveBeenCalled()
  })

  test('rejects a concurrently used-up token without creating another use', async () => {
    prisma.$queryRaw.mockResolvedValue([])
    prisma.aTIToken.findUnique.mockResolvedValue({
      id: 'ati_5',
      status: 'USED_UP',
      expiresAt: new Date('2024-12-01T00:00:00.000Z'),
      maxUses: 1,
      usageCount: 1,
    })

    const { consumeATITokenForSignup } = await loadAuth()

    await expect(consumeATITokenForSignup(prisma, 'ati_5')).rejects.toThrow('ATI_USED_UP')
    expect(prisma.aTIToken.update).toHaveBeenCalledWith({
      where: { id: 'ati_5' },
      data: { status: 'USED_UP' },
    })
  })

  test('marks expired tokens during atomic consume fallback', async () => {
    prisma.$queryRaw.mockResolvedValue([])
    prisma.aTIToken.findUnique.mockResolvedValue({
      id: 'ati_6',
      status: 'ACTIVE',
      expiresAt: new Date('2024-01-01T00:00:00.000Z'),
      maxUses: null,
      usageCount: 0,
    })

    const { consumeATITokenForSignup } = await loadAuth()

    await expect(consumeATITokenForSignup(prisma, 'ati_6')).rejects.toThrow('ATI_EXPIRED')
    expect(prisma.aTIToken.update).toHaveBeenCalledWith({
      where: { id: 'ati_6' },
      data: { status: 'EXPIRED' },
    })
  })
})
