import { getRawStage1SearchResults } from './novelty-stage1-results';

export type NoveltyAutoStageNumber = '1' | '1.5' | '3' | '4';
export type NoveltyAutoVisibleTab = '2' | '3' | '4' | '5';

export type NoveltyAutoStopReason =
  | 'START_REQUIRED'
  | 'NEEDS_STAGE0_APPROVAL'
  | 'NO_PATENTS'
  | 'FAILED'
  | 'COMPLETED'
  | 'NO_NEXT_STAGE';

export interface NoveltyAutoStageState {
  status?: string | null;
  currentStage?: string | null;
  stage0Approved?: boolean;
  hasStage1Results?: boolean;
  hasStage15Results?: boolean;
  hasVisiblePriorArtResults?: boolean;
  hasBorderlinePriorArtResults?: boolean;
  stage15GateStatus?: string | null;
  hasStage35Results?: boolean;
  hasStage4Results?: boolean;
}

export type NoveltyAutoStageAction =
  | { type: 'run'; stageNumber: NoveltyAutoStageNumber; visibleTab: NoveltyAutoVisibleTab }
  | { type: 'stop'; reason: NoveltyAutoStopReason };

export const NOVELTY_AUTO_STOP_MESSAGES: Record<NoveltyAutoStopReason, string> = {
  START_REQUIRED: 'Start the novelty search from Idea Setup first.',
  NEEDS_STAGE0_APPROVAL: 'Approve the generated search terms before auto-running the remaining stages.',
  NO_PATENTS: 'No high-confidence prior-art matches were found. Adjust the search query or review more candidates before continuing.',
  FAILED: 'Auto-run stopped because the novelty search is in a failed state.',
  COMPLETED: 'Novelty search is already complete.',
  NO_NEXT_STAGE: 'No remaining auto-run stage was found.',
};

export function isStage0EffectivelyApproved(state: NoveltyAutoStageState): boolean {
  return Boolean(
    state.stage0Approved ||
    state.hasStage1Results ||
    state.hasStage15Results ||
    state.hasStage35Results ||
    state.hasStage4Results ||
    state.status === 'STAGE_1_COMPLETED' ||
    state.status === 'STAGE_3_5_COMPLETED' ||
    state.status === 'COMPLETED'
  );
}

export function getStage1ResultsFromNoveltyResults(results: any): any[] {
  return getRawStage1SearchResults(results);
}

export function hasStage15ResultsInNoveltyResults(results: any): boolean {
  const root = results || {};
  const gate = root.aiRelevance || root.stage1?.aiRelevance;
  return Boolean(
    gate &&
    (
      Array.isArray(gate.accepted) ||
      Array.isArray(gate.component) ||
      Array.isArray(gate.borderline) ||
      Array.isArray(gate.rejected)
    )
  );
}

export function hasStage35ResultsInNoveltyResults(results: any): boolean {
  const root = results || {};
  const carrier = root.stage35 || root.stage3_5 || root;
  const featureMap = carrier?.feature_map || root.feature_map;
  const hasMapping = Array.isArray(featureMap) && featureMap.length > 0;
  const stage4 = root.stage4 || root;
  const hasAggregation = Boolean(
    stage4?.per_patent_coverage ||
    stage4?.per_feature_uniqueness ||
    stage4?.feature_coverage_summary
  );
  const remarks = Array.isArray(stage4?.per_patent_remarks) ? stage4.per_patent_remarks : [];
  const hasDetailedRemarks = Boolean(
    remarks.length > 0 &&
    (
      stage4?.stage35c_complete === true ||
      stage4?.per_patent_remarks_source === 'stage35c' ||
      (
        stage4?.per_patent_remarks_source !== 'stage35b_deterministic' &&
        stage4?.per_patent_remarks_source !== 'stage4_deterministic_fallback' &&
        remarks.some((remark: any) => (
          remark?.detailedAnalysis ||
          typeof remark?.relevance === 'number' ||
          typeof remark?.novelty_threat === 'string'
        ))
      )
    )
  );

  return hasMapping && hasAggregation && hasDetailedRemarks;
}

