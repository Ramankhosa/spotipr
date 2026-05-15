import { beforeEach, describe, expect, test, vi } from 'vitest'

const executeLLMOperation = vi.hoisted(() => vi.fn())
const prisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
  patent: {
    findFirst: vi.fn(),
  },
  draftingSession: {
    create: vi.fn(),
    update: vi.fn(),
  },
  ideaRecord: {
    create: vi.fn(),
    update: vi.fn(),
  },
}))
const verifyJWT = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma }))
vi.mock('@/lib/auth', () => ({ verifyJWT }))
vi.mock('@/lib/metering/gateway', () => ({
  llmGateway: {
    executeLLMOperation,
  },
}))

import { DraftingService } from '@/lib/drafting-service'

beforeEach(() => {
  vi.clearAllMocks()
  verifyJWT.mockReturnValue({ email: 'user@example.com' })
})

describe('DraftingService.normalizeIdea', () => {
  test('fails closed when LLM JSON cannot be parsed', async () => {
    executeLLMOperation.mockResolvedValueOnce({
      success: true,
      response: {
        output: 'not json at all',
        outputTokens: 12,
        metadata: {},
      },
    })

    const result = await DraftingService.normalizeIdea('A pump controller.', 'Pump Controller')

    expect(result.success).toBe(false)
    expect(result.normalizedData).toBeUndefined()
    expect(result.error).toContain('Failed to parse LLM response')
  })

  test('legacy executeDrafting persists normalized patent type on the session', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'user_1', email: 'user@example.com', tenantId: 'tenant_1' })
    prisma.patent.findFirst.mockResolvedValueOnce({ id: 'patent_1' })
    prisma.draftingSession.create.mockResolvedValueOnce({ id: 'session_1' })
    prisma.ideaRecord.create.mockResolvedValueOnce({})
    prisma.ideaRecord.update.mockResolvedValueOnce({})
    prisma.draftingSession.update.mockResolvedValueOnce({})
    executeLLMOperation.mockResolvedValueOnce({
      success: true,
      response: {
        output: JSON.stringify({
          schemaVersion: 2,
          searchQuery: 'pump controller method',
          problem: 'Pump control',
          objectives: 'Control pump operation',
          components: [{ name: 'Control Step', description: 'controls pump' }],
          inventionType: ['MECHANICAL'],
          patentTypePrimary: 'PROCESS',
          logic: 'A method controls pump operation.',
          inputs: 'Not stated by source',
          outputs: 'Not stated by source',
          variants: 'Not stated by source',
          bestMethod: 'Not stated by source',
          fieldOfRelevance: 'Mechanical',
          subfield: 'Pump control',
          drawingsFocus: 'Method flow',
          claimStrategy: 'Process claim',
          coreInventiveConcept: 'Pump control method',
          claimableFeatures: [],
          fallbackLimitations: [],
          doNotClaim: [],
          riskFlags: 'Not stated by source',
          abstract: 'Pump Controller. A method controls pump operation.',
          cpcCodes: [],
          ipcCodes: [],
          sourceFactLedger: {},
          supportDataSources: [],
          normalizationReviewWarnings: [],
        }),
        outputTokens: 100,
        metadata: {},
      },
    })

    const result = await DraftingService.executeDrafting({
      patentId: 'patent_1',
      jwtToken: 'token',
      mode: 'standalone',
      title: 'Pump Controller',
      problem: 'Pump control',
      solution: 'Control pump operation',
      technicalFeatures: ['control step'],
      jurisdiction: 'US',
      filingType: 'provisional',
    })

    expect(result.success).toBe(true)
    expect(prisma.draftingSession.update).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: 'session_1' },
      data: expect.objectContaining({
        patentTypePrimary: 'PROCESS',
        patentTypeDecidedAt: expect.any(Date),
        patentTypeComponentsHash: expect.any(String),
      }),
    }))
  })
})
