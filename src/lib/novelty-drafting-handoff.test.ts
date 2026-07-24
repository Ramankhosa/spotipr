import { describe, expect, it } from 'vitest';
import {
  buildAiAnalysisMap,
  buildNoveltyDraftingPayload,
  buildNoveltyGuidanceBlock,
  normalizeHandoffThreat,
  parseIdeaRefinementResponse,
  rankCitationsForClaimRefinement,
  splitEntityList,
  threatTag,
  toRelatedArtResultSeed,
  type NoveltyHandoffCitation,
} from './novelty-drafting-handoff';

/**
 * Minimal completed novelty run: two feature-mapped references with opposite overlap profiles,
 * plus the Stage 0/1/3.5/4 scaffolding buildNoveltyAttorneyReportModel expects.
 */
function buildSearchRunFixture() {
  const anticipating = 'IN202600001';
  const distant = 'IN202600002';

  return {
    id: 'search-1',
    title: 'Adaptive pump controller',
    jurisdiction: 'IN',
    inventionDescription: 'A controller adjusts pump speed using a pressure sensor and a thermal model.',
    config: { searchSource: { includePatents: true, includePapers: false, mode: 'INDIAN_ONLY' } },
    stage0Results: {
      searchQuery: 'adaptive pump controller pressure thermal',
      inventionFeatures: [
        'A pressure sensor measuring line pressure',
        'A thermal model predicting pump temperature',
        'A controller adjusting pump speed from the thermal model',
      ],
    },
    stage1Results: {
      retrievalCandidates: [
        {
          id: anticipating,
          pn: anticipating,
          publicationNumber: anticipating,
          title: 'Pump control using pressure feedback',
          abstract: 'A pressure sensor measures line pressure and a controller adjusts pump speed.',
          publicationDate: '2020-05-01',
          cpcCodes: ['F04B 49/06', 'G05B 13/02'],
          ipcCodes: ['F04B 49/06'],
          inventors: 'A. Inventor, B. Inventor',
          assignees: 'Pumps Ltd',
        },
        {
          id: distant,
          pn: distant,
          publicationNumber: distant,
          title: 'Thermal monitoring of rotating machinery',
          abstract: 'A thermal sensor reports bearing temperature for maintenance scheduling.',
          publicationDate: '2019-02-11',
          cpcCodes: ['G01K 13/08'],
          ipcCodes: ['G01K 13/08'],
          inventors: 'C. Inventor',
          assignees: 'Thermal Corp',
        },
      ],
      patentCount: 2,
      paperCount: 0,
      aiRelevance: {
        byPn: {
          [anticipating]: { pn: anticipating, decision: 'accept', score: 0.92, evidence_quality: 'high' },
          [distant]: { pn: distant, decision: 'accept', score: 0.41, evidence_quality: 'medium' },
        },
        accepted: [anticipating, distant],
      },
    },
    stage35Results: {
      feature_map: [
        {
          pn: anticipating,
          title: 'Pump control using pressure feedback',
          // FeatureMapCell carries the supporting passage on `quote`/`field`; a cell with no
          // quote is downgraded to Unknown/Absent by the report model.
          feature_analysis: [
            { feature: 'A pressure sensor measuring line pressure', status: 'Present', quote: 'a pressure sensor measures line pressure and reports it to the controller', field: 'abstract', confidence: 0.9 },
            { feature: 'A thermal model predicting pump temperature', status: 'Absent', quote: '', field: '', confidence: 0.8 },
            { feature: 'A controller adjusting pump speed from the thermal model', status: 'Partial', quote: 'a controller adjusts pump speed responsive to the measured pressure', field: 'abstract', confidence: 0.7 },
          ],
        },
        {
          pn: distant,
          title: 'Thermal monitoring of rotating machinery',
          feature_analysis: [
            { feature: 'A pressure sensor measuring line pressure', status: 'Absent', quote: '', field: '', confidence: 0.8 },
            { feature: 'A thermal model predicting pump temperature', status: 'Absent', quote: '', field: '', confidence: 0.7 },
            { feature: 'A controller adjusting pump speed from the thermal model', status: 'Absent', quote: '', field: '', confidence: 0.7 },
          ],
        },
      ],
    },
    stage4Results: {
      decision: 'Partially Novel',
      confidence: 'Medium',
      per_patent_remarks: [
        {
          pn: anticipating,
          title: 'Pump control using pressure feedback',
          novelty_threat: 'anticipates',
          remarks: 'Teaches pressure-based pump control but not the thermal model relationship.',
          summary: 'Teaches pressure-based pump control but not the thermal model relationship.',
          overlap_features: ['A pressure sensor measuring line pressure'],
          missing_features: ['A thermal model predicting pump temperature'],
        },
        {
          pn: distant,
          title: 'Thermal monitoring of rotating machinery',
          novelty_threat: 'remote',
          remarks: 'Monitors temperature for maintenance, not for pump speed control.',
          summary: 'Monitors temperature for maintenance, not for pump speed control.',
          overlap_features: [],
          missing_features: ['A controller adjusting pump speed from the thermal model'],
        },
      ],
      concluding_remarks: {
        strategic_recommendations: ['Claim the thermal-model-to-speed control relationship explicitly.'],
      },
    },
  };
}

