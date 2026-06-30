import { beforeEach, describe, expect, test, vi } from 'vitest'

const prisma = vi.hoisted(() => ({
  usageLog: {
    findMany: vi.fn()
  },
  patentDraftingUsage: {
    findMany: vi.fn()
  },
  draftingSession: {
    findMany: vi.fn()
  },
  noveltySearchRun: {
    findMany: vi.fn()
  },
  ideaBankReservation: {
    findMany: vi.fn()
  },
  tenant: {
    findMany: vi.fn()
  },
  aTIToken: {
    findMany: vi.fn()
  },
  user: {
    findMany: vi.fn()
  },
  patent: {
    findMany: vi.fn()
  }
}))

const costCalculator = vi.hoisted(() => ({
  calculateCost: vi.fn(),
  ensurePricingLoaded: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({ prisma }))
vi.mock('@/lib/metering/cost-calculator', () => ({
  CONTINGENCY_MULTIPLIER: 1.1,
  calculateCost: costCalculator.calculateCost,
  ensurePricingLoaded: costCalculator.ensurePricingLoaded
}))

import { computeUnifiedAdminUsage } from '@/lib/admin-usage-service'
import {
  getDateOnlyMonthRange,
  getDateOnlyYearRange,
  normalizeUsageDateRange
} from '@/lib/usage-periods'

const date = (value: string) => new Date(value)

beforeEach(() => {
  vi.clearAllMocks()

  prisma.usageLog.findMany.mockResolvedValue([])
  prisma.patentDraftingUsage.findMany.mockResolvedValue([])
  prisma.draftingSession.findMany.mockResolvedValue([])
  prisma.noveltySearchRun.findMany.mockResolvedValue([])
  prisma.ideaBankReservation.findMany.mockResolvedValue([])
  prisma.tenant.findMany.mockResolvedValue([])
  prisma.aTIToken.findMany.mockResolvedValue([])
  prisma.user.findMany.mockResolvedValue([])
  prisma.patent.findMany.mockResolvedValue([])

  costCalculator.ensurePricingLoaded.mockResolvedValue(true)
  costCalculator.calculateCost.mockImplementation((
    modelCode: string,
    inputTokens: number,
    outputTokens: number,
    thoughtTokens?: number
  ) => ({
    inputTokens,
    outputTokens,
    thoughtTokens,
    totalTokens: inputTokens + outputTokens + (thoughtTokens || 0),
    inputCost: inputTokens * 0.001,
    outputCost: outputTokens * 0.002,
    thoughtCost: (thoughtTokens || 0) * 0.002,
    actualCost: inputTokens * 0.001 + outputTokens * 0.002 + (thoughtTokens || 0) * 0.002,
    contingencyCost: (inputTokens * 0.001 + outputTokens * 0.002 + (thoughtTokens || 0) * 0.002) * 1.1,
    modelCode,
    provider: 'Test',
    inputPricePerMillion: 1000,
    outputPricePerMillion: 2000
  }))
})

describe('admin usage service', () => {
  test('aggregates unified tenant and user usage with ATI context and actual costs', async () => {
    prisma.usageLog.findMany.mockResolvedValue([
      {
        tenantId: 'tenant_1',
        userId: 'user_1',
        inputTokens: 10,
        outputTokens: 5,
        apiCalls: 1,
        modelClass: 'MODEL_A',
        meta: { cost: { actualCost: 1.25 } },
        startedAt: date('2026-06-10T12:00:00.000Z')
      },
      {
        tenantId: 'tenant_1',
        userId: 'user_2',
        inputTokens: 4,
        outputTokens: 3,
        apiCalls: 2,
        modelClass: 'MODEL_A',
        meta: {},
        startedAt: date('2026-06-11T12:00:00.000Z')
      }
    ])

    prisma.patentDraftingUsage.findMany.mockResolvedValue([
      {
        tenantId: 'tenant_1',
        sessionId: 'session_1',
        patentId: 'patent_1',
        userId: 'user_1',
        hasDescription: true,
        hasClaims: true,
        isCounted: true,
        countedAt: date('2026-06-12T09:00:00.000Z'),
        createdAt: date('2026-05-30T09:00:00.000Z')
      },
      {
        tenantId: 'tenant_1',
        sessionId: 'session_2',
        patentId: 'patent_2',
        userId: 'user_2',
        hasDescription: true,
        hasClaims: false,
        isCounted: false,
        countedAt: null,
        createdAt: date('2026-06-15T09:00:00.000Z')
      },
      {
        tenantId: 'tenant_1',
        sessionId: 'session_3',
        patentId: 'patent_3',
        userId: 'user_2',
        hasDescription: true,
        hasClaims: true,
        isCounted: true,
        countedAt: date('2026-07-01T09:00:00.000Z'),
        createdAt: date('2026-06-18T09:00:00.000Z')
      }
    ])

    prisma.draftingSession.findMany.mockResolvedValue([
      {
        tenantId: 'tenant_1',
        userId: 'user_1',
        createdAt: date('2026-06-05T10:00:00.000Z')
      },
      {
        tenantId: 'tenant_1',
        userId: 'user_2',
        createdAt: date('2026-06-16T10:00:00.000Z')
      }
    ])

    prisma.noveltySearchRun.findMany.mockResolvedValue([
      { userId: 'user_1', user: { tenantId: 'tenant_1' } },
      { userId: 'user_2', user: { tenantId: 'tenant_1' } }
    ])

    prisma.ideaBankReservation.findMany.mockResolvedValue([
      { userId: 'user_2', user: { tenantId: 'tenant_1' } }
    ])

    prisma.tenant.findMany.mockResolvedValue([
      {
        id: 'tenant_1',
        name: 'Tenant One',
        atiId: 'ATI-ONE',
        type: 'ENTERPRISE',
        registrationSource: 'MANUAL_ATI'
      }
    ])

    prisma.aTIToken.findMany.mockResolvedValue([
      { id: 'ati_token_1', tenantId: 'tenant_1' },
      { id: 'ati_token_2', tenantId: 'tenant_1' }
    ])

    prisma.user.findMany.mockResolvedValue([
      {
        id: 'user_1',
        name: 'Ada Inventor',
        email: 'ada@example.com',
        tenantId: 'tenant_1',
        tenant: {
          id: 'tenant_1',
          name: 'Tenant One',
          atiId: 'ATI-ONE',
          type: 'ENTERPRISE',
          registrationSource: 'MANUAL_ATI'
        },
        signupAtiTokenId: 'signup_token_1',
        signupAtiToken: {
          id: 'signup_token_1',
          fingerprint: 'fp-signup-1'
        }
      },
      {
        id: 'user_2',
        name: 'Ben Searcher',
        email: 'ben@example.com',
        tenantId: 'tenant_1',
        tenant: {
          id: 'tenant_1',
          name: 'Tenant One',
          atiId: 'ATI-ONE',
          type: 'ENTERPRISE',
          registrationSource: 'MANUAL_ATI'
        },
        signupAtiTokenId: null,
        signupAtiToken: null
      }
    ])

    prisma.patent.findMany.mockResolvedValue([
      { id: 'patent_1', title: 'Counted Patent' },
      { id: 'patent_2', title: 'In Progress Patent' },
      { id: 'patent_3', title: 'Out Of Range Counted Patent' }
    ])

    const result = await computeUnifiedAdminUsage(
      date('2026-06-01T00:00:00.000Z'),
      date('2026-06-30T00:00:00.000Z')
    )

    expect(result.summary.totalInputTokens).toBe(14)
    expect(result.summary.totalOutputTokens).toBe(8)
    expect(result.summary.totalApiCalls).toBe(3)
    expect(result.summary.totalCost).toBeCloseTo(1.26)
    expect(result.summary.totalPatentsDrafted).toBe(1)
    expect(result.summary.totalDraftingSessionsStarted).toBe(2)
    expect(result.summary.totalPatentDraftsInProgress).toBe(1)
    expect(result.summary.totalNoveltySearches).toBe(2)
    expect(result.summary.totalIdeasReserved).toBe(1)

    expect(result.tenants).toHaveLength(1)
    expect(result.tenants[0]).toEqual(expect.objectContaining({
      tenantId: 'tenant_1',
      tenantName: 'Tenant One',
      tenantAtiId: 'ATI-ONE',
      registrationSource: 'MANUAL_ATI',
      atiTokenCount: 2,
      patentDrafts: 1,
      draftingSessionsStarted: 2,
      patentDraftsInProgress: 1,
      noveltySearches: 2,
      ideasReserved: 1
    }))
    expect(result.tenants[0].totalCost).toBeCloseTo(
      result.users.reduce((sum, user) => sum + user.totalCost, 0)
    )

    const userOne = result.users.find(user => user.userId === 'user_1')
    expect(userOne).toEqual(expect.objectContaining({
      tenantAtiId: 'ATI-ONE',
      registrationSource: 'MANUAL_ATI',
      signupAtiTokenId: 'signup_token_1',
      signupAtiFingerprint: 'fp-signup-1',
      patentsDrafted: 1,
      draftingSessionsStarted: 1,
      noveltySearches: 1
    }))

    const userTwo = result.users.find(user => user.userId === 'user_2')
    expect(userTwo).toEqual(expect.objectContaining({
      patentDraftsInProgress: 1,
      ideasReserved: 1,
      totalApiCalls: 2,
      totalCost: 0.01
    }))

    expect(result.patents.map(row => row.patentId)).toEqual(['patent_1', 'patent_2'])
    expect(costCalculator.calculateCost).toHaveBeenCalledTimes(1)
  })

  test('normalizes date-only custom, month, and year ranges without timezone drift', () => {
    const customRange = normalizeUsageDateRange('2026-06-01', '2026-06-30')
    expect(customRange.start.toISOString()).toBe('2026-06-01T00:00:00.000Z')
    expect(customRange.endInclusive.toISOString()).toBe('2026-06-30T23:59:59.999Z')
    expect(customRange.endExclusive.toISOString()).toBe('2026-07-01T00:00:00.000Z')

    expect(getDateOnlyMonthRange('2026-06')).toEqual({
      startDate: '2026-06-01',
      endDate: '2026-06-30'
    })
    expect(getDateOnlyYearRange('2026')).toEqual({
      startDate: '2026-01-01',
      endDate: '2026-12-31'
    })
  })
})
