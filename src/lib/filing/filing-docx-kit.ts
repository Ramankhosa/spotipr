/**
 * India filing forms — shared DOCX building blocks.
 *
 * Form 1 and Form 5 are both one big bordered table on A4, so the table plumbing, the tick
 * glyphs and the signature blocks live here once. Keeping the signature builder shared is
 * deliberate: the same signatory must appear identically on Form 1 paragraph 13, on Form 5,
 * and on every drawing sheet, and the way that drifts in hand-prepared bundles is by being
 * retyped three times.
 */

import {
  AlignmentType,
  BorderStyle,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlignTable,
  WidthType,
  type IBorderOptions,
  type ISpacingProperties,
  type TableVerticalAlign,
} from 'docx'
import type { DeclarationState, FilingSignatory, InapplicableClauseStyle } from './types'

// A4 is 11906 x 16838 twips. Narrow margins because Form 1 is dense.
export const PAGE_WIDTH = 11906
export const PAGE_HEIGHT = 16838
export const PAGE_MARGIN = 850
export const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2 // 10206

export const FONT = 'Times New Roman'
export const SIZE_BODY = 20 // half-points => 10pt
export const SIZE_SMALL = 18 // 9pt
export const SIZE_HEADING = 24 // 12pt

const THIN: IBorderOptions = { style: BorderStyle.SINGLE, size: 4, color: '000000' }

export const CELL_BORDERS = { top: THIN, bottom: THIN, left: THIN, right: THIN }
export const NO_BORDERS = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
}

export interface TextOpts {
  bold?: boolean
  italics?: boolean
  strike?: boolean
  size?: number
  align?: (typeof AlignmentType)[keyof typeof AlignmentType]
  spacing?: ISpacingProperties
  underline?: boolean
}

/** A body paragraph in the form's typeface. `docx` forbids "\n" — callers pass one per line. */
export function para(text: string, opts: TextOpts = {}): Paragraph {
  return new Paragraph({
    alignment: opts.align ?? AlignmentType.LEFT,
    spacing: opts.spacing ?? { before: 20, after: 20 },
    children: [
      new TextRun({
        text,
        bold: opts.bold,
        italics: opts.italics,
        strike: opts.strike,
        underline: opts.underline ? {} : undefined,
        font: FONT,
        size: opts.size ?? SIZE_BODY,
      }),
    ],
  })
}

/** A paragraph assembled from differently-formatted runs (e.g. a glyph plus clause text). */
export function runsPara(runs: Array<{ text: string } & TextOpts>, opts: TextOpts = {}): Paragraph {
  return new Paragraph({
    alignment: opts.align ?? AlignmentType.LEFT,
    spacing: opts.spacing ?? { before: 20, after: 20 },
    children: runs.map(r => new TextRun({
      text: r.text,
      bold: r.bold,
      italics: r.italics,
      strike: r.strike,
      underline: r.underline ? {} : undefined,
      font: FONT,
      size: r.size ?? opts.size ?? SIZE_BODY,
    })),
  })
}

export function blank(size = SIZE_SMALL): Paragraph {
  return para('', { size })
}

export interface CellOpts {
  width: number
  columnSpan?: number
  rowSpan?: number
  bold?: boolean
  italics?: boolean
  align?: (typeof AlignmentType)[keyof typeof AlignmentType]
  verticalAlign?: TableVerticalAlign
  shading?: string
  size?: number
  borders?: typeof CELL_BORDERS
}

/** A bordered cell holding plain text lines. */
export function cell(text: string | string[], opts: CellOpts): TableCell {
  const lines = Array.isArray(text) ? text : [text]
  return cellOf(
    lines.length ? lines.map(line => para(line, { bold: opts.bold, italics: opts.italics, align: opts.align, size: opts.size })) : [blank()],
    opts
  )
}

/** A bordered cell holding arbitrary block content. */
export function cellOf(children: Array<Paragraph | Table>, opts: CellOpts): TableCell {
  return new TableCell({
    width: { size: opts.width, type: WidthType.DXA },
    columnSpan: opts.columnSpan,
    rowSpan: opts.rowSpan,
    verticalAlign: opts.verticalAlign ?? VerticalAlignTable.TOP,
    // ShadingType.CLEAR, never SOLID — SOLID renders as a black fill.
    shading: opts.shading ? { fill: opts.shading, type: ShadingType.CLEAR, color: 'auto' } : undefined,
    borders: opts.borders ?? CELL_BORDERS,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: children.length ? children : [blank()],
  })
}

