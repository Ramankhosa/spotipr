import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NoveltyAssessmentStatus, NoveltyDetermination } from '@prisma/client'

const prisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  patent: { findFirst: vi.fn() },
  noveltyAssessmentRun: {
    create: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
  },
  noveltyAssessmentLLMCall: { create: vi.fn() },
  priorArtPatent: { findUnique: vi.fn() },
}))

const llmGateway = vi.hoisted(() => ({
  executeLLMOperation: vi.fn(),
}))

vi.mock('./prisma', () => ({ prisma }))
vi.mock('@/lib/prisma', () => ({ prisma }))
vi.mock('./metering/gateway', () => ({ llmGateway }))
vi.mock('@/lib/metering/gateway', () => ({ llmGateway }))
vi.mock('./auth', () => ({ verifyJWT: vi.fn(() => ({ sub: 'user-1', email: 'user@example.com' })) }))
vi.mock('@/lib/auth', () => ({ verifyJWT: vi.fn(() => ({ sub: 'user-1', email: 'user@example.com' })) }))

const request = {
  patentId: 'patent-1',
  jwtToken: 'jwt',
  inventionSummary: {
    title: 'Widget',
    problem: 'Existing widgets fail',
    solution: 'Improved widget',
  },
  intersectingPatents: [
    {
      publicationNumber: 'P1',
      title: 'Prior widget',
      abstract: 'A prior widget',
      relevance: 50,
    },
  ],
}

