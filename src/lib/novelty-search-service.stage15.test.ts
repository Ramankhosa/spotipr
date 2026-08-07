import { afterEach, describe, expect, test, vi } from 'vitest';
import { NoveltySearchService } from './novelty-search-service';
import { patentSearchOrchestrator } from './patent-search';

vi.mock('./metering/gateway', () => ({
  llmGateway: {
    executeLLMOperation: vi.fn(),
  },
}));

function service() {
  return new NoveltySearchService() as any;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NoveltySearchService Stage 1.5 helpers', () => {
  test('keeps the retrieval funnel at 300 candidates and an 80-record gate wave', () => {
    const config = service().mergeConfig();

    expect(config.stage1.candidateLimit).toBe(300);
    // maxCandidates keeps its meaning: candidates gated per wave.
    expect(config.stage15.maxCandidates).toBe(80);
    expect(config.stage15.maxTotalCandidates).toBe(180);
    expect(config.stage15.totalTimeoutMs).toBe(300000);
    expect(config.stage15.maxTokens).toBe(250000);
    expect(config.stage15.minYieldToContinue).toBe(0.1);
    expect(config.stage15.yieldDecayFactor).toBe(0.25);
    expect(config.stage15.yieldConfirmationWaves).toBe(1);
  });

  test('walks the ranked pool in waves and stops when the yield drops', async () => {
    const { llmGateway } = await import('./metering/gateway');
    const svc = service();
    vi.spyOn(svc as any, 'persistStage15Progress').mockResolvedValue(undefined);
    vi.spyOn(svc as any, 'ensureSearchNotCancelled').mockResolvedValue({ success: true });

    const pool = Array.from({ length: 300 }, (_, index) => ({
      publicationNumber: `US${String(index).padStart(7, '0')}A1`,
      title: `Candidate ${index}`,
      abstract: `Abstract ${index}`,
      relevanceScore: 1 - index * 0.001,
    }));

    // Wave 1 (candidates 0-79) is dense with accepts; everything after is borderline.
    (llmGateway.executeLLMOperation as any).mockImplementation(async ({}, request: any) => {
      const ids = Array.from(String(request.prompt).matchAll(/Reference ID: (\S+)/g)).map(m => (m as any)[1]);
      const rows = ids.map(pn => {
        const index = Number(String(pn).replace(/\D/g, ''));
        return index < 80
          ? { pn, score: 0.9, decision: 'accept', matched_features: [], missing_features: [], evidence_quality: 'high' }
          : { pn, score: 0.3, decision: 'borderline', matched_features: [], missing_features: [], evidence_quality: 'low' };
      });
      return { success: true, response: { output: JSON.stringify(rows), inputTokens: 100, outputTokens: 50 } };
    });

    const result = await (svc as any).performStage15(
      'wave-run',
      { inventionFeatures: ['adaptive control'], searchQuery: 'adaptive control' },
      { retrievalCandidates: pool },
      svc.mergeConfig(),
      {}
    );

    expect(result.success).toBe(true);
    // Wave 1 is always processed in full; wave 2 is all borderline, so it stops.
    expect(result.data.nextBatchCursor).toBe(160);
    expect(result.data.screeningWaves).toBe(2);
    expect(result.data.screeningStopReason).toBe('yield_below_threshold');
    expect(result.data.screeningOrderTrusted).toBe(true);
    expect(result.data.screeningTokensUsed).toBeGreaterThan(0);
    // More of the pool remains, so the user can still ask for more.
    expect(result.data.hasMoreCandidates).toBe(true);
    // An automatic wave must not widen the visible list.
    expect(result.data.visibleResultLimit).toBe(50);
  });

  test('keeps gating past the first wave while relevance holds up', async () => {
    const { llmGateway } = await import('./metering/gateway');
    const svc = service();
    vi.spyOn(svc as any, 'persistStage15Progress').mockResolvedValue(undefined);
    vi.spyOn(svc as any, 'ensureSearchNotCancelled').mockResolvedValue({ success: true });

    const pool = Array.from({ length: 300 }, (_, index) => ({
      publicationNumber: `US${String(index).padStart(7, '0')}A1`,
      title: `Candidate ${index}`,
      abstract: `Abstract ${index}`,
      relevanceScore: 1 - index * 0.001,
    }));

    (llmGateway.executeLLMOperation as any).mockImplementation(async ({}, request: any) => {
      const ids = Array.from(String(request.prompt).matchAll(/Reference ID: (\S+)/g)).map(m => (m as any)[1]);
      const rows = ids.map(pn => ({ pn, score: 0.9, decision: 'accept', matched_features: [], missing_features: [], evidence_quality: 'high' }));
      return { success: true, response: { output: JSON.stringify(rows), inputTokens: 100, outputTokens: 50 } };
    });

    const result = await (svc as any).performStage15(
      'wave-run-dense',
      { inventionFeatures: ['adaptive control'], searchQuery: 'adaptive control' },
      { retrievalCandidates: pool },
      svc.mergeConfig(),
      {}
    );

    // Runs to the configured ceiling rather than the single 80-record pass.
    expect(result.data.nextBatchCursor).toBe(180);
    expect(result.data.screeningStopReason).toBe('candidate_ceiling');
    expect(result.data.reviewedCount).toBe(180);
  });

  test('keeps the static policy block as a stable prompt prefix across runs and batches', async () => {
    const { llmGateway } = await import('./metering/gateway');
    const svc = service();
    vi.spyOn(svc as any, 'persistStage15Progress').mockResolvedValue(undefined);
    vi.spyOn(svc as any, 'ensureSearchNotCancelled').mockResolvedValue({ success: true });

    const prompts: string[] = [];
    (llmGateway.executeLLMOperation as any).mockImplementation(async ({}, request: any) => {
      prompts.push(String(request.prompt));
      const ids = Array.from(String(request.prompt).matchAll(/Reference ID: (\S+)/g)).map(m => (m as any)[1]);
      return {
        success: true,
        response: {
          output: JSON.stringify(ids.map(pn => ({ pn, score: 0.2, decision: 'reject', matched_features: [], missing_features: [], evidence_quality: 'low' }))),
          inputTokens: 10,
          outputTokens: 5,
        },
      };
    });

    const poolFor = (prefix: string) => Array.from({ length: 40 }, (_, index) => ({
      publicationNumber: `${prefix}${String(index).padStart(6, '0')}A1`,
      title: `${prefix} candidate ${index}`,
      abstract: `Abstract for ${prefix} ${index}`,
      relevanceScore: 1 - index * 0.01,
    }));

    const runGate = (searchId: string, features: string[], prefix: string) => (svc as any).performStage15(
      searchId,
      { inventionFeatures: features, searchQuery: features[0] },
      { retrievalCandidates: poolFor(prefix) },
      svc.mergeConfig(),
      {}
    );

    await runGate('run-a', ['soil moisture sensing', 'valve actuation'], 'US');
    const runAPrompts = [...prompts];
    prompts.length = 0;
    await runGate('run-b', ['battery thermal management', 'coolant routing'], 'EP');
    const runBPrompts = [...prompts];

    const commonPrefix = (a: string, b: string) => {
      let i = 0;
      while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
      return a.slice(0, i);
    };

    expect(runAPrompts.length).toBeGreaterThan(1);
    expect(runBPrompts.length).toBeGreaterThan(1);

    // Across two unrelated inventions the whole policy block is still shared, which
    // is what a provider prompt cache can reuse. Before the reorder this was a
    // single sentence.
    const crossRun = commonPrefix(runAPrompts[0], runBPrompts[0]);
    expect(crossRun.length).toBeGreaterThan(8000);
    expect(crossRun).toContain('Decision policy:');
    expect(crossRun).toContain('Output requirements:');
    expect(crossRun).not.toContain('soil moisture sensing');

    // Within one run the feature list is shared too, so batch 2 onward reuses more.
    const withinRun = commonPrefix(runAPrompts[0], runAPrompts[1]);
    expect(withinRun.length).toBeGreaterThan(crossRun.length);
    expect(withinRun).toContain('soil moisture sensing');
  });

  test('uses corpus-only search without generated exclusion filters', async () => {
    const candidates = Array.from({ length: 300 }, (_, index) => ({
      publicationNumber: `WO2026${String(index).padStart(6, '0')}A1`,
      title: `Candidate ${index}`,
      abstract: 'Technical candidate disclosure.',
      sourceProvider: 'google-patents-corpus',
      relevanceScore: 1 - index / 1000,
    }));
    const searchSpy = vi.spyOn(patentSearchOrchestrator, 'search').mockResolvedValue({
      queryPlan: {} as any,
      providerStats: [],
      warnings: [],
      results: candidates.slice(0, 50) as any,
      candidateResults: candidates as any,
      diagnostics: {
        displayLimit: 50,
        candidateLimit: 300,
        resultCount: 50,
        candidateResultCount: 300,
        providerCandidateCount: 300,
        providerContributionCounts: {},
        rerankApplied: true,
        minRerankScore: 0,
        droppedBelowFloor: 0,
      },
    });
    const svc = service();
    const config = svc.mergeConfig({
      searchSource: { mode: 'LOCAL_CORPUS', includePatents: true, includePapers: false, filters: {} },
    });
    const result = await svc.performStage1(
      { id: 'search-300', jurisdiction: 'IN', inventionDescription: 'A technical control platform.' },
      {
        searchQuery: 'technical control platform',
        inventionFeatures: ['adaptive control mechanism'],
        searchExclusions: ['legacy exclusion'],
      },
      config,
    );

    expect(result.success).toBe(true);
    expect(result.data.retrievalCandidates).toHaveLength(300);
    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(searchSpy.mock.calls[0][0]).toMatchObject({
      candidateLimit: 300,
      disableProviderFallback: true,
      filters: {},
      queryPlan: { excludedTerms: [] },
    });
  });

  test('stops assessment when Voyage reranking fails after one retry', async () => {
    const searchSpy = vi.spyOn(patentSearchOrchestrator, 'search').mockResolvedValue({
      queryPlan: {} as any,
      providerStats: [],
      warnings: ['rerank unavailable'],
      results: [{ publicationNumber: 'P1' }, { publicationNumber: 'P2' }] as any,
      candidateResults: [{ publicationNumber: 'P1' }, { publicationNumber: 'P2' }] as any,
      diagnostics: {
        displayLimit: 50,
        candidateLimit: 300,
        resultCount: 2,
        candidateResultCount: 2,
        providerCandidateCount: 2,
        providerContributionCounts: {},
        rerankApplied: false,
        minRerankScore: 0,
        droppedBelowFloor: 0,
      },
    });
    const svc = service();
    const result = await svc.performStage1(
      { id: 'rerank-required', jurisdiction: 'IN', inventionDescription: 'Control platform.' },
      { searchQuery: 'control platform', inventionFeatures: ['adaptive control mechanism'] },
      svc.mergeConfig({ searchSource: { mode: 'LOCAL_CORPUS', includePatents: true, includePapers: false } }),
    );

    expect(searchSpy).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ success: false });
    expect(result.error).toContain('Voyage reranking is required');
  });

  test('promotes evidence-backed high-signal rejects before ordinary accepted records', () => {
    const svc = service();
    const stage0 = {
      searchQuery: 'adaptive inspection platform',
      inventionFeatures: [
        'autonomous propulsion control',
        'onboard anomaly inference',
        'closed loop route adaptation',
        'remote telemetry interface',
      ],
      featureDetails: [
        { feature: 'autonomous propulsion control', feature_type: 'core_technical' },
        { feature: 'onboard anomaly inference', feature_type: 'novelty_candidate' },
        { feature: 'closed loop route adaptation', feature_type: 'core_technical' },
        { feature: 'remote telemetry interface', feature_type: 'implementation' },
      ],
      claimConcepts: [{
        title: 'Autonomous inference control loop',
        linkedFeatures: ['autonomous propulsion control', 'onboard anomaly inference'],
        claimableSummary: 'Inference controls autonomous movement.',
        importance: 'primary',
      }],
    };
    const retrievalCandidates = [
      { publicationNumber: 'P1', title: 'Core plus novelty' },
      { publicationNumber: 'P2', title: 'Two core features' },
      { publicationNumber: 'P3', title: 'Keyword-only noise' },
      { publicationNumber: 'P4', title: 'Ordinary accepted record' },
    ];
    const stage1Data = {
      retrievalCandidates,
      aiRelevance: {
        accepted: ['P4'], component: [], borderline: [], rejected: ['P1', 'P2', 'P3'], gateStatus: 'complete',
        byPn: {
          P1: { pn: 'P1', decision: 'reject', score: 0.2, matched_features: ['F1', 'F2'], reviewStatus: 'reviewed' },
          P2: { pn: 'P2', decision: 'reject', score: 0.3, matched_features: ['F1', 'F3'], reviewStatus: 'reviewed' },
          P3: { pn: 'P3', decision: 'reject', score: 0.8, matched_features: [], reason: 'keyword overlap', reviewStatus: 'reviewed' },
          P4: { pn: 'P4', decision: 'accept', score: 0.9, matched_features: ['F4'], reviewStatus: 'reviewed' },
        },
      },
    };

    const selected = svc.selectRelevantPatentsForDeepAnalysis(stage1Data, 4, stage0);

    expect(selected.map((item: any) => item.publicationNumber)).toEqual(['P1', 'P2', 'P4']);
    expect(selected[0]).toMatchObject({ highSignal: true, preMappingPriorityScore: 5 });
    expect(selected[0].promotionReasons).toContain('core_plus_novelty');
    expect(selected[1].promotionReasons).toContain('two_core_features');
    expect(selected.some((item: any) => item.publicationNumber === 'P3')).toBe(false);
  });

  test('reuses only complete Stage 1.5 gate caches', () => {
    const svc = service();
    const complete = { aiRelevance: { byPn: { IN1: {} }, cacheKey: 'k1', gateStatus: 'complete' } };
    const partial = { aiRelevance: { byPn: { IN1: {} }, cacheKey: 'k1', gateStatus: 'partial' } };
    const failed = { aiRelevance: { byPn: { IN1: {} }, cacheKey: 'k1', gateStatus: 'failed' } };

    expect(svc.canReuseStage15Gate(complete, 'k1')).toBe(true);
    expect(svc.canReuseStage15Gate(partial, 'k1')).toBe(false);
    expect(svc.canReuseStage15Gate(failed, 'k1')).toBe(false);
    expect(svc.canReuseStage15Gate(complete, 'different')).toBe(false);
  });

  test('parses raw, fenced, wrapped, trailing-comma, and string-score gate JSON', () => {
    const svc = service();

    expect(svc.parseStage15GateResponse('[{"pn":"IN1","score":"0.8","decision":"accept",}]')).toMatchObject([
      { pn: 'IN1', score: '0.8', decision: 'accept' },
    ]);
    expect(svc.parseStage15GateResponse('```json\n[{"pn":"IN2","score":0.7,"decision":"accept"}]\n```')).toMatchObject([
      { pn: 'IN2', score: 0.7, decision: 'accept' },
    ]);
    expect(svc.parseStage15GateResponse('{"results":[{"pn":"IN3","score":0.6,"decision":"borderline"}]}')).toMatchObject([
      { pn: 'IN3', score: 0.6, decision: 'borderline' },
    ]);
    expect(svc.parseStage15GateResponse('[{"pn":"IN4","score":0.52,"decision":"component"}]')).toMatchObject([
      { pn: 'IN4', score: 0.52, decision: 'component' },
    ]);
    expect(svc.coerceGateScore({ score: '0.82' })).toBe(0.82);
  });

  test('does not index a parsed gate row without a publication number', () => {
    const svc = service();
    const indexed = svc.indexStage15ParsedRows([
      { pn: 'IN1', score: 0.8 },
      { score: 0.95, decision: 'accept' },
      { pn: 'IN3', score: 0.7 },
    ]);

    expect(indexed.IN1).toMatchObject({ pn: 'IN1' });
    expect(indexed.IN3).toMatchObject({ pn: 'IN3' });
    expect(Object.values(indexed)).not.toContainEqual({ score: 0.95, decision: 'accept' });
  });

  test('excludes gate-error records from genuine decision lists and counts them separately', () => {
    const svc = service();
    const candidates = [
      { publicationNumber: 'IN1' },
      { publicationNumber: 'IN2' },
      { publicationNumber: 'IN3' },
    ];
    const byPn = {
      IN1: { pn: 'IN1', decision: 'accept', reviewStatus: 'reviewed' },
      IN2: { pn: 'IN2', decision: 'reject', reviewStatus: 'gate_error', gateError: 'timeout' },
    };

    expect(svc.buildStage15DecisionLists(candidates, byPn, 5)).toEqual({
      accepted: ['IN1'],
      component: [],
      borderline: [],
      rejected: [],
    });
    expect(svc.summarizeStage15GateCounts(candidates, byPn)).toEqual({
      retrievedCount: 3,
      attemptedGateCount: 2,
      reviewedCount: 1,
      gateErrorCount: 1,
      unreviewedCount: 1,
    });
  });

  test('keeps component decisions as a separate Stage 1.5 bucket', () => {
    const svc = service();
    const candidates = [
      { publicationNumber: 'IN1' },
      { publicationNumber: 'IN2' },
      { publicationNumber: 'IN3' },
    ];
    const byPn = {
      IN1: { pn: 'IN1', decision: 'accept', reviewStatus: 'reviewed' },
      IN2: { pn: 'IN2', decision: 'component', reviewStatus: 'reviewed' },
      IN3: { pn: 'IN3', decision: 'borderline', reviewStatus: 'reviewed' },
    };

    expect(svc.buildStage15DecisionLists(candidates, byPn, 5)).toEqual({
      accepted: ['IN1'],
      component: ['IN2'],
      borderline: ['IN3'],
      rejected: [],
    });
  });

  test('keeps gate-error candidates as low-confidence borderline when the fallback decision is borderline', () => {
    const svc = service();
    const candidates = [
      { publicationNumber: 'IN1' },
      { publicationNumber: 'IN2' },
    ];
    const byPn = {
      IN1: { pn: 'IN1', decision: 'borderline', score: 0.2, evidence_quality: 'low', reviewStatus: 'gate_error', gateError: 'parse_error' },
      IN2: { pn: 'IN2', decision: 'reject', score: 0, evidence_quality: 'low', reviewStatus: 'gate_error', gateError: 'timeout' },
    };

    expect(svc.buildStage15DecisionLists(candidates, byPn, 5)).toEqual({
      accepted: [],
      component: [],
      borderline: ['IN1'],
      rejected: [],
    });
  });

  test('formats Stage 1.5 features with stable IDs and importance labels', () => {
    const svc = service();

    expect(svc.buildStage15AtomicFeatures({
      searchQuery: 'query',
      inventionFeatures: ['controller', 'fallback core', 'fallback mechanism'],
      featureDetails: [
        { feature: 'film', feature_type: 'generic_weak' },
        { feature: 'specific control loop', feature_type: 'core_technical' },
        { feature: 'optional display marker', feature_type: 'generic_weak' },
      ],
      noveltyFocus: ['layer', 'novel release trigger'],
    })).toEqual([
      'F1 [core]: specific control loop',
      'F2 [peripheral]: optional display marker',
      'F3 [core]: fallback core',
      'F4 [core]: fallback mechanism',
      'F5 [core]: novel release trigger',
    ]);
  });

  test('repairs claim concept linked features before storing approved Stage 0 metadata', () => {
    const svc = service();
    const normalized = svc.normalizeApprovedStage0({
      searchQuery: 'adaptive torque wrench',
      inventionFeatures: [
        'bolt size identification',
        'bolt material identification',
        'adaptive torque adjustment',
      ],
      claimConcepts: [
        {
          title: 'Adaptive torque from fastener characterization',
          linkedFeatures: ['bolt size detect', 'bolt material identification', 'adaptive torque adjustment'],
          claimableSummary: 'Bolt size and material identification drive torque adjustment.',
          importance: 'primary',
        },
      ],
    }, 'The wrench identifies bolt size and bolt material and adjusts torque.');

    expect(normalized.claimConcepts?.[0].linkedFeatures).toEqual([
      'bolt size identification',
      'bolt material identification',
      'adaptive torque adjustment',
    ]);
    expect(normalized.warnings?.some((warning: string) => warning.includes('was repaired'))).toBe(true);
  });

  test('does not treat individually mapped features as mapped claim concept relationship', () => {
    const svc = service();
    const mapping = svc.buildClaimConceptMapping(
      {
        searchQuery: 'adaptive torque wrench',
        inventionFeatures: [
          'bolt size identification',
          'bolt material identification',
          'adaptive torque adjustment',
        ],
        claimConcepts: [
          {
            title: 'Adaptive torque from fastener characterization',
            linkedFeatures: [
              'bolt size identification',
              'bolt material identification',
              'adaptive torque adjustment',
            ],
            claimableSummary: 'Bolt size and bolt material identification control torque adjustment.',
            importance: 'primary',
          },
        ],
      },
      [
        {
          pn: 'IN1',
          title: 'Torque tool with bolt measurements',
          feature_analysis: [
            { feature: 'bolt size identification', status: 'Present', quote: 'identifies bolt size' },
            { feature: 'bolt material identification', status: 'Present', quote: 'identifies bolt material' },
            { feature: 'adaptive torque adjustment', status: 'Present', quote: 'sets torque value' },
          ],
        },
      ]
    );

    expect(mapping[0]).toMatchObject({
      mappedFeatures: 3,
      totalFeatures: 3,
      coverage: 1,
      relationshipMapped: false,
      relationshipRisk: 'moderate',
    });
    expect(mapping[0].reason).toContain('cooperative relationship is not fully disclosed');
  });

  test('builds a successful no-high-confidence deep-analysis payload', () => {
    const svc = service();
    const stage1Data = {
      visiblePriorArtResults: [],
      retrievalCandidates: [{ publicationNumber: 'IN1' }, { publicationNumber: 'IN2' }],
      aiRelevance: {
        gateStatus: 'complete',
        reviewedCount: 2,
        retrievedCount: 2,
      },
    };

    expect(svc.hasNoHighConfidencePriorArt(stage1Data)).toBe(true);
    const data = svc.buildNoHighConfidenceStageData(
      'search-1',
      { searchQuery: 'query', inventionFeatures: ['feature one'] },
      stage1Data
    );

    expect(data.stage35Data).toMatchObject({
      noHighConfidencePriorArt: true,
      feature_map: [],
      reviewedCount: 2,
      retrievedCount: 2,
    });
    expect(data.stage4Data).toMatchObject({
      noHighConfidencePriorArt: true,
      decision: 'Low Evidence',
      confidence: 'Low',
      novelty_score: 0,
      per_patent_coverage: [],
    });
  });

  test('selects borderline candidates for deep analysis when no accepted candidate exists', () => {
    const svc = service();
    const retrievalCandidates = Array.from({ length: 5 }, (_, index) => ({
      publicationNumber: `IN202500000${index + 1}A`,
      title: `Borderline patent ${index + 1}`,
      abstract: `Related mechanism ${index + 1}`,
    }));
    const byPn = Object.fromEntries(retrievalCandidates.map((candidate, index) => [
      candidate.publicationNumber,
      {
        pn: candidate.publicationNumber,
        decision: 'borderline',
        score: 0.45 + index * 0.05,
        evidence_quality: 'medium',
        reviewStatus: 'reviewed',
      },
    ]));
    const stage1Data = {
      visiblePriorArtResults: [],
      pqaiResults: [],
      retrievalCandidates,
      aiRelevance: {
        accepted: [],
        borderline: retrievalCandidates.map(candidate => candidate.publicationNumber),
        rejected: [],
        byPn,
        gateStatus: 'complete',
        minimumVisibleConfidence: 0.7,
      },
    };

    expect(svc.hasNoHighConfidencePriorArt(stage1Data)).toBe(false);
    const selected = svc.selectRelevantPatentsForDeepAnalysis(stage1Data, 10);

    expect(selected).toHaveLength(5);
    expect(selected.map((item: any) => item.publicationNumber)).toEqual([
      'IN2025000005A',
      'IN2025000004A',
      'IN2025000003A',
      'IN2025000002A',
      'IN2025000001A',
    ]);
    expect(selected.every((item: any) => item.rerankDecision === 'borderline')).toBe(true);
  });

  test('selects direct, then component, then borderline candidates for deep analysis', () => {
    const svc = service();
    const retrievalCandidates = [
      { publicationNumber: 'IN_DIRECT', title: 'Direct match' },
      { publicationNumber: 'IN_COMPONENT', title: 'Component match' },
      { publicationNumber: 'IN_BORDERLINE', title: 'Borderline match' },
    ];
    const stage1Data = {
      retrievalCandidates,
      aiRelevance: {
        accepted: ['IN_DIRECT'],
        component: ['IN_COMPONENT'],
        borderline: ['IN_BORDERLINE'],
        rejected: [],
        byPn: {
          IN_DIRECT: { pn: 'IN_DIRECT', decision: 'accept', score: 0.9, evidence_quality: 'high', reviewStatus: 'reviewed' },
          IN_COMPONENT: { pn: 'IN_COMPONENT', decision: 'component', score: 0.25, evidence_quality: 'low', reviewStatus: 'reviewed' },
          IN_BORDERLINE: { pn: 'IN_BORDERLINE', decision: 'borderline', score: 0.45, evidence_quality: 'medium', reviewStatus: 'reviewed' },
        },
        gateStatus: 'complete',
        minimumVisibleConfidence: 0.7,
        thresholds: { high: 0.7, medium: 0.4 },
      },
    };

    const selected = svc.selectRelevantPatentsForDeepAnalysis(stage1Data, 3);

    expect(selected.map((item: any) => item.publicationNumber)).toEqual([
      'IN_DIRECT',
      'IN_COMPONENT',
      'IN_BORDERLINE',
    ]);
    expect(selected.map((item: any) => item.rerankDecision)).toEqual(['accept', 'component', 'borderline']);
    expect(selected[1].matchCategory).toBe('component');
  });

  test('does not add borderline candidates when direct and component coverage reaches the target', () => {
    const svc = service();
    const componentCandidates = Array.from({ length: 20 }, (_, index) => ({
      publicationNumber: `IN_COMPONENT_${index + 1}`,
      title: `Component ${index + 1}`,
    }));
    const borderlineCandidates = Array.from({ length: 20 }, (_, index) => ({
      publicationNumber: `IN_BORDERLINE_${index + 1}`,
      title: `Borderline ${index + 1}`,
    }));
    const retrievalCandidates = [...componentCandidates, ...borderlineCandidates];
    const byPn = Object.fromEntries([
      ...componentCandidates.map((candidate, index) => [
        candidate.publicationNumber,
        { pn: candidate.publicationNumber, decision: 'component', score: 0.8 - index * 0.01, evidence_quality: 'medium', reviewStatus: 'reviewed' },
      ]),
      ...borderlineCandidates.map((candidate, index) => [
        candidate.publicationNumber,
        { pn: candidate.publicationNumber, decision: 'borderline', score: 0.7 - index * 0.01, evidence_quality: 'medium', reviewStatus: 'reviewed' },
      ]),
    ]);
    const stage1Data = {
      retrievalCandidates,
      aiRelevance: {
        accepted: [],
        component: componentCandidates.map(candidate => candidate.publicationNumber),
        borderline: borderlineCandidates.map(candidate => candidate.publicationNumber),
        rejected: [],
        byPn,
        gateStatus: 'complete',
      },
    };

    const selected = svc.selectRelevantPatentsForDeepAnalysis(stage1Data, 60);

    expect(selected).toHaveLength(20);
    expect(selected.every((item: any) => item.rerankDecision === 'component')).toBe(true);
  });

  test('caps borderline filler when direct and component coverage is thin', () => {
    const svc = service();
    const acceptedCandidates = Array.from({ length: 2 }, (_, index) => ({
      publicationNumber: `IN_ACCEPT_${index + 1}`,
      title: `Accepted ${index + 1}`,
    }));
    const borderlineCandidates = Array.from({ length: 20 }, (_, index) => ({
      publicationNumber: `IN_BORDERLINE_${index + 1}`,
      title: `Borderline ${index + 1}`,
    }));
    const retrievalCandidates = [...acceptedCandidates, ...borderlineCandidates];
    const byPn = Object.fromEntries([
      ...acceptedCandidates.map((candidate, index) => [
        candidate.publicationNumber,
        { pn: candidate.publicationNumber, decision: 'accept', score: 0.9 - index * 0.01, evidence_quality: 'high', reviewStatus: 'reviewed' },
      ]),
      ...borderlineCandidates.map((candidate, index) => [
        candidate.publicationNumber,
        { pn: candidate.publicationNumber, decision: 'borderline', score: 0.7 - index * 0.01, evidence_quality: 'medium', reviewStatus: 'reviewed' },
      ]),
    ]);
    const stage1Data = {
      retrievalCandidates,
      aiRelevance: {
        accepted: acceptedCandidates.map(candidate => candidate.publicationNumber),
        component: [],
        borderline: borderlineCandidates.map(candidate => candidate.publicationNumber),
        rejected: [],
        byPn,
        gateStatus: 'complete',
      },
    };

    const selected = svc.selectRelevantPatentsForDeepAnalysis(stage1Data, 60);

    // 2 accepts + 20 borderline available. The deep-analysis floor (8) bounds the
    // filler, so only 6 of the 20 borderline candidates are pulled in.
    expect(selected).toHaveLength(8);
    expect(selected.filter((item: any) => item.rerankDecision === 'borderline')).toHaveLength(6);
    expect(selected.slice(0, 2).map((item: any) => item.rerankDecision)).toEqual(['accept', 'accept']);
  });

  test('does not impose the legacy borderline count cap on an adaptive analysis frontier', () => {
    const svc = service();
    const retrievalCandidates = Array.from({ length: 15 }, (_, index) => ({
      publicationNumber: `ADAPTIVE_${index + 1}`,
      title: `Adaptive candidate ${index + 1}`,
    }));
    const byPn = Object.fromEntries(retrievalCandidates.map((candidate, index) => [
      candidate.publicationNumber,
      { pn: candidate.publicationNumber, decision: 'borderline', score: 0.7 - index * 0.01, reviewStatus: 'reviewed' },
    ]));
    const stage1Data = {
      retrievalCandidates,
      aiRelevance: {
        accepted: [],
        component: [],
        borderline: retrievalCandidates.map(candidate => candidate.publicationNumber),
        rejected: [],
        byPn,
        gateStatus: 'complete',
      },
    };

    const selected = svc.selectRelevantPatentsForDeepAnalysis(stage1Data, retrievalCandidates.length, undefined, true);

    expect(selected).toHaveLength(15);
  });

  test('does not let the five-item borderline UI quota cap deep analysis at five', () => {
    const svc = service();
    const retrievalCandidates = Array.from({ length: 20 }, (_, index) => ({
      publicationNumber: `IN_QUOTA_${index + 1}`,
      title: `Borderline quota candidate ${index + 1}`,
    }));
    const byPn = Object.fromEntries(retrievalCandidates.map((candidate, index) => [
      candidate.publicationNumber,
      {
        pn: candidate.publicationNumber,
        decision: 'borderline',
        score: 0.8 - index * 0.01,
        evidence_quality: 'medium',
        reviewStatus: 'reviewed',
      },
    ]));
    const stage1Data = {
      retrievalCandidates,
      aiRelevance: {
        accepted: [],
        component: [],
        borderline: retrievalCandidates.slice(0, 5).map(candidate => candidate.publicationNumber),
        rejected: [],
        byPn,
        gateStatus: 'complete',
      },
    };

    const selected = svc.selectRelevantPatentsForDeepAnalysis(stage1Data, 60);

    // The gate's borderline list is a five-item UI slice; deep analysis reads every
    // reviewed borderline decision in byPn, so it must exceed five.
    expect(selected.length).toBeGreaterThan(5);
    expect(selected).toHaveLength(8);
    expect(selected.every((item: any) => item.rerankDecision === 'borderline')).toBe(true);
  });

  test('keeps no-high-confidence path when accepted and borderline are both empty', () => {
    const svc = service();
    const stage1Data = {
      visiblePriorArtResults: [],
      retrievalCandidates: [{ publicationNumber: 'IN1' }, { publicationNumber: 'IN2' }],
      aiRelevance: {
        accepted: [],
        component: [],
        borderline: [],
        rejected: ['IN1', 'IN2'],
        byPn: {
          IN1: { pn: 'IN1', decision: 'reject', score: 0.1, evidence_quality: 'low', reviewStatus: 'reviewed' },
          IN2: { pn: 'IN2', decision: 'reject', score: 0.2, evidence_quality: 'low', reviewStatus: 'reviewed' },
        },
        gateStatus: 'complete',
      },
    };

    expect(svc.selectRelevantPatentsForDeepAnalysis(stage1Data, 10)).toHaveLength(0);
    expect(svc.hasNoHighConfidencePriorArt(stage1Data)).toBe(true);
  });

  test('uses low-confidence borderline fallback candidates when the whole gate fails', () => {
    const svc = service();
    const fallback = svc.fallbackCandidatesForGateFailure([
      { publicationNumber: 'IN1' },
    ], 5);

    expect(fallback).toMatchObject([
      {
        publicationNumber: 'IN1',
        rerankDecision: 'borderline',
        rerankScore: 0.2,
        evidence_quality: 'low',
      },
    ]);
  });

  test('builds bounded live patent-analysis progress snapshots', () => {
    const svc = service();

    expect(svc.buildStageProgressSnapshot({
      stage: 'relevance_review',
      analyzedPatents: 3,
      totalPatents: 10,
      processedBatches: 1,
      batchCount: 4,
    })).toMatchObject({
      stage: 'relevance_review',
      status: 'running',
      analyzedPatents: 3,
      totalPatents: 10,
      percent: 30,
      message: 'Relevance review: 3 of 10 patents analyzed.',
    });

    expect(svc.buildStageProgressSnapshot({
      stage: 'deep_analysis',
      status: 'running',
      analyzedPatents: 10,
      totalPatents: 10,
    }).percent).toBe(99);

    expect(svc.buildStageProgressSnapshot({
      stage: 'deep_analysis',
      status: 'complete',
      analyzedPatents: 10,
      totalPatents: 10,
    }).percent).toBe(100);
  });
});

