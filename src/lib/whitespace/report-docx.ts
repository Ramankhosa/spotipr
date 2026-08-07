/**
 * Whitespace Studio — DOCX renderer.
 *
 * Turns the report model into a firm-branded Word document. Every editorial
 * decision was already made upstream in report-model.ts; this file decides only
 * how the page looks, which is why it can be read as a stylesheet.
 *
 * Word rather than PDF on purpose: this document is a draft an attorney edits
 * before it reaches a client, not a fixed artefact.
 *
 * Two conventions carried from the prior-art search report, both of which exist
 * because a reader who skips to the findings must still meet the caveats:
 * diagnostics lead, and human-authored judgment is labelled as the operative
 * one wherever it appears next to a machine number.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
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
import type {
  ReportAreaBlock,
  ReportDimensionBlock,
  ReportFieldMapBlock,
  ReportHypothesisBlock,
  WhitespaceReportModel,
} from './report-model'

// ---------------------------------------------------------------------------
// Colour (docx wants RRGGBB with no leading '#')
// ---------------------------------------------------------------------------

const DEFAULT_ACCENT = '1D4ED8'
const INK = '111827'
const MUTED = '6B7280'
const RULE = 'D1D5DB'

function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^#?([0-9a-fA-F]{6})$/)
  return match ? match[1].toUpperCase() : null
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `${clamp(r)}${clamp(g)}${clamp(b)}`.toUpperCase()
}

function mixToward(hex: string, target: number, amount: number): string {
  const [r, g, b] = hexToRgb(hex)
  return rgbToHex(r + (target - r) * amount, g + (target - g) * amount, b + (target - b) * amount)
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(v => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Darken a pale accent until white text on it stays readable. */
function clampForFill(hex: string): string {
  let out = hex
  let guard = 0
  while (relativeLuminance(out) > 0.5 && guard < 8) {
    out = mixToward(out, 0, 0.15)
    guard++
  }
  return out
}

// ---------------------------------------------------------------------------
// Paragraph helpers
// ---------------------------------------------------------------------------

function para(
  text: string,
  opts: { bold?: boolean; italics?: boolean; color?: string; size?: number; after?: number; indent?: number } = {}
): Paragraph {
  return new Paragraph({
    spacing: { after: opts.after ?? 80 },
    indent: opts.indent ? { left: opts.indent } : undefined,
    children: [
      new TextRun({ text, bold: opts.bold, italics: opts.italics, color: opts.color, size: opts.size }),
    ],
  })
}

function bullet(text: string, level = 0): Paragraph {
  return new Paragraph({ text, bullet: { level }, spacing: { after: 40 } })
}

function h1(text: string, accent: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 140 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: accent, space: 4 } },
    children: [new TextRun({ text, bold: true, color: accent, size: 28 })],
  })
}

function h2(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 220, after: 90 },
    children: [new TextRun({ text, bold: true, color: INK, size: 24 })],
  })
}

function h3(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 160, after: 70 },
    children: [new TextRun({ text, bold: true, color: INK, size: 22 })],
  })
}

function label(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 120, after: 50 },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, color: MUTED, size: 16 })],
  })
}

function spacer(): Paragraph {
  return new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: '' })] })
}

function cell(text: string, opts: { bold?: boolean; color?: string; fill?: string; width?: number } = {}): TableCell {
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.fill ? { type: ShadingType.CLEAR, fill: opts.fill, color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 90, right: 90 },
    children: [
      new Paragraph({
        spacing: { after: 0 },
        children: [new TextRun({ text, bold: opts.bold, color: opts.color, size: 18 })],
      }),
    ],
  })
}

/** A table whose header repeats when it crosses a page. */
function table(headers: string[], rows: string[][], accent: string, widths?: number[]): Table {
  const headerFill = clampForFill(accent)
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((text, i) =>
          cell(text, { bold: true, color: 'FFFFFF', fill: headerFill, width: widths?.[i] })
        ),
      }),
      ...rows.map(
        row =>
          new TableRow({
            children: row.map((text, i) => cell(text, { width: widths?.[i] })),
          })
      ),
    ],
  })
}