/** Column widths must sum to the table width, and every cell needs its own DXA width. */
export function table(columnWidths: number[], rows: TableRow[]): Table {
  return new Table({
    columnWidths,
    width: { size: columnWidths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    rows,
  })
}

export function row(cells: TableCell[]): TableRow {
  return new TableRow({ children: cells })
}

/** A full-width banner row spanning `columns`, used for the numbered section headings. */
export function sectionRow(text: string, columns: number, opts: { shading?: string } = {}): TableRow {
  return row([
    cell(text, {
      width: CONTENT_WIDTH,
      columnSpan: columns,
      bold: true,
      shading: opts.shading ?? 'F2F2F2',
    }),
  ])
}

// ---------------------------------------------------------------------------
// Tick marks
// ---------------------------------------------------------------------------

/** Form 1's inline category boxes: "Ordinary ( ✓ )" / "Convention ( )". */
export function tickBox(label: string, checked: boolean): string {
  return `${label} ( ${checked ? '✓' : ' '} )`
}

const GLYPH_TICK = '☑'
const GLYPH_CROSS = '☒'

/**
 * A declaration clause. The form's own footnote says tick or cross whichever applies and
 * strike out what does not, so the three states map to: ticked box, crossed box, and
 * crossed box with the text struck through.
 */
export function declarationPara(
  text: string,
  state: DeclarationState,
  inapplicableStyle: InapplicableClauseStyle
): Paragraph {
  const effective: DeclarationState =
    state === 'cross' && inapplicableStyle === 'strike' ? 'strike' : state
  const glyph = effective === 'tick' ? GLYPH_TICK : GLYPH_CROSS
  return runsPara([
    { text: `${glyph} `, size: SIZE_BODY },
    { text, strike: effective === 'strike' },
  ], { spacing: { before: 30, after: 30 } })
}

// ---------------------------------------------------------------------------
// Signature blocks
// ---------------------------------------------------------------------------

/**
 * The organisation signature block that closes Form 1 and Form 5.
 *
 * We print the name and designation over a blank signature line and never embed a signature
 * image — ink or DSC happens outside the system, which is what attorneys expect and what
 * keeps us out of storing signature artifacts.
 */
export function signatureBlock(
  signatory: FilingSignatory,
  opts: {
    datedThis: string
    organisation?: string | null
    controllerCity: string
    /** Form 5 addresses "The Controller of Patent"; Form 1 uses the plural. */
    controllerLabel?: string
    /** Form 1 prints "Registrar, LPU" on one line; Form 5 splits across two. */
    designationInline?: boolean
  }
): Paragraph[] {
  // The date line sits left, the signature block right, and the Controller address returns
  // to the left — the layout in the attorney-prepared originals.
  const R = { align: AlignmentType.RIGHT }
  const lines: Paragraph[] = [
    blank(),
    para(opts.datedThis),
    blank(),
    para('Signature', R),
    blank(),
    para(signatory.name, { ...R }),
  ]
  if (opts.designationInline && opts.organisation) {
    lines.push(para(`${signatory.designation}, ${opts.organisation}`, R))
  } else {
    lines.push(para(signatory.designation, R))
    if (opts.organisation) lines.push(para(opts.organisation, R))
  }
  if (signatory.mobile) lines.push(para(`Mobile No: ${signatory.mobile}`, R))
  lines.push(
    blank(),
    para('To'),
    para(opts.controllerLabel ?? 'The Controller of Patents,'),
    para(`The Patent Office, at ${opts.controllerCity}`)
  )
  return lines
}

/**
 * Form 1 paragraph 12(i) — each inventor signs individually, declaring the applicant is
 * their assignee. This is how an organisation takes rights without a separate assignment
 * deed being uploaded.
 */
export function inventorSignatureLines(name: string, date: string): Paragraph[] {
  return [
    para(`(a) Date: ${date}`),
    para('(b) Signature:'),
    para(`(c) Name: ${name}`),
    blank(),
  ]
}

/** The per-sheet signature on drawings. */
export function drawingSignatureLines(signatory: FilingSignatory, organisation?: string | null): Paragraph[] {
  const lines = [
    para(signatory.name, { align: AlignmentType.RIGHT, bold: true }),
    para(signatory.designation, { align: AlignmentType.RIGHT }),
  ]
  if (organisation) lines.push(para(organisation, { align: AlignmentType.RIGHT }))
  return lines
}

/** Standard A4 section properties for every filing document. */
export const A4_SECTION = {
  page: {
    size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
    margin: { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN },
  },
}

export const DEFAULT_STYLES = {
  default: {
    document: {
      run: { font: FONT, size: SIZE_BODY },
      paragraph: { spacing: { before: 20, after: 20 } },
    },
  },
}