describe('normalizeHandoffThreat', () => {
  it('maps raw assessment decisions into the drafting threat vocabulary', () => {
    expect(normalizeHandoffThreat('anticipates')).toBe('anticipates');
    expect(normalizeHandoffThreat('NOT_NOVEL')).toBe('anticipates');
    expect(normalizeHandoffThreat('obvious')).toBe('obvious');
    expect(normalizeHandoffThreat('partially novel')).toBe('obvious');
    expect(normalizeHandoffThreat('adjacent')).toBe('adjacent');
    expect(normalizeHandoffThreat('remote')).toBe('remote');
  });

  it('falls back to the overlap risk level when the raw decision is unassessed', () => {
    // The report model stores 'unassessed' whenever Stage 4 produced no per-patent threat.
    expect(normalizeHandoffThreat('unassessed', 'High')).toBe('anticipates');
    expect(normalizeHandoffThreat('unassessed', 'Medium')).toBe('adjacent');
    expect(normalizeHandoffThreat('unassessed', 'Low')).toBe('remote');
    expect(normalizeHandoffThreat('unassessed', 'Needs Review')).toBe('unknown');
    expect(normalizeHandoffThreat(undefined, undefined)).toBe('unknown');
  });

  it('never emits a display label as a threat value', () => {
    // Guards the trap that `comparison.noveltyThreat` is prose, not the enum.
    expect(normalizeHandoffThreat('High mapped-overlap risk')).toBe('anticipates');
    expect(normalizeHandoffThreat('Low mapped-overlap')).toBe('remote');
  });
});

describe('threatTag', () => {
  it('produces the tags the drafting UI already badges on', () => {
    expect(threatTag('anticipates')).toBe('AI_ANTICIPATES');
    expect(threatTag('obvious')).toBe('AI_OBVIOUS');
    expect(threatTag('adjacent')).toBe('AI_ADJACENT');
    expect(threatTag('remote')).toBe('AI_REMOTE');
    expect(threatTag('unknown')).toBe('AI_ANALYSIS_UNKNOWN');
  });
});

describe('splitEntityList', () => {
  it('splits the report model display strings into arrays', () => {
    expect(splitEntityList('F04B 49/06, G05B 13/02')).toEqual(['F04B 49/06', 'G05B 13/02']);
    expect(splitEntityList(['A. Inventor', 'B. Inventor'])).toEqual(['A. Inventor', 'B. Inventor']);
  });

  it('drops the placeholder values the report uses for missing data', () => {
    expect(splitEntityList('-')).toEqual([]);
    expect(splitEntityList('Not available')).toEqual([]);
    expect(splitEntityList('')).toEqual([]);
    expect(splitEntityList(undefined)).toEqual([]);
  });

  it('de-duplicates repeated entries', () => {
    expect(splitEntityList('Pumps Ltd, Pumps Ltd')).toEqual(['Pumps Ltd']);
  });
});

