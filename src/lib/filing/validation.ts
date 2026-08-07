/**
 * India filing forms — the pre-generation gate.
 *
 * Blocking issues stop generation outright; advisory issues warn and let it proceed. The
 * split matters: a missing PIN makes the form defective, whereas a name that might not be
 * family-name-first is a judgement call that belongs to the attorney, not to us.
 *
 * We never emit a silently defective legal document — but we also never refuse to generate
 * over something an attorney is entitled to decide.
 */

import { INDIAN_PIN_RE, renderPersonName, sanitizeField } from './formatting'
import type {
  FilingApplicant,
  FilingCorrespondence,
  FilingDetails,
  FilingInventor,
  FilingIssue,
  FilingSignatory,
  ResolvedDeclarations,
  StructuredAddress,
} from './types'

const ORG_CATEGORIES = new Set(['small_entity', 'startup', 'educational_institute', 'others'])

export interface ValidateFilingInput {
  title: string
  applicant: FilingApplicant
  inventors: FilingInventor[]
  signatory: FilingSignatory | null
  correspondence: FilingCorrespondence
  details: FilingDetails
  declarations?: ResolvedDeclarations
  /** True when a registered patent agent signs instead of an org signatory. */
  hasAgent?: boolean
}

export function validateFiling(input: ValidateFilingInput): FilingIssue[] {
  const issues: FilingIssue[] = []
  const { applicant, inventors, signatory, correspondence, details, title } = input

  // --- Title -------------------------------------------------------------
  if (!sanitizeField(title)) {
    issues.push({ severity: 'blocking', field: 'title', section: 'details', message: 'The invention title is required.' })
  }

  // --- Applicant ---------------------------------------------------------
  if (!sanitizeField(applicant.legalName)) {
    issues.push({ severity: 'blocking', field: 'applicant.legalName', section: 'applicant', message: 'Applicant legal name is required.' })
  }
  if (!sanitizeField(applicant.nationality)) {
    issues.push({ severity: 'blocking', field: 'applicant.nationality', section: 'applicant', message: 'Applicant nationality is required (Form 1 prints it beside the name).' })
  }
  issues.push(...validateAddress(applicant.address, 'applicant.address', 'applicant', 'Applicant'))

  // --- Signatory ---------------------------------------------------------
  // An organisation cannot sign; a named person signs on its behalf. Without one, Form 1
  // para 13, Form 5 and every drawing sheet would have an anonymous signature line.
  const isOrg = ORG_CATEGORIES.has(applicant.category)
  if (isOrg && !input.hasAgent) {
    if (!signatory || !sanitizeField(signatory.name)) {
      issues.push({ severity: 'blocking', field: 'signatory.name', section: 'signatory', message: 'An organisation applicant needs a named person authorised to sign on its behalf.' })
    }
    if (signatory && sanitizeField(signatory.name) && !sanitizeField(signatory.designation)) {
      issues.push({ severity: 'blocking', field: 'signatory.designation', section: 'signatory', message: 'The signatory’s designation is required (it prints under the signature line).' })
    }
    if (signatory && signatory.mobile && !/^\d{10}$/.test(sanitizeField(signatory.mobile).replace(/\D/g, '').slice(-10))) {
      issues.push({ severity: 'advisory', field: 'signatory.mobile', section: 'signatory', message: 'Signatory mobile does not look like a 10-digit Indian number.' })
    }
  }

  // --- Inventors ---------------------------------------------------------
  if (inventors.length === 0) {
    issues.push({ severity: 'blocking', field: 'inventors', section: 'inventors', message: 'At least one inventor is required — Form 5 is a declaration as to inventorship.' })
  }

  const seen = new Map<string, number>()
  inventors.forEach((inv, index) => {
    const label = `Inventor ${index + 1}`
    const printed = renderPersonName(inv.name)
    if (!sanitizeField(inv.name.nameBody)) {
      issues.push({ severity: 'blocking', field: `inventors.${index}.name`, section: 'inventors', message: `${label}: name is required.` })
    }
    if (!sanitizeField(inv.nationality)) {
      issues.push({ severity: 'blocking', field: `inventors.${index}.nationality`, section: 'inventors', message: `${label}: nationality is required.` })
    }
    issues.push(...validateAddress(inv.address, `inventors.${index}.address`, 'inventors', label))

    // Advisory: paste artifacts and ordering.
    const body = sanitizeField(inv.name.nameBody)
    if (body && body.length > 2 && (body === body.toUpperCase() || body === body.toLowerCase()) && /[a-z]/i.test(body)) {
      issues.push({ severity: 'advisory', field: `inventors.${index}.name`, section: 'inventors', message: `${label}: name is entirely one case, which usually means it was pasted. Check the spelling and capitalisation.` })
    }
    if (body && body.includes(' ') && !inv.name.familyNameFirst) {
      issues.push({ severity: 'advisory', field: `inventors.${index}.name`, section: 'inventors', message: `${label}: Form 1 asks for the family name first. Confirm "${printed}" is in the right order.` })
    }

    const dupKey = `${printed.toLowerCase()}|${addressKey(inv.address)}`
    const prior = seen.get(dupKey)
    if (prior !== undefined) {
      issues.push({ severity: 'advisory', field: `inventors.${index}`, section: 'inventors', message: `${label} looks identical to inventor ${prior + 1} (same name and address).` })
    } else {
      seen.set(dupKey, index)
    }
  })

  // --- Correspondence (Form 1 para 7) ------------------------------------
  if (!sanitizeField(correspondence.name)) {
    issues.push({ severity: 'blocking', field: 'correspondence.name', section: 'correspondence', message: 'Address for service in India requires a contact name.' })
  }
  if (!sanitizeField(correspondence.email)) {
    issues.push({ severity: 'blocking', field: 'correspondence.email', section: 'correspondence', message: 'Address for service in India requires an e-mail ID.' })
  }
  if (!sanitizeField(correspondence.postalAddress)) {
    issues.push({ severity: 'blocking', field: 'correspondence.postalAddress', section: 'correspondence', message: 'Address for service in India requires a postal address.' })
  }

  // --- Filing details ----------------------------------------------------
  if (details.specPages <= 0) {
    issues.push({ severity: 'blocking', field: 'details.specPages', section: 'details', message: 'Specification page count is required for Form 1 paragraph 13.' })
  }
  if (details.abstractPages <= 0) {
    issues.push({ severity: 'advisory', field: 'details.abstractPages', section: 'details', message: 'Abstract page count is zero — confirm no abstract is being filed.' })
  }
  if (details.specType === 'complete' && details.claimsCount <= 0) {
    issues.push({ severity: 'blocking', field: 'details.claimsCount', section: 'details', message: 'A complete specification must be filed with at least one claim.' })
  }
  if (details.drawingsCount > 0 && details.drawingsPages <= 0) {
    issues.push({ severity: 'advisory', field: 'details.drawingsPages', section: 'details', message: 'Drawings are listed but the page count is zero.' })
  }
  if (details.applicationType === 'convention' && !sanitizeField(details.parentApplicationNo)) {
    issues.push({ severity: 'advisory', field: 'details.parentApplicationNo', section: 'details', message: 'Convention application: paragraph 8 particulars are empty.' })
  }
  if (details.isDivisional && !sanitizeField(details.parentApplicationNo)) {
    issues.push({ severity: 'blocking', field: 'details.parentApplicationNo', section: 'details', message: 'A divisional application needs the original application particulars (paragraph 10).' })
  }
  if (details.isPatentOfAddition && !sanitizeField(details.parentApplicationNo)) {
    issues.push({ severity: 'blocking', field: 'details.parentApplicationNo', section: 'details', message: 'A patent of addition needs the main application particulars (paragraph 11).' })
  }
  if (!details.feeAmount || details.feeAmount <= 0) {
    issues.push({ severity: 'advisory', field: 'details.feeAmount', section: 'details', message: 'No fee amount set — Form 1 paragraph 13 will print a blank total.' })
  }

  // --- Declarations ------------------------------------------------------
  for (const clause of input.declarations || []) {
    if (clause.conflict) {
      issues.push({ severity: 'advisory', field: `declarations.${clause.key}`, section: 'declarations', message: clause.conflict })
    }
  }

  return issues
}

