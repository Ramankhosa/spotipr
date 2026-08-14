/**
 * Preliminary Novelty Assessment Report — DOCX renderer.
 *
 * The same AttorneyReportModel the PDF route draws, rendered as an editable Word
 * document. Word rather than PDF on purpose: an attorney annotates this, adapts
 * its language for a client, and lifts sections into an opinion letter — none of
 * which a fixed page allows.
 *
 * Every editorial decision was already made in novelty-attorney-report.ts. This
 * file decides only how the document looks, which is why it reads as a
 * stylesheet. Where the PDF uses a visual device that Word cannot carry (risk
 * accent bars, badge chips, the feature status matrix), the same information is
 * carried as words or as a table column instead of being dropped.
 *
 * Conventions carried from the PDF so the two documents cannot disagree:
 *  - citation headings read "D1-X  US20250178928A1", the examiner category first;
 *  - publication numbers hyperlink to their Google Patents record;
 *  - the search-scope annexure states sources that failed as plainly as those
 *    that worked.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  HeadingLevel,
  ImageRun,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  convertMillimetersToTwip,
} from 'docx'
import {
  citationDisplayNumber,
  formatFirmAddressLines,
  type AttorneyReportCitation,
  type AttorneyReportModel,
  type AttorneyReportPatentComparison,
} from './novelty-attorney-report'

// ---------------------------------------------------------------------------
// Colour (docx wants RRGGBB with no leading '#')
// ---------------------------------------------------------------------------

const DEFAULT_ACCENT = '1D4ED8'
const INK = '0F172A'
const MUTED = '64748B'
const RULE = 'CBD5E1'
const ALT_FILL = 'F8FAFC'

const STATUS_COLOR: Record<string, string> = {
  Present: '047857',
  Partial: 'A16207',
  Absent: 'B91C1C',
  Unknown: '475569',
}

function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^#?([0-9a-fA-F]{6})$/)
  return match ? match[1].toUpperCase() : null
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(v => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Darken a pale firm accent until white header text on it stays readable. */
function clampForFill(hex: string): string {
  let out = hex
  let guard = 0
  while (relativeLuminance(out) > 0.5 && guard < 8) {
    const [r, g, b] = hexToRgb(out)
    out = [r, g, b]
      .map(v => Math.round(v * 0.85).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
    guard++
  }
  return out
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

function text(value: unknown, fallback = ''): string {
  const out = String(value ?? '').replace(/\s+/g, ' ').trim()
  return out || fallback
}

function para(
  value: string,
  opts: { bold?: boolean; italics?: boolean; color?: string; size?: number; after?: number; indent?: number } = {}
): Paragraph {
  return new Paragraph({
    spacing: { after: opts.after ?? 90 },
    indent: opts.indent ? { left: opts.indent } : undefined,
    children: [new TextRun({ text: value, bold: opts.bold, italics: opts.italics, color: opts.color, size: opts.size })],
  })
}

function bullet(value: string, level = 0): Paragraph {
  return new Paragraph({ text: value, bullet: { level }, spacing: { after: 50 } })
}

function h1(value: string, accent: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    pageBreakBefore: true,
    spacing: { after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: accent, space: 4 } },
    children: [new TextRun({ text: value, bold: true, color: INK, size: 30 })],
  })
}

function h2(value: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 260, after: 100 },
    children: [new TextRun({ text: value, bold: true, color: INK, size: 24 })],
  })
}

function h3(value: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 180, after: 80 },
    children: [new TextRun({ text: value, bold: true, color: INK, size: 22 })],
  })
}

function label(value: string): Paragraph {
  return new Paragraph({
    spacing: { before: 140, after: 50 },
    children: [new TextRun({ text: value.toUpperCase(), bold: true, color: MUTED, size: 16 })],
  })
}

