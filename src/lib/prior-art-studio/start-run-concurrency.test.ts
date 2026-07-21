import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { state, prismaMock } = vi.hoisted(() => {
  const state: { liveRun: { id: string; sessionId: string; status: string; createdAt: Date } | null } = {
    liveRun: null,
  }
  const prismaMock = {
    priorArtStudioRun: {
      create: vi.fn(async ({ data }: any) => {
        if (state.liveRun) throw Object.assign(new Error('unique conflict'), { code: 'P2002' })
        state.liveRun = { id: 'run-1', sessionId: data.sessionId, status: 'RUNNING', createdAt: new Date() }
        return state.liveRun
      }),
      findFirst: vi.fn(async () => state.liveRun),
      update: vi.fn(),
    },
  }
  return { state, prismaMock }
})

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/patent-search', () => ({ patentSearchOrchestrator: { search: vi.fn() } }))
vi.mock('@/lib/patent-corpus-service', () => ({ hasSearchEmbeddingApiKey: vi.fn(() => false) }))
vi.mock('./element-scoring', () => ({ scoreElements: vi.fn() }))
vi.mock('@/lib/service-usage-tracker', () => ({ trackServiceUsage: vi.fn() }))

import { startStudioRun } from './service'
import { emptyStudioPlan } from './types'

describe('startStudioRun concurrency', () => {
  beforeEach(() => {
    state.liveRun = null
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('creates one live run and returns its id to a simultaneous caller', async () => {
    const plan = emptyStudioPlan()
    plan.title = 'Sensor search'
    plan.blocks = [{
      id: 'sensor',
      label: 'Sensor',
      mode: 'MATCH',
      terms: [{ text: 'optical sensor', origin: 'user', accepted: true }],
    }]
    const input = {
      sessionId: 'session-1',
      userId: 'user-1',
      plan,
      planVersion: 1,
      requestHeaders: {},
    }

    const results = await Promise.all([startStudioRun(input), startStudioRun(input)])
    expect(prismaMock.priorArtStudioRun.create).toHaveBeenCalledTimes(2)
    expect(results.map(result => result.runId)).toEqual(['run-1', 'run-1'])
    expect(results.filter(result => !result.existing)).toHaveLength(1)
    expect(results.filter(result => result.existing)).toHaveLength(1)
  })
})
