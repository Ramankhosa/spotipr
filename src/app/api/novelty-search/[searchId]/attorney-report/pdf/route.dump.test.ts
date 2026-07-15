import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { verifyJWT } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildNoveltyAttorneyReportModel } from '@/lib/novelty-attorney-report'
import { hydrateNoveltyReportPatentMetadata } from '@/lib/novelty-report-metadata'
import { GET } from './route'

vi.mock('@/lib/auth', () => ({ verifyJWT: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { noveltySearchRun: { findFirst: vi.fn() } } }))
vi.mock('@/lib/novelty-report-metadata', () => ({ hydrateNoveltyReportPatentMetadata: vi.fn() }))
vi.mock('@/lib/novelty-attorney-report', () => ({ buildNoveltyAttorneyReportModel: vi.fn() }))

const OUT = process.env.PDF_DUMP_PATH || ''

const statuses = ['Present', 'Partial', 'Absent', 'Absent', 'Absent', 'Absent', 'Absent', 'Absent'] as const

function featureRow(index: number, refIndex: number) {
  const status = statuses[(index + refIndex) % statuses.length]
  return {
    featureNumber: `KF${index + 1}`,
    userFeature: `Feature ${index + 1}: acoustic tomography for internal battery cell defect localization`,
    userDisclosure: `Complete submitted disclosure for feature ${index + 1}.`,
    patentDisclosure: status === 'Absent'
      ? `No related mechanism was identified for feature ${index + 1} in the reviewed record.`
      : `The reference describes a closely related mechanism for feature ${index + 1}, including sensor excitation, response capture, and localized interpretation of the measured response for cell condition assessment.`,
    status,
    statusLabel: status === 'Present' ? 'Directly Mapped' : status === 'Partial' ? 'Partially Mapped' : 'Not Found',
    publicMappingStatus: status,
    publicMappingCode: status === 'Present' ? 'D' : status === 'Partial' ? 'P' : 'N',
    evidenceQuote: status === 'Absent' ? '' : `the system emits a swept ultrasonic pulse into the cell and captures the transmitted acoustic response for interpretation (ref ${refIndex + 1}, feature ${index + 1})`,
    evidenceSource: status === 'Absent' ? 'none' : 'abstract',
    evidenceStrength: status === 'Present' ? 'Strong' : status === 'Partial' ? 'Moderate' : 'Weak',
    evidenceStrengthReason: status === 'Absent' ? 'No affirmative mapped evidence was identified for this feature.' : 'Passage supports a related mechanism but does not prove every feature constraint.',
    extentScore: status === 'Absent' ? 0 : 0.7,
    crispRemark: `Crisp remark for feature ${index + 1}.`,
    professionalRemark: `This reference ${status === 'Absent' ? 'does not disclose' : 'teaches a mechanism related to'} feature ${index + 1}. Claim drafting should preserve the embedded transducer arrangement, the localization output, and the integration into a repair-triggering workflow so the cooperative relationship remains explicit during review.`,
    attorneyRemark: 'Attorney remark.',
    noveltyImpact: 'Novelty impact.',
    claimReviewNote: 'Claim review note.',
    confidence: 0.8,
  }
}

function citation(refIndex: number) {
  const rows = Array.from({ length: 8 }, (_, i) => featureRow(i, refIndex))
  return {
    publicationNumber: `IN2026${String(refIndex + 1).padStart(5, '0')}`,
    applicationNumber: `2026${String(refIndex + 1).padStart(8, '0')}`,
    title: `Battery reference ${refIndex + 1}: electrochemical impedance spectroscopy measurement apparatus and method for battery health state estimation`,
    publicationDate: '2026-01-10',
    filingDate: '2025-03-01',
    priorityDate: '2024-03-01',
    assignees: 'Example Energy Research Corporation Private Limited',
    inventors: 'A. Inventor; B. Inventor; C. Inventor',
    cpcCodes: 'G01R 31/389, H01M 10/48',
    ipcCodes: 'G01R 31/389, H01M 10/48',
    link: '',
    matchCategoryLabel: 'Component / feature-level prior art',
    evidenceQuality: 'medium',
    referenceRole: refIndex % 3 === 0 ? 'Sensor / monitoring reference' : 'Remote background reference',
    reviewPriority: refIndex % 4 === 0 ? 'High' : refIndex % 4 === 1 ? 'Medium' : 'Standard',
    relevanceScore: 0.8 - refIndex * 0.01,
    noveltyThreat: 'Related / moderate-overlap',
    overlapRiskLevel: 'Medium',
    coverage: { score: 0.2, present: 1, partial: 1, absent: 6 },
    abstract: `An electrochemical impedance system comprising a vehicle battery, a battery management system, an excitation power module, and a current sensor. The BMS is configured to control the excitation power module to excite battery modules and receive sensed current so the system can determine the electrochemical impedance of the vehicle battery and generate a battery cell degradation output based at least on the determined impedance. Reference ${refIndex + 1}.`,
    technicalDisclosure: '',
    summary: `The patent is a clean match for the invention's EIS monitoring element in a vehicle battery context, but it does not disclose the acoustic localization, AI spatial mapping, repair-agent delivery, or post-repair control sequence. Reference ${refIndex + 1}.`,
    claimImpactSummary: 'Feature mapping: 1 directly mapped, 1 partially mapped, 6 not expressly taught. Related / moderate-overlap.',
    rows,
  }
}

