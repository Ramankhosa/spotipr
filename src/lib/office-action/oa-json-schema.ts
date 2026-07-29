/**
 * Office Action Studio — stored-JSON shape versioning
 *
 * The reply pipeline keeps its state in three Prisma Json columns —
 * OaResponseDraft.sectionsJson / .complianceJson and OaCitation.claimChartJson.
 * The safety tranche changes all three (procedural confirmation state, chart
 * verdict rename, chart conflicts, basis sentences, numbering metadata), and
 * none of it is a schema migration: the shapes simply change underneath rows
 * that are already on disk.
 *
 * Without a version tag every reader has to guess which shape it is holding,
 * and the guesses drift apart. This module is the single place that knows:
 * read through a normalizer, write with a stamp.
 *
 * REJECT, DO NOT GUESS. A version we do not recognise is an error, not an
 * invitation to improvise — it means a newer writer touched the row (a rollback
 * mid-deploy), and improvising there silently discards fields we cannot see.
 * A record with NO version is only treated as v1 when its shape actually looks
 * like v1; anything else is rejected too.
 */

export const OA_JSON_SCHEMA_VERSION = 2 as const

/** The stored JSON is from a version this build cannot safely read. */
export class OaJsonVersionError extends Error {
  readonly found: unknown
  constructor(what: string, found: unknown) {
    super(
      `${what} carries schemaVersion ${JSON.stringify(found)}, which this build does not understand ` +
      `(supported: 1 legacy, ${OA_JSON_SCHEMA_VERSION} current). Refusing to guess at its shape.`
    )
    this.name = 'OaJsonVersionError'
    this.found = found
  }
}

type Bag = Record<string, any>

const isBag = (v: unknown): v is Bag => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

/**
 * Decide which version a stored bag is.
 *
 * An explicit version wins and must be one we know. An ABSENT version is only
 * v1 if the bag structurally looks like v1 — `looksLegacy` is what stops an
 * empty or corrupt value being waved through as "just an old record".
 */
function resolveVersion(what: string, bag: Bag, looksLegacy: boolean): 1 | 2 {
  const raw = bag.schemaVersion
  if (raw === undefined || raw === null) {
    if (looksLegacy) return 1
    throw new OaJsonVersionError(what, 'absent (and the shape is not recognisable as v1)')
  }
  if (raw === 1 || raw === 2) return raw
  throw new OaJsonVersionError(what, raw)
}

// ---------------------------------------------------------------------------
// sectionsJson  (OaResponseDraft.sectionsJson)
// ---------------------------------------------------------------------------

export type ProceduralStatus = 'PENDING' | 'CONFIRMED' | 'NOT_APPLICABLE'

export interface ProceduralComplianceState {
  status: ProceduralStatus
  /** Server-assigned only — never accepted from a request body. */
  confirmedBy?: string
  confirmedAt?: string
  supportingDocumentIds?: string[]
  notApplicableReason?: string
  attorneyNote?: string
}

export const PENDING_COMPLIANCE: ProceduralComplianceState = { status: 'PENDING' }

export interface DraftSectionsV2 {
  schemaVersion: 2
  objectionReplies: Bag[]
  namedSections: Record<string, string>
  inProgress?: boolean
  [key: string]: any
}

/**
 * Read `sectionsJson` in the current shape.
 *
 * v1 → v2 migration:
 *  - every objection reply gains a `compliance` state; a procedural section
 *    that was already approved under the old rules is treated as CONFIRMED,
 *    because the attorney did affirmatively approve it — demoting it to
 *    PENDING would silently un-file work they had signed off.
 */
export function normalizeLegacyDraftJson(input: unknown): DraftSectionsV2 {
  const bag: Bag = isBag(input) ? input : {}
  const looksLegacy = Array.isArray(bag.objectionReplies) || isBag(bag.namedSections) ||
    Object.keys(bag).length === 0
  const version = resolveVersion('OaResponseDraft.sectionsJson', bag, looksLegacy)

  const replies: Bag[] = Array.isArray(bag.objectionReplies) ? bag.objectionReplies : []
  const namedSections: Record<string, string> = isBag(bag.namedSections)
    ? Object.fromEntries(Object.entries(bag.namedSections).filter(([, v]) => typeof v === 'string')) as Record<string, string>
    : {}

  return {
    ...bag,                                   // preserve unknown, non-conflicting fields
    schemaVersion: 2,
    objectionReplies: replies.map(r => migrateReply(r, version)),
    namedSections
  }
}

