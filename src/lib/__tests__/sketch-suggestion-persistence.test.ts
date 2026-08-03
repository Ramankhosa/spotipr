import { beforeEach, describe, expect, test, vi } from 'vitest'

const { sketchRecord, draftingSession } = vi.hoisted(() => ({
  sketchRecord: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  draftingSession: { findUnique: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sketchRecord,
    draftingSession,
    tenantPlan: { findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/metering/model-resolver', () => ({ resolveModel: vi.fn() }))
vi.mock('@/lib/metering/gateway', () => ({ llmGateway: {} }))
vi.mock('@/lib/metering/system', () => ({ createMeteringSystem: vi.fn() }))
vi.mock('@/lib/metering/auth-bridge', () => ({ extractTenantContextFromRequest: vi.fn() }))
vi.mock('@/lib/metering/cost-calculator', () => ({ CONTINGENCY_MULTIPLIER: 1.1 }))
vi.mock('@/lib/diagram-image-analysis', () => ({ cleanFigureDescriptionForDrafting: (value: unknown) => value }))

import { createSketchSuggestions, generateFromSuggestion } from '@/lib/sketch-service'

describe('persistent sketch suggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.GEMINI_SKETCH_MODEL
  })

  test('persists new suggestions and reuses matching saved templates', async () => {
    const existing = {
      id: 'suggestion-existing', patentId: 'patent-1', sessionId: 'session-1',
      status: 'SUGGESTED', title: 'Front view', description: 'Show the front assembly', isDeleted: false,
    }
    const created = {
      id: 'suggestion-new', patentId: 'patent-1', sessionId: 'session-1',
      status: 'SUGGESTED', title: 'Section view', description: 'Show the internal passage', isDeleted: false,
    }
    sketchRecord.findMany.mockResolvedValue([existing])
    sketchRecord.create.mockResolvedValue(created)

    const result = await createSketchSuggestions('patent-1', 'session-1', [
      { title: ' FRONT VIEW ', description: ' show the front assembly ' },
      { title: 'Section view', description: 'Show the internal passage' },
    ])

    expect(result.created).toBe(1)
    expect(result.sketchIds).toEqual(['suggestion-existing', 'suggestion-new'])
    expect(result.sketches).toEqual([existing, created])
    expect(sketchRecord.create).toHaveBeenCalledTimes(1)
  })

  test('creates a derived attempt without consuming the suggestion template', async () => {
    const suggestion = {
      id: 'suggestion-1', patentId: 'patent-1', sessionId: 'session-1',
      status: 'SUGGESTED', title: 'Exploded view', description: 'Separate the disclosed assemblies',
      session: { userId: 'user-1' },
    }
    sketchRecord.findUnique.mockResolvedValue(suggestion)
    sketchRecord.create.mockResolvedValue({ id: 'generated-1' })
    sketchRecord.update.mockResolvedValue({})
    draftingSession.findUnique.mockResolvedValue({
      patentTypePrimary: 'PRODUCT', jurisdictionDraftStatus: {}, activeJurisdiction: 'US',
      ideaRecord: { normalizedData: { title: 'Fixture invention' } },
      referenceMap: { components: [{ id: 'c1', name: 'Housing', referenceLabel: '100' }] },
      figurePlans: [], diagramSources: [], annexureDrafts: [],
    })

    const result = await generateFromSuggestion('suggestion-1', 'user-1')

    expect(sketchRecord.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'PENDING',
        sourceSketchId: 'suggestion-1',
        title: 'Exploded view',
      }),
    }))
    expect(sketchRecord.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'generated-1' },
      data: expect.objectContaining({ status: 'FAILED' }),
    }))
    expect(sketchRecord.update).not.toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'suggestion-1' },
    }))
    expect(result).toMatchObject({ success: false, sketchId: 'generated-1' })
  })
})
