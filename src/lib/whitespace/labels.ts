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
