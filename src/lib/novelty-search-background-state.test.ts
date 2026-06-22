import { describe, expect, it } from 'vitest'
import { getNoveltyPublicStatus, getVisibleNoveltyPatentCount, hasNoveltyRelevanceGate, noveltyCheckpointFor } from './novelty-search-background-state'

describe('novelty background state', () => {
  it('hides internal stages behind public processing states', () => {
    expect(getNoveltyPublicStatus({ status: 'STAGE_1_COMPLETED', backgroundJob: { status: 'PROCESSING' } })).toBe('PROCESSING')
    expect(getNoveltyPublicStatus({ status: 'COMPLETED', backgroundJob: { status: 'COMPLETED' } })).toBe('COMPLETE')
    expect(getNoveltyPublicStatus({ status: 'FAILED', backgroundJob: { status: 'FAILED' } })).toBe('FAILED')
    expect(getNoveltyPublicStatus({ status: 'PENDING', backgroundJob: { status: 'QUEUED' } })).toBe('QUEUED')
    expect(getNoveltyPublicStatus({ status: 'STAGE_1_COMPLETED', backgroundJob: { status: 'CANCELLED' } })).toBe('CANCELLED')
  })

  it('detects relevance gates and visible routing decisions', () => {
    const stage1 = { aiRelevance: { byPn: { A: { decision: 'accept' }, B: { decision: 'reject' }, C: { decision: 'component' } } } }
    expect(hasNoveltyRelevanceGate(stage1)).toBe(true)
    expect(getVisibleNoveltyPatentCount(stage1)).toBe(2)
    expect(getVisibleNoveltyPatentCount({ visiblePriorArtResults: [] })).toBe(0)
  })

  it('resumes from the latest persisted checkpoint', () => {
    expect(noveltyCheckpointFor({})).toEqual({ status: 'PENDING', currentStage: 'STAGE_0' })
    expect(noveltyCheckpointFor({ stage0Results: {} })).toEqual({ status: 'STAGE_0_COMPLETED', currentStage: 'STAGE_1' })
    expect(noveltyCheckpointFor({ stage0Results: {}, stage1Results: {} })).toEqual({ status: 'STAGE_1_COMPLETED', currentStage: 'STAGE_3_5' })
    expect(noveltyCheckpointFor({ stage35Results: {} })).toEqual({ status: 'STAGE_3_5_COMPLETED', currentStage: 'STAGE_4' })
  })
})