function validateAddress(
  address: StructuredAddress,
  fieldPrefix: string,
  section: FilingIssue['section'],
  label: string
): FilingIssue[] {
  const issues: FilingIssue[] = []
  const required: Array<[keyof StructuredAddress, string]> = [
    ['addressLine1', 'house number / address'],
    ['city', 'city'],
    ['state', 'state'],
    ['country', 'country'],
  ]
  for (const [key, human] of required) {
    if (!sanitizeField(address[key] as string)) {
      issues.push({ severity: 'blocking', field: `${fieldPrefix}.${key}`, section, message: `${label}: ${human} is required.` })
    }
  }

  const pin = sanitizeField(address.pinCode)
  const isIndia = sanitizeField(address.country).toLowerCase() === 'india'
  if (!pin) {
    issues.push({ severity: 'blocking', field: `${fieldPrefix}.pinCode`, section, message: `${label}: PIN code is required.` })
  } else if (isIndia && !INDIAN_PIN_RE.test(pin)) {
    issues.push({ severity: 'blocking', field: `${fieldPrefix}.pinCode`, section, message: `${label}: "${pin}" is not a valid Indian PIN code (six digits, not starting with 0).` })
  }

  return issues
}

function addressKey(address: StructuredAddress): string {
  return [address.addressLine1, address.street, address.city, address.state, address.pinCode]
    .map(v => sanitizeField(v as string).toLowerCase())
    .join('|')
}

export function hasBlockingIssues(issues: FilingIssue[]): boolean {
  return issues.some(issue => issue.severity === 'blocking')
}

export function blockingIssues(issues: FilingIssue[]): FilingIssue[] {
  return issues.filter(issue => issue.severity === 'blocking')
}
