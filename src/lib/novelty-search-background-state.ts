export type NoveltyPublicStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETE' | 'FAILED'

export function getNoveltyPublicStatus(run: { status?: string | null; backgroundJob?: { status?: string | null } | null }): NoveltyPublicStatus {
  if (run.backgroundJob?.status === 'QUEUED') return 'QUEUED'
  if (run.backgroundJob?.status === 'PROCESSING') return 'PROCESSING'
  if (run.backgroundJob?.status === 'FAILED' || run.status === 'FAILED') return 'FAILED'
  if (run.backgroundJob?.status === 'COMPLETED' || run.status === 'COMPLETED') return 'COMPLETE'
  return run.status === 'PENDING' ? 'QUEUED' : 'PROCESSING'
}

export function hasNoveltyRelevanceGate(stage1: any) {
  const gate = stage1?.aiRelevance
  return Boolean(gate && (gate.byPn || ['accepted', 'component', 'borderline', 'rejected'].some(key => Array.isArray(gate[key]))))
}

export function getVisibleNoveltyPatentCount(stage1: any) {
  if (Array.isArray(stage1?.visiblePriorArtResults)) return stage1.visiblePriorArtResults.length
  const gate = stage1?.aiRelevance || {}
  const routed = ['accepted', 'component', 'borderline']
    .reduce((count, key) => count + (Array.isArray(gate[key]) ? gate[key].length : 0), 0)
  if (routed > 0) return routed
  if (gate.byPn && typeof gate.byPn === 'object') {
    return Object.values(gate.byPn).filter((item: any) => ['accept', 'accepted', 'component', 'borderline'].includes(String(item?.decision || '').toLowerCase())).length
  }
  return 0
}

export function noveltyCheckpointFor(run: { stage0Results?: unknown; stage1Results?: unknown; stage35Results?: unknown }) {
  if (run.stage35Results) return { status: 'STAGE_3_5_COMPLETED', currentStage: 'STAGE_4' }
  if (run.stage1Results) return { status: 'STAGE_1_COMPLETED', currentStage: 'STAGE_3_5' }
  if (run.stage0Results) return { status: 'STAGE_0_COMPLETED', currentStage: 'STAGE_1' }
  return { status: 'PENDING', currentStage: 'STAGE_0' }
}