export function hasStage4ResultsInNoveltyResults(results: any): boolean {
  const root = results || {};
  const report = root.stage4 || root;
  return Boolean(
    report?.executive_summary ||
    report?.concluding_remarks ||
    report?.final_assessment ||
    report?.report_metadata
  );
}

export function buildNoveltyAutoStageState(
  search: { status?: string | null; currentStage?: string | null; results?: any },
  stage0Approved: boolean
): NoveltyAutoStageState {
  const results = search.results;
  const root = results || {};
  const gate = root.aiRelevance || root.stage1?.aiRelevance;
  const visiblePriorArt = root.visiblePriorArtResults || root.stage1?.visiblePriorArtResults || root.pqaiResults || root.stage1?.pqaiResults;
  const state: NoveltyAutoStageState = {
    status: search.status,
    currentStage: search.currentStage,
    stage0Approved,
    hasStage1Results: getStage1ResultsFromNoveltyResults(results).length > 0,
    hasStage15Results: hasStage15ResultsInNoveltyResults(results),
    hasVisiblePriorArtResults: Array.isArray(visiblePriorArt) && visiblePriorArt.length > 0,
    hasBorderlinePriorArtResults: (Array.isArray(gate?.component) && gate.component.length > 0) || (Array.isArray(gate?.borderline) && gate.borderline.length > 0),
    stage15GateStatus: typeof gate?.gateStatus === 'string' ? gate.gateStatus : null,
    hasStage35Results: hasStage35ResultsInNoveltyResults(results),
    hasStage4Results: hasStage4ResultsInNoveltyResults(results),
  };

  return {
    ...state,
    stage0Approved: isStage0EffectivelyApproved(state),
  };
}

export function getNextNoveltyAutoStage(state: NoveltyAutoStageState): NoveltyAutoStageAction {
  if (!state.status || state.status === 'PENDING') {
    return { type: 'stop', reason: 'START_REQUIRED' };
  }
  if (state.status === 'FAILED') {
    return { type: 'stop', reason: 'FAILED' };
  }
  if (state.status === 'COMPLETED' || state.hasStage4Results) {
    return { type: 'stop', reason: 'COMPLETED' };
  }
  if (!isStage0EffectivelyApproved(state)) {
    return { type: 'stop', reason: 'NEEDS_STAGE0_APPROVAL' };
  }

  if (state.status === 'STAGE_0_COMPLETED') {
    if (!state.hasStage1Results) return { type: 'run', stageNumber: '1', visibleTab: '2' };
    if (!state.hasStage15Results) return { type: 'run', stageNumber: '1.5', visibleTab: '3' };
    if (state.hasVisiblePriorArtResults === false && !state.hasBorderlinePriorArtResults && state.stage15GateStatus !== 'failed') return { type: 'stop', reason: 'NO_PATENTS' };
    if (!state.hasStage35Results) return { type: 'run', stageNumber: '3', visibleTab: '4' };
    return { type: 'run', stageNumber: '4', visibleTab: '5' };
  }

  if (state.status === 'STAGE_1_COMPLETED') {
    if (!state.hasStage1Results && state.currentStage === 'STAGE_4') {
      return { type: 'stop', reason: 'NO_PATENTS' };
    }
    if (!state.hasStage1Results) return { type: 'run', stageNumber: '1', visibleTab: '2' };
    if (!state.hasStage15Results) return { type: 'run', stageNumber: '1.5', visibleTab: '3' };
    if (state.hasVisiblePriorArtResults === false && !state.hasBorderlinePriorArtResults && state.stage15GateStatus !== 'failed') return { type: 'stop', reason: 'NO_PATENTS' };
    if (!state.hasStage35Results) return { type: 'run', stageNumber: '3', visibleTab: '4' };
    return { type: 'run', stageNumber: '4', visibleTab: '5' };
  }

  if (state.status === 'STAGE_3_5_COMPLETED') {
    if (!state.hasStage35Results) return { type: 'run', stageNumber: '3', visibleTab: '4' };
    return { type: 'run', stageNumber: '4', visibleTab: '5' };
  }

  return { type: 'stop', reason: 'NO_NEXT_STAGE' };
}
