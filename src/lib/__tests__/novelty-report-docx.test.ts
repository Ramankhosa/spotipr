import { describe, expect, test } from 'vitest'
import { buildNoveltyAttorneyReportModel } from '../novelty-attorney-report'
import { buildNoveltyReportDocx } from '../novelty-report-docx'

/**
 * The DOCX renderer is checked against a model built by the real report builder,
 * not a hand-written fixture: the point of the export is that it cannot disagree
 * with the PDF about what the report says.
 */
function sampleModel() {
  const publications = ['US-2025178928-A1', 'IN-100-A', 'IN-200-A']
  return buildNoveltyAttorneyReportModel({
    id: 'docx-sample-1',
    title: 'Acoustic battery defect localization with targeted electrolyte repair',
    jurisdiction: 'IN',
    stage0Results: {
      searchQuery: 'battery defect localization and targeted repair',
      inventionFeatures: [
        'acoustic tomography for internal cell defect localization',
        'microfluidic electrolyte redistribution into the affected cell region',
        'digital-twin validation of the post-repair cell state',
      ],
    },
    stage1Results: {
      patentCount: 3,
      providerStats: [
        { providerId: 'indian-corpus', label: 'Indian patent corpus', enabled: true, requested: true, resultCount: 120 },
        { providerId: 'epo-docdb', label: 'EPO DOCDB', enabled: true, requested: true, resultCount: 60 },
        { providerId: 'paper:crossref', label: 'Scholarly papers - Crossref', enabled: true, requested: true, resultCount: 0, error: 'upstream request timed out' },
      ],
      featurePrescreen: { status: 'ok', scoredCount: 180, unavailableCount: 0, semanticAvailable: true },
      aiRelevance: {
        screeningCoverage: { reviewedCount: 120, poolSize: 180 },
        byPn: {
          'US2025178928': { decision: 'accept', score: 0.92, evidence_quality: 'high' },
          IN100: { decision: 'component', score: 0.71, evidence_quality: 'medium' },
          IN200: { decision: 'component', score: 0.64, evidence_quality: 'medium' },
        },
      },
      retrievalCandidates: publications.map((publicationNumber, index) => ({
        publicationNumber,
        title: `Battery diagnostics reference ${index + 1}`,
        abstract: 'A battery management system measures cell response and reports a degradation output.',
        publicationDate: `202${index + 3}-04-01`,
        assignees: `Example Energy ${index + 1} Ltd`,
        inventors: 'A. Inventor; B. Inventor',
        relevanceScore: 0.9 - index * 0.1,
      })),
    },
    stage35Results: {
      feature_map: publications.map((pn, index) => ({
        pn,
        title: `Battery diagnostics reference ${index + 1}`,
        decision: index === 0 ? 'high' : 'low',
        feature_analysis: [
          { feature: 'acoustic tomography for internal cell defect localization', status: index === 0 ? 'Present' : 'Absent', quote: 'ultrasonic response capture', field: 'abstract' },
          { feature: 'microfluidic electrolyte redistribution into the affected cell region', status: index === 1 ? 'Present' : 'Absent', quote: 'electrolyte delivery channel', field: 'abstract' },
          { feature: 'digital-twin validation of the post-repair cell state', status: index === 2 ? 'Partial' : 'Absent', quote: 'model-based state check', field: 'abstract' },
        ],
      })),
    },
    stage4Results: {},
  })
}

describe('buildNoveltyReportDocx', () => {
  test('renders the report model as a Word document with categories, links and the annexure', async () => {
    const model = sampleModel()
    const buffer = await buildNoveltyReportDocx(model)

    // A .docx is a zip; "PK" is its signature.
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK')
    expect(buffer.length).toBeGreaterThan(5_000)

    // The document XML lives inside the zip, so assert on the model the renderer
    // consumes plus a decompressed read of the package parts below.
    const { default: JSZip } = await import('jszip')
    const zip = await JSZip.loadAsync(buffer)
    const documentXml = await zip.file('word/document.xml')!.async('string')
    const relsXml = await zip.file('word/_rels/document.xml.rels')!.async('string')

    expect(documentXml).toContain('Preliminary Novelty Assessment Report')
    expect(documentXml).toContain('Annexure I')
    expect(documentXml).toContain('Search scope and coverage record')
    // Provider outcomes, including the one that failed.
    expect(documentXml).toContain('Indian patent corpus')
    expect(documentXml).toContain('Requested but unavailable')
    // Coverage is stated by publication date, never filing date.
    expect(documentXml).toContain('Coverage is stated by publication date')
    // Examiner categories reach the document.
    expect(documentXml).toMatch(/D1-[XYA]/)
    // Google Patents records are real hyperlink relationships, not plain text.
    expect(relsXml).toContain('https://patents.google.com/patent/US20250178928A1')
  }, 30_000)

  test('categorizes the single-reference overlap as X and background art as A', () => {
    const model = sampleModel()
    const categories = model.comparisons.map(item => item.examinerCategory)
    expect(categories).toContain('X')
    expect(categories.every(category => category === 'X' || category === 'Y' || category === 'A')).toBe(true)
    // Unmapped shortlisted citations are never categorized: they were not read
    // against the claims.
    expect(model.otherShortlistedCitations.every(item => !item.examinerCategory)).toBe(true)
  })
})
