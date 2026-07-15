import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { verifyJWT } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildNoveltyAttorneyReportModel } from '@/lib/novelty-attorney-report'
import { hydrateNoveltyReportPatentMetadata } from '@/lib/novelty-report-metadata'
import { GET } from './route'

vi.mock('@/lib/auth', () => ({ verifyJWT: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { noveltySearchRun: { findFirst: vi.fn() } },
}))
vi.mock('@/lib/novelty-report-metadata', () => ({ hydrateNoveltyReportPatentMetadata: vi.fn() }))
vi.mock('@/lib/novelty-attorney-report', () => ({ buildNoveltyAttorneyReportModel: vi.fn() }))

const pdfParse = require('pdf-parse-fork') as (buffer: Buffer) => Promise<{ text: string; numpages: number }>
const mockedVerifyJWT = vi.mocked(verifyJWT)
const mockedFindFirst = vi.mocked(prisma.noveltySearchRun.findFirst)
const mockedHydrate = vi.mocked(hydrateNoveltyReportPatentMetadata)
const mockedBuildReport = vi.mocked(buildNoveltyAttorneyReportModel)

function longText(prefix: string, marker: string) {
  return `${prefix} ${Array.from({ length: 850 }, (_, index) => `evidence-${index}`).join(' ')} ${marker}`
}

function executiveText(prefix: string, marker: string) {
  return `${prefix} ${Array.from({ length: 90 }, (_, index) => `snapshot-${index}`).join(' ')} ${marker}`
}

function featureRow(index: number, overrides: Record<string, unknown> = {}) {
  return {
    featureNumber: `KF${index + 1}`,
    userFeature: `Submitted feature ${index + 1}`,
    userDisclosure: `Complete submitted disclosure for feature ${index + 1}.`,
    patentDisclosure: `Mapped patent disclosure for feature ${index + 1}.`,
    status: index % 3 === 0 ? 'Present' : index % 3 === 1 ? 'Partial' : 'Absent',
    statusLabel: index % 3 === 0 ? 'Directly Mapped' : index % 3 === 1 ? 'Partially Mapped' : 'Not Expressly Taught',
    publicMappingStatus: index % 3 === 0 ? 'Directly Mapped' : index % 3 === 1 ? 'Partially Mapped' : 'Not Expressly Taught',
    publicMappingCode: index % 3 === 0 ? 'D' : index % 3 === 1 ? 'P' : 'N',
    evidenceQuote: `Evidence quotation for feature ${index + 1}.`,
    evidenceSource: 'abstract',
    evidenceStrength: index % 3 === 0 ? 'Strong' : index % 3 === 1 ? 'Moderate' : 'Weak',
    evidenceStrengthReason: index % 3 === 0 ? 'Explicit passage directly supports the mapped feature.' : 'Passage requires confirmation from source records.',
    extentScore: index % 3 === 2 ? 0 : 0.72,
    crispRemark: `Attorney remark for feature ${index + 1}.`,
    professionalRemark: `Professional consolidated remark for feature ${index + 1}.`,
    attorneyRemark: `Detailed attorney discussion for feature ${index + 1}.`,
    noveltyImpact: `Novelty impact for feature ${index + 1}.`,
    claimReviewNote: `Claim review note for feature ${index + 1}.`,
    confidence: 0.82,
    ...overrides,
  }
}

