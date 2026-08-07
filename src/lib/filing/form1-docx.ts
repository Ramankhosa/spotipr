/**
 * FORM 1 — Application for Grant of Patent (Patents Act 1970, Patents Rules 2003).
 *
 * Rendered as a single 12-column bordered table so every section aligns on one grid, which
 * is how the printed form reads. All values arrive pre-resolved on the FilingContext; this
 * module does no lookups and no cascade resolution of its own.
 *
 * Deviation from the sample bundle, on purpose: paragraph 8 (particulars of a convention
 * application) is restored. The attorney's template had deleted it, so its numbering jumped
 * 7 -> 9 and paragraph 12(iii) still referred to convention particulars as "Para - 5" — a
 * fossil of an older form revision. The declaration text here points at paragraph 8.
 */

import { AlignmentType, Document, Packer, Paragraph, TableRow, VerticalAlignTable } from 'docx'
import {
  A4_SECTION,
  CELL_BORDERS,
  DEFAULT_STYLES,
  SIZE_HEADING,
  SIZE_SMALL,
  blank,
  cell,
  cellOf,
  declarationPara,
  inventorSignatureLines,
  para,
  row,
  signatureBlock,
  table,
  tickBox,
} from './filing-docx-kit'
import {
  applyTitleCase,
  renderAddressLine,
  renderAddressRows,
  renderDatedThis,
  renderNotApplicable,
  renderPersonName,
  renderShortDate,
  sanitizeField,
} from './formatting'
import { clauseState } from './declarations'
import type { FilingContext, FilingInventor, StructuredAddress } from './types'

const COL = 850
const COLS = 12
const GRID = Array(COLS).fill(COL)
const W = (n: number) => n * COL
const FULL = W(COLS)

