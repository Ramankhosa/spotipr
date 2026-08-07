/**
 * FORM 5 — Declaration as to Inventorship
 * (Patents Act 1970 s.10(6), Patents Rules 2003 r.13(6)).
 *
 * Reads from the same records as Form 1 but renders addresses as flowing prose rather than
 * the fixed table rows. That single-source arrangement is the point: the two documents
 * cannot disagree about an inventor's address, which is exactly the drift that separately
 * maintained templates produce.
 *
 * The application number and filing date print as dotted blanks until the application is
 * actually filed — Form 5 goes in the same day as Form 1, so those particulars do not exist
 * yet. Once they do, the bundle regenerates with them filled in.
 */

import { AlignmentType, Document, Packer, Paragraph, TableRow, VerticalAlignTable } from 'docx'
import {
  A4_SECTION,
  DEFAULT_STYLES,
  NO_BORDERS,
  SIZE_HEADING,
  SIZE_SMALL,
  blank,
  cell,
  cellOf,
  para,
  row,
  signatureBlock,
  table,
} from './filing-docx-kit'
import {
  renderAddressLine,
  renderDatedThis,
  renderDottedBlank,
  renderPartialFilingDate,
  renderPersonName,
  renderShortDate,
  sanitizeField,
} from './formatting'
import { clauseState } from './declarations'
import type { FilingContext } from './types'

const COL = 850
const COLS = 12
const GRID = Array(COLS).fill(COL)
const W = (n: number) => n * COL
const FULL = W(COLS)

export async function buildForm5Docx(ctx: FilingContext): Promise<Buffer> {
  const s = ctx.settings
  const heading: Paragraph[] = [
    para('FORM 5', { bold: true, size: SIZE_HEADING, align: AlignmentType.CENTER }),
    para('THE PATENTS ACT, 1970', { align: AlignmentType.CENTER }),
    para('(39 OF 1970)', { align: AlignmentType.CENTER }),
    para('&', { align: AlignmentType.CENTER }),
    para('THE PATENT RULES, 2003', { align: AlignmentType.CENTER }),
    para('DECLARATION AS TO INVENTORSHIP', { bold: true, align: AlignmentType.CENTER }),
    blank(),
  ]

  const rows: TableRow[] = []

  // Form 5 is laid out on an invisible table — unlike Form 1, the printed form has no
  // visible cell borders.
  const B = { borders: NO_BORDERS }

  // --- 1. Applicant + the "we declare" preamble --------------------------
  rows.push(row([
    cellOf([
      para('[See Section 10(6) and Rule 13(6)]', { size: SIZE_SMALL, bold: true }),
      para('1. Name of Applicant', { bold: true }),
    ], { width: W(4), columnSpan: 4, ...B }),
    cell(sanitizeField(ctx.applicant.legalName), { width: W(8), columnSpan: 8, bold: true, verticalAlign: VerticalAlignTable.TOP, ...B }),
  ]))

  // Unknown until the Office allots them. The date keeps the month and year the form is
  // being filed in and leaves only the day open, as the attorney-prepared originals do.
  const appNo = sanitizeField(ctx.details.applicationNo) || renderDottedBlank(10)
  const appDate = ctx.details.filingDate
    ? renderShortDate(ctx.details.filingDate)
    : renderPartialFilingDate(ctx.filingDateForDocs)
  rows.push(row([cellOf([
    para(`hereby declare that the true and first inventor(s) of the invention disclosed in the ${ctx.details.specType === 'complete' ? 'Complete' : 'Provisional'} specification filed in pursuance of our application numbered ${appNo} dated ${appDate} are:`),
  ], { width: FULL, columnSpan: COLS, ...B })]))

  // --- 2. Inventors ------------------------------------------------------
  const primaryInventors = ctx.inventors.filter(i => !i.isAdditionalInventor)
  const inventorBlocks: Paragraph[] = []
  for (const inv of primaryInventors) {
    inventorBlocks.push(
      para(`a. Name: ${renderPersonName(inv.name, s.nameCase)}`),
      para(`b. Nationality: ${sanitizeField(inv.nationality)}`),
      para(`c. Address: ${renderAddressLine(inv.address, { terminalPeriod: s.addressLineTerminalPeriod })}`),
      blank()
    )
  }
  rows.push(row([
    cell('2. Inventor(s)', { width: W(3), columnSpan: 3, bold: true, ...B }),
    cellOf(inventorBlocks.length ? inventorBlocks : [blank()], { width: W(9), columnSpan: 9, ...B }),
  ]))

  // --- 3. Convention-country declaration ---------------------------------
  // Whether this block is kept or struck is the attorney's choice, resolved through the
  // firm -> project -> patent cascade. The rules only supply the default (struck on an
  // ordinary application, per the form's "strike out what is not applicable" instruction).
  const strikeSection3 = clauseState(ctx.declarations, 'form5Convention') === 'strike'
  rows.push(row([cellOf([
    para(
      '3. Declaration to be given when the application in India is filed by the applicant(s) in the convention country:-',
      { bold: true, strike: strikeSection3 }
    ),
    para(
      'We the applicants in the convention country hereby declare that our right to apply for a patent in India is by way of assignment from the true and first inventor(s).',
      { strike: strikeSection3 }
    ),
  ], { width: FULL, columnSpan: COLS, ...B })]))

  // --- 4. Additional inventors' assent -----------------------------------
  // Same treatment: the default follows from whether any inventor is marked additional,
  // and the attorney can override it for this filing.
  const additional = ctx.inventors.filter(i => i.isAdditionalInventor)
  const strikeSection4 = clauseState(ctx.declarations, 'form5AdditionalInventors') === 'strike'

  const assentBlock: Paragraph[] = [
    para(
      '4. Statement (to be signed by the additional inventor(s) not mentioned in the application form)',
      { bold: true, strike: strikeSection4 }
    ),
    para(
      'I/We assent to the invention referred to in the above declaration, being included in the complete specification filed in pursuance of the stated application.',
      { strike: strikeSection4 }
    ),
    blank(),
  ]
  if (additional.length) {
    for (const inv of additional) {
      assentBlock.push(
        para(renderDatedThis(ctx.filingDateForDocs, s.dateStyle), { strike: strikeSection4 }),
        para('Signature of the additional inventor:', { strike: strikeSection4 }),
        para(`Name: ${renderPersonName(inv.name, s.nameCase)}`, { strike: strikeSection4 }),
        blank()
      )
    }
  } else {
    assentBlock.push(
      para(renderDatedThis(ctx.filingDateForDocs, s.dateStyle), { strike: strikeSection4 }),
      para('Signature of the additional inventor(s):', { strike: strikeSection4 }),
      para('Name:', { strike: strikeSection4 }),
      blank()
    )
  }

  // The applicant's own signature block is never struck — it closes the form.
  if (ctx.signatory) {
    assentBlock.push(...signatureBlock(ctx.signatory, {
      datedThis: renderDatedThis(ctx.filingDateForDocs, s.dateStyle),
      organisation: ctx.applicant.legalName,
      controllerCity: s.officeBranch,
      controllerLabel: 'The Controller of Patents,',
    }))
  }

  rows.push(row([cellOf(assentBlock, { width: FULL, columnSpan: COLS, ...B })]))

  const doc = new Document({
    styles: DEFAULT_STYLES,
    sections: [{ properties: A4_SECTION, children: [...heading, table(GRID, rows)] }],
  })
  return Packer.toBuffer(doc)
}