describe('NoveltySearchService Stage 1.5 gate observability', () => {
  function pool(size: number) {
    return Array.from({ length: size }, (_, index) => ({
      publicationNumber: `US${String(index).padStart(7, '0')}A1`,
      title: `Candidate ${index}`,
      abstract: `Abstract ${index}`,
      relevanceScore: 1 - index * 0.001,
    }));
  }

  function promptIds(request: any): string[] {
    return Array.from(String(request.prompt).matchAll(/Reference ID: (\S+)/g)).map(m => (m as any)[1]);
  }

  // Stripping non-digits would fold the "1" of the A1 kind code into the index
  // (US0000003A1 -> 31), so read the padded ordinal on its own.
  function ordinal(pn: string): number {
    return Number(String(pn).match(/US(\d{7})A1/)?.[1] ?? -1);
  }

  function harness() {
    const svc = service();
    vi.spyOn(svc as any, 'persistStage15Progress').mockResolvedValue(undefined);
    vi.spyOn(svc as any, 'ensureSearchNotCancelled').mockResolvedValue({ success: true });
    return svc;
  }

  test('records a decision census and the reject rate for the run', async () => {
    const { llmGateway } = await import('./metering/gateway');
    const svc = harness();
    (llmGateway.executeLLMOperation as any).mockImplementation(async ({}, request: any) => {
      const rows = promptIds(request).map(pn => ({
        pn,
        score: 0.2,
        decision: ordinal(pn) < 4 ? 'accept' : 'reject',
        matched_features: [],
        missing_features: [],
        evidence_quality: 'low',
      }));
      return { success: true, response: { output: JSON.stringify(rows), inputTokens: 10, outputTokens: 5 } };
    });

    const result = await (svc as any).performStage15(
      'census-run',
      { inventionFeatures: ['adaptive control'], searchQuery: 'adaptive control' },
      { retrievalCandidates: pool(40) },
      svc.mergeConfig(),
      {}
    );

    const coverage = result.data.screeningCoverage;
    expect(coverage.decisionCounts).toEqual({ accept: 4, component: 0, borderline: 0, reject: 36 });
    expect(coverage.rejectRate).toBe(0.9);
    expect(coverage.poolSize).toBe(40);
    expect(coverage.stopClass).toBe('exhausted');
    expect(coverage.unknownDecisionCount).toBe(0);
  });

  test('counts decision literals the gate invented instead of discarding those candidates', async () => {
    const { llmGateway } = await import('./metering/gateway');
    const svc = harness();
    (llmGateway.executeLLMOperation as any).mockImplementation(async ({}, request: any) => {
      const rows = promptIds(request).map(pn => ({
        pn, score: 0.5, decision: 'partial', matched_features: [], missing_features: [], evidence_quality: 'medium',
      }));
      return { success: true, response: { output: JSON.stringify(rows), inputTokens: 10, outputTokens: 5 } };
    });

    const result = await (svc as any).performStage15(
      'drift-run',
      { inventionFeatures: ['adaptive control'], searchQuery: 'adaptive control' },
      { retrievalCandidates: pool(20) },
      svc.mergeConfig(),
      {}
    );

    const coverage = result.data.screeningCoverage;
    expect(coverage.unknownDecisionCount).toBe(20);
    expect(coverage.unknownDecisionSamples[0]).toBe('partial x20');
    // The whole point: a drifted vocabulary must not empty the pipeline.
    expect(coverage.decisionCounts.reject).toBe(0);
    expect(coverage.decisionCounts.borderline).toBe(20);
    expect(result.data.borderline.length).toBeGreaterThan(0);
  });

  test('retries once when a wave fails wholesale, then keeps screening', async () => {
    const { llmGateway } = await import('./metering/gateway');
    const svc = harness();
    // Every wave-2 batch fails on first contact and succeeds when retried, keyed by
    // batch rather than by call count so batch size and concurrency cannot skew it.
    const failedOnce = new Set<string>();
    (llmGateway.executeLLMOperation as any).mockImplementation(async ({}, request: any) => {
      const ids = promptIds(request);
      // Wave 2 only (candidates 80-159), so wave 3 is a clean pass and the run can
      // be asserted to finish undegraded.
      if (ids.some(pn => ordinal(pn) >= 80 && ordinal(pn) < 160) && !failedOnce.has(ids[0])) {
        failedOnce.add(ids[0]);
        throw new Error('provider unavailable');
      }
      const rows = ids.map(pn => ({ pn, score: 0.9, decision: 'accept', matched_features: [], missing_features: [], evidence_quality: 'high' }));
      return { success: true, response: { output: JSON.stringify(rows), inputTokens: 10, outputTokens: 5 } };
    });

    const result = await (svc as any).performStage15(
      'retry-run',
      { inventionFeatures: ['adaptive control'], searchQuery: 'adaptive control' },
      { retrievalCandidates: pool(180) },
      svc.mergeConfig(),
      {}
    );

    const coverage = result.data.screeningCoverage;
    expect(coverage.gateErrorRetryUsed).toBe(true);
    expect(coverage.gateErrorRetryRecovered).toBe(true);
    // Recovered, so the run is not truncated at wave 1 and not marked degraded.
    expect(result.data.screeningStopReason).not.toBe('gate_errors');
    expect(result.data.gateStatus).toBe('complete');
    expect(coverage.decisionCounts.accept).toBe(180);
  });

  test('stops and reports an error class when the retry does not recover', async () => {
    const { llmGateway } = await import('./metering/gateway');
    const svc = harness();
    (llmGateway.executeLLMOperation as any).mockImplementation(async ({}, request: any) => {
      const ids = promptIds(request);
      if (ids.some(pn => ordinal(pn) >= 80)) throw new Error('provider down');
      const rows = ids.map(pn => ({ pn, score: 0.9, decision: 'accept', matched_features: [], missing_features: [], evidence_quality: 'high' }));
      return { success: true, response: { output: JSON.stringify(rows), inputTokens: 10, outputTokens: 5 } };
    });

    const result = await (svc as any).performStage15(
      'retry-failed-run',
      { inventionFeatures: ['adaptive control'], searchQuery: 'adaptive control' },
      { retrievalCandidates: pool(180) },
      svc.mergeConfig(),
      {}
    );

    const coverage = result.data.screeningCoverage;
    expect(coverage.gateErrorRetryUsed).toBe(true);
    expect(coverage.gateErrorRetryRecovered).toBe(false);
    expect(result.data.screeningStopReason).toBe('gate_errors');
    // An incomplete search must be distinguishable from an exhausted one.
    expect(coverage.stopClass).toBe('error');
  });
});