function migrateReply(reply: Bag, version: 1 | 2): Bag {
  const out: Bag = { ...reply }
  if (!isBag(out.compliance)) {
    const wasApprovedProcedural = version === 1 && out.attorneyAction === true && out.approved === true
    out.compliance = wasApprovedProcedural
      ? { status: 'CONFIRMED' as ProceduralStatus }   // grandfathered: they did approve it
      : { ...PENDING_COMPLIANCE }
  }
  return out
}

/** Whether a procedural section may contribute filed text. */
export function isComplianceConfirmed(reply: Bag | null | undefined): boolean {
  return (reply as Bag)?.compliance?.status === 'CONFIRMED'
}

// ---------------------------------------------------------------------------
// claimChartJson  (OaCitation.claimChartJson)
// ---------------------------------------------------------------------------

/**
 * Cell verdicts.
 *
 * NOT_FOUND replaces v1's NOT_DISCLOSED: one passage proves disclosure, but no
 * retrieved passage does NOT prove absence, and the old name invited the reply
 * to assert the stronger claim. UNKNOWN_DOCUMENT_INCOMPLETE is the state that
 * did not exist at all in v1 — "we could not look properly", as distinct from
 * "we looked and did not find".
 */
export type CellVerdictV2 = 'DISCLOSED' | 'NOT_FOUND' | 'AMBIGUOUS' | 'UNKNOWN_DOCUMENT_INCOMPLETE'

const VERDICTS_V2 = new Set<string>(['DISCLOSED', 'NOT_FOUND', 'AMBIGUOUS', 'UNKNOWN_DOCUMENT_INCOMPLETE'])

/** Accept the legacy token wherever a verdict is read, from storage or from model output. */
export function coerceCellVerdict(raw: unknown): CellVerdictV2 {
  if (raw === 'NOT_DISCLOSED') return 'NOT_FOUND'         // v1 spelling
  return VERDICTS_V2.has(raw as string) ? (raw as CellVerdictV2) : 'AMBIGUOUS'
}

export interface ChartConflict {
  status: 'CONFLICT'
  previousVerdict: CellVerdictV2
  incomingVerdict: CellVerdictV2
  detectedAt?: string
}

export interface ClaimChartSliceV2 {
  schemaVersion: 2
  claimNumbers: number[]
  rows: Bag[]
  [key: string]: any
}

/**
 * Read a persisted per-citation chart slice in the current shape.
 *
 * v1 → v2: verdict rename. v1 rows carry no `elementId` and cannot be given a
 * trustworthy one after the fact (the claim text they were parsed from may have
 * changed), so they are left without — the merge in claim-chart-service treats
 * an id-less row as un-mergeable and keeps it only for display.
 */
export function normalizeLegacyClaimChart(input: unknown): ClaimChartSliceV2 {
  const bag: Bag = isBag(input) ? input : {}
  const looksLegacy = Array.isArray(bag.rows) || Array.isArray(bag.claimNumbers) ||
    Object.keys(bag).length === 0
  resolveVersion('OaCitation.claimChartJson', bag, looksLegacy)

  const rows: Bag[] = Array.isArray(bag.rows) ? bag.rows : []
  return {
    ...bag,
    schemaVersion: 2,
    claimNumbers: Array.isArray(bag.claimNumbers) ? bag.claimNumbers.map(Number).filter(Number.isFinite) : [],
    rows: rows.map(migrateChartRow)
  }
}

function migrateChartRow(row: Bag): Bag {
  const out: Bag = { ...row }
  if (isBag(out.cell)) {
    out.cell = { ...out.cell, verdict: coerceCellVerdict(out.cell.verdict) }
  }
  if (Array.isArray(out.cells)) {
    out.cells = out.cells.map((c: Bag) => (isBag(c) ? { ...c, verdict: coerceCellVerdict(c.verdict) } : c))
  }
  return out
}