/** "Label: value" on one line — the Word equivalent of the PDF's metadata grid row. */
function field(name: string, value: string, opts: { link?: string } = {}): Paragraph {
  return new Paragraph({
    spacing: { after: 50 },
    children: [
      new TextRun({ text: `${name}: `, bold: true, color: MUTED, size: 18 }),
      ...(opts.link
        ? [new ExternalHyperlink({
            link: opts.link,
            children: [new TextRun({ text: value, color: DEFAULT_ACCENT, underline: {}, size: 18 })],
          })]
        : [new TextRun({ text: value, size: 18 })]),
    ],
  })
}

function spacer(): Paragraph {
  return new Paragraph({ spacing: { after: 140 }, children: [new TextRun({ text: '' })] })
}

type CellContent = string | { text: string; link?: string; color?: string; bold?: boolean }

function cell(content: CellContent, opts: { bold?: boolean; color?: string; fill?: string; width?: number } = {}): TableCell {
  const value = typeof content === 'string' ? { text: content } : content
  const bold = value.bold ?? opts.bold
  const color = value.color ?? opts.color
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.fill ? { type: ShadingType.CLEAR, fill: opts.fill, color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 90, right: 90 },
    children: [
      new Paragraph({
        spacing: { after: 0 },
        children: value.link
          ? [new ExternalHyperlink({
              link: value.link,
              children: [new TextRun({ text: value.text, color: DEFAULT_ACCENT, underline: {}, size: 17 })],
            })]
          : [new TextRun({ text: value.text, bold, color, size: 17 })],
      }),
    ],
  })
}

/** A table whose header row repeats when it crosses a page, with banded rows. */
function table(headers: string[], rows: CellContent[][], accent: string, widths?: number[]): Table {
  const headerFill = clampForFill(accent)
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      left: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      right: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: RULE },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: RULE },
    },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((value, index) =>
          cell(value, { bold: true, color: 'FFFFFF', fill: headerFill, width: widths?.[index] })
        ),
      }),
      ...rows.map((row, rowIndex) =>
        new TableRow({
          children: row.map((value, index) =>
            cell(value, { fill: rowIndex % 2 ? ALT_FILL : undefined, width: widths?.[index] })
          ),
        })
      ),
    ],
  })
}

function decodeLogo(dataUri: string | null | undefined): { data: Buffer; type: 'png' | 'jpg' } | null {
  if (!dataUri) return null
  try {
    const match = dataUri.match(/^data:image\/(png|jpe?g);base64,(.+)$/i)
    if (!match) return null
    const data = Buffer.from(match[2], 'base64')
    if (!data.length) return null
    return { data, type: match[1].toLowerCase().startsWith('p') ? 'png' : 'jpg' }
  } catch {
    return null
  }
}

/** Citation tables mirror the PDF's, including the examiner-category column. */
function citationTable(citations: AttorneyReportCitation[], accent: string): (Paragraph | Table)[] {
  const categorized = citations.some(citation => citation.examinerCategory)
  const headers = categorized
    ? ['S.No.', 'Cat.', 'Citation No.', 'Title', 'Reference Role', 'Claim Impact']
    : ['S.No.', 'Citation No.', 'Title', 'Reference Role', 'Claim Impact']
  const widths = categorized ? [6, 6, 17, 43, 18, 10] : [6, 18, 46, 20, 10]
  const rows: CellContent[][] = citations.map((citation, index) => [
    String(index + 1),
    ...(categorized ? [{ text: citation.examinerCategory || '-', bold: true } as CellContent] : []),
    citation.googlePatentsUrl
      ? { text: citation.publicationNumber, link: citation.googlePatentsUrl }
      : citation.publicationNumber,
    citation.title,
    citation.referenceRole,
    citation.reviewPriority,
  ])
  const notes = [
    categorized ? 'Cat.: X - relevant alone; Y - relevant in combination; A - technological background.' : '',
    citations.some(citation => citation.googlePatentsUrl)
      ? 'Citation numbers link to the full-text record on Google Patents.'
      : '',
  ].filter(Boolean)
  return [
    table(headers, rows, accent, widths),
    ...(notes.length ? [para(notes.join(' '), { color: MUTED, size: 16, after: 140 })] : [spacer()]),
  ]
}

