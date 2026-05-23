import { describe, expect, test } from 'vitest';
import {
  buildNoveltyAutoStageState,
  getNextNoveltyAutoStage,
  isStage0EffectivelyApproved,
  type NoveltyAutoStageState,
} from '@/lib/novelty-auto-stage';

const runAction = (state: NoveltyAutoStageState) => getNextNoveltyAutoStage(state);

describe('novelty auto stage progression', () => {
  test('stops after Stage 0 until search terms are approved', () => {
    expect(runAction({ status: 'STAGE_0_COMPLETED', stage0Approved: false })).toEqual({
      type: 'stop',
      reason: 'NEEDS_STAGE0_APPROVAL',
    });
  });

  test('runs patent search after approved Stage 0', () => {
    expect(runAction({ status: 'STAGE_0_COMPLETED', stage0Approved: true })).toEqual({
      type: 'run',
      stageNumber: '1',
      visibleTab: '2',
    });
  });

  test('runs AI relevance after patent search results exist', () => {
    expect(runAction({
      status: 'STAGE_1_COMPLETED',
      stage0Approved: true,
      hasStage1Results: true,
    })).toEqual({
      type: 'run',
      stageNumber: '1.5',
      visibleTab: '3',
    });
  });

  test('stops when Stage 1 completed with no returned patents', () => {
    expect(runAction({
      status: 'STAGE_1_COMPLETED',
      currentStage: 'STAGE_4',
      stage0Approved: true,
      hasStage1Results: false,
    })).toEqual({
      type: 'stop',
      reason: 'NO_PATENTS',
    });
  });

  test('runs deep analysis after relevance is complete', () => {
    expect(runAction({
      status: 'STAGE_1_COMPLETED',
      stage0Approved: true,
      hasStage1Results: true,
      hasStage15Results: true,
    })).toEqual({
      type: 'run',
      stageNumber: '3',
      visibleTab: '4',
    });
  });

  test('runs final report after deep analysis is complete', () => {
    expect(runAction({
      status: 'STAGE_3_5_COMPLETED',
      stage0Approved: true,
      hasStage35Results: true,
    })).toEqual({
      type: 'run',
      stageNumber: '4',
      visibleTab: '5',
    });
  });

  test('completed searches have no next auto stage', () => {
    expect(runAction({ status: 'COMPLETED', hasStage4Results: true })).toEqual({
      type: 'stop',
      reason: 'COMPLETED',
    });
  });

  test('downstream results make Stage 0 effectively approved for resumed searches', () => {
    const state = buildNoveltyAutoStageState({
      status: 'STAGE_1_COMPLETED',
      currentStage: 'STAGE_3_5',
      results: {
        stage1: {
          pqaiResults: [{ publicationNumber: 'IN1' }],
        },
      },
    }, false);

    expect(isStage0EffectivelyApproved(state)).toBe(true);
    expect(state.stage0Approved).toBe(true);
  });
});