function llmResponse(output: string) {
  return {
    success: true,
    response: {
      output,
      outputTokens: 10,
      modelClass: 'test-model',
      metadata: {},
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  prisma.user.findUnique.mockImplementation(async ({ where }: any) => {
    if (where.id === 'user-1') return { id: 'user-1', email: 'user@example.com' }
    return null
  })
  prisma.patent.findFirst.mockResolvedValue({ id: 'patent-1', createdBy: 'user-1' })
  prisma.noveltyAssessmentRun.create.mockResolvedValue({ id: 'assessment-1' })
  prisma.noveltyAssessmentRun.update.mockResolvedValue({})
  prisma.noveltyAssessmentLLMCall.create.mockResolvedValue({})
  prisma.priorArtPatent.findUnique.mockResolvedValue(null)
})

describe('NoveltyAssessmentService.startAssessment', () => {
  it('resolves JWT subject as user id, not email', async () => {
    llmGateway.executeLLMOperation.mockResolvedValueOnce(llmResponse(JSON.stringify({
      overall_determination: 'NOVEL',
      patent_assessments: [{ publication_number: 'P1', relevance: 'LOW', reasoning: 'Different' }],
      summary_remarks: 'No close match',
    })))

    const { NoveltyAssessmentService } = await import('./novelty-assessment')
    const result = await NoveltyAssessmentService.startAssessment(request)

    expect(result.success).toBe(true)
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' }, select: { id: true } })
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' } })
    expect(prisma.user.findUnique).not.toHaveBeenCalledWith({ where: { email: 'user-1' } })
  })

  it('finalizes as NOVEL only when every required Stage 2 comparison succeeds as NOVEL', async () => {
    llmGateway.executeLLMOperation
      .mockResolvedValueOnce(llmResponse(JSON.stringify({
        overall_determination: 'DOUBT',
        patent_assessments: [{ publication_number: 'P1', relevance: 'MEDIUM', reasoning: 'Related' }],
        summary_remarks: 'Needs comparison',
      })))
      .mockResolvedValueOnce(llmResponse(JSON.stringify({
        determination: 'NOVEL',
        confidence_level: 'HIGH',
        novel_aspects: ['feature A'],
        non_novel_aspects: [],
        technical_reasoning: 'Distinguishing feature exists',
        suggestions: 'Proceed',
      })))

    const { NoveltyAssessmentService } = await import('./novelty-assessment')
    const result = await NoveltyAssessmentService.startAssessment(request)

    expect(result.success).toBe(true)
    expect(result.determination).toBe(NoveltyDetermination.NOVEL)
    expect(prisma.noveltyAssessmentRun.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: NoveltyAssessmentStatus.NOVEL,
        finalDetermination: NoveltyDetermination.NOVEL,
      }),
    }))
  })

  it('uses technical_reasoning and the weakest Stage 2 confidence', async () => {
    const twoPatentRequest = {
      ...request,
      intersectingPatents: [
        ...request.intersectingPatents,
        { publicationNumber: 'P2', title: 'Second prior widget', abstract: 'Another widget', relevance: 45 },
      ],
    }
    llmGateway.executeLLMOperation
      .mockResolvedValueOnce(llmResponse(JSON.stringify({
        overall_determination: 'DOUBT',
        patent_assessments: [
          { publication_number: 'P1', relevance: 'MEDIUM', reasoning: 'Related' },
          { publication_number: 'P2', relevance: 'MEDIUM', reasoning: 'Also related' },
        ],
        summary_remarks: 'Needs comparison',
      })))
      .mockResolvedValueOnce(llmResponse(JSON.stringify({
        determination: 'NOVEL',
        confidence_level: 'HIGH',
        novel_aspects: ['feature A'],
        non_novel_aspects: [],
        technical_reasoning: 'P1 leaves feature A undisclosed',
        suggestions: 'Proceed carefully',
      })))
      .mockResolvedValueOnce(llmResponse(JSON.stringify({
        determination: 'PARTIALLY_NOVEL',
        confidence_level: 'LOW',
        novel_aspects: ['feature B'],
        non_novel_aspects: ['feature C'],
        technical_reasoning: 'P2 overlaps feature C but not feature B',
        suggestions: 'Emphasize feature B',
      })))

    const { NoveltyAssessmentService } = await import('./novelty-assessment')
    const result = await NoveltyAssessmentService.startAssessment(twoPatentRequest)

    expect(result.success).toBe(true)
    expect(result.confidenceLevel).toBe('LOW')
    expect(result.remarks).toContain('P1 leaves feature A undisclosed')
    expect(result.remarks).toContain('P2 overlaps feature C but not feature B')
  })

  it('fails closed when a required Stage 2 comparison call fails', async () => {
    llmGateway.executeLLMOperation
      .mockResolvedValueOnce(llmResponse(JSON.stringify({
        overall_determination: 'DOUBT',
        patent_assessments: [{ publication_number: 'P1', relevance: 'MEDIUM', reasoning: 'Related' }],
        summary_remarks: 'Needs comparison',
      })))
      .mockResolvedValueOnce({ success: false, error: 'provider unavailable' })

    const { NoveltyAssessmentService } = await import('./novelty-assessment')
    const result = await NoveltyAssessmentService.startAssessment(request)

    expect(result.success).toBe(false)
    expect(prisma.noveltyAssessmentRun.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: NoveltyAssessmentStatus.FAILED,
        finalDetermination: NoveltyDetermination.DOUBT,
        stage2Results: expect.objectContaining({
          incomplete: true,
          failures: [expect.objectContaining({ publicationNumber: 'P1', reason: 'LLM_CALL_FAILED' })],
        }),
      }),
    }))
  })

  it('fails closed when Stage 2 returns unparsable JSON', async () => {
    llmGateway.executeLLMOperation
      .mockResolvedValueOnce(llmResponse(JSON.stringify({
        overall_determination: 'DOUBT',
        patent_assessments: [{ publication_number: 'P1', relevance: 'MEDIUM', reasoning: 'Related' }],
        summary_remarks: 'Needs comparison',
      })))
      .mockResolvedValueOnce(llmResponse('not-json'))

    const { NoveltyAssessmentService } = await import('./novelty-assessment')
    const result = await NoveltyAssessmentService.startAssessment(request)

    expect(result.success).toBe(false)
    expect(prisma.noveltyAssessmentRun.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: NoveltyAssessmentStatus.FAILED,
        finalDetermination: NoveltyDetermination.DOUBT,
        stage2Results: expect.objectContaining({
          incomplete: true,
          failures: [expect.objectContaining({ publicationNumber: 'P1', reason: 'JSON_PARSE_FAILED' })],
        }),
      }),
    }))
  })

  it('fails closed when Stage 1 returns an unexpected patent instead of the requested patent', async () => {
    llmGateway.executeLLMOperation.mockResolvedValueOnce(llmResponse(JSON.stringify({
      overall_determination: 'DOUBT',
      patent_assessments: [{ publication_number: 'MISSING', relevance: 'MEDIUM', reasoning: 'Related' }],
      summary_remarks: 'Needs comparison',
    })))

    const { NoveltyAssessmentService } = await import('./novelty-assessment')
    const result = await NoveltyAssessmentService.startAssessment(request)

    expect(result.success).toBe(false)
    expect(prisma.noveltyAssessmentRun.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: NoveltyAssessmentStatus.FAILED,
      }),
    }))
    expect(llmGateway.executeLLMOperation).toHaveBeenCalledTimes(1)
  })

  it('recomputes a contradictory Stage 1 headline from the per-patent relevance rows', async () => {
    llmGateway.executeLLMOperation.mockResolvedValueOnce(llmResponse(JSON.stringify({
      overall_determination: 'NOVEL',
      patent_assessments: [{ publication_number: 'P1', relevance: 'HIGH', reasoning: 'Teaches all elements' }],
      summary_remarks: 'Contradictory model headline',
    })))

    const { NoveltyAssessmentService } = await import('./novelty-assessment')
    const result = await NoveltyAssessmentService.startAssessment(request)

    expect(result.success).toBe(true)
    expect(result.determination).toBe(NoveltyDetermination.NOT_NOVEL)
    expect(prisma.noveltyAssessmentRun.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: NoveltyAssessmentStatus.NOT_NOVEL,
        finalDetermination: NoveltyDetermination.NOT_NOVEL,
      }),
    }))
  })
})

describe('NoveltyAssessmentService.performLevel1Assessment', () => {
  it('persists HIGH relevance as NOT_NOVEL status', async () => {
    llmGateway.executeLLMOperation.mockResolvedValueOnce(llmResponse(JSON.stringify({
      overall_determination: 'NOT_NOVEL',
      patent_assessments: [{ publication_number: 'P1', relevance: 'HIGH', reasoning: 'Teaches all elements' }],
      summary_remarks: 'Anticipated',
    })))

    const { NoveltyAssessmentService } = await import('./novelty-assessment')
    const result = await NoveltyAssessmentService.performLevel1Assessment({
      patentId: 'patent-1',
      runId: 'prior-art-run-1',
      jwtToken: 'jwt',
      inventionSummary: request.inventionSummary,
      level1Patents: [{
        publicationNumber: 'P1',
        title: 'Prior widget',
        abstract: 'A prior widget',
        relevance: 90,
        foundInVariants: ['v1'],
        intersectionType: 'semantic',
      }],
    })

    expect(result.determination).toBe(NoveltyDetermination.NOT_NOVEL)
    expect(prisma.noveltyAssessmentRun.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: NoveltyAssessmentStatus.NOT_NOVEL,
        finalDetermination: NoveltyDetermination.NOT_NOVEL,
      }),
    }))
  })
})