export async function buildForm1Docx(ctx: FilingContext): Promise<Buffer> {
  const rows: TableRow[] = []
  const s = ctx.settings
  const na = renderNotApplicable(s.notApplicableStyle)

  // --- Header + office-use block ----------------------------------------
  rows.push(row([
    cellOf([
      para('FORM 1', { bold: true, size: SIZE_HEADING, align: AlignmentType.CENTER }),
      para('THE PATENTS ACT 1970 (39 OF 1970) and', { align: AlignmentType.CENTER }),
      para('The Patents Rules, 2003', { align: AlignmentType.CENTER }),
      para('APPLICATION FOR GRANT OF PATENT', { bold: true, align: AlignmentType.CENTER }),
      para('(See section 7, 54 & 135 and sub-rule (1) of rule 20)', { size: SIZE_SMALL, align: AlignmentType.CENTER }),
    ], { width: W(7), columnSpan: 7, verticalAlign: VerticalAlignTable.CENTER }),
    cellOf([
      para('(FOR OFFICE USE ONLY)', { bold: true, align: AlignmentType.CENTER, size: SIZE_SMALL }),
      blank(),
      para('Application No:'),
      para('Filing Date:'),
      para('Amount of Fee paid:'),
      para('CBR No:'),
      para('Signature:'),
    ], { width: W(5), columnSpan: 5 }),
  ]))

  // --- 1. Applicant's reference -----------------------------------------
  rows.push(row([
    cell("1. APPLICANT'S REFERENCE / IDENTIFICATION NO. (AS ALLOTTED BY OFFICE)", { width: W(7), columnSpan: 7, bold: true }),
    cell(sanitizeField(ctx.details.applicantRefNo) || '', { width: W(5), columnSpan: 5 }),
  ]))

  // --- 2. Type of application -------------------------------------------
  rows.push(section('2. TYPE OF APPLICATION [Please tick (✓) at the appropriate category]'))
  const type = ctx.details.applicationType
  rows.push(row([
    cell(tickBox('Ordinary', type === 'ordinary'), { width: W(4), columnSpan: 4 }),
    cell(tickBox('Convention', type === 'convention'), { width: W(4), columnSpan: 4 }),
    cell(tickBox('PCT-NP', type === 'pct_np'), { width: W(4), columnSpan: 4 }),
  ]))
  rows.push(row([
    cell(tickBox('Divisional', ctx.details.isDivisional), { width: W(6), columnSpan: 6 }),
    cell(tickBox('Patent of addition', ctx.details.isPatentOfAddition), { width: W(6), columnSpan: 6 }),
  ]))

  // --- 3A. Applicant ----------------------------------------------------
  rows.push(section('3A. APPLICANT(S)'))
  rows.push(partyHeaderRow('Address of the Applicant'))
  rows.push(...partyRows(
    ctx.applicant.legalName,
    ctx.applicant.nationality,
    ctx.applicant.countryOfResidence,
    ctx.applicant.address,
    s.emptyFieldStyle
  ))

  // --- 3B. Category -----------------------------------------------------
  rows.push(section('3B. CATEGORY OF APPLICANT [Please tick (✓) at the appropriate category]'))
  const cat = ctx.applicant.category
  rows.push(row([
    cell(tickBox('Natural person', cat === 'natural_person'), { width: W(3), columnSpan: 3, rowSpan: 2 }),
    cell('Other than Natural person', { width: W(9), columnSpan: 9, bold: true }),
  ]))
  rows.push(row([
    cell(tickBox('Small entity', cat === 'small_entity'), { width: W(3), columnSpan: 3 }),
    cell(tickBox('Startup', cat === 'startup'), { width: W(3), columnSpan: 3 }),
    cell(tickBox('Educational Institute', cat === 'educational_institute'), { width: W(3), columnSpan: 3 }),
  ]))

  // --- 4. Inventors -----------------------------------------------------
  rows.push(section('4. INVENTOR(S) [Please tick (✓) at the appropriate category]'))
  const sameAsApplicant = inventorsSameAsApplicant(ctx)
  rows.push(row([
    cell('Are all the inventor(s) same as the applicant(s) named above?', { width: W(6), columnSpan: 6 }),
    cell(tickBox('Yes', sameAsApplicant), { width: W(3), columnSpan: 3 }),
    cell(tickBox('No', !sameAsApplicant), { width: W(3), columnSpan: 3 }),
  ]))
  if (!sameAsApplicant) {
    rows.push(row([cell('If "No" furnish the details of the inventor(s)', { width: FULL, columnSpan: COLS, italics: true })]))
    rows.push(partyHeaderRow('Address of the Inventor'))
    for (const inv of ctx.inventors) {
      rows.push(...partyRows(
        renderPersonName(inv.name, s.nameCase),
        inv.nationality,
        inv.countryOfResidence,
        inv.address,
        s.emptyFieldStyle,
        { pinCode: 'Pin code' }
      ))
    }
  }

  // --- 5. Title ---------------------------------------------------------
  rows.push(section('5. TITLE OF THE INVENTION'))
  rows.push(row([cell(applyTitleCase(ctx.title, s.titleCase), { width: FULL, columnSpan: COLS, bold: true })]))

  // --- 6. Authorised registered person ----------------------------------
  const agent = ctx.agent
  rows.push(labelValueBlock('6. AUTHORISED REGISTERED PERSON(S)', [
    ['IN/PA No.', agent ? sanitizeField(agent.registrationNo) : na],
    ['Name', agent ? sanitizeField(agent.name) : na],
    ['Mobile No.', agent ? sanitizeField(agent.mobile) || na : na],
  ]))

  // --- 7. Address for service -------------------------------------------
  const c = ctx.correspondence
  rows.push(labelValueBlock('7. ADDRESS FOR SERVICE OF APPLICANT IN INDIA', [
    ['Name', sanitizeField(c.name)],
    ['Postal address', sanitizeField(c.postalAddress)],
    ['Telephone No.', sanitizeField(c.phone) || na],
    ['Mobile No.', sanitizeField(c.mobile) || na],
    ['Fax No.', sanitizeField(c.fax) || na],
    ['E-Mail ID', sanitizeField(c.email)],
  ]))

  // --- 8. Convention application particulars ----------------------------
  rows.push(section('8. IN CASE OF APPLICATION CLAIMING PRIORITY OF APPLICATION FILED IN CONVENTION COUNTRY, PARTICULARS OF CONVENTION APPLICATION'))
  const isConvention = ctx.details.applicationType === 'convention'
  rows.push(row([
    cell('Application No.', { width: W(4), columnSpan: 4, bold: true }),
    cell('Filing date', { width: W(4), columnSpan: 4, bold: true }),
    cell('Country', { width: W(4), columnSpan: 4, bold: true }),
  ]))
  rows.push(row([
    cell(isConvention ? sanitizeField(ctx.details.parentApplicationNo) || '' : na, { width: W(4), columnSpan: 4 }),
    cell(isConvention && ctx.details.parentFilingDate ? renderShortDate(ctx.details.parentFilingDate) : (isConvention ? '' : na), { width: W(4), columnSpan: 4 }),
    cell(isConvention ? '' : na, { width: W(4), columnSpan: 4 }),
  ]))

  // --- 9. PCT particulars -----------------------------------------------
  rows.push(section('9. IN CASE OF PCT NATIONAL PHASE APPLICATION, PARTICULARS OF INTERNATIONAL APPLICATION FILED UNDER PATENT CO-OPERATION TREATY (PCT)'))
  const isPct = ctx.details.applicationType === 'pct_np'
  rows.push(row([
    cell('International application number', { width: W(6), columnSpan: 6, bold: true }),
    cell('International filing date', { width: W(6), columnSpan: 6, bold: true }),
  ]))
  rows.push(row([
    cell(isPct ? sanitizeField(ctx.details.parentApplicationNo) || '' : na, { width: W(6), columnSpan: 6 }),
    cell(isPct && ctx.details.parentFilingDate ? renderShortDate(ctx.details.parentFilingDate) : (isPct ? '' : na), { width: W(6), columnSpan: 6 }),
  ]))

  // --- 10. Divisional particulars ---------------------------------------
  rows.push(section('10. IN CASE OF DIVISIONAL APPLICATION FILED UNDER SECTION 16, PARTICULARS OF ORIGINAL (FIRST) APPLICATION'))
  rows.push(row([
    cell('Original (first) application No.', { width: W(6), columnSpan: 6, bold: true }),
    cell('Date of filing of original (first) application', { width: W(6), columnSpan: 6, bold: true }),
  ]))
  rows.push(row([
    cell(ctx.details.isDivisional ? sanitizeField(ctx.details.parentApplicationNo) || '' : na, { width: W(6), columnSpan: 6 }),
    cell(ctx.details.isDivisional && ctx.details.parentFilingDate ? renderShortDate(ctx.details.parentFilingDate) : (ctx.details.isDivisional ? '' : na), { width: W(6), columnSpan: 6 }),
  ]))

  // --- 11. Patent of addition particulars -------------------------------
  rows.push(section('11. IN CASE OF PATENT OF ADDITION FILED UNDER SECTION 54, PARTICULARS OF MAIN APPLICATION OR PATENT'))
  rows.push(row([
    cell('Main application / Patent No.', { width: W(6), columnSpan: 6, bold: true }),
    cell('Date of filing of main application', { width: W(6), columnSpan: 6, bold: true }),
  ]))
  rows.push(row([
    cell(ctx.details.isPatentOfAddition ? sanitizeField(ctx.details.parentApplicationNo) || '' : na, { width: W(6), columnSpan: 6 }),
    cell(ctx.details.isPatentOfAddition && ctx.details.parentFilingDate ? renderShortDate(ctx.details.parentFilingDate) : (ctx.details.isPatentOfAddition ? '' : na), { width: W(6), columnSpan: 6 }),
  ]))

  // --- 12. Declarations -------------------------------------------------
  rows.push(section('12. DECLARATIONS:'))

  // 12(i) — each inventor signs, which is how an organisation takes rights by assignment.
  const inventorDeclaration: Paragraph[] = [
    para('(i) Declaration by the Inventor(s)', { bold: true }),
    para('(In case the applicant is an assignee: the inventor(s) may sign herein below or the applicant may upload the assignment or enclose the assignment with this application for patent or send the assignment by post/electronic transmission duly authenticated within the prescribed period).', { size: SIZE_SMALL, italics: true }),
    para('I/We, the above named inventor(s) are the true & first inventor(s) for this invention and declare that the applicant herein is our assignee or legal representative.'),
    blank(),
  ]
  const declDate = renderShortDate(ctx.filingDateForDocs)
  for (const inv of ctx.inventors) {
    inventorDeclaration.push(...inventorSignatureLines(renderPersonName(inv.name, s.nameCase), declDate))
  }
  rows.push(row([cellOf(inventorDeclaration, { width: FULL, columnSpan: COLS })]))

  // 12(ii) — convention-country applicant declaration. Kept or struck per the attorney's
  // choice, resolved through the cascade; the rules only supply the default.
  const strike12ii = clauseState(ctx.declarations, 'form1ConventionApplicant') === 'strike'
  rows.push(row([cellOf([
    para('(ii) Declaration by the applicant(s) in the convention country', { bold: true, strike: strike12ii }),
    para('(In case the applicant in India is different than the applicant in the convention country: the applicant in the convention country may sign herein below or applicant in India may upload the assignment from the applicant in the convention country or enclose the said assignment with this application for patent or send the assignment by post/electronic transmission duly authenticated within the prescribed period).', { size: SIZE_SMALL, italics: true, strike: strike12ii }),
    para('I/We, the applicant(s) in the convention country declare that the applicant(s) herein is/are my/our assignee or legal representative.', { strike: strike12ii }),
    blank(),
    para('a) Date:', { strike: strike12ii }),
    para('b) Signature: ___________________', { strike: strike12ii }),
    para(`c) Name(s) of the signatory: ${isConvention ? sanitizeField(ctx.applicant.legalName) : na}`, { strike: strike12ii }),
  ], { width: FULL, columnSpan: COLS })]))

  // 12(iii) — the checklist. Every state here came out of the cascade.
  rows.push(row([cellOf([
    para('(iii) Declaration by the applicants:', { bold: true }),
    para('I/We, the applicants hereby declare that:'),
    // Only the 12(iii) tick-box clauses belong here; the whole-block clauses render in
    // their own sections.
    ...ctx.declarations
      .filter(clause => clause.group === 'form1_12iii')
      .map(clause => declarationPara(clause.text, clause.state, s.inapplicableClauseStyle)),
  ], { width: FULL, columnSpan: COLS })]))

  // --- 13. Attachments --------------------------------------------------
  rows.push(section('13. FOLLOWING ARE THE ATTACHMENTS WITH THE APPLICATION'))
  rows.push(row([
    cell('Item', { width: W(3), columnSpan: 3, bold: true }),
    cell('Details', { width: W(4), columnSpan: 4, bold: true }),
    cell('Fee', { width: W(2), columnSpan: 2, bold: true }),
    cell('Remarks', { width: W(3), columnSpan: 3, bold: true }),
  ]))
  const d = ctx.details
  const specLabel = d.specType === 'complete' ? 'Complete specification' : 'Provisional specification'
  rows.push(attachmentRow(specLabel, `No. of pages: ${d.specPages}`))
  rows.push(attachmentRow('No. of Claim(s)', `No. of claims: ${d.claimsCount} and No. of pages: ${d.claimsPages}`))
  rows.push(attachmentRow('Abstract', `No. of pages: ${pad2(d.abstractPages)}`))
  rows.push(attachmentRow('No. of Drawing(s)', `No. of drawings: ${d.drawingsCount} and No. of pages: ${pad2(d.drawingsPages)}`))

  // --- Closing block ----------------------------------------------------
  const closing: Paragraph[] = [
    para(`Total Fee Rs. ${d.feeAmount ?? ''}/- ${d.feeMode === 'efiling' ? 'Via E-Filing.' : ''}`.trim()),
    blank(),
    para('I/We hereby declare that to the best of my/our knowledge, information and belief the fact and matters stated herein are correct and I/we request that a patent may be granted to me/us for the said invention.'),
  ]
  if (ctx.signatory) {
    closing.push(...signatureBlock(ctx.signatory, {
      datedThis: renderDatedThis(ctx.filingDateForDocs, s.dateStyle),
      organisation: ctx.applicant.legalName,
      controllerCity: s.officeBranch,
      controllerLabel: 'The Controller of Patents,',
      // Form 1 runs designation and organisation together — "Registrar, LPU".
      designationInline: true,
    }))
  }
  rows.push(row([cellOf(closing, { width: FULL, columnSpan: COLS })]))

  // --- Footnote ---------------------------------------------------------
  rows.push(row([cellOf([
    para('Note:', { bold: true, size: SIZE_SMALL }),
    para('* Repeat boxes in case of more than one entry.', { size: SIZE_SMALL }),
    para('* To be signed by the applicant(s) or by authorized registered patent agent otherwise where mentioned.', { size: SIZE_SMALL }),
    para('* Tick (✓) / cross (x) whichever is applicable/not applicable in declaration in paragraph-12.', { size: SIZE_SMALL }),
    para('* Name of the inventor and applicant should be given in full, family name in the beginning.', { size: SIZE_SMALL }),
    para('* Strike out the portion which is/are not applicable.', { size: SIZE_SMALL }),
    para('* For fee: See First schedule.', { size: SIZE_SMALL }),
  ], { width: FULL, columnSpan: COLS })]))

  const doc = new Document({
    styles: DEFAULT_STYLES,
    sections: [{ properties: A4_SECTION, children: [table(GRID, rows)] }],
  })
  return Packer.toBuffer(doc)
}