// ---------------------------------------------------------------------------
// complianceJson  (OaResponseDraft.complianceJson)
// ---------------------------------------------------------------------------

/**
 * The as-filed specification this case's amendment basis and paragraph
 * citations resolve against.
 *
 * `newMatterSafe` alone cannot carry this: it is set from the upload's `kind`,
 * so an amended, corrected or translated specification uploaded later is also
 * flagged safe and silently overwrites OfficeActionCase.specificationText.
 * Designation is an explicit act, and the hash is what makes "the document this
 * confirmation was about" checkable after the fact.
 */
export interface BasisSourceIdentity {
  documentId: string
  contentHash: string
  designatedAsFiled: boolean
  /** Server-assigned only. */
  designatedBy: string
  designatedAt: string
}

/** Attorney vouching that the specification's own numbering may be relied on. */
export interface NumberingConfirmation {
  modeConfirmed: 'AUTHORED'
  /** Ties the confirmation to the exact document it judged. */
  contentHash: string
  confirmedBy: string
  confirmedAt: string
  note?: string
}

/** Attorney vouching for one specific citation the automated check rejects. */
export interface CitationOverride {
  citationLiteral: string
  exactSourceText: string
  sourcePage?: number
  sourceSection?: string
  confirmedBy: string
  confirmedAt: string
  /** Content hash of the basis source at the time of confirmation. */
  contentHash: string
}

export interface ComplianceV2 {
  schemaVersion: 2
  formsStatus: Bag
  judgmentFlags: any[]
  basisSource?: BasisSourceIdentity
  numberingConfirmation?: NumberingConfirmation
  citationOverrides?: CitationOverride[]
  identityOverride?: { field: string; confirmedBy: string; confirmedAt: string; note?: string }
  [key: string]: any
}

export function normalizeLegacyCompliance(input: unknown): ComplianceV2 {
  const bag: Bag = isBag(input) ? input : {}
  const looksLegacy = isBag(bag.formsStatus) || Array.isArray(bag.judgmentFlags) ||
    isBag(bag.lint) || isBag(bag.agent) || Object.keys(bag).length === 0
  resolveVersion('OaResponseDraft.complianceJson', bag, looksLegacy)

  return {
    ...bag,
    schemaVersion: 2,
    formsStatus: isBag(bag.formsStatus) ? bag.formsStatus : {},
    judgmentFlags: Array.isArray(bag.judgmentFlags) ? bag.judgmentFlags : []
  }
}

/**
 * Every override and confirmation is scoped to the basis source it was made
 * against. Replacing the specification invalidates all of them at once —
 * a confirmation about a document that is no longer on file attests nothing.
 */
export function invalidateForBasisChange(compliance: ComplianceV2): ComplianceV2 {
  const { numberingConfirmation, citationOverrides, ...rest } = compliance
  return { ...rest, schemaVersion: 2 } as ComplianceV2
}

/** Overrides still tied to the current basis source. */
export function activeCitationOverrides(compliance: ComplianceV2 | null | undefined, contentHash: string | undefined): CitationOverride[] {
  if (!compliance?.citationOverrides || !contentHash) return []
  return compliance.citationOverrides.filter(o => o.contentHash === contentHash)
}

/** The numbering confirmation, only if it was made against the document on file now. */
export function activeNumberingConfirmation(
  compliance: ComplianceV2 | null | undefined,
  contentHash: string | undefined
): NumberingConfirmation | undefined {
  const c = compliance?.numberingConfirmation
  return c && contentHash && c.contentHash === contentHash ? c : undefined
}

/** Stable content hash for a stored document's text. */
export function hashDocumentText(text: string): string {
  // Local require keeps this module importable from the browser bundle, where
  // only the type exports and the pure coercions are used.
  const crypto = require('crypto') as typeof import('crypto')
  return crypto.createHash('sha256').update(text || '', 'utf8').digest('hex').slice(0, 32)
}