describe('buildNoveltyDraftingPayload', () => {
  it('projects feature-mapped references into drafting citations', () => {
    const payload = buildNoveltyDraftingPayload(buildSearchRunFixture());

    expect(payload.searchId).toBe('search-1');
    expect(payload.jurisdiction).toBe('IN');
    expect(payload.citations.length).toBe(2);

    const anticipating = payload.citations.find(item => item.patentNumber.includes('202600001'));
    expect(anticipating).toBeTruthy();
    expect(anticipating!.analysed).toBe(true);
    expect(anticipating!.noveltyThreat).toBe('anticipates');
    expect(anticipating!.title).toBe('Pump control using pressure feedback');
    expect(anticipating!.cpcCodes).toContain('F04B 49/06');
    expect(anticipating!.assignees).toContain('Pumps Ltd');
  });

  it('splits mapped features into relevant and irrelevant parts by status', () => {
    const payload = buildNoveltyDraftingPayload(buildSearchRunFixture());
    const anticipating = payload.citations.find(item => item.patentNumber.includes('202600001'))!;

    // Present + Partial are what the reference teaches; Absent is what it does not.
    expect(anticipating.relevantParts).toContain('A pressure sensor measuring line pressure');
    expect(anticipating.relevantParts).toContain('A controller adjusting pump speed from the thermal model');
    expect(anticipating.irrelevantParts).toContain('A thermal model predicting pump temperature');
    expect(anticipating.relevantParts).not.toContain('A thermal model predicting pump temperature');
  });

  it('produces a findings digest naming the closest references and the outcome', () => {
    const payload = buildNoveltyDraftingPayload(buildSearchRunFixture());

    expect(payload.findingsDigest).toContain('OVERALL:');
    expect(payload.findingsDigest).toContain('CLOSEST REFERENCES:');
    expect(payload.findingsDigest).toContain('202600001');
    expect(payload.risk.noveltyRisk).toBeTruthy();
  });

  it('carries the invention features and search query through', () => {
    const payload = buildNoveltyDraftingPayload(buildSearchRunFixture());

    expect(payload.searchQuery).toBe('adaptive pump controller pressure thermal');
    expect(payload.inventionFeatures).toHaveLength(3);
  });

  it('does not repeat an analysed reference in the shortlist', () => {
    const payload = buildNoveltyDraftingPayload(buildSearchRunFixture());
    const analysedKeys = new Set(payload.citations.map(item => item.patentNumber));
    for (const item of payload.shortlisted) {
      expect(analysedKeys.has(item.patentNumber)).toBe(false);
    }
  });

  it('survives a run with no mapped references', () => {
    const payload = buildNoveltyDraftingPayload({
      id: 'empty-search',
      title: 'Untested invention',
      jurisdiction: 'IN',
      inventionDescription: 'A mechanism.',
      config: { searchSource: { includePatents: true, includePapers: false } },
      stage0Results: { searchQuery: 'mechanism', inventionFeatures: ['A mechanism'] },
      stage1Results: { retrievalCandidates: [], patentCount: 0, paperCount: 0 },
      stage35Results: { feature_map: [] },
      stage4Results: {},
    });

    expect(payload.citations).toEqual([]);
    expect(payload.findingsDigest).toContain('OVERALL:');
  });
});