function reportModel() {
  const comparisons = Array.from({ length: 48 }, (_, i) => citation(i))
  const featureRows = comparisons[0].rows
  return {
    reportNumber: 'PN-NOV-IN-20260713-SAMPLE01',
    reportTitle: 'Preliminary Novelty Assessment Report',
    inventionTitle: 'Autonomous Self-Healing EV Battery Pack Using Acoustic Tomography, Microfluidic Electrolyte Redistribution, and Digital-Twin Control',
    jurisdiction: 'IN',
    sourceMode: 'INDIA_PLUS_INTERNATIONAL',
    generatedDate: '2026-07-13',
    confidentiality: 'Confidential review draft',
    preparedBy: 'PatentNest.ai Patent Intelligence',
    searchQuery: 'Battery pack health monitoring system using acoustic tomography and impedance sensing to localize internal cell defects and control repair or isolation',
    inventionFeatures: featureRows.map(row => row.userFeature),
    evidenceBasis: 'Disclaimer: This preliminary assessment is based on limited preliminary data. Review the full patent text, claims, specification, drawings, family/legal status, and prosecution history before any final conclusion.',
    methodology: {
      corpus: 'India + Europe + international patents; Scholarly papers (google scholar, semantic scholar, crossref)',
      retrievalMode: 'Hybrid retrieval/ranking with AI relevance gating and feature mapping',
      searchedEvidence: 'This preliminary screening uses selected patent records and scholarly-paper bibliographic records, including available abstracts and metadata.',
      preliminaryStatus: 'AI-assisted preliminary assessment for professional review; not a legal opinion unless separately reviewed by qualified counsel.',
      techniques: ['LLM-assisted invention normalization and key-feature extraction', 'Patent and scholarly-paper candidate retrieval and ranking', 'AI relevance gating before detailed mapping', 'Feature-by-feature evidence mapping using explicit source labels'],
    },
    counts: { searched: 180, found: 59, directlyRelevant: 0, retrieved: 180, reviewed: 59, visible: 54, analyzed: 48 },
    countLabels: [
      { label: 'Candidate records retrieved/ranked', value: 180 },
      { label: 'Shortlisted candidate citations', value: 59 },
      { label: 'Direct invention-level mapped citations', value: 0 },
      { label: 'Component / feature-level mapped citations', value: 48 },
      { label: 'Citations selected for detailed feature mapping', value: 48 },
    ],
    scoringLegend: [
      { label: 'D - Directly Mapped', meaning: 'The reviewed record explicitly states the mapped mechanism for this feature.' },
      { label: 'P - Partially Mapped', meaning: 'The citation discloses a related mechanism; at least one required element remains distinct.' },
      { label: 'N - Not Found', meaning: 'The feature was not found in the reviewed preliminary record.' },
    ],
    tableOfContents: [],
    featureSummaries: featureRows.map((row, i) => ({
      featureNumber: row.featureNumber,
      feature: row.userFeature,
      importance: i < 5 ? 'core_inventive' : 'secondary',
      importanceLabel: i < 5 ? 'Core inventive feature' : 'Secondary implementation feature',
      type: i === 3 || i === 4 ? 'novelty_candidate' : 'core_technical',
      typeLabel: i === 3 || i === 4 ? 'Novelty candidate' : 'Core technical',
      genericWarning: '',
    })),
    genericFeatureRisk: { features: [], summary: 'No standalone generic feature risk was detected from the extracted feature list.' },
    citations: comparisons,
    componentCitations: comparisons,
    directCitations: [],
    borderlineCitations: [],
    otherShortlistedCitations: Array.from({ length: 12 }, (_, i) => ({
      citationNo: `S${i + 1}`,
      publicationNumber: `CN2026${String(i + 1).padStart(5, '0')}`,
      title: `Shortlisted battery diagnostics reference ${i + 1} that cleared the relevance gate`,
      referenceType: 'patent',
      relevanceScore: 0.6 - i * 0.01,
      evidenceQuality: 'not mapped',
      referenceRole: 'Shortlisted / not mapped',
      reviewPriority: 'Standard',
      matchCategory: 'rejected',
      matchCategoryLabel: 'Not mapped / shortlisted',
    })),
    otherShortlistedExcludedCount: 19,
    assignees: ['Example Energy Research Corporation'],
    inventors: ['A. Inventor', 'B. Inventor'],
    assigneeLandscape: { summary: '7 repeated entity signal(s) found across mapped citations.', groups: [{ label: 'Companies / commercial entities', names: ['Example Energy Research Corporation', 'Battery Systems International Ltd'] }], repeated: [{ name: 'Example Energy Research Corporation', count: 5 }] },
    inventorSignals: { summary: '3 repeated inventor signal(s) found across mapped citations.', groups: [{ label: 'Repeated inventor signals', names: ['A. Inventor', 'B. Inventor'] }], repeated: [{ name: 'A. Inventor', count: 9 }] },
    comparisons,
    riskAssessment: {
      noveltyRisk: 'Low',
      noveltyRiskLabel: 'Novelty / anticipation risk: Low',
      noveltyRiskExplanation: 'No single reviewed citation maps most core inventive features.',
      combinationRisk: 'High',
      combinationRiskLabel: 'Component-combination risk: High',
      combinationRiskExplanation: 'Core features are distributed across multiple component references.',
      headline: 'High component-combination risk',
      coreFeatureCount: 5,
      strongestSingleReferenceCoreCoverage: 0.3,
      distributedCoreCoverage: 0.8,
    },
    potentialDifferentiationSpace: 'Potential differentiation space appears to lie in the specific integration of KF1, KF2, KF3, KF4 and KF5. Treat this as a preliminary claim-positioning signal, not a legal patentability conclusion.',
    matrixInsight: 'No cited reference maps KF1 + KF2 + KF3 + KF4 + KF5 together. Core features are distributed across multiple component references.',
    finalAssessment: {
      decision: 'High component-combination risk',
      confidence: 'Medium',
      summary: 'No single reviewed citation maps most core inventive features. Core features are distributed across multiple component references.',
      risks: ['Many references have ambiguous or short abstracts', 'Multiple references appear to be in non-English languages'],
      recommendations: ['Narrow disclosure to potential differentiators', 'Request review before filing decisions'],
    },
    publicClosestCitation: comparisons[0],
    reportConfidence: { automatedReportConfidence: 'Medium', retrievalConfidence: 'Medium', featureMappingConfidence: 'Medium', legalConclusion: 'Not provided; requires review.' },
    claimPositioningAnalysis: {
      primaryClaimFocus: 'Sensor-derived internal localization is converted into a spatial health map, which selects a cell region for microfluidic delivery of electrolyte or additive and then validates repair against a degradation model.',
      secondaryClaimFocus: 'Post-repair condition measurements are evaluated by a digital twin to determine whether switching circuitry should return, derate, bypass, or isolate the cell or section.',
      remainingInventiveCore: 'Although the reviewed references disclose acoustic tomography and impedance measurement individually, the retrieved evidence does not identify the complete interaction between the post-repair digital twin validation, the three-dimensional internal health map, and the microfluidic repair network as described in the submitted invention.',
      whyStillDistinguishable: 'The cooperative relationship across localization, targeted delivery, and post-repair validation remains unmapped by any single reviewed citation.',
      reasoning: 'Derived from mapped coverage, relationship gaps, and unmapped core or novelty-candidate features.',
      weakClaimAreas: ['Generic impedance sensing alone.'],
      avoidRelyingSolelyOn: ['Avoid relying solely on KF1 (acoustic tomography) as the broadest claim focus.', 'Avoid relying solely on KF2 (electrochemical impedance measurement) as the broadest claim focus.'],
    },
    claimDraftingConsiderations: {
      independentClaimFocus: 'Consider emphasizing the sensor-derived internal localization converted into a spatial health map with targeted microfluidic delivery and post-repair digital-twin validation, centered on KF7, KF3, and KF4 with emphasis on the data/control relationship that remains incompletely mapped across the reviewed references.',
      dependentClaimIdeas: ['Consider protecting KF3 (three-dimensional internal health map generated by edge AI) as a dependent or narrower implementation detail.', 'Consider protecting KF4 (microfluidic repair network integrated into a battery module) as a dependent or narrower implementation detail.'],
      fallbackClaimIdeas: ['Consider separating KF8 (cell-level isolation and bypass switching) into record-based review embodiments if the primary focus is closely mapped.'],
      reviewBeforeDrafting: ['Consider reviewing IN202600001 first because it has the strongest mapped overlap.'],
    },
    draftingOpportunities: [
      {
        title: 'Closed-loop localized battery self-repair',
        opportunityType: 'primary',
        linkedFeatures: ['Acoustic tomography for internal battery cell defect localization', 'Three-dimensional internal health map generated by edge AI', 'Microfluidic repair network integrated into a battery module', 'Selective injection of electrolyte or functional additive into an affected cell region', 'Post-repair digital twin validation for service state decision'],
        explanation: 'Consider emphasizing sensor-derived internal localization converted into a spatial health map, which selects a cell region for microfluidic delivery of electrolyte or additive and then validates repair against a degradation model, centered on the post-repair digital twin validation for service state decision, the three-dimensional internal health map generated by edge AI, and the microfluidic repair network integrated into the battery module with emphasis on the data/control relationship that remains incompletely mapped across all of the reviewed component references in this preliminary record set.',
      },
      {
        title: 'Repair-aware battery reconfiguration',
        opportunityType: 'secondary',
        linkedFeatures: ['Post-repair digital twin validation for service state decision', 'Cell-level isolation and bypass switching based on defect condition'],
        explanation: 'Consider separating post-repair condition measurements evaluated by a digital twin to determine whether switching circuitry should return, derate, bypass, or isolate the cell or section, centered on the digital-twin validation and the cell-level isolation and bypass switching with emphasis on the data/control relationship that remains incompletely mapped.',
      },
    ],
    conceptMappedCoverageSummary: [
      { conceptTitle: 'Closed-loop localized battery self-repair', mappedCoveragePercent: 60, singleReferenceMappedCoveragePercent: 20, distributedMappedCoveragePercent: 60, relationshipMapped: false, mappingLevel: 'Moderate', closestReferences: ['IN202600001'] },
      { conceptTitle: 'Multimodal internal defect classification', mappedCoveragePercent: 100, singleReferenceMappedCoveragePercent: 50, distributedMappedCoveragePercent: 100, relationshipMapped: false, mappingLevel: 'Moderate', closestReferences: ['IN202600002'] },
    ],
    strategicReviewFocus: {
      highestPriorityReference: 'IN202600001',
      reviewReason: 'Highest weighted overlap with mapped features and concept coverage.',
      highestOverlap: 'IN202600001',
      lowestOverlap: 'IN202600047',
      criticalRelationshipToVerify: 'Verify whether the full text discloses the complete relationship for closed-loop localized battery self-repair.',
      recommendedFullTextReview: ['IN202600001', 'IN202600002'],
      remainingUncertainties: ['Relationship mapping for closed-loop localized battery self-repair.'],
    },
    attorneyReviewFocus: 'Review IN202600001 first for overlap against closed-loop localized battery self-repair. Preserve the cooperative relationship across KF1 + KF3 + KF4 + KF5 + KF7. Do not treat isolated feature overlap as mapping the claimed relationship unless the relationship is disclosed.',
    mainDifferentiator: 'Internal defect localization drives targeted microfluidic repair, and post-repair digital twin validation controls whether the cell is restored, derated, bypassed, or isolated.',
    claimConceptMapping: [],
    overallDraftingDirection: 'Focus claim drafting on concrete features that remain unmapped or only partially mapped, and verify all mapped references with full patent documents.',
    limitations: 'This preliminary novelty assessment is prepared from automated retrieval, ranking, and feature mapping of patent records available to the system. This report is not a legal opinion.',
    nextSteps: ['Review the highest-overlap mapped citations at claim level.', 'Validate results with full patent documents and non-patent literature searching.'],
  }
}

const mockedVerifyJWT = vi.mocked(verifyJWT)
const mockedFindFirst = vi.mocked(prisma.noveltySearchRun.findFirst)
const mockedHydrate = vi.mocked(hydrateNoveltyReportPatentMetadata)
const mockedBuildReport = vi.mocked(buildNoveltyAttorneyReportModel)

beforeEach(() => {
  vi.clearAllMocks()
  mockedVerifyJWT.mockReturnValue({ sub: 'user-1' } as any)
  mockedFindFirst.mockResolvedValue({ id: 'search-1', userId: 'user-1' } as any)
  mockedHydrate.mockImplementation(async value => value as any)
})

describe.skipIf(!OUT)('PDF dump', () => {
  test('dump sample report', async () => {
    mockedBuildReport.mockReturnValue(reportModel() as any)
    const response = await GET(
      new NextRequest('http://localhost/api/novelty-search/search-1/attorney-report/pdf', { headers: { authorization: 'Bearer t' } }),
      { params: { searchId: 'search-1' } },
    )
    expect(response.status).toBe(200)
    writeFileSync(OUT, Buffer.from(await response.arrayBuffer()))
  }, 120_000)
})
