import { beforeEach, describe, expect, test, vi } from 'vitest'

const prisma = vi.hoisted(() => ({
  usageLog: { findMany: vi.fn() },
  draftingSession: { findMany: vi.fn() },
  patent: { findMany: vi.fn() }
}))

const costCalculator = vi.hoisted(() => ({
  calculateCost: vi.fn(),
  ensurePricingLoaded: vi.fn(),
  isModelPriced: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({ prisma }))
vi.mock('@/lib/metering/cost-calculator', () => ({
  CONTINGENCY_MULTIPLIER: 1.1,
  calculateCost: costCalculator.calculateCost,
  ensurePricingLoaded: costCalculator.ensurePricingLoaded,
  isModelPriced: costCalculator.isModelPriced
}))

import { computePatentCosts } from '@/lib/admin-usage-service'

const date = (value: string) => new Date(value)

/** Every log carries its own cost in meta, so the expected totals are readable. */
const log = (over: Record<string, unknown>) => ({
  userId: 'user_1',
  startedAt: date('2026-06-10T12:00:00.000Z'),
  inputTokens: 100,
  outputTokens: 50,
  apiCalls: 1,
  modelClass: 'gpt-test',
  taskCode: 'LLM2_DRAFT',
  meta: { cost: { actualCost: 1 } },
  user: { id: 'user_1', name: 'Ada', email: 'ada@example.com' },
  ...over
})

beforeEach(() => {
  vi.clearAllMocks()
  prisma.usageLog.findMany.mockResolvedValue([])
  prisma.draftingSession.findMany.mockResolvedValue([])
  prisma.patent.findMany.mockResolvedValue([])
  costCalculator.ensurePricingLoaded.mockResolvedValue(true)
  costCalculator.isModelPriced.mockReturnValue(true)
  costCalculator.calculateCost.mockReturnValue({ actualCost: 0, contingencyCost: 0 })
})

describe('computePatentCosts', () => {
  test('attributes drafting logs through meta.sessionId when meta.patentId is absent', async () => {
    prisma.usageLog.findMany.mockResolvedValue([
      log({ meta: { patentId: 'patent_1', cost: { actualCost: 2 } } }),
      // Same patent, but only reachable via the session it was drafted in.
      log({ meta: { sessionId: 'session_1', cost: { actualCost: 3 } } })
    ])
    prisma.draftingSession.findMany.mockResolvedValue([
      {
        id: 'session_1',
        patentId: 'patent_1',
        userId: 'user_1',
        createdAt: date('2026-06-01T00:00:00.000Z'),
        patent: { id: 'patent_1', title: 'Widget' },
        user: { id: 'user_1', name: 'Ada', email: 'ada@example.com' }
      }
    ])

    const result = await computePatentCosts('tenant_1', date('2026-06-01'), date('2026-06-30'))

    expect(result.patents).toHaveLength(1)
    expect(result.patents[0].actualCost).toBe(5)
    expect(result.unattributed).toEqual([])
    expect(result.totals.tenantActualCost).toBe(5)
  })

  test('keeps non-patent runs (novelty, reports) in the totals instead of dropping them', async () => {
    prisma.usageLog.findMany.mockResolvedValue([
      log({ meta: { patentId: 'patent_1', cost: { actualCost: 2 } } }),
      log({
        taskCode: 'LLM5_NOVELTY_ASSESS',
        meta: { stageCode: 'NOVELTY_QUERY_GENERATION', cost: { actualCost: 4 } }
      }),
      log({
        taskCode: 'LLM5_NOVELTY_ASSESS',
        meta: { stageCode: 'NOVELTY_COMPARISON', cost: { actualCost: 1 } }
      }),
      log({ taskCode: 'LLM6_REPORT_GENERATION', meta: { cost: { actualCost: 3 } } })
    ])
    prisma.patent.findMany.mockResolvedValue([{ id: 'patent_1', title: 'Widget', createdBy: 'user_1' }])

    const result = await computePatentCosts('tenant_1', date('2026-06-01'), date('2026-06-30'))

    expect(result.totals.actualCost).toBe(2)
    expect(result.totals.unattributedActualCost).toBe(8)
    // The whole point: the panel total equals what the tenant was actually billed.
    expect(result.totals.tenantActualCost).toBe(10)
    expect(result.totals.tenantContingencyCost).toBeCloseTo(11)

    const novelty = result.unattributed.find(g => g.taskCode === 'LLM5_NOVELTY_ASSESS')
    expect(novelty).toMatchObject({ label: 'Novelty search & assessment', logCount: 2, actualCost: 5 })
    expect(novelty!.stageBreakdown.map(s => s.stage)).toEqual([
      'NOVELTY_QUERY_GENERATION',
      'NOVELTY_COMPARISON'
    ])
    // Sorted most expensive first.
    expect(result.unattributed.map(g => g.taskCode)).toEqual([
      'LLM5_NOVELTY_ASSESS',
      'LLM6_REPORT_GENERATION'
    ])
  })

  test('applies the 10% buffer to every row and keeps stage sums equal to their parent', async () => {
    prisma.usageLog.findMany.mockResolvedValue([
      log({ meta: { patentId: 'patent_1', stageCode: 'DRAFT_CLAIMS', cost: { actualCost: 2 } } }),
      log({ meta: { patentId: 'patent_1', stageCode: 'DRAFT_ABSTRACT', cost: { actualCost: 1 } } }),
      log({ taskCode: 'LLM8_OA_RESPONSE', meta: { stageCode: 'OA_DRAFT', cost: { actualCost: 5 } } })
    ])
    prisma.patent.findMany.mockResolvedValue([{ id: 'patent_1', title: 'Widget', createdBy: 'user_1' }])

    const result = await computePatentCosts('tenant_1', date('2026-06-01'), date('2026-06-30'))

    const patent = result.patents[0]
    expect(patent.contingencyCost).toBeCloseTo(patent.actualCost * 1.1)
    expect(patent.stageBreakdown.reduce((s, x) => s + x.actualCost, 0)).toBeCloseTo(patent.actualCost)
    for (const stage of patent.stageBreakdown) {
      expect(stage.contingencyCost).toBeCloseTo(stage.actualCost * 1.1)
    }

    const group = result.unattributed[0]
    expect(group.contingencyCost).toBeCloseTo(group.actualCost * 1.1)
    expect(group.stageBreakdown.reduce((s, x) => s + x.actualCost, 0)).toBeCloseTo(group.actualCost)
  })

  test('reports models that are billed at the fallback price', async () => {
    costCalculator.isModelPriced.mockImplementation((code: string) => code !== 'mystery-model')
    prisma.usageLog.findMany.mockResolvedValue([
      log({ modelClass: 'mystery-model', meta: { patentId: 'patent_1', cost: { actualCost: 1 } } }),
      log({ modelClass: 'mystery-model', meta: { cost: { actualCost: 1 } } }),
      log({ modelClass: 'gpt-test', meta: { cost: { actualCost: 1 } } })
    ])
    prisma.patent.findMany.mockResolvedValue([{ id: 'patent_1', title: 'Widget', createdBy: 'user_1' }])

    const result = await computePatentCosts('tenant_1', date('2026-06-01'), date('2026-06-30'))

    expect(result.pricingWarnings).toEqual([{ modelClass: 'mystery-model', logCount: 2 }])
  })

  test('seeds patent identity from the earliest session so rows are deterministic', async () => {
    prisma.draftingSession.findMany.mockResolvedValue([
      {
        id: 'session_late',
        patentId: 'patent_1',
        userId: 'user_2',
        createdAt: date('2026-06-20T00:00:00.000Z'),
        patent: { id: 'patent_1', title: 'Widget' },
        user: { id: 'user_2', name: 'Ben', email: 'ben@example.com' }
      },
      {
        id: 'session_early',
        patentId: 'patent_1',
        userId: 'user_1',
        createdAt: date('2026-06-02T00:00:00.000Z'),
        patent: { id: 'patent_1', title: 'Widget' },
        user: { id: 'user_1', name: 'Ada', email: 'ada@example.com' }
      }
    ])

    const result = await computePatentCosts('tenant_1', date('2026-06-01'), date('2026-06-30'))

    expect(result.patents).toHaveLength(1)
    expect(result.patents[0].userId).toBe('user_1')
    expect(result.patents[0].createdAt).toEqual(date('2026-06-02T00:00:00.000Z'))
  })

  test('returns empty, zeroed totals when there is no usage', async () => {
    const result = await computePatentCosts('tenant_1', date('2026-06-01'), date('2026-06-30'))

    expect(result.patents).toEqual([])
    expect(result.unattributed).toEqual([])
    expect(result.pricingWarnings).toEqual([])
    expect(result.totals.tenantActualCost).toBe(0)
    expect(result.totals.patentCount).toBe(0)
  })
})