function citation(rows: ReturnType<typeof featureRow>[], overrides: Record<string, unknown> = {}) {
  return {
    publicationNumber: 'US-2026-000001-A1',
    applicationNumber: 'US18/000001',
    title: 'Adaptive evidence-driven control system with a complete descriptive citation title',
    publicationDate: '2026-01-10',
    filingDate: '2025-03-01',
    priorityDate: '2024-03-01',
    assignees: 'Example Research Corporation',
    inventors: 'A. Inventor; B. Inventor',
    cpcCodes: 'G06F 16/00',
    ipcCodes: 'G06F 16/00',
    link: 'https://example.test/patent/1',
    matchCategoryLabel: 'Direct match',
    evidenceQuality: 'Mapped evidence',
    referenceRole: 'Closest invention-level reference',
    reviewPriority: 'High',
    relevanceScore: 0.91,
    noveltyThreat: 'High mapped-overlap risk',
    overlapRiskLevel: 'High',
    coverage: { score: 0.74, present: 5, partial: 2, absent: 2 },
    abstract: 'Patent abstract.',
    technicalDisclosure: 'Technical disclosure.',
    summary: 'Reference summary.',
    claimImpactSummary: 'Claim impact summary.',
    rows,
    ...overrides,
  }
}

function reportModel(overrides: Record<string, unknown> = {}) {
  const rows = Array.from({ length: 9 }, (_, index) => featureRow(index))
  const comparison = citation(rows)
  return {
    reportNumber: 'PN-NOV-IN-20260622-TEST001',
    reportTitle: 'Preliminary Novelty Assessment Report',
    inventionTitle: 'Evidence-driven adaptive control platform',
    jurisdiction: 'India',
    sourceMode: 'PQAI_ONLY',
    generatedDate: '22 June 2026',
    confidentiality: 'Confidential — prepared for review',
    preparedBy: 'PatentNest.ai',
    searchQuery: 'adaptive evidence control',
    inventionFeatures: rows.map(row => row.userFeature),
    evidenceBasis: 'Preliminary patentability intelligence with mapped support',
    methodology: {
      corpus: 'International patents',
      retrievalMode: 'Semantic and textual retrieval',
      searchedEvidence: 'Full patent documents should be reviewed before final conclusions.',
      preliminaryStatus: 'Review required',
      techniques: ['Semantic retrieval', 'Feature mapping'],
    },
    counts: { searched: 40, found: 7, directlyRelevant: 1, retrieved: 40, reviewed: 20, visible: 7, analyzed: 1 },
    countLabels: [
      { label: 'Candidate records retrieved/ranked', value: 40 },
      { label: 'Shortlisted citations', value: 7 },
    ],
    scoringLegend: [
      { label: 'Present', meaning: 'Mapped evidence supports the feature.' },
      { label: 'Partial', meaning: 'Mapped evidence supports part of the feature.' },
      { label: 'Absent', meaning: 'The feature was not mapped.' },
    ],
    tableOfContents: [],
    featureSummaries: rows.map(row => ({
      featureNumber: row.featureNumber,
      feature: row.userFeature,
      type: 'core_technical',
      typeLabel: 'Core technical',
      genericWarning: '',
    })),
    genericFeatureRisk: { features: [], summary: 'No standalone generic feature risk was detected.' },
    citations: [comparison],
    componentCitations: [],
    directCitations: [comparison],
    borderlineCitations: [],
    otherShortlistedCitations: [],
    assignees: ['Example Research Corporation'],
    inventors: ['A. Inventor', 'B. Inventor'],
    assigneeLandscape: { summary: 'One assignee was mapped.', groups: [], repeated: [] },
    inventorSignals: { summary: 'Two inventors were mapped.', groups: [], repeated: [] },
    comparisons: [comparison],
    riskAssessment: {
      noveltyRisk: 'Moderate',
      noveltyRiskLabel: 'Novelty / anticipation risk: Moderate',
      noveltyRiskExplanation: 'No single reviewed reference maps all core inventive features.',
      combinationRisk: 'High',
      combinationRiskLabel: 'Component-combination risk: High',
      combinationRiskExplanation: 'Core features are distributed across multiple component references.',
      headline: 'High component-combination risk',
      coreFeatureCount: 4,
      strongestSingleReferenceCoreCoverage: 0.72,
      distributedCoreCoverage: 0.9,
    },
    potentialDifferentiationSpace: 'Potential differentiation space appears to lie in the integrated control relationship.',
    matrixInsight: 'No cited reference maps KF1 + KF2 + KF3 + KF4 together.',
    finalAssessment: {
      decision: 'High component-combination risk',
      confidence: 'Medium',
      summary: 'Mapped evidence indicates material overlap. Full records still require attorney review.',
      risks: ['Claim scope may overlap the mapped reference.'],
      recommendations: ['Review the complete claims.'],
    },
    publicClosestCitation: comparison,
    reportConfidence: {
      automatedReportConfidence: 'Medium',
      retrievalConfidence: 'Medium',
      featureMappingConfidence: 'Medium',
      legalConclusion: 'Not provided; requires review.',
    },
    overallDraftingDirection: 'Focus drafting on features that remain unmapped.',
    limitations: 'This automated report is not a legal opinion.',
    nextSteps: ['Review the highest-overlap citation at claim level.'],
    ...overrides,
  }
}