// ---------------------------------------------------------------------------
// Row builders
// ---------------------------------------------------------------------------

function section(text: string): TableRow {
  return row([cell(text, { width: FULL, columnSpan: COLS, bold: true, shading: 'F2F2F2' })])
}

function partyHeaderRow(addressLabel: string): TableRow {
  return row([
    cell('Name in full', { width: W(3), columnSpan: 3, bold: true }),
    cell('Nationality', { width: W(2), columnSpan: 2, bold: true }),
    cell('Country of Residence', { width: W(2), columnSpan: 2, bold: true }),
    cell(addressLabel, { width: W(5), columnSpan: 5, bold: true }),
  ])
}

/**
 * One party (applicant or inventor) as six rows: name/nationality/residence span all six via
 * rowSpan, and the address occupies the fixed label/value rows the form prescribes.
 */
function partyRows(
  name: string,
  nationality: string,
  countryOfResidence: string,
  address: StructuredAddress,
  emptyFieldStyle: FilingContext['settings']['emptyFieldStyle'],
  labels: { houseAndAddress?: string; pinCode?: string } = {}
): TableRow[] {
  const addressRows = renderAddressRows(address, emptyFieldStyle, labels)
  return addressRows.map((r, index) => {
    if (index === 0) {
      return row([
        cell(sanitizeField(name), { width: W(3), columnSpan: 3, rowSpan: addressRows.length }),
        cell(sanitizeField(nationality), { width: W(2), columnSpan: 2, rowSpan: addressRows.length }),
        cell(sanitizeField(countryOfResidence), { width: W(2), columnSpan: 2, rowSpan: addressRows.length }),
        cell(r.label, { width: W(2), columnSpan: 2 }),
        cell(r.value, { width: W(3), columnSpan: 3 }),
      ])
    }
    return row([
      cell(r.label, { width: W(2), columnSpan: 2 }),
      cell(r.value, { width: W(3), columnSpan: 3 }),
    ])
  })
}

