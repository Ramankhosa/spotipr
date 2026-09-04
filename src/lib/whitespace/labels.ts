/**
 * The plain-English vocabulary of the studio.
 *
 * Shared by the screen and the exported report on purpose: an attorney who
 * reads "Vocabulary gap — patented under other words" on the page and
 * "TERMINOLOGY_WHITESPACE" in the document they hand to a client is holding two
 * different findings as far as the client is concerned. One source of words.
 */

import type { HumanReviewVerdict } from './types'

export const TYPE_LABEL: Record<string, string> = {
  UNDETERMINED: 'Not yet tested',
  DATA_WHITESPACE: 'Data gap — corpus cannot see this area',
  TERMINOLOGY_WHITESPACE: 'Vocabulary gap — patented under other words',
  PATENT_WHITESPACE: 'Sparse area',
  CLAIM_WHITESPACE: 'Claim gap — patents exist, claims do not recite this',
  SCIENTIFIC_WHITESPACE: 'Untouched by patents and literature',
  PRODUCT_WHITESPACE: 'Patented but not productised',
  TECHNICAL_FEASIBILITY_WHITESPACE: 'Tried and abandoned',
  COMMERCIAL_WHITESPACE: 'Feasible but uneconomic',
  REGULATORY_WHITESPACE: 'Blocked by regulation',
  GENUINE: 'Genuine opening — survived all tests',
}

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Proposed',
  VALIDATING: 'Being tested',
  VALIDATED: 'Survived testing',
  REFUTED: 'Refuted',
  INCONCLUSIVE: 'Inconclusive',
}

export const GATE_LABEL: Record<string, string> = {
  G1_DATA: 'Data coverage',
  G2_TERMINOLOGY: 'Vocabulary',
  G3_ADJACENT_CLAIMS: 'Adjacent claims',
  G4_FEASIBILITY: 'Feasibility',
  G5_COMMERCIAL: 'Commercial',
  G6_REGULATORY: 'Regulatory',
}

export const STRATEGY_LABEL: Record<string, string> = {
  SYNONYM_SHIFTED: 'Other vocabulary',
  SEMANTIC_PARAPHRASE: 'Meaning search',
  CPC_ADJACENT: 'Adjacent classes',
  ASSIGNEE_PIVOT: 'Competitor portfolios',
  RED_TEAM: 'Red team',
  LITERATURE: 'Literature',
}

/** Stage names as a reader would say them. */
export const STAGE_LABEL: Record<string, string> = {
  FIELD_MAP: 'Field census',
  CLUSTER: 'Grouping the field',
  SIGNALS: 'Measuring the groups',
  DEEP_DIVE: 'Reading the claims',
  VALIDATE: 'Attacking a hypothesis',
  DIMENSION_MAP: 'Finding the viewpoints',
  MINER_HARVEST: 'Reading the field',
  MINER_ENGINES: 'Finding the openings',
  MINER_GATE: 'Testing grantability',
  MINER_BRIEF: 'Writing the invention brief',
}

/** Where a lead came from, in the words the section headings use. */
export const LEAD_ORIGIN_LABEL: Record<string, string> = {
  UNSOLVED_PROBLEM: 'Problem the field admits but does not solve',
  CROSS_DOMAIN_TRANSFER: 'Mechanism borrowed from another field',
  CLAIM_FRONTIER: 'Combination nobody has claimed together',
  EXPIRY_FRONTIER: 'Platform nearing the end of protection',
}

/**
 * One human status per lead.
 *
 * Every word here was chosen against what the system can actually see. It holds
 * no legal status, no citation data, and no application filed in the last
 * eighteen months; on most fields it reads a five-thousand-character
 * description prefix for a sample of the families. "Grantable" would be a
 * prediction about examination made from that, printed in a document headed
 * attorney work product that a client may act on. So the vocabulary reports the
 * screen that was run, and leaves the opinion to the attorney.
 */
export const LEAD_STATUS_LABEL: Record<string, string> = {
  CANDIDATE: 'Not screened yet',
  GATING: 'Being screened',
  NO_BLOCKER_FOUND: 'No blocker found',
  CONDITIONS_TO_CLEAR: 'Conditions to clear',
  NOT_TESTED: 'Could not be screened',
  BLOCKED_BY_CITED_ART: 'Blocked by cited art',
  STALE: 'Screened against an older scope',
}

/**
 * Printed under every lead, in the brief, and in the report. Not a legal
 * disclaimer bolted on at the end — it is the honest description of what the
 * status above it means.
 */
export const LEAD_SCREEN_CAVEAT = 'A screen over the text we could read, not a patentability opinion.'

/** What each terminal status means, for the disclosure beside it. */
export const LEAD_STATUS_MEANING: Record<string, string> = {
  NO_BLOCKER_FOUND:
    'Nothing we could read anticipates it, the art we retrieved does not suggest it, and no statutory exclusion we screened applies.',
  CONDITIONS_TO_CLEAR:
    'It survived, but something has to be answered first — the conditions are listed with what would answer each.',
  NOT_TESTED:
    'A retrieval or model step did not run, so this lead has not been screened. It is not a negative result.',
  BLOCKED_BY_CITED_ART: 'A document we retrieved discloses the whole combination. It is named on the lead.',
  STALE: 'The scope changed after this lead was screened. Screen it again before relying on it.',
}

/** What each rung of the grantability ladder was asking. */
export const LEAD_GATE_LABEL: Record<string, string> = {
  G1_ANTICIPATION: 'Is it already in one document?',
  G2_INVENTIVE_STEP: 'Would the art suggest it?',
  G3_EXCLUSIONS: 'Is it excluded by statute?',
  G4_CLAIMABILITY: 'Can a claim be supported?',
  G5_DEMAND: 'Is anyone asking for it?',
}

/** What an attack outcome meant. */
export const OUTCOME_LABEL: Record<string, string> = {
  CLEAN: 'Nothing close found',
  WEAKENING: 'Partial matches found',
  REFUTING: 'Full combination found — refuted',
  NOT_RUN: 'Could not run',
}

/**
 * Gate results. `PASSED_WITH_WEAKENING` and `UNASSESSED` are the two that must
 * never be read as a clean pass, so they say so in words.
 */
export const GATE_OUTCOME_LABEL: Record<string, string> = {
  PASSED: 'Passed',
  PASSED_WITH_WEAKENING: 'Passed, but weakened',
  FAILED: 'Failed',
  ADVISORY: 'Advisory only — not tested',
  UNASSESSED: 'Not assessed',
}

/** The attorney's verdict, in the words the attorney would use. */
export const REVIEW_LABEL: Record<HumanReviewVerdict, string> = {
  ENDORSED: 'Endorsed',
  REJECTED: 'Set aside',
  NEEDS_INVESTIGATION: 'Needs investigation',
}

/** What each verdict commits the reader to, spelled out in the report. */
export const REVIEW_MEANING: Record<HumanReviewVerdict, string> = {
  ENDORSED: 'the attorney considers this direction worth pursuing',
  REJECTED: 'the attorney has set this direction aside',
  NEEDS_INVESTIGATION: 'the attorney wants further work before deciding',
}