function request(disposition = 'inline') {
  return new NextRequest(`http://localhost/api/novelty-search/search-1/attorney-report/pdf?disposition=${disposition}`, {
    headers: { authorization: 'Bearer valid-token' },
  })
}

async function responseBuffer(response: Response) {
  return Buffer.from(await response.arrayBuffer())
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedVerifyJWT.mockReturnValue({ sub: 'user-1' } as any)
  mockedFindFirst.mockResolvedValue({ id: 'search-1', userId: 'user-1' } as any)
  mockedHydrate.mockImplementation(async value => value as any)
})

describe('GET attorney report PDF', () => {
  test('embeds Inter, renders the grouped hierarchy, and preserves long substantive content', async () => {
    const rows = Array.from({ length: 9 }, (_, index) => featureRow(index))
    rows[0] = featureRow(0, {
      userDisclosure: longText('Long submitted feature disclosure', 'USER_DISCLOSURE_TAIL_MARKER'),
      patentDisclosure: longText('Long patent disclosure', 'DISCLOSURE_TAIL_MARKER'),
      evidenceQuote: longText('Long mapped evidence', 'EVIDENCE_TAIL_MARKER'),
      crispRemark: longText('Long attorney remark', 'REMARK_TAIL_MARKER'),
      professionalRemark: longText('Long professional consolidated remark', 'PROFESSIONAL_REMARK_TAIL_MARKER'),
      attorneyRemark: longText('Long detailed attorney discussion', 'ATTORNEY_DISCUSSION_TAIL_MARKER'),
      noveltyImpact: longText('Long novelty impact discussion', 'NOVELTY_IMPACT_TAIL_MARKER'),
      claimReviewNote: longText('Long claim review note', 'CLAIM_REVIEW_TAIL_MARKER'),
    })
    const comparison = citation(rows, {
      abstract: longText('Long patent abstract', 'ABSTRACT_TAIL_MARKER'),
      technicalDisclosure: longText('Long technical disclosure', 'TECHNICAL_TAIL_MARKER'),
      summary: longText('Long reference summary', 'REFERENCE_TAIL_MARKER'),
      claimImpactSummary: longText('Long claim impact summary', 'CLAIM_TAIL_MARKER'),
    })
    mockedBuildReport.mockReturnValue(reportModel({
      inventionFeatures: rows.map(row => row.userFeature),
      featureSummaries: rows.map(row => ({
        featureNumber: row.featureNumber,
        feature: row.userFeature,
        type: 'core_technical',
        typeLabel: 'Core technical',
        genericWarning: '',
      })),
      mainDifferentiator: executiveText('Controller-driven sensing to curing relationship with', 'MAIN_DIFFERENTIATOR_WRAP_MARKER'),
      attorneyReviewFocus: executiveText('Open US-2026-000001-A1 first and compare the mapped control relationship before drafting', 'ATTORNEY_REVIEW_WRAP_MARKER'),
      potentialDifferentiationSpace: executiveText('Potential differentiation space appears to lie in the integrated control relationship with', 'KEY_TAKEAWAY_WRAP_MARKER'),
      claimPositioningAnalysis: {
        primaryClaimFocus: 'Controller-driven sensing to curing relationship.',
        weakClaimAreas: ['Generic sensor alone.'],
        avoidRelyingSolelyOn: ['Avoid relying solely on generic sensor language as the broadest claim focus.'],
        remainingInventiveCore: 'Although the reviewed references disclose sensors individually, the retrieved evidence does not identify the complete interaction between sensing, curing, and useful-life updating.',
        whyStillDistinguishable: 'Although the reviewed references disclose sensors individually, the retrieved evidence does not identify the complete interaction between sensing, curing, and useful-life updating.',
        reasoning: 'Derived from mapped coverage and relationship gaps.',
      },
      claimDraftingConsiderations: {
        independentClaimFocus: 'Consider emphasizing the controller-driven sensing to curing relationship.',
        dependentClaimIdeas: ['Consider protecting localized curing as a narrower implementation detail.'],
        fallbackClaimIdeas: ['Consider separating useful-life updating into fallback embodiments.'],
        reviewBeforeDrafting: ['Consider reviewing US-2026-000001-A1 first.'],
      },
      draftingOpportunities: [{
        title: 'Controller-driven repair',
        opportunityType: 'primary',
        linkedFeatures: ['Submitted feature 1'],
        explanation: 'Consider emphasizing the controller-driven repair workflow.',
      }],
      conceptMappedCoverageSummary: [{
        conceptTitle: 'Controller-driven repair',
        mappedCoveragePercent: 60,
        singleReferenceMappedCoveragePercent: 50,
        distributedMappedCoveragePercent: 70,
        relationshipMapped: false,
        mappingLevel: 'Moderate',
        closestReferences: ['US-2026-000001-A1'],
      }],
      strategicReviewFocus: {
        highestPriorityReference: 'US-2026-000001-A1',
        reviewReason: 'Highest overlap with the controller-driven workflow while leaving the sensing-to-curing relationship partially disclosed.',
        highestOverlap: 'US-2026-000001-A1',
        lowestOverlap: '-',
        criticalRelationshipToVerify: 'Verify the sensing-to-curing relationship.',
        recommendedFullTextReview: ['US-2026-000001-A1'],
        remainingUncertainties: ['Relationship mapping for controller-driven repair.'],
      },
      citations: [comparison],
      directCitations: [comparison],
      comparisons: [comparison],
    }) as any)

    const response = await GET(request(), { params: { searchId: 'search-1' } })
    const buffer = await responseBuffer(response)
    const parsed = await pdfParse(buffer)
    const normalizedText = parsed.text.replace(/\s+/g, ' ')
    const compactText = parsed.text.replace(/\s+/g, '')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition')).toContain('inline;')
    expect(buffer.toString('latin1')).toContain('Inter-Regular')
    expect(parsed.numpages).toBeGreaterThan(6)
    expect(parsed.text).toContain('High component-combination risk')
    expect(compactText).toContain('MAIN_DIFFERENTIATOR_WRAP_MARKER')
    expect(compactText).toContain('ATTORNEY_REVIEW_WRAP_MARKER')
    expect(compactText).toContain('KEY_TAKEAWAY_WRAP_MARKER')
    expect(normalizedText).toContain('Claim-Positioning Analysis')
    expect(normalizedText).toContain('Remaining Inventive Core')
    expect(normalizedText).toContain('Highest priority reference')
    expect(normalizedText).toContain('Novelty / anticipation risk')
    expect(normalizedText).toContain('Component-combination risk')
    expect(normalizedText).toContain('Evidence strength')
    expect(normalizedText).toContain('Potential Differentiation Space')
    expect(parsed.text).not.toContain('Not Novel determination')
    expect(parsed.text).toContain('1 Search Overview')
    expect(parsed.text).toContain('2 Citation Analysis')
    expect(parsed.text).toContain('2.1.1 US-2026-000001-A1')
    expect(parsed.text).toContain('2.2 List of Other Shortlisted Citations')
    expect(parsed.text).not.toContain('2.3 List of Other Shortlisted Citations')
    expect(parsed.text).toContain('Key Features')
    expect(normalizedText).toContain('Reference Disclosure: US-2026-000001-A1')
    expect(parsed.text).toContain('Key Feature')
    expect(parsed.text).toContain('Professional Remark')
    expect(compactText).toContain('Mappeddisclosure:Longpatentdisclosure')
    expect(compactText).toContain('Evidence:Longmappedevidence')
    expect(parsed.text).not.toContain('Relevance / Evidence')
    expect(parsed.text).not.toContain('Retrieval Relevance')
    expect(parsed.text).not.toContain('Evidence sources')
    expect(parsed.text).not.toContain('Evidence Quality')
    expect(parsed.text).not.toContain('Discussion Points')
    expect(parsed.text).not.toContain('Crisp remark')
    expect(parsed.text).not.toContain('Novelty impact')
    expect(parsed.text).not.toContain('Claim review note')
    expect(parsed.text).not.toContain('Confidence:')
    expect(parsed.text).not.toContain('Feature coverage:')
    // Full-length content is preserved in the citation header (abstract / technical
    // disclosure) and the reference/claim summaries.
    for (const marker of [
      'ABSTRACT_TAIL_MARKER',
      'TECHNICAL_TAIL_MARKER',
      'REFERENCE_TAIL_MARKER',
      'CLAIM_TAIL_MARKER',
    ]) expect(compactText).toContain(marker)
    // Per-feature comparison cells are intentionally condensed: the submitted-disclosure
    // line is dropped (redundant with the Key Features table) and the mapped disclosure,
    // evidence, and remark are truncated so a single feature row can no longer exceed a
    // page and leave blank continuation pages.
    for (const marker of [
      'USER_DISCLOSURE_TAIL_MARKER',
      'DISCLOSURE_TAIL_MARKER',
      'EVIDENCE_TAIL_MARKER',
      'PROFESSIONAL_REMARK_TAIL_MARKER',
      'ATTORNEY_DISCUSSION_TAIL_MARKER',
      'NOVELTY_IMPACT_TAIL_MARKER',
      'CLAIM_REVIEW_TAIL_MARKER',
    ]) expect(compactText).not.toContain(marker)
  }, 30_000)

  test('handles identical disclosure text, missing evidence, and no additional shortlisted citations', async () => {
    const rows = [featureRow(0, { evidenceQuote: '', evidenceSource: 'none' })]
    const comparison = citation(rows, {
      abstract: 'Shared source disclosure text.',
      technicalDisclosure: 'Shared source disclosure text.',
    })
    mockedBuildReport.mockReturnValue(reportModel({
      inventionFeatures: [rows[0].userFeature],
      comparisons: [comparison],
      citations: [comparison],
      directCitations: [comparison],
      otherShortlistedCitations: [],
    }) as any)

    const response = await GET(request('attachment'), { params: { searchId: 'search-1' } })
    const parsed = await pdfParse(await responseBuffer(response))
    const normalizedText = parsed.text.replace(/\s+/g, ' ')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toContain('attachment;')
    expect(normalizedText).toContain('Mapping assessment: Directly Mapped')
    expect(parsed.text).toContain('No additional shortlisted citations remained')
    expect(parsed.text.match(/Shared source disclosure text\./g)).toHaveLength(1)
  }, 20_000)

  test('renders scholarly publications separately and indexes paper titles', async () => {
    const rows = [featureRow(0, {
      patentDisclosure: 'The paper abstract expressly describes the submitted sensing mechanism.',
      professionalRemark: 'The paper maps the sensing feature but not the complete control relationship.',
    })]
    const paper = citation(rows, {
      publicationNumber: 'PAPER:0123456789ABCDEF',
      referenceType: 'paper',
      title: 'Scholarly sensing mechanism research title',
      link: 'https://doi.org/10.1000/sensing',
      authors: 'A. Author, B. Author',
      venue: 'Journal of Technical Sensors',
      doi: '10.1000/sensing',
      sourceProviders: 'Google Scholar, Crossref',
      citationCount: 42,
      publicationDate: '2020',
      abstract: 'A scholarly abstract describing a sensing mechanism.',
      technicalDisclosure: 'A scholarly abstract describing a sensing mechanism.',
      summary: 'Paper feature remarks identify sensing overlap and a missing control relationship.',
    })
    mockedBuildReport.mockReturnValue(reportModel({
      inventionFeatures: [rows[0].userFeature],
      featureSummaries: [{ featureNumber: 'KF1', feature: rows[0].userFeature, type: 'core_technical', typeLabel: 'Core technical', genericWarning: '' }],
      citations: [paper],
      patentCitations: [],
      paperCitations: [paper],
      directCitations: [paper],
      comparisons: [paper],
      patentComparisons: [],
      paperComparisons: [paper],
      otherShortlistedCitations: [],
    }) as any)

    const response = await GET(request(), { params: { searchId: 'search-1' } })
    const buffer = await responseBuffer(response)
    const parsed = await pdfParse(buffer)
    const normalizedText = parsed.text.replace(/\s+/g, ' ')

    expect(response.status).toBe(200)
    expect(normalizedText).toContain('2.2 Relevant Scholarly Publications')
    expect(normalizedText).toContain('2.2.1 Scholarly sensing mechanism research title')
    expect(normalizedText).toContain('Authors A. Author, B. Author')
    expect(normalizedText).toContain('PAPER FEATURE REMARKS')
    expect(normalizedText).toContain('Paper feature remarks identify sensing overlap')
    expect(normalizedText).toContain('2.3 List of Other Shortlisted Citations')
    expect(buffer.toString('latin1')).toContain('/GoTo')
  }, 20_000)

  test('lays the table of contents out across reserved pages for large reports', async () => {
    const rows = Array.from({ length: 8 }, (_, index) => featureRow(index))
    const comparisons = Array.from({ length: 48 }, (_, index) => citation(rows, {
      publicationNumber: `US-2026-${String(index + 1).padStart(6, '0')}-A1`,
      title: `Reference number ${index + 1} with a reasonably descriptive citation title for the index`,
    }))
    mockedBuildReport.mockReturnValue(reportModel({
      citations: comparisons,
      directCitations: comparisons,
      comparisons,
    }) as any)

    const response = await GET(request(), { params: { searchId: 'search-1' } })
    const buffer = await responseBuffer(response)
    const parsed = await pdfParse(buffer)

    expect(response.status).toBe(200)
    // Every citation is indexed in the TOC, including entries past the first TOC page.
    expect(parsed.text).toContain('2.1.1 US-2026-000001-A1')
    expect(parsed.text).toContain('2.1.30 US-2026-000030-A1')
    expect(parsed.text).toContain('2.1.48 US-2026-000048-A1')
    // No TOC entries leak past the end of the report: the old single-page TOC
    // overflowed and appended one-entry-per-page fragments after the final section.
    const tail = parsed.text.slice(parsed.text.lastIndexOf('What To Do Next'))
    expect(tail).not.toMatch(/2\.1\.\d+ US-2026/)
    // Sidebar bookmarks are emitted for navigation.
    expect(buffer.toString('latin1')).toContain('/Outlines')
  }, 60_000)

  test('renders empty comparison and matrix states without changing endpoint behavior', async () => {
    mockedBuildReport.mockReturnValue(reportModel({
      inventionFeatures: [],
      featureSummaries: [],
      citations: [],
      directCitations: [],
      comparisons: [],
    }) as any)

    const response = await GET(request(), { params: { searchId: 'search-1' } })
    const parsed = await pdfParse(await responseBuffer(response))

    expect(response.status).toBe(200)
    expect(parsed.text).toContain('Feature matrix will appear after citation mapping')
    expect(parsed.text).toContain('2.2 List of Other Shortlisted Citations')
  }, 20_000)
})
