import { afterEach, describe, expect, it, vi } from 'vitest'
import { prisma } from './prisma'
import { recordIdeationNoveltyHandoff } from './ideation-novelty-handoff'
import { NoveltySearchService } from './novelty-search-service'

vi.mock('./metering/gateway', () => ({
  llmGateway: { executeLLMOperation: vi.fn() },
}))

function service() {
  const instance = new NoveltySearchService() as any
  instance.validateUser = vi.fn().mockResolvedValue({ id: 'user-1', tenantId: null })
  return instance
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    jwtToken: 'token',
    title: 'Approved invention',
    inventionDescription: 'A detailed invention disclosure.',
    jurisdiction: 'IN',
    config: {
      jurisdiction: 'IN',
      searchSource: { mode: 'INDIAN_ONLY', searchMode: 'intelligent', llmExpansion: true },
    },
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('NoveltySearchService approval gate', () => {
  it('prepares the query and features without creating a run or queue job', async () => {
    const svc = service()
    const proposed = {
      searchQuery: 'sensor calibration drift',
      inventionFeatures: ['A controller compensates sensor drift'],
    }
    svc.performStage0 = vi.fn().mockResolvedValue({ success: true, data: proposed })
    const transaction = vi.spyOn(prisma as any, '$transaction')

    const result = await svc.prepareNoveltySearch(request())

    expect(result).toMatchObject({ success: true, results: proposed })
    expect(svc.performStage0).toHaveBeenCalledOnce()
    expect(transaction).not.toHaveBeenCalled()
  })

  it('does not create a run or queue job before stage 0 is approved', async () => {
    const svc = service()
    const transaction = vi.spyOn(prisma as any, '$transaction')

    const result = await svc.enqueueNoveltySearch(request())

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('approve'),
    })
    expect(transaction).not.toHaveBeenCalled()
  })

  it('creates the run and queue job together after approval', async () => {
    const svc = service()
    const createRun = vi.fn().mockResolvedValue({ id: 'search-1' })
    const createJob = vi.fn().mockResolvedValue({ id: 'job-1' })
    vi.spyOn(prisma as any, '$transaction').mockImplementation(async (callback: any) => callback({
      noveltySearchRun: { create: createRun },
      noveltySearchJob: { create: createJob },
    }))

    const result = await svc.enqueueNoveltySearch(request({
      config: {
        jurisdiction: 'IN',
        sourceMetadata: {
          source: 'ideation',
          sessionId: 'session-1',
          ideaFrameId: 'idea-frame-1',
        },
        searchSource: { mode: 'INDIAN_ONLY', searchMode: 'intelligent', llmExpansion: true },
      },
      approvedStage0: {
        searchQuery: '  approved sensor query  ',
        inventionFeatures: ['  Approved feature  ', 'Approved feature'],
        featureDetails: [{
          feature: 'Original feature',
          user_disclosure: 'Original disclosure',
          technical_role: 'Core control function',
        }],
      },
    }))

    expect(result).toMatchObject({ success: true, searchId: 'search-1' })
    expect(createRun).toHaveBeenCalledOnce()
    expect(createRun.mock.calls[0][0].data.stage0Results).toMatchObject({
      searchQuery: 'approved sensor query',
      inventionFeatures: ['Approved feature'],
      featureDetails: [{ feature: 'Approved feature', user_disclosure: 'Approved feature' }],
    })
    expect(createRun.mock.calls[0][0].data.config.sourceMetadata).toMatchObject({
      source: 'ideation',
      sessionId: 'session-1',
      ideaFrameId: 'idea-frame-1',
    })
    expect(createJob).toHaveBeenCalledWith({
      data: { searchId: 'search-1', status: 'QUEUED', currentStep: 'STAGE_1' },
    })
  })

  it('records queued novelty search metadata on the source ideation frame', async () => {
    const findFirst = vi.spyOn(prisma.ideaFrame, 'findFirst').mockResolvedValue({
      id: 'idea-frame-1',
      noveltySummaryJson: { existing: true },
    } as any)
    const update = vi.spyOn(prisma.ideaFrame, 'update').mockResolvedValue({} as any)

    await recordIdeationNoveltyHandoff({
      searchId: 'search-1',
      userId: 'user-1',
      config: {
        sourceMetadata: {
          source: 'ideation',
          sessionId: 'session-1',
          ideaFrameId: 'idea-frame-1',
        },
      },
    })

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: 'idea-frame-1',
        sessionId: 'session-1',
        session: { userId: 'user-1' },
      },
      select: { id: true, noveltySummaryJson: true },
    })
    expect(update).toHaveBeenCalledOnce()
    const noveltySummaryJson = update.mock.calls[0]?.[0].data.noveltySummaryJson as any;
    expect(noveltySummaryJson).toMatchObject({
      existing: true,
      pipeline: {
        searchId: 'search-1',
        status: 'QUEUED',
      },
    })
    expect(noveltySummaryJson.pipeline.queuedAt).toEqual(expect.any(String))
  })
})
