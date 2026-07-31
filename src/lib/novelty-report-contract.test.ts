import { describe, expect, test, vi } from 'vitest';
import {
  buildCanonicalNoveltyVerdict,
  buildStage4ReportPromptFromRemarksV3,
  type AggregationResult,
} from './novelty-search-service';

vi.mock('./metering/gateway', () => ({
  llmGateway: { executeLLMOperation: vi.fn() },
}));

function aggregation(): AggregationResult {
  return {
    idea_id: 'idea-1',
    per_patent_coverage: [{ pn: 'US1', present_count: 2, partial_count: 0, absent_count: 0, coverage_ratio: 1 }],
    per_feature_uniqueness: [],
    integration_check: {
      any_single_patent_covers_majority: true,
      integration_pn: 'US1',
      explanation: 'US1 maps the important features.',
    },
    novelty_score: 0.2,
    decision: 'Not Novel',
    confidence: 'High',
    risk_factors: ['High single-reference overlap'],
    closest_mapped_references: ['US1'],
  };
}

describe('novelty report contract', () => {
  test('builds the actual Stage 4 prompt with deterministic server rules and resolved metadata', () => {
    const prompt = buildStage4ReportPromptFromRemarksV3({
      inventionFeatures: ['feature A'],
      perPatentRemarks: [{ pn: 'US1', novelty_threat: 'high_overlap' }],
      searchMetadata: { search_id: 'search-1', jurisdiction: 'IN' },
      metrics: { decision: 'Not Novel', confidence: 'High', novelty_score: 0.2 },
      mappedSupplementaryReferences: [{ pn: 'US2', novelty_threat: 'related' }],
      shortlistedUnmappedReferences: [{ pn: 'US3', gate_decision: 'component' }],
    });

    expect(prompt).toContain('The metrics decision, confidence, and novelty_score are deterministic server values');
    expect(prompt).toContain('"novelty_threat":"high_overlap"');
    expect(prompt).toContain('"search_id":"search-1"');
    expect(prompt).toContain('mapped_supplementary_references=[{"pn":"US2"');
    expect(prompt).toContain('shortlisted_unmapped_references=[{"pn":"US3"');
    expect(prompt).not.toContain('additional_patents_studied=');
    expect(prompt).not.toContain('SEARCH_ID');
  });

  test('forces degraded analysis to a single low-evidence verdict', () => {
    expect(buildCanonicalNoveltyVerdict(aggregation(), true)).toMatchObject({
      decision: 'Low Evidence',
      confidence: 'Low',
      degraded: true,
      decisiveReferences: ['US1'],
    });
  });
});
