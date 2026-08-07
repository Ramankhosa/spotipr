import { describe, expect, it } from 'vitest';
import { buildNoveltyAttorneyReportModel } from './novelty-attorney-report';

describe('buildNoveltyAttorneyReportModel', () => {
  it('applies evidence priorities, caps the main report, retains appendices, and separates jurisdiction metadata', () => {
    const patents = Array.from({ length: 18 }, (_, index) => ({
      publicationNumber: `CN-121704${String(index).padStart(3, '0')}-A`,
      title: `Mapped reference ${index + 1}`,
      abstract: 'An autonomous control loop performs anomaly inference and sends telemetry.',
      relevanceScore: 0.99 - index * 0.01,
      country: 'CN',
      sourceProvider: 'google-patents-corpus',
    }));
    const featureMapFor = (publicationNumber: string, title: string, index: number) => ({
      pn: publicationNumber,
      title,
      feature_analysis: [
        { feature: 'autonomous control loop', status: 'Present', quote: 'autonomous control loop', field: 'abstract', confidence: 0.9 },
        { feature: 'anomaly inference feedback', status: 'Present', quote: 'anomaly inference', field: 'abstract', confidence: 0.9 },
        { feature: 'remote telemetry interface', status: index % 2 === 0 ? 'Present' : 'Absent', quote: index % 2 === 0 ? 'sends telemetry' : '', field: 'abstract', confidence: 0.7 },
        { feature: 'distributed routing actuator', status: index % 2 === 1 ? 'Present' : 'Absent', quote: index % 2 === 1 ? 'distributed routing actuator' : '', field: 'abstract', confidence: 0.7 },
      ],
    });
    const model = buildNoveltyAttorneyReportModel({
      id: 'priority-search',
      title: 'Autonomous inspection controller',
      jurisdiction: 'IN',
      inventionDescription: 'An autonomous controller uses anomaly inference feedback and telemetry.',
      config: { searchSource: { mode: 'LOCAL_CORPUS', filters: {} } },
      stage0Results: {
        searchQuery: 'autonomous anomaly inference controller',
        inventionFeatures: ['autonomous control loop', 'anomaly inference feedback', 'remote telemetry interface', 'distributed routing actuator'],
        featureDetails: [
          { feature: 'autonomous control loop', feature_type: 'core_technical' },
          { feature: 'anomaly inference feedback', feature_type: 'novelty_candidate' },
          { feature: 'remote telemetry interface', feature_type: 'core_technical' },
          { feature: 'distributed routing actuator', feature_type: 'novelty_candidate' },
        ],
        claimConcepts: [{
          title: 'Inference-driven autonomous control',
          linkedFeatures: ['autonomous control loop', 'anomaly inference feedback'],
          claimableSummary: 'Inference feedback controls autonomous operation.',
          importance: 'primary',
        }],
      },
      stage1Results: {
        retrievedCount: 300,
        reviewedCount: 80,
        retrievalCandidates: patents,
        aiRelevance: { byPn: {}, gateStatus: 'complete' },
      },
      stage35Results: {
        feature_map: [
          ...patents.map((patent, index) => featureMapFor(patent.publicationNumber, patent.title, index)),
          featureMapFor('CN 121704000 A', 'Equivalent duplicate', 0),
        ],
      },
      stage4Results: { confidence: 'Medium' },
    });

    expect(model.comparisons).toHaveLength(18);
    expect(model.mainComparisons).toHaveLength(10);
    expect(model.appendixMappedComparisons).toHaveLength(8);
    expect(model.comparisons.filter(item => item.reviewPriority === 'Critical')).toHaveLength(4);
    expect(model.comparisons.filter(item => item.reviewPriority === 'Critical').every(item =>
      model.mainComparisons.some(main => main.publicationNumber === item.publicationNumber)
    )).toBe(true);
    expect(model.comparisons.filter(item => item.reviewPriority === 'High')).toHaveLength(8);
    expect(model.comparisons.filter(item => item.reviewPriority === 'Medium')).toHaveLength(6);
    expect(model.comparisons.find(item => item.publicationNumber === 'CN121704000A')).toMatchObject({
      publicationNumber: 'CN121704000A',
      publicationJurisdiction: 'CN',
      searchAuthorityScope: 'Worldwide',
      targetLegalJurisdiction: 'IN',
      sourceCorpus: 'google-patents-corpus',
      filingCountry: 'Not available',
    });
    expect(model.riskAssessment.highestSingleReferenceCoreCoveragePercent).toBe(75);
    expect(model.riskAssessment.distributedCoreCoveragePercent).toBe(100);
    expect(model.potentialCombinations.length).toBeGreaterThan(0);
    expect(model.potentialCombinations[0].label).toBe('Inventive-step review');
  });

  it('builds professional preliminary assessment sections and side-by-side comparison rows', () => {
    const model = buildNoveltyAttorneyReportModel({
      id: 'search123456789',
      title: 'Soil moisture irrigation controller',
      jurisdiction: 'IN',
      inventionDescription: 'A controller measures soil moisture and modulates irrigation water delivery using threshold logic.',
      config: { searchSource: { mode: 'PQAI_PLUS_INDIAN' } },
      stage0Results: {
        searchQuery: 'soil moisture irrigation controller',
        inventionFeatures: ['soil moisture measurement loop', 'threshold-based irrigation decision rule', 'sensor', 'unsupported dosing signal'],
        noveltyFocus: ['threshold-based irrigation decision rule'],
        featureDetails: [
          {
            feature: 'soil moisture measurement loop',
            feature_type: 'core_technical',
            user_disclosure: 'The invention measures soil moisture in a feedback loop.',
          },
          {
            feature: 'threshold-based irrigation decision rule',
            feature_type: 'novelty_candidate',
            user_disclosure: 'The controller uses threshold logic to decide irrigation delivery.',
          },
          {
            feature: 'sensor',
            feature_type: 'generic_weak',
            user_disclosure: 'The controller uses a sensor.',
          },
        ],
      },
      stage1Results: {
        retrievedCount: 180,
        reviewedCount: 120,
        visibleCount: 30,
        retrievalCandidates: [
          {
            publicationNumber: 'IN123A',
            title: 'Automatic irrigation controller',
            abstract: 'A soil moisture sensor controls irrigation.',
            relevanceScore: 0.82,
            assignees: ['Agro Tech Pvt Ltd'],
            inventors: ['Asha Kumar'],
          },
          {
            publicationNumber: 'IN456A',
            title: 'Irrigation valve timing',
            abstract: 'A valve timing system for irrigation delivery.',
            relevanceScore: 0.61,
            assignees: ['Agro Tech Pvt Ltd'],
            inventors: ['Asha Kumar'],
          },
        ],
        aiRelevance: {
          accepted: ['IN123A'],
          component: ['IN456A'],
          borderline: [],
          byPn: {
            IN123: {
              decision: 'accept',
              score: 0.82,
              rerankScore: 0.82,
              evidence_quality: 'high',
            },
            IN456: {
              decision: 'component',
              score: 0.61,
              rerankScore: 0.61,
              evidence_quality: 'medium',
            },
          },
        },
      },
      stage35Results: {
        feature_map: [
          {
            pn: 'IN123A',
            title: 'Automatic irrigation controller',
            feature_analysis: [
              {
                feature: 'soil moisture measurement loop',
                status: 'Present',
                quote: 'soil moisture sensor controls irrigation',
                field: 'abstract',
              },
              {
                feature: 'threshold-based irrigation decision rule',
                status: 'Absent',
                reason: 'No threshold rule disclosed in the abstract.',
              },
              {
                feature: 'sensor',
                status: 'Present',
                quote: 'soil moisture sensor',
                field: 'abstract',
              },
              {
                feature: 'unsupported dosing signal',
                status: 'Present',
              },
            ],
          },
          {
            pn: 'IN456A',
            title: 'Irrigation valve timing',
            feature_analysis: [
              {
                feature: 'soil moisture measurement loop',
                status: 'Partial',
                quote: 'irrigation delivery',
                field: 'abstract',
              },
              {
                feature: 'threshold-based irrigation decision rule',
                status: 'Absent',
                reason: 'No threshold rule disclosed in the abstract.',
              },
              {
                feature: 'sensor',
                status: 'Absent',
                reason: 'No sensor disclosed in the abstract.',
              },
              {
                feature: 'unsupported dosing signal',
                status: 'Unknown',
                reason: 'Evidence is too thin.',
              },
            ],
          },
        ],
      },
      stage4Results: {
        decision: 'Partially Novel',
        confidence: 'Medium',
        executive_summary: { summary: 'One close irrigation reference was found.' },
        per_patent_remarks: [
          {
            pn: 'IN123A',
            summary: 'Close irrigation-control reference.',
            novelty_threat: 'obvious',
            comparison_rows: [
              {
                feature_id: 'KF1',
                feature: 'soil moisture measurement loop',
                user_invention_disclosure: 'The invention measures soil moisture in a feedback loop.',
                patent_disclosure: 'The patent discloses soil moisture sensing.',
                status: 'Present',
                evidence_quote: 'soil moisture sensor',
                evidence_source: 'abstract',
                extent_score: 0.88,
                confidence: 0.91,
                attorney_remark: 'This is a direct overlap in the abstract.',
                novelty_impact: 'This feature is materially overlapping.',
                claim_review_note: 'Do not rely on this loop alone for novelty.',
                professional_remark: 'The reference teaches soil moisture sensing in the irrigation controller, so claim drafting should focus on the narrower threshold-control rule.',
              },
              {
                feature_id: 'KF2',
                feature: 'threshold-based irrigation decision rule',
                user_invention_disclosure: 'The controller uses threshold logic to decide irrigation delivery.',
                patent_disclosure: 'The patent controls irrigation without disclosing the submitted threshold decision rule.',
                status: 'Absent',
                evidence_quote: '',
                evidence_source: 'none',
                extent_score: 0.08,
                confidence: 0.84,
                attorney_remark: 'Attorney remark: The reference lacks the threshold-triggered sequence. Novelty impact: potential distinction. Claim review note: emphasize threshold inputs.',
                novelty_impact: 'The threshold sequence is a mapped technical difference from this reference.',
                claim_review_note: 'State the threshold inputs and resulting control transition expressly.',
              },
            ],
          },
          {
            pn: 'IN456A',
            summary: 'Related irrigation-control reference.',
            novelty_threat: 'adjacent',
          },
        ],
      },
    });

    expect(model.reportNumber).toMatch(/^PN-NOV-IN-\d{8}-SEARCH12$/);
    expect(model.tableOfContents.map(item => item.title)).toContain('Search Scope and Methodology');
    expect(model.tableOfContents.map(item => item.title)).toContain('Claim-Positioning Analysis');
    expect(model.tableOfContents.map(item => item.title)).toContain('Claim-Positioning Observations');
    expect(model.tableOfContents).toContainEqual({ number: '1', title: 'Search Overview' });
    expect(model.tableOfContents).toContainEqual({ number: '2', title: 'Citation Analysis' });
    expect(model.tableOfContents).toContainEqual({ number: '2.2', title: 'Appendix B: Shortlisted but Unmapped Citations' });
    expect(model.tableOfContents.some(item => item.number === '2.3')).toBe(false);
    expect(model.reportTitle).toBe('Preliminary Novelty Assessment Report');
    expect(model.evidenceBasis).toContain('based on limited preliminary data');
    expect(model.methodology.searchedEvidence).toContain('claims, specification');
    expect(model.methodology.searchedEvidence).toContain('legal status');
    expect(model.methodology.preliminaryStatus).toContain('preliminary assessment');
    expect(model.limitations).toContain('full patent documents');
    expect(model.evidenceBasis).toContain('before any final conclusion');
    expect(model.countLabels.map(item => item.label)).toEqual([
      'Candidate records retrieved/ranked',
      'Shortlisted candidate citations',
      'Direct invention-level mapped citations',
      'Component / feature-level mapped citations',
      'Citations selected for detailed feature mapping',
    ]);
    expect(model.scoringLegend.map(item => item.label)).toEqual(expect.arrayContaining([
      'D - Directly Mapped',
      'P - Partially Mapped',
      'Feature Mapping',
      'N - Not Found',
    ]));
    expect(model.scoringLegend.map(item => item.label)).not.toContain('Retrieval Relevance');
    expect(model.scoringLegend.map(item => item.label)).not.toContain('Evidence Confidence');
    expect(model.scoringLegend.map(item => item.label)).not.toContain('Absent / weak signal');

    expect(model.citations[0]).toMatchObject({ citationNo: 'D1', publicationNumber: 'IN123A' });
    expect(model.citations[0]).toMatchObject({
      matchCategory: 'direct',
      matchCategoryLabel: 'Direct invention-level match',
      referenceRole: 'Closest invention-level reference',
      reviewPriority: 'Medium',
    });
    expect(model.componentCitations.map(item => item.publicationNumber)).toEqual(['IN456A']);
    expect(model.comparisons[0].technicalDisclosure).toContain('soil moisture sensor');
    expect(model.comparisons[0].abstract).toBe('A soil moisture sensor controls irrigation.');
    expect(model.comparisons[0].rows).toHaveLength(4);
    expect(model.comparisons[0].noveltyThreat).toBe('Related / moderate-overlap');
    expect(model.comparisons[0].claimImpactSummary).toContain('Feature mapping: 2 directly mapped, 0 partially mapped, 1 not expressly taught, 1 requiring full-text review.');
    expect(model.comparisons[0].rows[0]).toMatchObject({
      featureNumber: 'KF1',
      userDisclosure: 'The invention measures soil moisture in a feedback loop.',
      patentDisclosure: 'The patent discloses soil moisture sensing.',
      status: 'Present',
      statusLabel: 'Directly Mapped',
      publicMappingStatus: 'Directly Mapped',
      publicMappingCode: 'D',
      evidenceSource: 'source record',
      extentScore: 0.88,
      confidence: 0.91,
      evidenceStrength: 'Strong',
      crispRemark: 'This is a direct overlap in the abstract.',
      professionalRemark: 'The reference teaches soil moisture sensing in the irrigation controller, so claim drafting should focus on the narrower threshold-control rule.',
      attorneyRemark: 'This is a direct overlap in the abstract.',
      claimReviewNote: 'Do not rely on this loop alone for novelty.',
    });
    expect(model.comparisons[0].rows[1]).toMatchObject({
      featureNumber: 'KF2',
      status: 'Absent',
      statusLabel: 'Not Found in Reviewed Record',
      publicMappingStatus: 'Not Found in Reviewed Record',
      publicMappingCode: 'N',
      patentDisclosure: 'The patent controls irrigation without disclosing the submitted threshold decision rule.',
      evidenceSource: 'none',
      extentScore: null,
      crispRemark: 'The reference lacks the threshold-triggered sequence. potential distinction. emphasize threshold inputs.',
    });
    expect(model.comparisons[0].rows[1].crispRemark).not.toMatch(/Attorney remark|Novelty impact|Claim review note/i);
    expect(model.comparisons[0].rows[1].professionalRemark).toContain('The reference lacks the threshold-triggered sequence.');
    expect(model.comparisons[0].rows[1].professionalRemark).toContain('potential distinction.');
    expect(model.comparisons[0].rows[1].professionalRemark).not.toMatch(/Attorney remark|Novelty impact|Claim review note|Confidence|Coverage|\d+%/i);
    expect(model.comparisons[0].rows[3]).toMatchObject({
      featureNumber: 'KF4',
      status: 'Unknown',
      // States what the record shows rather than assigning the reader homework.
      statusLabel: 'Not Established in Reviewed Record',
      publicMappingStatus: 'Not Established in Reviewed Record',
      publicMappingCode: 'R',
      evidenceStrength: 'Weak',
      evidenceSource: 'none',
    });
    expect(model.comparisons[0].rows[3].professionalRemark).toContain('unsupported dosing signal');

    expect(model.featureSummaries[2]).toMatchObject({
      featureNumber: 'KF3',
      type: 'generic_weak',
      importance: 'secondary_implementation',
    });
    expect(model.featureSummaries[0]).toMatchObject({
      importance: 'core_inventive',
      importanceLabel: 'Core inventive feature',
    });
    expect(model.riskAssessment).toMatchObject({
      noveltyRisk: 'Low',
      combinationRisk: 'Moderate',
      headline: 'Moderate mapped-overlap risk',
      coreFeatureCount: 2,
    });
    expect(model.riskAssessment.noveltyRiskExplanation).toContain('No single reviewed citation maps most core inventive features');
    expect(model.potentialDifferentiationSpace).toContain('Potential differentiation space');
    expect(model.matrixInsight).toContain('No cited reference maps');
    expect(model.genericFeatureRisk.features).toContain('sensor');
    expect(model.assigneeLandscape.summary).toContain('repeated entity signal');
    expect(model.inventorSignals.repeated).toEqual([{ name: 'Asha Kumar', count: 2 }]);
    expect(model.reportConfidence.legalConclusion).toBe('Not provided; requires review.');
    expect(model.limitations).toContain('not a legal opinion');
    expect(model.nextSteps).toEqual(expect.arrayContaining([
      'Review the highest-overlap mapped citations at claim level.',
    ]));
    expect(model.counts).toMatchObject({
      searched: 180,
      found: 2,
      directlyRelevant: 1,
      analyzed: 2,
    });
    const renderedModelText = JSON.stringify(model);
    expect(model.publicClosestCitation?.publicationNumber).toBe('IN123A');
    expect(model.claimPositioningAnalysis?.primaryClaimFocus).toContain('threshold-based irrigation decision rule');
    expect(model.claimPositioningAnalysis?.remainingInventiveCore).toMatch(/^Although the reviewed references disclose/i);
    expect(model.claimDraftingConsiderations?.independentClaimFocus).toMatch(/^Consider emphasizing/);
    expect(model.draftingOpportunities?.some(item => item.opportunityType === 'primary')).toBe(true);
    expect(model.strategicReviewFocus).toMatchObject({
      highestPriorityReference: 'IN123A',
    });
    expect(model.strategicReviewFocus?.reviewReason).toContain('Highest weighted overlap');
    expect(renderedModelText).not.toMatch(/Mapped, needs review|Absent \/ weak signal|Evidence Confidence|limited available patent data|deterministic fallback|available data does not/i);
  });

  it('uses deterministic distributed-risk logic, evidence downgrades, optional weighting, and entity cleanup', () => {
    const base = {
      id: 'distributed123',
      title: 'Humidity responsive blister package',
      jurisdiction: 'IN',
      inventionDescription: 'A blister package uses cavity-level humidity indication, isolation, calibration, and smartphone verification.',
      config: { searchSource: { mode: 'PQAI_PLUS_INDIAN' } },
      stage0Results: {
        searchQuery: 'humidity blister indicator',
        inventionFeatures: [
          'cavity-level humidity-responsive indicator',
          'moisture-isolation micro-seal localizing humidity ingress',
          'reference calibration zone',
          'optional smartphone-readable verification marker',
        ],
        featureDetails: [
          { feature: 'cavity-level humidity-responsive indicator', feature_type: 'novelty_candidate' },
          { feature: 'moisture-isolation micro-seal localizing humidity ingress', feature_type: 'novelty_candidate' },
          { feature: 'reference calibration zone', feature_type: 'implementation' },
          { feature: 'optional smartphone-readable verification marker', feature_type: 'implementation' },
        ],
      },
      stage1Results: {
        retrievedCount: 127,
        reviewedCount: 58,
        retrievalCandidates: [
          { publicationNumber: 'CN1', title: 'Blister package', abstract: 'A blister package has a moisture-proof seal and isolation cavity.', assignees: ['LEVOSIL S.P.A.'], inventors: ['E.', 'Thomas'] },
          { publicationNumber: 'IN2', title: 'Humidity indicator', abstract: 'A cavity-level humidity-responsive indicator changes color.', assignees: ['INNORESE AG'], inventors: ['Asha Kumar'] },
          { publicationNumber: 'US3', title: 'Verification marker', abstract: 'A smartphone-readable verification marker is provided.', assignees: ['MULTISORB TECHNOLOGIES'], inventors: ['R.', 'Asha Kumar'] },
        ],
        aiRelevance: {
          accepted: [],
          component: ['CN1', 'IN2', 'US3'],
          borderline: [],
          byPn: {
            CN1: { decision: 'component', score: 0.7 },
            IN2: { decision: 'component', score: 0.7 },
            US3: { decision: 'component', score: 0.7 },
          },
        },
      },
      stage35Results: {
        feature_map: [
          {
            pn: 'CN1',
            title: 'Blister package',
            feature_analysis: [
              { feature: 'cavity-level humidity-responsive indicator', status: 'Absent', reason: 'No indicator.' },
              { feature: 'moisture-isolation micro-seal localizing humidity ingress', status: 'Present', quote: 'moisture-proof seal and isolation cavity', field: 'abstract' },
              { feature: 'reference calibration zone', status: 'Absent', reason: 'No calibration.' },
              { feature: 'optional smartphone-readable verification marker', status: 'Absent', reason: 'No smartphone marker.' },
            ],
          },
          {
            pn: 'IN2',
            title: 'Humidity indicator',
            feature_analysis: [
              { feature: 'cavity-level humidity-responsive indicator', status: 'Present', quote: 'cavity-level humidity-responsive indicator changes color', field: 'abstract' },
              { feature: 'moisture-isolation micro-seal localizing humidity ingress', status: 'Absent', reason: 'No micro-seal.' },
              { feature: 'reference calibration zone', status: 'Absent', reason: 'No calibration.' },
              { feature: 'optional smartphone-readable verification marker', status: 'Absent', reason: 'No smartphone marker.' },
            ],
          },
          {
            pn: 'US3',
            title: 'Verification marker',
            feature_analysis: [
              { feature: 'cavity-level humidity-responsive indicator', status: 'Absent', reason: 'No humidity indicator.' },
              { feature: 'moisture-isolation micro-seal localizing humidity ingress', status: 'Absent', reason: 'No seal.' },
              { feature: 'reference calibration zone', status: 'Absent', reason: 'No calibration.' },
              { feature: 'optional smartphone-readable verification marker', status: 'Present', quote: 'smartphone-readable verification marker', field: 'abstract' },
            ],
          },
        ],
      },
      stage4Results: {
        decision: 'Not Novel',
        risk_factors: ['Not Novel determination indicates material prior-art overlap requiring claim narrowing.'],
      },
    };
    const first = buildNoveltyAttorneyReportModel(base);
    const second = buildNoveltyAttorneyReportModel(base);

    expect(second.riskAssessment).toEqual(first.riskAssessment);
    expect(first.riskAssessment).toMatchObject({
      noveltyRisk: 'Low',
      combinationRisk: 'High',
      headline: 'High component-combination risk',
      coreFeatureCount: 2,
    });
    expect(first.finalAssessment.decision).toBe('Not Novel');
    expect(first.finalAssessment.risks.join(' ')).not.toMatch(/Not Novel determination/i);
    expect(first.featureSummaries[3]).toMatchObject({
      importance: 'optional_embodiment',
      importanceLabel: 'Optional embodiment',
    });
    expect(first.comparisons.find(item => item.publicationNumber === 'US3')?.coverage.score).toBeGreaterThan(0);
    expect(first.riskAssessment.coreFeatureCount).toBe(2);
    expect(first.assigneeLandscape.groups.find(group => group.label === 'Companies / commercial entities')?.names).toEqual(
      expect.arrayContaining(['LEVOSIL S.P.A.', 'INNORESE AG', 'MULTISORB TECHNOLOGIES'])
    );
    expect(JSON.stringify(first.inventorSignals)).not.toMatch(/\bE\.|\bR\.|Thomas/);
    expect(first.citations.map(item => item.referenceRole)).not.toEqual(expect.arrayContaining([
      'Smart verification reference',
      'Indicator / exposure-response reference',
      'Desiccant / moisture-control reference',
      'Closest structural packaging reference',
    ]));
    expect(first.citations.map(item => item.referenceRole)).toEqual(expect.arrayContaining([
      'Structural reference',
      'Sensor / monitoring reference',
      'Control / software reference',
    ]));
  });

  it('generates primary and secondary claim-positioning guidance from mapped concepts', () => {
    const model = buildNoveltyAttorneyReportModel({
      id: 'claimfocus123',
      title: 'Closed-loop coating repair platform',
      jurisdiction: 'IN',
      inventionDescription: 'A coating system senses corrosion, estimates repair effect, locally cures a repair material, and updates remaining useful life.',
      stage0Results: {
        searchQuery: 'closed loop corrosion coating repair localized curing',
        inventionFeatures: [
          'controller-driven healing optimization',
          'localized UV curing trigger',
          'self-healing coating chemistry',
          'remaining useful life update',
        ],
        featureDetails: [
          { feature: 'controller-driven healing optimization', feature_type: 'novelty_candidate' },
          { feature: 'localized UV curing trigger', feature_type: 'core_technical' },
          { feature: 'self-healing coating chemistry', feature_type: 'core_technical' },
          { feature: 'remaining useful life update', feature_type: 'novelty_candidate' },
        ],
        claimConcepts: [
          {
            title: 'Closed-loop repair control',
            linkedFeatures: ['controller-driven healing optimization', 'remaining useful life update'],
            claimableSummary: 'controller-driven closed-loop repair optimization',
            importance: 'primary',
          },
          {
            title: 'Localized curing subsystem',
            linkedFeatures: ['localized UV curing trigger'],
            claimableSummary: 'localized curing trigger subsystem',
            importance: 'secondary',
          },
          {
            title: 'Coating chemistry',
            linkedFeatures: ['self-healing coating chemistry'],
            claimableSummary: 'self-healing coating chemistry',
            importance: 'fallback',
          },
        ],
      },
      stage1Results: {
        retrievalCandidates: [
          { publicationNumber: 'USCONTROL1', title: 'Corrosion monitoring controller', abstract: 'A controller monitors corrosion and updates useful life.', relevanceScore: 0.88 },
          { publicationNumber: 'USCURE2', title: 'Localized UV curing', abstract: 'Localized UV curing is triggered for a coating repair region.', relevanceScore: 0.76 },
        ],
        aiRelevance: {
          accepted: [],
          component: ['USCONTROL1', 'USCURE2'],
          borderline: [],
          byPn: {
            USCONTROL1: { decision: 'component', score: 0.88, rerankScore: 0.88, evidence_quality: 'high' },
            USCURE2: { decision: 'component', score: 0.76, rerankScore: 0.76, evidence_quality: 'high' },
          },
        },
      },
      stage35Results: {
        feature_map: [
          {
            pn: 'USCONTROL1',
            title: 'Corrosion monitoring controller',
            feature_analysis: [
              { feature: 'controller-driven healing optimization', status: 'Partial', quote: 'controller monitors corrosion', field: 'abstract' },
              { feature: 'localized UV curing trigger', status: 'Absent', reason: 'No localized curing.' },
              { feature: 'self-healing coating chemistry', status: 'Present', quote: 'self-healing coating', field: 'abstract' },
              { feature: 'remaining useful life update', status: 'Present', quote: 'updates useful life', field: 'abstract' },
            ],
          },
          {
            pn: 'USCURE2',
            title: 'Localized UV curing',
            feature_analysis: [
              { feature: 'controller-driven healing optimization', status: 'Absent', reason: 'No controller optimization.' },
              { feature: 'localized UV curing trigger', status: 'Present', quote: 'localized UV curing is triggered', field: 'abstract' },
              { feature: 'self-healing coating chemistry', status: 'Absent', reason: 'No chemistry.' },
              { feature: 'remaining useful life update', status: 'Absent', reason: 'No useful life update.' },
            ],
          },
        ],
      },
      stage4Results: {
        claimConceptMapping: [
          {
            claimConceptTitle: 'Closed-loop repair control',
            linkedFeatures: ['controller-driven healing optimization', 'remaining useful life update'],
            mappedFeatures: 2,
            totalFeatures: 2,
            coverage: 0.75,
            distributedCoverage: 1,
            bestReference: 'USCONTROL1',
            relationshipMapped: false,
            relationshipEvidence: 'Feature overlap without complete closed-loop repair relationship.',
            relationshipRisk: 'moderate',
            risk: 'moderate',
            reason: 'A citation maps most linked features, but the cooperative relationship is not fully disclosed.',
          },
          {
            claimConceptTitle: 'Localized curing subsystem',
            linkedFeatures: ['localized UV curing trigger'],
            mappedFeatures: 1,
            totalFeatures: 1,
            coverage: 0.5,
            distributedCoverage: 1,
            bestReference: 'USCURE2',
            relationshipMapped: false,
            relationshipEvidence: '',
            relationshipRisk: 'moderate',
            risk: 'moderate',
            reason: 'Feature is mapped but not integrated with control.',
          },
          {
            claimConceptTitle: 'Coating chemistry',
            linkedFeatures: ['self-healing coating chemistry'],
            mappedFeatures: 1,
            totalFeatures: 1,
            coverage: 1,
            distributedCoverage: 1,
            bestReference: 'USCONTROL1',
            relationshipMapped: true,
            relationshipEvidence: 'Self-healing coating is disclosed.',
            relationshipRisk: 'high',
            risk: 'high',
            reason: 'A single reviewed citation maps the linked feature.',
          },
        ],
      },
    });

    expect(model.claimPositioningAnalysis?.primaryClaimFocus).toContain('controller-driven closed-loop repair optimization');
    expect(model.claimPositioningAnalysis?.secondaryClaimFocus).toContain('localized curing trigger subsystem');
    expect(model.claimPositioningAnalysis?.remainingInventiveCore).toMatch(/^Although the reviewed references disclose/i);
    expect(model.claimPositioningAnalysis?.remainingInventiveCore).toContain('retrieved evidence does not identify the complete interaction');
    expect(model.claimPositioningAnalysis?.remainingInventiveCore).not.toMatch(/highly innovative|breakthrough|guaranteed|patentable/i);
    expect(model.conceptMappedCoverageSummary?.find(item => item.conceptTitle === 'Closed-loop repair control')).toMatchObject({
      mappedCoveragePercent: 100,
      singleReferenceMappedCoveragePercent: 75,
      distributedMappedCoveragePercent: 100,
      mappingLevel: 'High',
      closestReferences: ['USCONTROL1'],
    });
    expect(model.draftingOpportunities?.map(item => item.opportunityType)).toEqual(expect.arrayContaining([
      'primary',
      'secondary',
      'avoid_relying_solely_on',
    ]));
    const draftingText = JSON.stringify(model.claimDraftingConsiderations);
    expect(draftingText).not.toMatch(/\bClaim X\b|\bPatent X\b|You should file|This will be patentable|Guaranteed|Safe to file/i);
    for (const item of [
      model.claimDraftingConsiderations?.independentClaimFocus,
      ...(model.claimDraftingConsiderations?.dependentClaimIdeas || []),
      ...(model.claimDraftingConsiderations?.fallbackClaimIdeas || []),
      ...(model.claimDraftingConsiderations?.reviewBeforeDrafting || []),
    ]) {
      expect(item).toMatch(/^(Consider emphasizing|Consider reviewing|Consider separating|Consider protecting|Consider avoiding reliance on)/);
    }
    expect(model.strategicReviewFocus?.highestPriorityReference).toBe('USCONTROL1');
    expect(model.strategicReviewFocus?.reviewReason).toContain('Closed-loop repair control');
  });

  it('marks claim-positioning sections for manual review when mapped evidence is too weak', () => {
    const model = buildNoveltyAttorneyReportModel({
      id: 'weakevidence123',
      title: 'Sparse invention',
      jurisdiction: 'IN',
      stage0Results: {
        searchQuery: 'sparse invention',
        inventionFeatures: ['undocumented control relationship'],
      },
      stage1Results: { retrievalCandidates: [] },
      stage35Results: { feature_map: [] },
      stage4Results: {},
    });

    // Weak mapped evidence must still produce a substantive statement about the art,
    // not a warning about our own confidence or a task handed back to the reader.
    expect(model.claimPositioningAnalysis?.primaryClaimFocus).toContain('feature combination');
    expect(model.claimPositioningAnalysis?.remainingInventiveCore).toContain('feature combination');
    expect(model.strategicReviewFocus?.reviewReason).toContain('feature combination');
    for (const text of [
      model.claimPositioningAnalysis?.primaryClaimFocus,
      model.claimPositioningAnalysis?.reasoning,
      model.strategicReviewFocus?.reviewReason,
      model.strategicReviewFocus?.criticalRelationshipToVerify,
    ]) {
      expect(String(text)).not.toMatch(/manual review|not strong enough|confidence threshold|requires full-text review/i);
    }
  });

  it('uses object-form feature-map evidence when comparison rows do not provide a quote', () => {
    const model = buildNoveltyAttorneyReportModel({
      id: 'objectevidence123',
      title: 'Evidence mapped controller',
      jurisdiction: 'IN',
      stage0Results: {
        searchQuery: 'controller dosage mapping',
        inventionFeatures: ['controller adjusts dosage from patient variables'],
      },
      stage1Results: {
        retrievalCandidates: [{
          publicationNumber: 'INOBJ1',
          title: 'Patient-variable dosage controller',
          abstract: 'The controller adjusts dosage according to patient variables.',
          relevanceScore: 0.86,
        }],
        aiRelevance: {
          accepted: ['INOBJ1'],
          byPn: { INOBJ1: { decision: 'accept', score: 0.86, evidence_quality: 'high' } },
        },
      },
      stage35Results: {
        feature_map: [{
          pn: 'INOBJ1',
          title: 'Patient-variable dosage controller',
          feature_analysis: [{
            feature: 'controller adjusts dosage from patient variables',
            status: 'Present',
            patent_disclosure: 'The reference discloses dosage adjustment based on patient variables.',
            evidence: {
              quote: 'controller adjusts dosage according to patient variables',
              field: 'abstract',
            },
          }],
        }],
      },
      stage4Results: {},
    });

    expect(model.comparisons[0].rows[0]).toMatchObject({
      status: 'Present',
      evidenceQuote: 'controller adjusts dosage according to patient variables',
      evidenceSource: 'source record',
      patentDisclosure: 'The reference discloses dosage adjustment based on patient variables.',
    });
  });

  it('uses claim-supported evidence internally while keeping the public source label generic', () => {
    const model = buildNoveltyAttorneyReportModel({
      id: 'claim-evidence-report',
      title: 'Temperature-aware charging controller',
      jurisdiction: 'IN',
      stage0Results: {
        searchQuery: 'temperature charging current threshold',
        inventionFeatures: ['reduces charging current above a temperature threshold'],
      },
      stage1Results: {
        retrievalCandidates: [{
          publicationNumber: 'USCLAIM1A1',
          title: 'Temperature-aware charging controller',
          abstract: 'A charging controller for a battery.',
          relevanceScore: 0.9,
        }],
        aiRelevance: {
          accepted: ['USCLAIM1A1'],
          byPn: { USCLAIM1: { decision: 'accept', score: 0.9, evidence_quality: 'high' } },
        },
      },
      stage35Results: {
        feature_map: [{
          pn: 'USCLAIM1A1',
          title: 'Temperature-aware charging controller',
          claimsAvailability: 'FULL',
          feature_analysis: [{
            feature: 'reduces charging current above a temperature threshold',
            status: 'Present',
            quote: 'reduces charging current above a temperature threshold',
            evidence_source: 'claims',
            claim_number: 1,
            confidence: 0.9,
          }],
        }],
      },
      stage4Results: {},
    });

    expect(model.comparisons[0].rows[0]).toMatchObject({
      status: 'Present',
      evidenceQuote: 'reduces charging current above a temperature threshold',
      evidenceSource: 'source record',
      evidenceStrength: 'Strong',
    });
    expect(JSON.stringify(model.comparisons[0].rows[0])).not.toContain('claimsAvailability');
  });

  it('keeps gate-rejected retrieval candidates out of the other-shortlisted citations list', () => {
    const model = buildNoveltyAttorneyReportModel({
      id: 'shortlistfilter1',
      title: 'Battery healing controller',
      jurisdiction: 'IN',
      stage0Results: {
        searchQuery: 'battery healing',
        inventionFeatures: ['acoustic defect localization'],
      },
      stage1Results: {
        retrievalCandidates: [
          { publicationNumber: 'IN100A', title: 'Mapped battery reference', abstract: 'Battery reference.', relevanceScore: 0.9 },
          { publicationNumber: 'IN200A', title: 'Gate-accepted battery monitor', abstract: 'Battery monitor.', relevanceScore: 0.72 },
          { publicationNumber: 'IN250A', title: 'Component battery monitor', abstract: 'Battery component.', relevanceScore: 0.68 },
          { publicationNumber: 'IN260A', title: 'Borderline battery monitor', abstract: 'Battery candidate.', relevanceScore: 0.61 },
          { publicationNumber: 'IN300A', title: 'Score-only borderline candidate', abstract: 'Cell diagnostics.', relevanceScore: 0.55 },
          { publicationNumber: 'IN400A', title: 'Water quality inspection drone', abstract: 'A drone inspects water quality.', relevanceScore: 0.92 },
          { publicationNumber: 'IN500A', title: 'Aquatic environment monitor', abstract: 'Aquarium environment control.' },
        ],
        aiRelevance: {
          accepted: ['IN200A'],
          byPn: {
            IN100: { decision: 'accept', score: 0.9, evidence_quality: 'high' },
            IN200: { decision: 'accept', score: 0.72, evidence_quality: 'high' },
            IN250: { decision: 'component', score: 0.68, evidence_quality: 'medium' },
            IN260: { decision: 'borderline', score: 0.61, evidence_quality: 'medium' },
            IN400: { decision: 'reject', score: 0.12, evidence_quality: 'low' },
          },
        },
      },
      stage35Results: {
        feature_map: [{
          pn: 'IN100A',
          title: 'Mapped battery reference',
          feature_analysis: [{ feature: 'acoustic defect localization', status: 'Present', quote: 'battery', field: 'abstract' }],
        }],
      },
      stage4Results: {},
    });

    // The three explicit gate decisions retain their categories. A raw score cannot
    // promote IN300A, and IN400A remains excluded despite its deliberately high score.
    expect(model.otherShortlistedCitations.map(item => item.publicationNumber)).toEqual(['IN200A', 'IN250A', 'IN260A']);
    expect(model.otherShortlistedCitations[0].referenceRole).toBe('Gate accepted / not mapped');
    expect(model.otherShortlistedCitations[0].matchCategory).toBe('direct');
    expect(model.otherShortlistedCitations[1]).toMatchObject({
      referenceRole: 'Component candidate / not mapped',
      matchCategory: 'component',
      reviewPriority: 'Medium',
    });
    expect(model.otherShortlistedCitations[2]).toMatchObject({
      referenceRole: 'Borderline candidate / not mapped',
      matchCategory: 'borderline',
      reviewPriority: 'Low',
    });
    expect(model.otherShortlistedCitations.some(item => item.referenceRole === 'Requires full-text review')).toBe(false);
    expect(model.otherShortlistedEligibleCount).toBe(3);
    expect(model.otherShortlistedRejectedCount).toBe(1);
    expect(model.otherShortlistedUngatedCount).toBe(2);
    expect(model.otherShortlistedExcludedCount).toBe(3);
  });

  it('uses a valid persisted reference partition and recomputes an invalid one', () => {
    const publications = ['US100A', 'US200A', 'US300A', 'US400A'];
    const featureMap = publications.map(publicationNumber => ({
      pn: publicationNumber,
      title: publicationNumber,
      feature_analysis: [{ feature: 'adaptive control', status: 'Present', quote: 'adaptive control', field: 'abstract' }],
    }));
    const counts = {
      mappedTotal: 4,
      mainDisplayed: 3,
      mappedSupplementaryDisplayed: 1,
      unmappedEligibleTotal: 0,
      unmappedDisplayed: 0,
      unmappedOmitted: 0,
      explicitlyRejectedExcluded: 0,
      ungatedExcluded: 0,
      invalidPublicationNumbersExcluded: 0,
      protectedOverflow: 0,
    };
    const persisted = {
      version: 1,
      main: ['US400A', 'US200A', 'US300A'].map(publicationNumber => ({
        publicationNumber,
        canonicalPublicationNumber: publicationNumber.replace(/A$/, ''),
        reason: 'ranked_fill',
      })),
      mappedSupplementary: [{
        publicationNumber: 'US100A',
        canonicalPublicationNumber: 'US100',
        reason: 'mapped_supplementary',
      }],
      unmappedSupplementary: [],
      counts,
    };
    const searchRun = {
      id: 'persisted-selection',
      title: 'Adaptive controller',
      jurisdiction: 'IN',
      config: { stage4: { mainReferenceTarget: 3, minMainReferences: 3 } },
      stage0Results: { inventionFeatures: ['adaptive control'] },
      stage1Results: {
        retrievalCandidates: publications.map(publicationNumber => ({ publicationNumber, title: publicationNumber })),
        aiRelevance: { byPn: {} },
      },
      stage35Results: { feature_map: featureMap },
      stage4Results: { report_reference_selection: persisted },
    };

    const model = buildNoveltyAttorneyReportModel(searchRun);
    expect(model.mainComparisons.map(item => item.publicationNumber)).toEqual(['US400A', 'US200A', 'US300A']);
    expect(model.appendixMappedComparisons.map(item => item.publicationNumber)).toEqual(['US100A']);

    const invalidModel = buildNoveltyAttorneyReportModel({
      ...searchRun,
      stage4Results: {
        report_reference_selection: {
          ...persisted,
          mappedSupplementary: [],
          counts: { ...counts, mappedTotal: 3, mappedSupplementaryDisplayed: 0 },
        },
      },
    });
    expect(invalidModel.mainComparisons).toHaveLength(3);
    expect(invalidModel.appendixMappedComparisons).toHaveLength(1);
    expect(new Set([
      ...invalidModel.mainComparisons,
      ...invalidModel.appendixMappedComparisons,
    ].map(item => item.publicationNumber))).toEqual(new Set(publications));
  });

  it('states a claim impact for every reference and never hands the assessment back', () => {
    const publications = ['US800A', 'US801A', 'US802A'];
    const model = buildNoveltyAttorneyReportModel({
      id: 'tone-check',
      title: 'Adaptive irrigation controller',
      jurisdiction: 'IN',
      config: {},
      stage0Results: {
        inventionFeatures: ['soil moisture sensing', 'closed-loop valve control'],
        featureDetails: [
          { feature: 'soil moisture sensing', feature_type: 'core_technical' },
          { feature: 'closed-loop valve control', feature_type: 'novelty_candidate' },
        ],
      },
      stage1Results: {
        retrievalCandidates: publications.map(publicationNumber => ({ publicationNumber, title: publicationNumber })),
        aiRelevance: { byPn: {} },
      },
      stage35Results: {
        feature_map: publications.map((publicationNumber, index) => ({
          pn: publicationNumber,
          title: publicationNumber,
          feature_analysis: [
            { feature: 'soil moisture sensing', status: 'Present', quote: 'a soil moisture sensing probe measures soil moisture', evidence_source: 'abstract', confidence: 0.9 },
            // Only the first reference also maps the novelty-candidate feature, so it
            // is the one that must come out at the top of the scale.
            index === 0
              ? { feature: 'closed-loop valve control', status: 'Present', quote: 'closed-loop control of the valve from the moisture signal', evidence_source: 'claims', confidence: 0.9 }
              // Low confidence keeps this genuinely undetermined: with no stated
              // confidence the builder resolves it to a definite "Not found" instead.
              : { feature: 'closed-loop valve control', status: 'Unknown', confidence: 0.4 },
          ],
        })),
      },
      stage4Results: {},
    });

    // Every reference gets a stated level on one scale. "Review" is not a level:
    // the strongest references are tagged Critical by applySelectivePriorities, and a
    // display path that fails to recognise it silently understates the finding.
    for (const comparison of model.comparisons) {
      expect(['Critical', 'High', 'Medium', 'Low']).toContain(comparison.reviewPriority);
      expect(comparison.referenceRole).not.toMatch(/review/i);
    }
    expect(model.comparisons.some(c => c.reviewPriority === 'Critical' || c.reviewPriority === 'High')).toBe(true);

    // An undetermined cell reports the state of the record, not an instruction.
    const undetermined = model.comparisons
      .flatMap(comparison => comparison.rows)
      .find(row => row.status === 'Unknown');
    expect(undetermined?.statusLabel).toBe('Not Established in Reviewed Record');

    const legend = model.scoringLegend.map(entry => `${entry.label} ${entry.meaning}`).join(' ');
    expect(legend).not.toMatch(/requires full-text review/i);
  });

  it('recomputes a stale selection under the rule it was written with', () => {
    // 14 references, each strongly mapping two important features, so all of them
    // clear the materiality bar and none of them is hidden by a fixed target.
    const publications = Array.from({ length: 14 }, (_, index) => `US${900 + index}A`);
    const featureMap = publications.map(publicationNumber => ({
      pn: publicationNumber,
      title: publicationNumber,
      feature_analysis: [
        { feature: 'adaptive control', status: 'Present', quote: 'adaptive control', field: 'abstract' },
        { feature: 'moisture feedback', status: 'Present', quote: 'moisture feedback', field: 'abstract' },
      ],
    }));
    const baseRun = {
      id: 'stale-selection',
      title: 'Adaptive controller',
      jurisdiction: 'IN',
      config: {},
      stage0Results: { inventionFeatures: ['adaptive control', 'moisture feedback'] },
      stage1Results: {
        retrievalCandidates: publications.map(publicationNumber => ({ publicationNumber, title: publicationNumber })),
        aiRelevance: { byPn: {} },
      },
      stage35Results: { feature_map: featureMap },
    };
    // Deliberately stale: the partition names references that no longer exist, so
    // validation fails and the renderer has to recompute.
    const staleSelection = (rule?: string) => ({
      report_reference_selection: {
        version: 1,
        ...(rule ? { rule } : {}),
        main: [{ publicationNumber: 'US1A', canonicalPublicationNumber: 'US1', reason: 'ranked_fill' }],
        mappedSupplementary: [],
        unmappedSupplementary: [],
        counts: {
          mappedTotal: 1,
          mainDisplayed: 1,
          mappedSupplementaryDisplayed: 0,
          unmappedEligibleTotal: 0,
          unmappedDisplayed: 0,
          unmappedOmitted: 0,
          explicitlyRejectedExcluded: 0,
          ungatedExcluded: 0,
          invalidPublicationNumbersExcluded: 0,
          protectedOverflow: 0,
        },
      },
    });

    // No rule on the blob, and no blob at all, both mean the legacy fixed target.
    const legacy = buildNoveltyAttorneyReportModel({ ...baseRun, stage4Results: staleSelection() });
    expect(legacy.mainComparisons).toHaveLength(10);
    expect(legacy.appendixMappedComparisons).toHaveLength(4);

    const noBlob = buildNoveltyAttorneyReportModel({ ...baseRun, stage4Results: {} });
    expect(noBlob.mainComparisons).toHaveLength(10);

    // A materiality-era run recomputes under materiality: every qualifying
    // reference is shown, so nothing lands in the appendix.
    const materiality = buildNoveltyAttorneyReportModel({
      ...baseRun,
      stage4Results: staleSelection('materiality_v1'),
    });
    expect(materiality.mainComparisons).toHaveLength(14);
    expect(materiality.appendixMappedComparisons).toHaveLength(0);
  });
});
