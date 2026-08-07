/**
 * India filing forms — shared types.
 *
 * Pure types + no runtime deps, so both the DOCX renderers (server) and the Filing tab
 * (client) can import them.
 *
 * The central design rule: three kinds of data are kept apart, because conflating them is
 * what makes template systems emit self-contradictory forms.
 *
 *   FACT      — stored on the entity (applicant category, inventor PIN)
 *   DERIVED   — computed from facts by a rule table (which 12(iii) clauses apply, fee)
 *   PREFERENCE— house style, stored as a sparse patch in the firm/project/patent cascade
 *
 * Category variance is almost entirely DERIVED, not preference: a university filing and a
 * startup filing differ because the rules read the category, not because someone saved two
 * preference sets.
 */

// ---------------------------------------------------------------------------
// Canonical person / address records
// ---------------------------------------------------------------------------

/**
 * A name kept in parts. The honorific is split off because Form 1's "family name in the
 * beginning" instruction applies to the body alone, while both forms print the honorific.
 */
export interface PersonName {
  honorific?: string | null
  nameBody: string
  familyNameFirst?: boolean
}

/**
 * One canonical address, two renderers. Form 1 needs it decomposed into fixed table rows;
 * Form 5 needs it as flowing prose. Storing only the structure — never the flowed string —
 * is what guarantees the two forms cannot disagree about an address, which is exactly the
 * drift that separately-maintained templates produce.
 */
export interface StructuredAddress {
  /** Optional leading org line, e.g. inventors addressed at their institution. */
  orgPrefix?: string | null
  /** Form 1's "House No. & Address" row. */
  addressLine1: string
  /** Form 1's "Street" row. Empty renders per `emptyFieldStyle`. */
  street?: string | null
  city: string
  state: string
  country: string
  pinCode: string
}

export interface FilingInventor {
  id?: string
  sortOrder: number
  name: PersonName
  nationality: string
  countryOfResidence: string
  address: StructuredAddress
  isAdditionalInventor?: boolean
}

export interface FilingApplicant {
  legalName: string
  category: ApplicantCategoryValue
  nationality: string
  countryOfResidence: string
  address: StructuredAddress
}

/**
 * The person who signs for an organisation applicant. Printed as name + designation over a
 * blank signature line — we deliberately never store signature images; ink/DSC happens
 * outside the system, which is what attorneys expect.
 */
export interface FilingSignatory {
  name: string
  designation: string
  mobile?: string | null
  email?: string | null
}

/** Form 1 para 7 — address for service in India. */
export interface FilingCorrespondence {
  name: string
  postalAddress: string
  email: string
  phone?: string | null
  mobile?: string | null
  fax?: string | null
}

/** Form 1 para 6 — authorised registered patent agent, when one is engaged. */
export interface FilingAgent {
  registrationNo: string
  name: string
  mobile?: string | null
}

// ---------------------------------------------------------------------------
// Filing facts
// ---------------------------------------------------------------------------

export type ApplicantCategoryValue =
  | 'natural_person'
  | 'small_entity'
  | 'startup'
  | 'educational_institute'
  | 'others'

export type FilingApplicationTypeValue = 'ordinary' | 'convention' | 'pct_np'
export type FilingSpecTypeValue = 'provisional' | 'complete'

export interface FilingDetails {
  applicationType: FilingApplicationTypeValue
  specType: FilingSpecTypeValue
  isDivisional: boolean
  isPatentOfAddition: boolean
  officeBranch: string
  applicantRefNo?: string | null
  specPages: number
  claimsCount: number
  claimsPages: number
  abstractPages: number
  drawingsCount: number
  drawingsPages: number
  feeAmount?: number | null
  feeMode: string
  applicationNo?: string | null
  filingDate?: Date | null
  parentApplicationNo?: string | null
  parentFilingDate?: Date | null
}

/** Everything the renderers need, already resolved. Renderers do no lookups. */
export interface FilingContext {
  title: string
  applicant: FilingApplicant
  inventors: FilingInventor[]
  signatory: FilingSignatory | null
  correspondence: FilingCorrespondence
  agent: FilingAgent | null
  details: FilingDetails
  settings: ResolvedFilingSettings
  declarations: ResolvedDeclarations
  /** Date the forms are dated with. Passed in, never `new Date()` inside a renderer. */
  filingDateForDocs: Date
}