describe('buildNoveltyGuidanceBlock', () => {
  const guidance = {
    primaryClaimFocus: 'The thermal-model-driven speed adjustment',
    secondaryClaimFocus: 'Pressure-compensated startup',
    remainingInventiveCore: 'Closed loop between predicted temperature and commanded speed',
    whyStillDistinguishable: 'No cited reference couples a thermal prediction to speed control',
    weakClaimAreas: ['Generic controller recitation'],
    avoidRelyingSolelyOn: ['A pressure sensor measuring line pressure'],
    independentClaimFocus: 'Claim the coupling, not the sensor',
    dependentClaimIdeas: ['Model coefficients derived from bearing temperature'],
    fallbackClaimIdeas: ['Restrict to centrifugal pumps'],
    reviewBeforeDrafting: ['Read IN202600001 in full'],
    draftingOpportunities: [
      { title: 'Thermal coupling', opportunityType: 'primary', linkedFeatures: ['thermal model'], explanation: 'Unmapped across all references' },
    ],
    mainDifferentiator: 'Thermal-to-speed coupling',
    overallDraftingDirection: 'Focus on unmapped features',
  };

  it('renders the positioning the assessment established', () => {
    const block = buildNoveltyGuidanceBlock(guidance);

    expect(block).toContain('NOVELTY ASSESSMENT CLAIM GUIDANCE');
    expect(block).toContain('The thermal-model-driven speed adjustment');
    expect(block).toContain('DO NOT rely on these alone');
    expect(block).toContain('A pressure sensor measuring line pressure');
    expect(block).toContain('Model coefficients derived from bearing temperature');
  });

  it('returns an empty string when there is no guidance, so prompts stay unchanged', () => {
    expect(buildNoveltyGuidanceBlock(null)).toBe('');
    expect(buildNoveltyGuidanceBlock(undefined)).toBe('');
    expect(buildNoveltyGuidanceBlock({
      primaryClaimFocus: '', secondaryClaimFocus: '', remainingInventiveCore: '', whyStillDistinguishable: '',
      weakClaimAreas: [], avoidRelyingSolelyOn: [], independentClaimFocus: '', dependentClaimIdeas: [],
      fallbackClaimIdeas: [], reviewBeforeDrafting: [], draftingOpportunities: [], mainDifferentiator: '',
      overallDraftingDirection: '',
    })).toBe('');
  });
});

describe('parseIdeaRefinementResponse', () => {
  const valid = {
    refinedTitle: 'Thermally compensated adaptive pump controller',
    refinedDescription: 'A controller couples a predicted pump temperature to a commanded speed.',
    abstract: 'A pump controller.',
    keyFeatures: ['thermal model', 'speed command'],
    potentialApplications: ['industrial pumps'],
    domainTags: ['mechanical'],
    technicalField: 'Pump control',
    changeLog: ['Led with the thermal coupling because IN202600001 already teaches pressure feedback'],
    openQuestions: [],
  };

  it('parses a clean JSON response', () => {
    const result = parseIdeaRefinementResponse(JSON.stringify(valid));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.refinedTitle).toBe(valid.refinedTitle);
      expect(result.data.keyFeatures).toEqual(['thermal model', 'speed command']);
    }
  });

  it('tolerates markdown fences and surrounding prose', () => {
    const wrapped = `Here is the refined idea:\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\`\nLet me know if you need changes.`;
    const result = parseIdeaRefinementResponse(wrapped);
    expect(result.success).toBe(true);
  });

  it('truncates an over-long title to the 15-word drafting limit', () => {
    const longTitle = Array.from({ length: 25 }, (_, index) => `word${index}`).join(' ');
    const result = parseIdeaRefinementResponse(JSON.stringify({ ...valid, refinedTitle: longTitle }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.refinedTitle.split(/\s+/)).toHaveLength(15);
    }
  });

  it('rejects a response missing the required fields', () => {
    const result = parseIdeaRefinementResponse(JSON.stringify({ abstract: 'only an abstract' }));
    expect(result.success).toBe(false);
  });

  it('rejects malformed JSON and empty output', () => {
    expect(parseIdeaRefinementResponse('{not json').success).toBe(false);
    expect(parseIdeaRefinementResponse('').success).toBe(false);
    expect(parseIdeaRefinementResponse('no object here at all').success).toBe(false);
  });

  it('defaults optional list fields rather than throwing', () => {
    const result = parseIdeaRefinementResponse(JSON.stringify({
      refinedTitle: 'A title',
      refinedDescription: 'A description',
    }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.keyFeatures).toEqual([]);
      expect(result.data.changeLog).toEqual([]);
    }
  });
});