/** A numbered section whose body is a label/value list (paragraphs 6 and 7). */
function labelValueBlock(heading: string, pairs: Array<[string, string]>): TableRow {
  return row([
    cell(heading, { width: W(4), columnSpan: 4, bold: true, verticalAlign: VerticalAlignTable.CENTER }),
    cellOf(pairs.map(([label]) => para(label)), { width: W(3), columnSpan: 3 }),
    cellOf(pairs.map(([, value]) => para(value || '')), { width: W(5), columnSpan: 5 }),
  ])
}

function attachmentRow(item: string, details: string): TableRow {
  return row([
    cell(item, { width: W(3), columnSpan: 3 }),
    cell(details, { width: W(4), columnSpan: 4 }),
    cell('', { width: W(2), columnSpan: 2 }),
    cell('', { width: W(3), columnSpan: 3 }),
  ])
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/**
 * True when every inventor is the applicant. Drives paragraph 4's Yes/No tick and the
 * `assigneeOfInventors` declaration — an applicant who is the inventor has nothing to be an
 * assignee of.
 */
export function inventorsSameAsApplicant(ctx: FilingContext): boolean {
  if (ctx.inventors.length !== 1) return false
  const inventor = ctx.inventors[0]
  const invName = renderPersonName(inventor.name).toLowerCase()
  const appName = sanitizeField(ctx.applicant.legalName).toLowerCase()
  if (invName !== appName) return false
  return renderAddressLine(inventor.address) === renderAddressLine(ctx.applicant.address)
}

export { CELL_BORDERS }

/** Re-exported for the drawings renderer, which reuses the inventor address helper. */
export type { FilingInventor }
