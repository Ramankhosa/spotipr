import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

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

afterEach(() => {
  vi.unstubAllEnvs()
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CORE_PAYLOAD = {
  schemaVersion: 2,
  problem: 'Water use',
  objectives: 'Control irrigation',
  components: [{ name: 'Controller', description: 'controls irrigation' }],
  inventionType: ['ELECTRICAL'],
  patentTypePrimary: 'SYSTEM',
  logic: 'The controller actuates valves.',
  inputs: 'Soil moisture',
  outputs: 'Valve control',
  variants: 'Not stated by source',
  bestMethod: 'Not stated by source',
  fieldOfRelevance: 'Agriculture',
  subfield: 'Irrigation',
  drawingsFocus: 'Controller and valve flow',
  claimStrategy: 'System claim',
  coreInventiveConcept: 'Irrigation controller',
  claimableFeatures: [],
  fallbackLimitations: [],
  doNotClaim: [],
  riskFlags: 'Not stated by source',
  abstract: 'Smart Irrigation Controller. A controller actuates valves.',
  normalizationReviewWarnings: [],
}

const SEARCH_PAYLOAD = {
  searchQuery: 'smart irrigation controller using soil moisture valve control',
  googlePatentKeywords: [' smart irrigation controller ', 'soil moisture valve control'],
  epoTitleKeywords: ['irrigation controller'],
  epoAbstractKeywords: ['soil moisture valve control'],
  epoCombinedKeywords: ['water scheduling'],
  patentSearchConceptGroups: [
    { id: 'core', label: 'Core', kind: 'core', terms: ['irrigation controller', 'water scheduling device'], required: true },
    { id: 'mechanism', label: 'Mechanism', kind: 'mechanism', terms: ['soil moisture valve control'], required: true },
  ],
  cpcCodes: [],
  ipcCodes: [],
}

const SUPPORT_PAYLOAD = {
  sourceFactLedger: {},
  supportDataSources: [],
  normalizationReviewWarnings: [],
}

function llmResponse(payload: unknown, outputTokens: number) {
  return {
    success: true,
    response: {
      output: typeof payload === 'string' ? payload : JSON.stringify(payload),
      outputTokens,
      metadata: {},
    },
  }
}

/** Routes each mocked gateway call to a fixture using the sub-call purpose. */
function mockSplitCalls(overrides: {
  core?: unknown
  search?: unknown
  support?: unknown
  coreTokens?: number
  searchTokens?: number
  supportTokens?: number
} = {}) {
  executeLLMOperation.mockImplementation(async (_request: any, llmRequest: any) => {
    const purpose = String(llmRequest?.metadata?.purpose || '')
    if (purpose.endsWith('_search')) {
      return llmResponse(overrides.search ?? SEARCH_PAYLOAD, overrides.searchTokens ?? 20)
    }
    if (purpose.endsWith('_support')) {
      return llmResponse(overrides.support ?? SUPPORT_PAYLOAD, overrides.supportTokens ?? 30)
    }
    return llmResponse(overrides.core ?? CORE_PAYLOAD, overrides.coreTokens ?? 50)
  })
}

// ---------------------------------------------------------------------------
// Split flow (default)
// ---------------------------------------------------------------------------

describe('DraftingService.normalizeIdea (split calls)', () => {
  test('runs three sub-calls with distinct purposes against the same stage code', async () => {
    mockSplitCalls()

    const result = await DraftingService.normalizeIdea('A smart irrigation controller uses soil moisture valve control.', 'Smart Irrigation Controller')

    expect(result.success).toBe(true)
    expect(executeLLMOperation).toHaveBeenCalledTimes(3)

    const purposes = executeLLMOperation.mock.calls.map((call: any[]) => call[1]?.metadata?.purpose).sort()
    expect(purposes).toEqual(['idea_normalization_core', 'idea_normalization_search', 'idea_normalization_support'])

    executeLLMOperation.mock.calls.forEach((call: any[]) => {
      expect(call[1]).toMatchObject({ taskCode: 'LLM2_DRAFT', stageCode: 'DRAFT_IDEA_ENTRY' })
      expect(call[1].prompt).toBeTruthy()
    })
  })

  test('merges fields from all three sub-calls', async () => {
    mockSplitCalls()

    const result = await DraftingService.normalizeIdea('A smart irrigation controller uses soil moisture valve control.', 'Smart Irrigation Controller')

    expect(result.success).toBe(true)
    expect(result.extractedFields?.problem).toBe('Water use') // core
    expect(result.extractedFields?.searchQuery).toBe('smart irrigation controller using soil moisture valve control') // search
    expect(result.normalizedData?.supportDataSources).toBeDefined() // support
    expect(result.normalizedData?.sourceFactLedger).toBeDefined()
  })

  test('preserves patent search keywords and concept groups from Stage 0', async () => {
    mockSplitCalls()

    const result = await DraftingService.normalizeIdea('A smart irrigation controller uses soil moisture valve control.', 'Smart Irrigation Controller')

    expect(result.success).toBe(true)
    expect(result.extractedFields?.googlePatentKeywords).toEqual(['smart irrigation controller', 'soil moisture valve control'])
    expect(result.extractedFields?.epoTitleKeywords).toEqual(['irrigation controller'])
    expect(result.extractedFields?.patentSearchConceptGroups?.[0]).toMatchObject({
      label: 'Core',
      terms: ['irrigation controller', 'water scheduling device'],
      required: true,
    })
  })

  test('synthesizes scopeRecommendations from inline component scope and strips the inline copy', async () => {
    mockSplitCalls({
      core: {
        ...CORE_PAYLOAD,
        components: [
          {
            name: 'Controller',
            description: 'controls irrigation',
            scope: { claim: 'claim_1', numbering: 'number', figures: 'include', description: 'include' },
          },
        ],
        claimableFeatures: [
          { feature: 'Threshold-based shutdown', scope: { claim: 'dependent_claim' } },
        ],
      },
    })

    const result = await DraftingService.normalizeIdea('A smart irrigation controller uses soil moisture valve control.', 'Smart Irrigation Controller')

    expect(result.success).toBe(true)

    const elements = result.normalizedData?.scopeRecommendations?.elements || []
    expect(elements.length).toBeGreaterThan(0)
    expect(elements[0]).toMatchObject({
      label: 'Controller',
      sourceRefs: ['components[0]'],
      recommended: expect.objectContaining({ claim: 'claim_1' }),
    })

    // claimableFeatures must survive as plain strings for downstream coercion
    expect(result.normalizedData?.claimableFeatures).toEqual(['Threshold-based shutdown'])

    // The inline scope is not persisted on components
    result.normalizedData?.components?.forEach((component: any) => {
      expect(component).not.toHaveProperty('scope')
    })
  })

  test('sums output tokens and records a split telemetry envelope', async () => {
    mockSplitCalls({ coreTokens: 50, searchTokens: 20, supportTokens: 30 })

    const result = await DraftingService.normalizeIdea('A smart irrigation controller uses soil moisture valve control.', 'Smart Irrigation Controller')

    expect(result.tokensUsed).toBe(100)
    expect(result.llmResponse?.splitVersion).toBe(1)
    expect(Object.keys(result.llmResponse?.calls || {}).sort()).toEqual(['core', 'search', 'support'])
    expect(result.llmPrompt).toContain('=== CALL A: CORE ===')
    expect(result.llmPrompt).toContain('=== CALL B: SEARCH ===')
    expect(result.llmPrompt).toContain('=== CALL C: SUPPORT ===')
  })

  test('a stray field in one sub-call cannot clobber another call output', async () => {
    mockSplitCalls({
      search: {
        ...SEARCH_PAYLOAD,
        // Hallucinated fields owned by other calls must be ignored
        components: [{ name: 'Bogus Component From Search Call' }],
        problem: 'hallucinated problem',
      },
      support: {
        ...SUPPORT_PAYLOAD,
        components: [{ name: 'Bogus Component From Support Call' }],
      },
    })

    const result = await DraftingService.normalizeIdea('A smart irrigation controller uses soil moisture valve control.', 'Smart Irrigation Controller')

    expect(result.success).toBe(true)
    expect(result.extractedFields?.problem).toBe('Water use')
    expect(result.normalizedData?.components?.map((c: any) => c.name)).toEqual(['Controller'])
  })

  test('fails closed when the core sub-call returns unparseable JSON', async () => {
    mockSplitCalls({ core: 'not json at all' })

    const result = await DraftingService.normalizeIdea('A pump controller.', 'Pump Controller')

    expect(result.success).toBe(false)
    expect(result.normalizedData).toBeUndefined()
    expect(result.error).toContain('Failed to parse LLM response')
    expect(result.error).toContain('core')
  })

  test('fails closed when only the support sub-call returns unparseable JSON', async () => {
    mockSplitCalls({ support: 'still not json' })

    const result = await DraftingService.normalizeIdea('A pump controller.', 'Pump Controller')

    expect(result.success).toBe(false)
    expect(result.normalizedData).toBeUndefined()
    expect(result.error).toContain('support')
  })

  test('fails closed when a sub-call returns a gateway error', async () => {
    executeLLMOperation.mockImplementation(async (_request: any, llmRequest: any) => {
      const purpose = String(llmRequest?.metadata?.purpose || '')
      if (purpose.endsWith('_search')) {
        return { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'provider down' } }
      }
      if (purpose.endsWith('_support')) return llmResponse(SUPPORT_PAYLOAD, 30)
      return llmResponse(CORE_PAYLOAD, 50)
    })

    const result = await DraftingService.normalizeIdea('A pump controller.', 'Pump Controller')

    expect(result.success).toBe(false)
    expect(result.error).toContain('search')
    expect(result.error).toContain('provider down')
  })

  test('retries serially when a sub-call is rejected by the concurrency limit', async () => {
    let supportAttempts = 0
    executeLLMOperation.mockImplementation(async (_request: any, llmRequest: any) => {
      const purpose = String(llmRequest?.metadata?.purpose || '')
      if (purpose.endsWith('_search')) return llmResponse(SEARCH_PAYLOAD, 20)
      if (purpose.endsWith('_support')) {
        supportAttempts += 1
        if (supportAttempts === 1) {
          return { success: false, error: { code: 'CONCURRENCY_LIMIT', message: 'Too many concurrent LLM2_DRAFT operations. Limit: 1' } }
        }
        return llmResponse(SUPPORT_PAYLOAD, 30)
      }
      return llmResponse(CORE_PAYLOAD, 50)
    })

    const result = await DraftingService.normalizeIdea('A smart irrigation controller uses soil moisture valve control.', 'Smart Irrigation Controller')

    expect(result.success).toBe(true)
    expect(supportAttempts).toBe(2)
    expect(executeLLMOperation).toHaveBeenCalledTimes(4)
  })

  test('legacy executeDrafting persists normalized patent type on the session', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'user_1', email: 'user@example.com', tenantId: 'tenant_1' })
    prisma.patent.findFirst.mockResolvedValueOnce({ id: 'patent_1' })
    prisma.draftingSession.create.mockResolvedValueOnce({ id: 'session_1' })
    prisma.ideaRecord.create.mockResolvedValueOnce({})
    prisma.ideaRecord.update.mockResolvedValueOnce({})
    prisma.draftingSession.update.mockResolvedValueOnce({})
    mockSplitCalls({
      core: {
        ...CORE_PAYLOAD,
        components: [{ name: 'Control Step', description: 'controls pump' }],
        inventionType: ['MECHANICAL'],
        patentTypePrimary: 'PROCESS',
        problem: 'Pump control',
        objectives: 'Control pump operation',
        logic: 'A method controls pump operation.',
        fieldOfRelevance: 'Mechanical',
        subfield: 'Pump control',
        claimStrategy: 'Process claim',
        coreInventiveConcept: 'Pump control method',
        abstract: 'Pump Controller. A method controls pump operation.',
      },
      search: { ...SEARCH_PAYLOAD, searchQuery: 'pump controller method' },
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

// ---------------------------------------------------------------------------
// Legacy single-call rollback path
// ---------------------------------------------------------------------------

describe('DraftingService.normalizeIdea (IDEA_NORMALIZATION_SPLIT=false)', () => {
  beforeEach(() => {
    vi.stubEnv('IDEA_NORMALIZATION_SPLIT', 'false')
  })

  test('uses a single LLM call and returns the same contract', async () => {
    executeLLMOperation.mockResolvedValueOnce(llmResponse({
      ...CORE_PAYLOAD,
      ...SEARCH_PAYLOAD,
      ...SUPPORT_PAYLOAD,
    }, 100))

    const result = await DraftingService.normalizeIdea('A smart irrigation controller uses soil moisture valve control.', 'Smart Irrigation Controller')

    expect(executeLLMOperation).toHaveBeenCalledTimes(1)
    expect(executeLLMOperation.mock.calls[0][1]).toMatchObject({
      taskCode: 'LLM2_DRAFT',
      stageCode: 'DRAFT_IDEA_ENTRY',
      metadata: expect.objectContaining({ purpose: 'idea_normalization' }),
    })

    expect(result.success).toBe(true)
    expect(result.tokensUsed).toBe(100)
    expect(result.extractedFields?.problem).toBe('Water use')
    expect(result.extractedFields?.searchQuery).toBe('smart irrigation controller using soil moisture valve control')
    expect(result.extractedFields?.googlePatentKeywords).toEqual(['smart irrigation controller', 'soil moisture valve control'])
    expect(result.normalizedData?.patentTypePrimary).toBe('SYSTEM')
  })

  test('fails closed when LLM JSON cannot be parsed', async () => {
    executeLLMOperation.mockResolvedValueOnce(llmResponse('not json at all', 12))

    const result = await DraftingService.normalizeIdea('A pump controller.', 'Pump Controller')

    expect(result.success).toBe(false)
    expect(result.normalizedData).toBeUndefined()
    expect(result.error).toContain('Failed to parse LLM response')
  })
})