const int = (value: number) => (Number.isFinite(value) ? Math.round(value).toLocaleString() : '—')
const pct1 = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—'

/**
 * Decode a stored firm logo for embedding. Anything unreadable returns null and
 * the cover falls back to the firm name: a corrupt logo must not cost the
 * attorney their report.
 */
function decodeLogo(dataUri: string | null): { data: Buffer; type: 'png' | 'jpg' } | null {
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

// ---------------------------------------------------------------------------
// The renderer
// ---------------------------------------------------------------------------

export async function buildWhitespaceReportDocx(model: WhitespaceReportModel): Promise<Buffer> {
  const accent = normalizeHex(model.firm?.accentColor) || DEFAULT_ACCENT
  const children: (Paragraph | Table)[] = []

  // ---- cover --------------------------------------------------------------
  const logo = decodeLogo(model.firm?.logoDataUri ?? null)
  if (logo) {
    try {
      children.push(
        new Paragraph({
          spacing: { after: 160 },
          children: [
            new ImageRun({
              data: logo.data,
              type: logo.type,
              transformation: { width: 150, height: 50 },
            }),
          ],
        })
      )
    } catch {
      // Fall through to the text branding below.
    }
  }

  if (model.firm) {
    children.push(para(model.firm.name, { bold: true, size: 26, color: INK, after: 40 }))
    if (model.firm.tagline) children.push(para(model.firm.tagline, { italics: true, color: MUTED, after: 40 }))
    for (const line of model.firm.addressLines) children.push(para(line, { color: MUTED, size: 18, after: 20 }))
    if (model.firm.contactLine) children.push(para(model.firm.contactLine, { color: MUTED, size: 18 }))
  }

  children.push(
    new Paragraph({
      spacing: { before: 400, after: 100 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: accent, space: 6 } },
      children: [new TextRun({ text: 'Whitespace Study Report', bold: true, size: 44, color: INK })],
    })
  )
  children.push(para(model.meta.title, { bold: true, size: 26, color: accent, after: 60 }))
  children.push(para(model.meta.kindLabel, { color: MUTED }))
  children.push(
    para(
      `Study ${model.meta.studyId}  ·  scope version ${model.meta.scopeVersion}  ·  generated ${model.meta.generatedOn}`,
      { color: MUTED, size: 18 }
    )
  )
  children.push(para(`Prepared by ${model.meta.preparedBy} using PatentNest Whitespace Studio.`, { italics: true, color: MUTED, size: 18 }))
  children.push(para(model.meta.confidentiality, { bold: true, color: MUTED, size: 18, after: 200 }))

  children.push(
    para(
      'This report states what was measured, how it was measured, and what the measurement cannot see. Nothing in it is an opinion on patentability, validity or freedom to operate.',
      { italics: true, color: MUTED, size: 18 }
    )
  )

  // ---- the invention ------------------------------------------------------
  if (model.invention) {
    children.push(h1('The invention as described', accent))
    if (model.invention.problem) {
      children.push(label('Problem'))
      children.push(para(model.invention.problem))
    }
    if (model.invention.approach) {
      children.push(label('Approach'))
      children.push(para(model.invention.approach))
    }
    if (model.invention.constraints) {
      children.push(label('Constraints'))
      children.push(para(model.invention.constraints))
    }
  }

  // ---- the premise --------------------------------------------------------
  children.push(h1('The premise', accent))
  children.push(
    para(
      'Everything below was counted under the scope stated here. Scope error is the dominant source of wrong answers in patent analytics, so the premise is published in full rather than summarised.',
      { italics: true, color: MUTED }
    )
  )
  if (model.scope.summary) children.push(para(model.scope.summary))

  if (model.scope.concepts.length) {
    children.push(h3('Concepts searched'))
    for (const concept of model.scope.concepts) {
      const flags = [concept.required ? 'must appear' : null, concept.authored ? 'your wording' : null]
        .filter(Boolean)
        .join(', ')
      children.push(bullet(`${concept.label}${flags ? ` (${flags})` : ''}`))
      if (concept.synonyms.length) {
        children.push(para(`also matched as: ${concept.synonyms.join('; ')}`, { color: MUTED, size: 18, indent: 360, after: 40 }))
      }
    }
    if (model.scope.intersectionWarning) {
      children.push(para(model.scope.intersectionWarning, { italics: true, color: MUTED }))
    }
  }

  if (model.scope.classifications.length) {
    children.push(h3('Classifications included'))
    for (const classification of model.scope.classifications) {
      children.push(bullet(`${classification.code}${classification.definition ? ` — ${classification.definition}` : ''}`))
      if (classification.caution) {
        children.push(para(`Caution: ${classification.caution}`, { italics: true, color: MUTED, size: 18, indent: 360, after: 40 }))
      }
    }
  }

  if (model.scope.exclusions.length) {
    children.push(h3('Excluded'))
    for (const exclusion of model.scope.exclusions) {
      children.push(bullet(`${exclusion.term}${exclusion.reason ? ` — ${exclusion.reason}` : ''}`))
    }
  }

  children.push(h3('Filters'))
  children.push(para(model.scope.filterLine))

  if (model.scope.interpretationAssumptions.length) {
    children.push(h3('Assumptions made when reading your brief'))
    children.push(para('These are interpretations. If one is wrong, the numbers below are answering a different question than you asked.', { italics: true, color: MUTED }))
    for (const assumption of model.scope.interpretationAssumptions) children.push(bullet(assumption))
  }
  if (model.scope.corpusAssumptions.length) {
    children.push(h3('Facts about the corpus'))
    for (const assumption of model.scope.corpusAssumptions) children.push(bullet(assumption))
  }

  // ---- diagnostics, before any finding ------------------------------------
  children.push(h1('What was run', accent))
  children.push(
    para(
      'Stated before the findings: a stage that failed or was never run is the reason a section below may be missing, and an absent section is not a finding of absence.',
      { italics: true, color: MUTED }
    )
  )
  if (!model.runDiagnostics.length) {
    children.push(para('No stages have been run for this study.'))
  } else {
    children.push(
      table(
        ['Stage', 'Outcome', 'When', 'Took', 'Scope'],
        model.runDiagnostics.map(run => [
          run.stage,
          run.status,
          run.when,
          run.duration,
          run.stale ? `v${run.scopeVersion} (superseded)` : `v${run.scopeVersion}`,
        ]),
        accent,
        [26, 18, 24, 14, 18]
      )
    )
    const failed = model.runDiagnostics.filter(run => run.error)
    if (failed.length) {
      children.push(spacer())
      children.push(label('Failures'))
      for (const run of failed) children.push(bullet(`${run.stage}: ${run.error}`))
    }
    if (model.runDiagnostics.some(run => run.stale)) {
      children.push(
        para(
          'Runs marked "superseded" were computed against an earlier version of the scope. Their figures are reported as measured, but they do not describe the scope as it now stands.',
          { italics: true, color: MUTED }
        )
      )
    }
    if (model.runsTruncated) {
      children.push(para('Only the most recent runs are listed.', { italics: true, color: MUTED, size: 18 }))
    }
  }

  if (model.fieldMap) renderFieldMap(children, model.fieldMap, accent)
  if (model.areas.length) renderAreas(children, model.areas, accent)

  if (model.divergence.length) {
    children.push(h1('Vocabulary the scope did not use', accent))
    children.push(
      para(
        'For these concepts, meaning-based retrieval reached a body of documents that the scope wording itself does not match. That is a signal about the search, not about the field: a gap found under wording this narrow may be a vocabulary artefact.',
        { italics: true, color: MUTED }
      )
    )
    for (const entry of model.divergence) {
      children.push(h3(entry.concept))
      children.push(
        para(
          `Reached by wording: ${int(entry.lexicalCount)} families. Reached by meaning: ${
            entry.semanticCount === null ? 'not measurable' : int(entry.semanticCount)
          }. Agreement: ${pct1(entry.overlapPct === null ? null : entry.overlapPct / 100)}.`
        )
      )
      if (entry.semanticOnlyVocabulary) {
        children.push(para(`Seen in documents your wording missed: ${entry.semanticOnlyVocabulary}`, { color: MUTED, size: 18 }))
      }
    }
  }

  if (model.dimensionMap) renderDimensionMap(children, model.dimensionMap, accent)
  if (model.hypotheses.length) renderHypotheses(children, model, accent)

  // ---- concepts -----------------------------------------------------------
  if (model.concepts.length) {
    children.push(h1('Invention directions', accent))
    children.push(
      para('Hypotheses that survived testing and were promoted to a working direction.', { italics: true, color: MUTED })
    )
    for (const concept of model.concepts) {
      children.push(h3(concept.title))
      children.push(para(concept.summary))
      if (concept.requiredElements.length) {
        children.push(label('Elements that would have to be present'))
        for (const element of concept.requiredElements) children.push(bullet(element))
      }
      if (concept.differentiation.length) {
        children.push(label('Distinguished from'))
        for (const line of concept.differentiation) children.push(bullet(line))
      }
      if (concept.openQuestions.length) {
        children.push(label('Open questions for human judgment'))
        for (const question of concept.openQuestions) children.push(bullet(question))
      }
    }
  }

  // ---- limitations --------------------------------------------------------
  children.push(h1('Read this before drawing conclusions', accent))
  if (model.limitations.length) {
    children.push(
      para('Properties of the data behind this study. They qualify every figure above.', { italics: true, color: MUTED })
    )
    for (const limitation of model.limitations) children.push(bullet(limitation))
  } else {
    children.push(para('No coverage limitations were recorded for the stages that ran.'))
  }
  children.push(
    para(
      'An absence in this report means the corpus and the wording used did not find something. It is not evidence that nothing exists: no register was consulted, no non-patent literature was searched, and nothing here is an opinion on patentability, validity or freedom to operate.',
      { bold: true }
    )
  )

  // ---- trail --------------------------------------------------------------
  if (model.trail.length) {
    children.push(h1('Evidence trail', accent))
    children.push(
      para(
        `Append-only log of every action taken in this study, human and model alike${model.trailTruncated ? ' (most recent 100 entries)' : ''}.`,
        { italics: true, color: MUTED }
      )
    )
    for (const entry of model.trail) {
      children.push(para(`${entry.when} · ${entry.kind} · ${entry.actor} — ${entry.summary}`, { size: 18, after: 30 }))
    }
  }

  if (model.firm?.showPoweredBy !== false) {
    children.push(spacer())
    children.push(para('Powered by PatentNest.ai', { italics: true, color: MUTED, size: 16 }))
  }

  const margin = convertMillimetersToTwip(20)
  const doc = new Document({
    creator: 'PatentNest Whitespace Studio',
    title: `Whitespace Study Report — ${model.meta.title}`,
    styles: { default: { document: { run: { font: 'Calibri', size: 20, color: INK } } } },
    sections: [
      {
        properties: { page: { margin: { top: margin, bottom: margin, left: margin, right: margin } } },
        children,
      },
    ],
  })
  return Packer.toBuffer(doc)
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function renderFieldMap(children: (Paragraph | Table)[], fieldMap: ReportFieldMapBlock, accent: string) {
  children.push(h1('The field, counted', accent))
  if (fieldMap.stale) {
    children.push(para('Measured against an earlier version of the scope.', { italics: true, color: MUTED }))
  }
  children.push(
    para(
      `${int(fieldMap.familyCount)} patent families (${int(fieldMap.publicationCount)} publications) matched the premise above.`,
      { bold: true }
    )
  )

  if (fieldMap.funnel.length >= 2) {
    children.push(h3('How the field narrowed'))
    children.push(
      table(['Step', 'Documents'], fieldMap.funnel.map(step => [step.label, int(step.count)]), accent, [60, 40])
    )
    children.push(para('Only the steps that were actually measured are listed.', { italics: true, color: MUTED, size: 18 }))
  }

  if (fieldMap.filingsByYear.length) {
    children.push(h3('Filings by year'))
    children.push(
      table(
        ['Year', 'Families', ''],
        fieldMap.filingsByYear.map(entry => [
          String(entry.year),
          int(entry.families),
          entry.withinLag ? 'incomplete — publication lag' : '',
        ]),
        accent,
        [20, 25, 55]
      )
    )
    children.push(para(fieldMap.lagNote, { italics: true, color: MUTED, size: 18 }))
  }

  if (fieldMap.jurisdictions.length) {
    children.push(h3('Where it is filed'))
    children.push(
      table(['Jurisdiction', 'Families'], fieldMap.jurisdictions.map(j => [j.label, int(j.families)]), accent, [60, 40])
    )
  }

  if (fieldMap.assignees.length) {
    children.push(h3('Who files it'))
    children.push(
      table(['Applicant', 'Families'], fieldMap.assignees.map(a => [a.label, int(a.families)]), accent, [70, 30])
    )
  }

  if (fieldMap.classifications.length) {
    children.push(h3('How it is classified'))
    children.push(
      table(
        ['CPC', 'Families', 'Meaning'],
        fieldMap.classifications.map(c => [c.label, int(c.families), c.definition || '']),
        accent,
        [18, 15, 67]
      )
    )
  }

  children.push(h3('Grant status'))
  children.push(
    para(
      `Granted ${int(fieldMap.statusProxy.granted)} · pending ${int(fieldMap.statusProxy.pending)} · unknown ${int(
        fieldMap.statusProxy.unknown
      )}`
    )
  )
  children.push(para(fieldMap.statusProxy.qualifier, { italics: true, color: MUTED, size: 18 }))

  children.push(h3('How much of the field can actually be read'))
  children.push(
    para(
      `Claim text is available for ${int(fieldMap.textCoverage.withClaims)} of ${int(
        fieldMap.textCoverage.familiesTotal
      )} families (${pct1(fieldMap.textCoverage.claimsReadablePct)}); description text for ${int(
        fieldMap.textCoverage.withDescription
      )}.`
    )
  )
  children.push(
    para(
      'This is the most consequential number in the study. Claim-level findings can only be drawn from the readable share, and readability is very uneven between jurisdictions.',
      { italics: true, color: MUTED }
    )
  )
  if (fieldMap.textCoverage.byJurisdiction.length) {
    children.push(
      table(
        ['Jurisdiction', 'Families', 'With claims', 'Readable'],
        fieldMap.textCoverage.byJurisdiction.map(row => [
          row.country,
          int(row.families),
          int(row.withClaims),
          row.families > 0 ? pct1(row.withClaims / row.families) : '—',
        ]),
        accent,
        [34, 22, 22, 22]
      )
    )
  }

  if (fieldMap.coverageNotes.length) {
    children.push(h3('Coverage notes'))
    for (const note of fieldMap.coverageNotes) children.push(bullet(note))
  }
}

function renderAreas(children: (Paragraph | Table)[], areas: ReportAreaBlock[], accent: string) {
  children.push(h1('Areas within the field', accent))
  children.push(
    para(
      'The field grouped by what the documents are about. Group sizes are extrapolated from a sample and are estimates; the geometry behind each grouping is stated so its quality can be judged.',
      { italics: true, color: MUTED }
    )
  )
  for (const area of areas) {
    children.push(h2(area.label))
    if (area.description) children.push(para(area.description))
    children.push(
      para(`~${int(area.fieldEstimate)} families (estimate, from ${int(area.memberCount)} sampled). ${area.estimateQualifier}`, {
        color: MUTED,
        size: 18,
      })
    )
    if (area.keywords.length) children.push(para(`Keywords: ${area.keywords.join(' · ')}`, { color: MUTED, size: 18 }))
    if (area.metricLines.length) children.push(para(area.metricLines.join('  ·  ')))
    if (area.geometry) children.push(para(`Grouping quality: ${area.geometry}`, { color: MUTED, size: 18 }))
    if (area.topAssignees.length) {
      children.push(
        para(`Most active: ${area.topAssignees.slice(0, 6).map(a => `${a.label} (${int(a.families)})`).join(' · ')}`)
      )
    }

    if (area.deepDive) {
      children.push(h3('What the claims in this area recite'))
      children.push(
        para(
          `Read from ${int(area.deepDive.familiesExtracted)} families, of ${int(
            area.deepDive.familiesWithClaims
          )} with claim text among ${int(area.deepDive.familiesConsidered)} examined.`,
          { color: MUTED, size: 18 }
        )
      )
      if (area.deepDive.elementSupport.length) {
        children.push(
          table(
            ['Element', 'Families'],
            area.deepDive.elementSupport.slice(0, 20).map(entry => [entry.element, int(entry.families)]),
            accent,
            [72, 28]
          )
        )
      }
      if (area.deepDive.rarePairs.length) {
        children.push(label('Combinations the area avoids'))
        children.push(
          para(
            'Ranked by how surprising the shortfall is, not by a ratio: a pair expected 500 times and never seen is a far stronger signal than one expected six times.',
            { italics: true, color: MUTED, size: 18 }
          )
        )
        children.push(
          table(
            ['Combination', 'Seen', 'Expected', 'Surprisal'],
            area.deepDive.rarePairs.slice(0, 15).map(pair => [
              `${pair.a} + ${pair.b}`,
              int(pair.observed),
              pair.expected.toFixed(1),
              pair.surprisal.toFixed(1),
            ]),
            accent,
            [52, 14, 17, 17]
          )
        )
      }
      if (area.deepDive.problemSolution.length) {
        children.push(label('Problems and how they are solved'))
        for (const entry of area.deepDive.problemSolution.slice(0, 12)) {
          children.push(bullet(`${entry.problem} → ${entry.solutions.join('; ')} (${int(entry.families)} families)`))
        }
      }
      for (const note of area.deepDive.coverageNotes) children.push(para(note, { italics: true, color: MUTED, size: 18 }))
    }
  }
}

function renderDimensionMap(children: (Paragraph | Table)[], map: ReportDimensionBlock, accent: string) {
  children.push(h1('How the field organises itself', accent))
  if (map.stale) children.push(para('Measured against an earlier version of the scope.', { italics: true, color: MUTED }))
  children.push(
    para(
      `${int(map.familyCount)} families (${int(map.publicationCount)} publications) were placed along the viewpoints below.`,
      { bold: true }
    )
  )
  children.push(para(map.sampleQualifier, { italics: true, color: MUTED, size: 18 }))
  children.push(
    para(
      `Discovery ${map.settled ? 'settled' : 'stopped'} because ${map.settledReason}.`,
      map.settled ? { color: MUTED, size: 18 } : { bold: true }
    )
  )

  for (const dimension of map.registry) {
    children.push(h2(dimension.label))
    children.push(para(dimension.description))
    children.push(
      table(
        ['Value', 'Families', 'Share of field', 'Found'],
        dimension.values.map(value => [
          value.label,
          int(value.families),
          pct1(value.share),
          value.provenance === 'user' ? 'yours' : `round ${value.round}`,
        ]),
        accent,
        [46, 18, 20, 16]
      )
    )
    children.push(
      para(
        `Places ${int(dimension.assignedFamilies)} families; ${pct1(dimension.residualShare)} of the field takes no value on this axis.${
          dimension.multiAssignmentRatio > 1.05
            ? ' Values overlap, so they do not sum to the total — a document may occupy several.'
            : ''
        }`,
        { color: MUTED, size: 18 }
      )
    )
  }

  if (map.rounds.length) {
    children.push(h2('How the viewpoints were found'))
    children.push(
      para('Including what was proposed and dropped, with the reason it was dropped — the rejections are part of why the registry can be trusted.', {
        italics: true,
        color: MUTED,
      })
    )
    for (const round of map.rounds) {
      children.push(h3(`Round ${round.round}`))
      children.push(para(`Read ${round.sliceLine}.`, { color: MUTED, size: 18 }))
      if (round.accepted.length) {
        children.push(label('Accepted'))
        for (const entry of round.accepted) children.push(bullet(entry))
      }
      if (round.rejected.length) {
        children.push(label('Measured and rejected'))
        for (const entry of round.rejected) children.push(bullet(`${entry.label} — ${entry.reason} (${entry.detail})`))
      }
      children.push(
        para(`After this round, ${pct1(round.residualShareAfter)} of the sample was still unplaced.`, {
          color: MUTED,
          size: 18,
        })
      )
    }
  }

  if (map.matrixSummary.length) {
    children.push(h2('Viewpoint pairs examined'))
    children.push(
      table(
        ['Pair', 'Harvested', 'Overlap', 'Skipped because'],
        map.matrixSummary.map(entry => [
          entry.pair,
          entry.harvested ? 'yes' : 'no',
          entry.redundancy === null ? '—' : pct1(entry.redundancy),
          entry.skipReason || '',
        ]),
        accent,
        [38, 14, 14, 34]
      )
    )
  }

  children.push(h2('Unoccupied combinations'))
  if (!map.gaps.length) {
    children.push(
      para(
        'No combination met the evidence bar. Every empty cell either sat on a thin margin, was expected to be empty by chance, or lay on an axis pair that restates itself — so none is reported as a finding.',
        { bold: true }
      )
    )
  } else {
    children.push(
      para(
        'Each of these is a cell where both axes are well populated, the combination was expected to occur, and it does not. They are candidates for investigation, not conclusions.',
        { italics: true, color: MUTED }
      )
    )
    if (map.thresholdLine) children.push(para(map.thresholdLine, { italics: true, color: MUTED, size: 18 }))
    for (const gap of map.gaps) {
      children.push(h3(gap.title))
      children.push(
        para(
          `Seen ${gap.observed === 1 ? 'once' : `${int(gap.observed)} times`} where ${gap.expected.toFixed(
            1
          )} were expected. Margins: ${int(gap.marginA)} × ${int(gap.marginB)} families. Surprisal ${gap.surprisal.toFixed(
            1
          )} decibans.`
        )
      )
      if (gap.nearMissLine) children.push(para(gap.nearMissLine, { size: 18 }))
      if (gap.unassignedLine) children.push(para(gap.unassignedLine, { size: 18, color: MUTED }))
      if (gap.armClaimsLine) children.push(para(gap.armClaimsLine, { size: 18, color: MUTED }))
      if (gap.suspectReason) {
        children.push(para(`Treat with caution: ${gap.suspectReason}`, { bold: true, size: 18 }))
      }
    }
  }

  children.push(
    para(
      `${int(map.unclassifiedFamilies)} families (${pct1(map.unclassifiedShare)}) match no value of any viewpoint. A large share here means the axes do not describe the whole field, and gaps drawn from them are correspondingly narrower than they look.`,
      { italics: true, color: MUTED, size: 18 }
    )
  )
  for (const note of map.coverageNotes) children.push(bullet(note))
}

function renderHypotheses(children: (Paragraph | Table)[], model: WhitespaceReportModel, accent: string) {
  children.push(h1('Hypotheses and how they were tested', accent))
  children.push(
    para(
      'Each statement below was attacked deliberately: the system searched for the art that would disprove it, in vocabulary the original wording did not use. Scores and attack outcomes are computed. Where an attorney review is recorded, that review is the operative judgment and outranks the machine verdict above it.',
      { italics: true, color: MUTED }
    )
  )
  if (model.reviewedCount) {
    children.push(
      para(
        `${model.reviewedCount} of ${model.hypotheses.length} ${
          model.hypotheses.length === 1 ? 'has' : 'have'
        } been reviewed.`,
        { color: MUTED, size: 18 }
      )
    )
  }

  for (const hypothesis of model.hypotheses) {
    renderHypothesis(children, hypothesis, accent)
  }
}

function renderHypothesis(children: (Paragraph | Table)[], hypothesis: ReportHypothesisBlock, accent: string) {
  children.push(h2(hypothesis.statement))
  children.push(
    para(
      `${hypothesis.statusLabel}  ·  ${hypothesis.typeLabel}${
        hypothesis.clusterLabel ? `  ·  in “${hypothesis.clusterLabel}”` : ''
      }`,
      { color: MUTED, size: 18 }
    )
  )
  children.push(para(hypothesis.rationale))
  if (hypothesis.elements.length) {
    children.push(para(`Elements: ${hypothesis.elements.join(' · ')}`, { color: MUTED, size: 18 }))
  }

  children.push(label('Scores'))
  children.push(
    table(
      hypothesis.scoreLine.map(score => score.label),
      [hypothesis.scoreLine.map(score => score.value)],
      accent
    )
  )
  children.push(
    para('Reported separately and never averaged: they measure different things and a single number would hide which one is weak.', {
      italics: true,
      color: MUTED,
      size: 18,
    })
  )

  children.push(label(`Attacks — ${hypothesis.attacksRun} of ${hypothesis.attacksPlanned} ran`))
  if (!hypothesis.attacks.length) {
    children.push(para('No attacks have been run against this hypothesis.', { bold: true }))
  } else {
    children.push(
      table(
        ['Attack', 'Query', 'Hits', 'Outcome'],
        hypothesis.attacks.map(attack => [
          attack.label,
          attack.query || '—',
          attack.notRun ? '—' : String(attack.hits),
          attack.notRun ? `${attack.outcome} — ${attack.reason || 'no reason recorded'}` : attack.outcome,
        ]),
        accent,
        [20, 42, 10, 28]
      )
    )
    children.push(
      para('An attack that could not run is not a survived attack. It lowers evidence quality rather than raising confidence.', {
        italics: true,
        color: MUTED,
        size: 18,
      })
    )
  }

  if (hypothesis.gates.length) {
    children.push(label('Tests applied'))
    children.push(
      table(
        ['Test', 'Result', 'On what basis'],
        hypothesis.gates.map(gate => [gate.label, gate.outcome, gate.basis]),
        accent,
        [22, 20, 58]
      )
    )
  }

  if (hypothesis.redTeamNotes) {
    children.push(label('Red team'))
    children.push(para(hypothesis.redTeamNotes))
  }

  if (hypothesis.evidence.length) {
    children.push(label('Evidence'))
    for (const item of hypothesis.evidence.slice(0, 12)) {
      children.push(
        para(`${item.stance} · ${item.kind}${item.refId ? ` · ${item.refId}` : ''}`, { bold: true, size: 18, after: 20 })
      )
      if (item.passage) children.push(para(item.passage, { size: 18, indent: 360 }))
    }
  }

  if (hypothesis.coverageLimitations.length) {
    children.push(label('What this does not cover'))
    for (const limitation of hypothesis.coverageLimitations) children.push(bullet(limitation))
  }

  // The attorney's word, last and loudest.
  children.push(label('Attorney review'))
  if (hypothesis.review) {
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              cell(`${hypothesis.review.verdictLabel.toUpperCase()} — ${hypothesis.review.meaning}`, {
                bold: true,
                color: 'FFFFFF',
                fill: clampForFill(accent),
              }),
            ],
          }),
          ...(hypothesis.review.note
            ? [new TableRow({ children: [cell(hypothesis.review.note)] })]
            : []),
          new TableRow({
            children: [cell(`Recorded ${hypothesis.review.reviewedOn}. This is the operative judgment on this hypothesis.`)],
          }),
        ],
      })
    )
  } else {
    children.push(
      para('No attorney review recorded. The status above is the system’s own verdict and has not been reviewed.', {
        italics: true,
        color: MUTED,
      })
    )
  }
  children.push(spacer())
}