describe('drafting-session seeding helpers', () => {
  const citation: NoveltyHandoffCitation = {
    patentNumber: 'IN202600001',
    title: 'Pump control using pressure feedback',
    link: '',
    abstract: 'A pressure sensor measures line pressure.',
    snippet: 'A pressure sensor measures line pressure.',
    score: 0.92,
    publicationDate: '2020-05-01',
    filingDate: '2019-04-02',
    applicationNumber: 'APP-1',
    cpcCodes: ['F04B 49/06'],
    ipcCodes: ['F04B 49/06'],
    inventors: ['A. Inventor'],
    assignees: ['Pumps Ltd'],
    referenceType: 'patent',
    noveltyThreat: 'anticipates',
    overlapRiskLevel: 'High',
    aiSummary: 'Teaches pressure-based control.',
    noveltyComparison: 'Does not teach the thermal coupling.',
    relevantParts: ['A pressure sensor measuring line pressure'],
    irrelevantParts: ['A thermal model predicting pump temperature'],
    coverageScore: 0.66,
    analysed: true,
  };

  it('emits every patent-number alias the related-art table reads', () => {
    const seed = toRelatedArtResultSeed(citation);
    for (const key of ['publicationNumber', 'publication_number', 'patent_number', 'pn', 'id']) {
      expect(seed[key]).toBe('IN202600001');
    }
    expect(seed.cpc_codes).toEqual(['F04B 49/06']);
    expect(seed.publication_date).toBe('2020-05-01');
  });

  it('builds an aiAnalysisData map in the shape the Related Art stage writes', () => {
    const map = buildAiAnalysisMap([citation]) as Record<string, any>;
    expect(map['IN202600001']).toMatchObject({
      aiSummary: 'Teaches pressure-based control.',
      noveltyThreat: 'anticipates',
      noveltyComparison: 'Does not teach the thermal coupling.',
    });
    expect(map['IN202600001'].relevantParts).toEqual(['A pressure sensor measuring line pressure']);
  });

  it('excludes unanalysed shortlist entries from the analysis map', () => {
    const shortlisted: NoveltyHandoffCitation = { ...citation, patentNumber: 'IN202600009', analysed: false };
    const map = buildAiAnalysisMap([citation, shortlisted]);
    expect(Object.keys(map)).toEqual(['IN202600001']);
  });

  it('ranks the highest-threat references first for claim refinement', () => {
    const remote: NoveltyHandoffCitation = { ...citation, patentNumber: 'IN202600002', noveltyThreat: 'remote', coverageScore: 0.1 };
    const obvious: NoveltyHandoffCitation = { ...citation, patentNumber: 'IN202600003', noveltyThreat: 'obvious', coverageScore: 0.4 };

    const ranked = rankCitationsForClaimRefinement([remote, obvious, citation], 5);
    expect(ranked.map(item => item.patentNumber)).toEqual(['IN202600001', 'IN202600003', 'IN202600002']);
  });

  it('honours the limit and skips unanalysed references', () => {
    const shortlisted: NoveltyHandoffCitation = { ...citation, patentNumber: 'IN202600009', analysed: false };
    expect(rankCitationsForClaimRefinement([citation, shortlisted], 5)).toHaveLength(1);
    expect(rankCitationsForClaimRefinement([citation, { ...citation, patentNumber: 'IN2' }], 1)).toHaveLength(1);
  });
});
