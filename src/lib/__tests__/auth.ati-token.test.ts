import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const prisma = {
  aTIToken: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
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
  })

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