function referenceBlock(item: AttorneyReportPatentComparison, index: number, total: number, accent: string): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = []
  const heading = `${citationDisplayNumber(item) || `D${index + 1}`}  ${item.publicationNumber}`
  out.push(new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 300, after: 60 },
    children: [
      new TextRun({ text: heading, bold: true, color: accent, size: 24 }),
      new TextRun({ text: `    Reference ${index + 1} of ${total}`, color: MUTED, size: 16 }),
    ],
  }))
  out.push(para(text(item.title), { bold: true, after: 80 }))
  if (item.examinerCategory) {
    out.push(para(`Category ${item.examinerCategory} - ${text(item.examinerCategoryLabel)}.`, { italics: true, color: MUTED, size: 18, after: 60 }))
  }
  out.push(para(
    `Overlap: ${text(item.noveltyThreat || item.overlapRiskLevel, 'Not stated')}  ·  Review priority: ${text(item.reviewPriority, '-')}  ·  Reference role: ${text(item.referenceRole, '-')}`,
    { color: MUTED, size: 18, after: 120 }
  ))

  if (item.referenceType === 'paper') {
    out.push(field('Reference type', 'Scholarly paper'))
    out.push(field('Authors', text(item.authors, '-')))
    out.push(field('Year / venue', `${text(item.publicationDate, '-')} / ${text(item.venue, '-')}`))
    out.push(field('DOI', text(item.doi, '-')))
    out.push(field('Citation count', item.citationCount === null ? '-' : String(item.citationCount)))
    out.push(field('Academic source', text(item.sourceProviders, '-')))
    if (text(item.link)) out.push(field('Record URL', text(item.link).replace(/^https?:\/\//, ''), { link: item.link }))
  } else {
    out.push(field('Application no.', text(item.applicationNumber, '-')))
    out.push(field('Publication / priority', `${text(item.publicationDate, '-')} / ${text(item.priorityDate, '-')}`))
    out.push(field('Filing date', text(item.filingDate, '-')))
    out.push(field('Publication authority', text(item.publicationJurisdiction, 'Not available')))
    out.push(field('Filing country / office', text(item.filingCountry, 'Not available')))
    out.push(field('Target legal jurisdiction', text(item.targetLegalJurisdiction, '-')))
    out.push(field('Applicant / assignee', text(item.assignees, '-')))
    out.push(field('Inventor(s)', text(item.inventors, '-')))
    out.push(field('CPC / IPC', `${text(item.cpcCodes, '-')} / ${text(item.ipcCodes, '-')}`))
    out.push(field('Source corpus / provider', text(item.sourceCorpus || item.sourceProviders, 'Not available')))
    if (item.googlePatentsUrl) {
      out.push(field('Full-text record', item.googlePatentsUrl.replace(/^https?:\/\//, ''), { link: item.googlePatentsUrl }))
    }
    if (text(item.link)) out.push(field('Source', text(item.link).replace(/^https?:\/\//, ''), { link: item.link }))
  }

  out.push(label(item.referenceType === 'paper' ? 'Paper abstract' : 'Patent abstract'))
  out.push(para(text(item.abstract, '-')))
  const abstract = text(item.abstract)
  const disclosure = text(item.technicalDisclosure)
  if (disclosure && disclosure !== abstract && !abstract.includes(disclosure)) {
    out.push(label('Technical disclosure'))
    out.push(para(disclosure))
  }

  out.push(h3('Feature-by-feature comparison'))
  if (item.rows.length) {
    out.push(table(
      ['Key feature', `Reference disclosure: ${item.publicationNumber}`, 'Professional remark'],
      item.rows.map(row => [
        `${row.featureNumber} - ${text(row.userFeature)}`,
        {
          text: `${text(row.statusLabel || row.status)}. ${text(row.patentDisclosure, 'No mapped disclosure was identified.')}${text(row.evidenceQuote) ? ` Evidence: ${text(row.evidenceQuote)}` : ''}`,
          color: STATUS_COLOR[row.status] || INK,
        },
        text(row.professionalRemark || row.crispRemark, '-'),
      ]),
      accent,
      [26, 44, 30]
    ))
  } else {
    out.push(para('No feature comparison rows were available for this citation.'))
  }
  out.push(label(item.referenceType === 'paper' ? 'Paper feature remarks' : 'Reference summary'))
  out.push(para(text(item.summary, '-')))
  out.push(label('Claim impact summary'))
  out.push(para(text(item.claimImpactSummary, '-'), { after: 160 }))
  out.push(label('Attorney notes'))
  // A deliberately empty ruled line: the reason this export exists is that the
  // attorney writes here.
  out.push(new Paragraph({
    spacing: { after: 200 },
    border: { bottom: { style: BorderStyle.DOTTED, size: 4, color: RULE, space: 6 } },
    children: [new TextRun({ text: '' })],
  }))
  return out
}

// ---------------------------------------------------------------------------
// The renderer
// ---------------------------------------------------------------------------

export async function buildNoveltyReportDocx(report: AttorneyReportModel): Promise<Buffer> {
  const accent = normalizeHex(report.accentColor) || DEFAULT_ACCENT
  const children: (Paragraph | Table)[] = []
  const firm = report.firm

  // ---- cover ---------------------------------------------------------------
  const logo = decodeLogo(firm?.logoDataUri)
  if (logo) {
    try {
      children.push(new Paragraph({
        spacing: { after: 160 },
        children: [new ImageRun({ data: logo.data, type: logo.type, transformation: { width: 150, height: 50 } })],
      }))
    } catch {
      // Fall through to the text branding below: a corrupt logo must not cost
      // the attorney their report.
    }
  }
  if (firm) {
    children.push(para(firm.firmName, { bold: true, size: 26, after: 40 }))
    if (firm.tagline) children.push(para(firm.tagline, { italics: true, color: MUTED, size: 18, after: 40 }))
    for (const line of formatFirmAddressLines(firm)) children.push(para(line, { color: MUTED, size: 18, after: 20 }))
  }

  children.push(new Paragraph({
    spacing: { before: 400, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: accent, space: 6 } },
    children: [new TextRun({ text: report.reportTitle, bold: true, size: 44, color: INK })],
  }))
  children.push(para(report.inventionTitle, { bold: true, size: 26, color: accent, after: 140 }))
  children.push(table(
    ['Field', 'Value'],
    [
      ['Report no.', report.reportNumber],
      ['Generated', report.generatedDate],
      ['Jurisdiction', report.jurisdiction],
      ['Source mode', text(report.methodology.corpus, report.sourceMode)],
      ['Prepared by', report.preparedBy],
      ['Confidentiality', report.confidentiality],
    ],
    accent,
    [26, 74]
  ))
  children.push(spacer())
  children.push(para(report.evidenceBasis, { italics: true, color: MUTED, size: 18 }))
  children.push(para(
    'This document is an editable working copy. Figures and mappings are generated from automated retrieval and feature mapping; verify every citation against the full patent document before relying on it.',
    { italics: true, color: MUTED, size: 18 }
  ))

  // ---- executive snapshot --------------------------------------------------
  children.push(h1('Executive snapshot', accent))
  children.push(para(report.finalAssessment.decision, { bold: true, size: 26, color: accent }))
  children.push(para(report.finalAssessment.summary))
  children.push(table(
    ['Signal', 'Assessment'],
    [
      ['Novelty / anticipation risk', `${report.riskAssessment.noveltyRisk} - ${report.riskAssessment.noveltyRiskExplanation}`],
      ['Component-combination risk', `${report.riskAssessment.combinationRisk} - ${report.riskAssessment.combinationRiskExplanation}`],
      ['Highest single-reference core coverage', `${report.riskAssessment.highestSingleReferenceCoreCoveragePercent ?? Math.round((report.riskAssessment.strongestSingleReferenceCoreCoverage || 0) * 100)}%`],
      ['Distributed core-feature coverage', `${report.riskAssessment.distributedCoreCoveragePercent ?? Math.round((report.riskAssessment.distributedCoreCoverage || 0) * 100)}%`],
      ['Assessment confidence', text(report.riskAssessment.assessmentConfidence || report.finalAssessment.confidence, 'Low')],
      ['Closest mapped citation', text(report.publicClosestCitation?.publicationNumber, '-')],
      ['Main differentiator', text(report.mainDifferentiator, '-')],
    ],
    accent,
    [30, 70]
  ))
  if (report.attorneyReviewFocus) {
    children.push(label('Attorney review focus'))
    children.push(para(report.attorneyReviewFocus))
  }
  if (report.potentialDifferentiationSpace) {
    children.push(label('Potential differentiation space'))
    children.push(para(report.potentialDifferentiationSpace))
  }

  // ---- 1 search overview ---------------------------------------------------
  children.push(h1('1  Search overview', accent))
  children.push(h2('1.1  Objective'))
  children.push(para('The objective of this report is to organize relevant patent records and map available evidence against the extracted key features of the submitted invention for review.'))
  children.push(field('Search query', text(report.searchQuery, '-')))
  children.push(spacer())
  children.push(table(
    ['Stage', 'Records'],
    report.countLabels.map(item => [item.label, String(item.value)]),
    accent,
    [70, 30]
  ))

  children.push(h2('1.2  Search scope and methodology'))
  children.push(field('Patent nationality coverage', report.methodology.corpus))
  children.push(field('Search / mapping mode', report.methodology.retrievalMode))
  children.push(field('Assessment scope', report.methodology.searchedEvidence))
  children.push(field('Review status', report.methodology.preliminaryStatus))
  children.push(label('Techniques used'))
  for (const technique of report.methodology.techniques) children.push(bullet(technique))

  children.push(h2('1.3  Key features'))
  children.push(para('The key features are extracted from the submitted disclosure and classified to separate core mechanisms, implementation details, novelty-candidate features, and generic features that should not be relied on alone.'))
  children.push(table(
    ['Key feature', 'Importance', 'Type', 'Feature description'],
    report.featureSummaries.map(feature => [
      feature.featureNumber,
      text(feature.importanceLabel, '-'),
      text(feature.typeLabel, '-'),
      `${feature.feature}${feature.genericWarning ? ` ${feature.genericWarning}` : ''}`,
    ]),
    accent,
    [10, 20, 16, 54]
  ))
  children.push(spacer())
  children.push(field('Generic feature risk', text(report.genericFeatureRisk.summary, '-')))

  children.push(h2('1.4  Legend'))
  children.push(table(
    ['Score / status', 'Meaning'],
    report.scoringLegend.map(item => [item.label, item.meaning]),
    accent,
    [26, 74]
  ))

  children.push(h2('1.5  Summary of relevant citations'))
  children.push(...citationTable(report.mainCitations || report.citations, accent))

  const componentCitations = (report.mainCitations || report.citations).filter(item => item.matchCategory === 'component')
  children.push(h2('1.6  Component / feature-level prior art'))
  children.push(para('These citations disclose one or more relevant invention features, subsystems, materials, process steps, or implementation details, but are not treated as full invention-level matches by themselves.'))
  if (componentCitations.length) {
    children.push(...citationTable(componentCitations, accent))
  } else {
    children.push(para('No separate component / feature-level references were classified in this run.'))
  }

  // The PDF's feature matrix is a colour grid; Word carries the same evidence as
  // a per-reference status row, which stays readable when a reader edits it.
  const matrixComparisons = report.mainComparisons?.length ? report.mainComparisons : report.comparisons
  children.push(h2('1.7  Key feature analysis matrix'))
  if (report.inventionFeatures.length && matrixComparisons.length) {
    children.push(para('D - directly mapped; P - partially mapped; N - not found; R - not established.', { color: MUTED, size: 16 }))
    children.push(table(
      ['Citation No.', 'Cat.', ...report.inventionFeatures.map((_, index) => `KF${index + 1}`), 'Claim impact'],
      matrixComparisons.map(item => [
        item.publicationNumber,
        { text: item.examinerCategory || '-', bold: true } as CellContent,
        ...report.inventionFeatures.map((_, index) => {
          const row = item.rows[index]
          const code = row?.publicMappingCode
            || (row?.status === 'Present' ? 'D' : row?.status === 'Partial' ? 'P' : row?.status === 'Unknown' ? 'R' : 'N')
          return { text: code, bold: true, color: STATUS_COLOR[row?.status || 'Absent'] } as CellContent
        }),
        item.reviewPriority,
      ]),
      accent
    ))
    if (report.matrixInsight) children.push(para(report.matrixInsight, { italics: true, color: MUTED, size: 18 }))
  } else {
    children.push(para('Feature matrix will appear after citation mapping.'))
  }

  if (report.potentialCombinations.length) {
    children.push(h2('1.8  Potential inventive-step combinations'))
    children.push(para('These pairs support inventive-step review only. They are not single-reference novelty or anticipation conclusions.'))
    report.potentialCombinations.forEach((pair, index) => {
      children.push(h3(`Combination ${index + 1}: ${pair.referenceA.publicationNumber} + ${pair.referenceB.publicationNumber}`))
      children.push(field('Reference A teaches', pair.referenceA.teaches.join('; ') || '-'))
      children.push(field('Reference B adds', pair.referenceB.adds.join('; ') || '-'))
      children.push(field('Combined important-feature coverage', `${pair.combinedImportantFeatureCoverage}%`))
      children.push(field('Apparent motivation', pair.apparentMotivation))
      children.push(field('Still missing', pair.missingImportantFeatures.join('; ') || pair.stillMissingRelationship))
    })
  }

  // ---- 2 citation analysis -------------------------------------------------
  const detailed = report.mainComparisons?.length ? report.mainComparisons : report.comparisons
  const patentComparisons = detailed.filter(item => item.referenceType !== 'paper')
  const paperComparisons = detailed.filter(item => item.referenceType === 'paper')

  children.push(h1('2  Citation analysis', accent))
  children.push(h2('2.1  Relevant patent citations'))
  if (patentComparisons.length) {
    patentComparisons.forEach((item, index) => {
      children.push(...referenceBlock(item, index, detailed.length, accent))
    })
  } else {
    children.push(para('No relevant patent citations were selected for detailed feature mapping in this run.'))
  }

  if (paperComparisons.length) {
    children.push(h2('2.2  Relevant scholarly publications'))
    paperComparisons.forEach((item, index) => {
      children.push(...referenceBlock(item, patentComparisons.length + index, detailed.length, accent))
    })
  }

  if (report.appendixMappedComparisons?.length) {
    children.push(h1('Appendix A  Remaining mapped references', accent))
    children.push(para('These references were analyzed feature by feature and contributed to the assessment, but are summarized here because higher-priority mapped references are presented in detail.'))
    children.push(...citationTable(report.appendixMappedComparisons, accent))
  }

  children.push(h1('Appendix B  Shortlisted but unmapped references', accent))
  if (report.otherShortlistedCitations.length) {
    children.push(para('The citations below explicitly passed the AI relevance gate but were not selected for detailed feature mapping because the report focuses on the most relevant mapped references.'))
    children.push(...citationTable(report.otherShortlistedCitations, accent))
    if (report.otherShortlistedOmittedCount > 0) {
      children.push(para(`${report.otherShortlistedOmittedCount} additional gate-approved unmapped citation${report.otherShortlistedOmittedCount === 1 ? ' was' : 's were'} omitted from this appendix to keep the report readable.`))
    }
  } else {
    children.push(para('No explicitly gate-approved unmapped citations remained after the detailed mapped references were selected.'))
  }
  if (report.otherShortlistedRejectedCount > 0 || report.otherShortlistedUngatedCount > 0) {
    children.push(para(`${report.otherShortlistedRejectedCount} explicitly rejected and ${report.otherShortlistedUngatedCount} ungated retrieval candidate${report.otherShortlistedRejectedCount + report.otherShortlistedUngatedCount === 1 ? ' was' : 's were'} excluded from the supplementary-reference list.`))
  }

  // ---- 3-4 landscape -------------------------------------------------------
  children.push(h1('3  Applicant / assignee landscape', accent))
  children.push(para(report.assigneeLandscape.summary))
  for (const entry of report.assigneeLandscape.repeated) {
    children.push(bullet(`${entry.name} (${entry.count} mapped citation${entry.count === 1 ? '' : 's'})`))
  }
  for (const group of report.assigneeLandscape.groups) {
    children.push(h3(group.label))
    for (const name of group.names) children.push(bullet(name))
  }

  children.push(h1('4  Repeated inventor / entity signals', accent))
  children.push(para(report.inventorSignals.summary))
  for (const entry of report.inventorSignals.repeated) {
    children.push(bullet(`${entry.name} (${entry.count} mapped citation${entry.count === 1 ? '' : 's'})`))
  }
  for (const group of report.inventorSignals.groups) {
    children.push(h3(group.label))
    for (const name of group.names) children.push(bullet(name))
  }

  // ---- 5 claim positioning -------------------------------------------------
  children.push(h1('5  Claim-positioning analysis', accent))
  const positioning = report.claimPositioningAnalysis
  if (positioning) {
    children.push(label('Primary claim focus'))
    children.push(para(positioning.primaryClaimFocus))
    if (positioning.secondaryClaimFocus) {
      children.push(label('Secondary claim focus'))
      children.push(para(positioning.secondaryClaimFocus))
    }
    children.push(label('Remaining inventive core'))
    children.push(para(positioning.remainingInventiveCore))
    children.push(label('Why still distinguishable'))
    children.push(para(positioning.whyStillDistinguishable))
    children.push(label('Reasoning'))
    children.push(para(positioning.reasoning))
    if (positioning.weakClaimAreas?.length) {
      children.push(label('Weak claim areas'))
      for (const item of positioning.weakClaimAreas) children.push(bullet(item))
    }
    if (positioning.avoidRelyingSolelyOn?.length) {
      children.push(label('Avoid relying solely on'))
      for (const item of positioning.avoidRelyingSolelyOn) children.push(bullet(item))
    }
  } else {
    children.push(para('Claim-positioning analysis was not generated for this report version.'))
  }

  if (report.conceptMappedCoverageSummary?.length) {
    children.push(h3('Concept mapped coverage summary'))
    children.push(table(
      ['Concept', 'Mapped', 'Single ref.', 'Distributed', 'Level', 'Closest references'],
      report.conceptMappedCoverageSummary.map(item => [
        item.conceptTitle,
        `${item.mappedCoveragePercent}%`,
        `${item.singleReferenceMappedCoveragePercent}%`,
        `${item.distributedMappedCoveragePercent}%`,
        `${item.mappingLevel}${item.relationshipMapped ? ' + relationship' : ''}`,
        item.closestReferences.join(', ') || '-',
      ]),
      accent,
      [28, 11, 12, 13, 16, 20]
    ))
  }

  if (report.claimDraftingConsiderations) {
    children.push(h3('Claim drafting considerations'))
    children.push(para(report.claimDraftingConsiderations.independentClaimFocus))
    const groups: Array<[string, string[]]> = [
      ['Dependent claim ideas', report.claimDraftingConsiderations.dependentClaimIdeas || []],
      ['Fallback claim ideas', report.claimDraftingConsiderations.fallbackClaimIdeas || []],
      ['Review before drafting', report.claimDraftingConsiderations.reviewBeforeDrafting || []],
    ]
    for (const [name, items] of groups) {
      if (!items.length) continue
      children.push(label(name))
      for (const item of items) children.push(bullet(item))
    }
  }

  if (report.strategicReviewFocus) {
    children.push(h3('Strategic review focus'))
    children.push(field('Highest priority reference', report.strategicReviewFocus.highestPriorityReference))
    children.push(field('Review reason', report.strategicReviewFocus.reviewReason))
    children.push(field('Critical relationship to verify', report.strategicReviewFocus.criticalRelationshipToVerify))
    children.push(field('Priority references', report.strategicReviewFocus.recommendedFullTextReview.join(', ') || '-'))
    if (report.strategicReviewFocus.remainingUncertainties?.length) {
      children.push(label('Remaining uncertainties'))
      for (const item of report.strategicReviewFocus.remainingUncertainties) children.push(bullet(item))
    }
  }

  // ---- 6 observations ------------------------------------------------------
  children.push(h1('6  Claim-positioning observations', accent))
  children.push(field('Automated overlap position', report.finalAssessment.decision))
  children.push(field('Legal conclusion', report.reportConfidence.legalConclusion))
  children.push(label('Summary'))
  children.push(para(report.finalAssessment.summary))
  if (report.finalAssessment.risks.length) {
    children.push(label('Key risks'))
    for (const item of report.finalAssessment.risks) children.push(bullet(item))
  }
  if (report.finalAssessment.recommendations.length) {
    children.push(label('Recommendations'))
    for (const item of report.finalAssessment.recommendations) children.push(bullet(item))
  }
  if (report.overallDraftingDirection) {
    children.push(label('Overall drafting direction'))
    children.push(para(report.overallDraftingDirection))
  }

  // ---- 7 limitations -------------------------------------------------------
  children.push(h1('7  Limitations and next steps', accent))
  children.push(para(report.limitations))
  if (report.nextSteps.length) {
    children.push(label('What to do next'))
    for (const item of report.nextSteps) children.push(bullet(item))
  }

  // ---- annexure I ----------------------------------------------------------
  const scope = report.searchScope
  if (scope && Array.isArray(scope.coverage)) {
    children.push(h1('Annexure I  Search scope and coverage record', accent))
    children.push(para('This annexure records the sources searched, the volume screened at each stage, and the coverage limits of this run, so the findings above can be weighed against what was actually examined.'))
    children.push(h3('Sources searched'))
    if (scope.sources?.length) {
      children.push(table(
        ['Source', 'Status', 'Records', 'Note'],
        scope.sources.map(source => [source.label, source.status, source.retrieved, source.note || '-']),
        accent,
        [36, 22, 12, 30]
      ))
    } else {
      children.push(para('Per-source retrieval statistics were not recorded for this run.'))
    }
    children.push(h3('Volume at each stage'))
    children.push(table(
      ['Stage', 'Records'],
      scope.coverage.map(entry => [entry.label, entry.value]),
      accent,
      [72, 28]
    ))
    children.push(h3('Date coverage'))
    children.push(para(scope.dateCoverage))
    children.push(h3('What this search did not cover'))
    for (const limitation of scope.limitations || []) children.push(bullet(limitation))
  }

  if (report.showPoweredBy !== false) {
    children.push(spacer())
    children.push(para('Powered by PatentNest.ai', { italics: true, color: MUTED, size: 16 }))
  }

  const margin = convertMillimetersToTwip(18)
  const doc = new Document({
    creator: report.preparedBy,
    title: `${report.reportTitle} - ${report.reportNumber}`,
    description: report.inventionTitle,
    styles: { default: { document: { run: { font: 'Calibri', size: 20, color: INK } } } },
    sections: [
      {
        properties: { page: { margin: { top: margin, bottom: margin, left: margin, right: margin } } },
        footers: {
          default: new Footer({
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: `${report.reportNumber}  ·  ${report.confidentiality}  ·  Page `, color: MUTED, size: 16 }),
                new TextRun({ children: [PageNumber.CURRENT], color: MUTED, size: 16 }),
                new TextRun({ text: ' of ', color: MUTED, size: 16 }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], color: MUTED, size: 16 }),
              ],
            })],
          }),
        },
        children,
      },
    ],
  })
  return Packer.toBuffer(doc)
}