// ---------------------------------------------------------------------------
// Preferences (the cascade)
// ---------------------------------------------------------------------------

/** How an empty *field* renders (e.g. Street with no value). */
export type EmptyFieldStyle = 'dash' | 'na' | 'blank'
/** How a whole inapplicable *section* renders (e.g. the agent block when self-filing). */
export type NotApplicableStyle = 'dash' | 'na' | 'blank' | 'strike'
/** How an inapplicable declaration clause is marked. */
export type InapplicableClauseStyle = 'cross' | 'strike'
/** "Dated this ….. day of June, 2026" vs "16-06-2026". */
export type DateStyle = 'blankDay' | 'fullDate'
export type CasePolicy = 'preserve' | 'title' | 'upper'

/**
 * A SPARSE patch. Only keys deliberately set at this layer are present; an absent key means
 * "inherit". That distinction is load-bearing — `false`/`'cross'` (an explicit override) and
 * "unset" (inherit) must never collapse into the same value, which is why this is stored as
 * JSON rather than a wide set of nullable columns.
 */
export interface FilingSettingsPatch {
  emptyFieldStyle?: EmptyFieldStyle
  notApplicableStyle?: NotApplicableStyle
  inapplicableClauseStyle?: InapplicableClauseStyle
  dateStyle?: DateStyle
  officeBranch?: string
  titleCase?: CasePolicy
  nameCase?: CasePolicy
  /** Terminal period on flowed address lines (Form 5 house style). */
  addressLineTerminalPeriod?: boolean
  /** Pinned declaration states, e.g. a firm that never touches biological material. */
  declarations?: Partial<Record<DeclarationClauseKey, DeclarationState>>
  /** Which documents the bundle includes by default. */
  includeDocs?: { form1?: boolean; form5?: boolean; drawings?: boolean }
}

/** Every key present — the patch layers merged onto the built-in baseline. */
export type ResolvedFilingSettings = Required<Omit<FilingSettingsPatch, 'declarations' | 'includeDocs'>> & {
  declarations: Partial<Record<DeclarationClauseKey, DeclarationState>>
  includeDocs: { form1: boolean; form5: boolean; drawings: boolean }
}

/** Where a resolved value came from — surfaced per row in the declarations matrix. */
export type SettingSource = 'baseline' | 'rules' | 'firm' | 'project' | 'patent'

export interface Provenance<T> {
  value: T
  source: SettingSource
}

// ---------------------------------------------------------------------------
// Declarations (Form 1 para 12(iii))
// ---------------------------------------------------------------------------

export type DeclarationClauseKey =
  // Form 1, paragraph 12(iii)
  | 'possession'
  | 'specFiled'
  | 'biologicalMaterial'
  | 'noLawfulGround'
  | 'assigneeOfInventors'
  | 'firstAppInConvention'
  | 'priorityClaim'
  | 'pctBased'
  | 'divisional'
  | 'patentOfAddition'
  // Whole blocks the attorney strikes out rather than tick-boxes. Same three states, same
  // cascade, so a firm can pin how it always handles them and any filing can differ.
  | 'form1ConventionApplicant' // Form 1, paragraph 12(ii)
  | 'form5Convention' // Form 5, section 3
  | 'form5AdditionalInventors' // Form 5, section 4

/** Which document and section a clause belongs to — drives grouping in the UI. */
export type DeclarationGroup = 'form1_12iii' | 'form1_12ii' | 'form5'

/**
 * Three states, straight from the form's own footnote: tick or cross whichever is
 * applicable, and strike out portions that are not.
 */
export type DeclarationState = 'tick' | 'cross' | 'strike'

export interface ResolvedDeclarationClause {
  key: DeclarationClauseKey
  text: string
  state: DeclarationState
  group: DeclarationGroup
  source: SettingSource
  /**
   * Set when the chosen state contradicts the filing facts (e.g. the PCT clause ticked on an
   * ordinary application). Surfaced as a warning, never a hard lock — attorneys sometimes
   * know better, but they should see it.
   */
  conflict?: string
}

export type ResolvedDeclarations = ResolvedDeclarationClause[]

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface FilingIssue {
  /** `blocking` stops generation; `advisory` warns and lets it proceed. */
  severity: 'blocking' | 'advisory'
  field: string
  message: string
  /** Where in the UI to send the attorney to fix it. */
  section: 'applicant' | 'signatory' | 'inventors' | 'details' | 'declarations' | 'correspondence'
}
