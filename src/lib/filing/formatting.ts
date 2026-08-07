/**
 * India filing forms — name and address processing.
 *
 * Pure functions, no I/O, no docx import, so this is unit-testable and shared by the
 * renderers and the Filing tab's live preview.
 *
 * Pipeline: sanitize -> parse (assistive) -> validate -> case policy -> render.
 * Parsing is ALWAYS assistive: a parsed split is shown to the attorney for review and never
 * written straight into a legal document. A silently mis-assigned city is a filing defect,
 * not a UX annoyance.
 */

import type {
  CasePolicy,
  EmptyFieldStyle,
  NotApplicableStyle,
  PersonName,
  StructuredAddress,
} from './types'

// ---------------------------------------------------------------------------
// Stage 1 — sanitize (lossless, always applied)
// ---------------------------------------------------------------------------

/**
 * Attorneys paste from Word, Outlook and Excel, which carries non-breaking spaces,
 * zero-width joiners and curly quotes into the data. Left alone these render as invisible
 * corruption in the DOCX and break exact-match comparisons between forms.
 */
export function sanitizeText(input: string | null | undefined): string {
  if (!input) return ''
  return input
    .normalize('NFC')
    // NBSP, narrow/thin/en/em spaces, ideographic space -> plain space
    .replace(/[      　]/g, ' ')
    // zero-width space / non-joiner / joiner / BOM -> gone
    .replace(/[​‌‍﻿]/g, '')
    // curly apostrophes/quotes -> straight, so "D'Souza" compares equal across forms
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Field values carry no terminal punctuation — renderers own punctuation, not the data. */
export function sanitizeField(input: string | null | undefined): string {
  return sanitizeText(input).replace(/[,;.\s]+$/, '').trim()
}

// ---------------------------------------------------------------------------
// Stage 2 — parse (assistive; results go to a review UI, never applied silently)
// ---------------------------------------------------------------------------

const HONORIFICS = [
  'Dr', 'Prof', 'Mr', 'Mrs', 'Ms', 'Miss', 'Shri', 'Sri', 'Smt', 'Kum', 'Er', 'Adv', 'Capt', 'Maj', 'Col',
]

const HONORIFIC_RE = new RegExp(`^(${HONORIFICS.join('|')})\\.?\\s*`, 'i')

/**
 * Split an honorific off a free-typed name and detect the "Family, Given" form.
 * Also repairs the very common `Dr.Krishan` (missing space after the period).
 */
export function parsePersonName(raw: string | null | undefined): PersonName {
  const cleaned = sanitizeField(raw)
  if (!cleaned) return { nameBody: '', familyNameFirst: false }

  // "Dr.Krishan Arora" / "Dr . Krishan Arora" -> normalise the separator first
  const spaced = cleaned.replace(/^([A-Za-z]{2,5})\s*\.\s*/, '$1. ')

  let honorific: string | null = null
  let body = spaced
  const match = spaced.match(HONORIFIC_RE)
  if (match) {
    const canonical = HONORIFICS.find(h => h.toLowerCase() === match[1].toLowerCase())!
    honorific = `${canonical}.`
    body = spaced.slice(match[0].length).trim()
  }

  // "Pal, Uday" -> already family-name-first
  let familyNameFirst = false
  if (body.includes(',')) {
    const parts = body.split(',').map(p => p.trim()).filter(Boolean)
    if (parts.length === 2) {
      body = `${parts[0]} ${parts[1]}`
      familyNameFirst = true
    }
  }

  return { honorific, nameBody: sanitizeField(body), familyNameFirst }
}

/**
 * Honorifics keep their trailing period — `sanitizeField` strips terminal punctuation as
 * noise, which is right for an address line and wrong for an abbreviation. Without this,
 * "Dr." is stored as "Dr" and every form prints "Dr Krishan Arora".
 */
export function normalizeHonorific(raw: string | null | undefined): string {
  const cleaned = sanitizeText(raw).replace(/[\s.]+$/, '')
  if (!cleaned) return ''
  const known = HONORIFICS.find(h => h.toLowerCase() === cleaned.toLowerCase())
  return known ? `${known}.` : cleaned
}

/** 28 states + 8 union territories, with the abbreviations that show up in pasted data. */
const INDIAN_STATES: Record<string, string> = {}
for (const [name, aliases] of Object.entries<string[]>({
  'Andhra Pradesh': ['AP'], 'Arunachal Pradesh': ['AR'], 'Assam': ['AS'], 'Bihar': ['BR'],
  'Chhattisgarh': ['CG', 'Chattisgarh'], 'Goa': ['GA'], 'Gujarat': ['GJ'], 'Haryana': ['HR'],
  'Himachal Pradesh': ['HP'], 'Jharkhand': ['JH'], 'Karnataka': ['KA'], 'Kerala': ['KL'],
  'Madhya Pradesh': ['MP'], 'Maharashtra': ['MH'], 'Manipur': ['MN'], 'Meghalaya': ['ML'],
  'Mizoram': ['MZ'], 'Nagaland': ['NL'], 'Odisha': ['OD', 'Orissa'], 'Punjab': ['PB'],
  'Rajasthan': ['RJ'], 'Sikkim': ['SK'], 'Tamil Nadu': ['TN', 'Tamilnadu'], 'Telangana': ['TS', 'TG'],
  'Tripura': ['TR'], 'Uttar Pradesh': ['UP'], 'Uttarakhand': ['UK', 'Uttaranchal'],
  'West Bengal': ['WB'], 'Andaman and Nicobar Islands': ['AN'], 'Chandigarh': ['CH'],
  'Dadra and Nagar Haveli and Daman and Diu': ['DN', 'DD'], 'Delhi': ['DL', 'New Delhi', 'NCT of Delhi'],
  'Jammu and Kashmir': ['JK'], 'Ladakh': ['LA'], 'Lakshadweep': ['LD'], 'Puducherry': ['PY', 'Pondicherry'],
})) {
  INDIAN_STATES[name.toLowerCase()] = name
  for (const alias of aliases) INDIAN_STATES[alias.toLowerCase()] = name
}

/** Indian PIN: exactly six digits, first digit 1-9 (9 covers Army Post Office). */
export const INDIAN_PIN_RE = /^[1-9]\d{5}$/

const COUNTRY_ALIASES: Record<string, string> = {
  india: 'India', 'in': 'India', bharat: 'India',
  'united states': 'United States', usa: 'United States', us: 'United States',
  'united kingdom': 'United Kingdom', uk: 'United Kingdom',
}

export interface AddressParseResult {
  address: StructuredAddress
  /** Fields the parser guessed rather than read unambiguously — highlighted for review. */
  lowConfidence: Array<keyof StructuredAddress>
}

/**
 * Best-effort split of a pasted address blob into Form 1's fixed rows.
 *
 * Deliberately conservative about Street: the observed attorney convention puts the road
 * into "House No. & Address" and dashes the Street row, so everything that is not
 * city/state/country/PIN lands in addressLine1. The review UI offers a one-click "move to
 * Street" instead of the parser guessing.
 */
export function parseAddressBlob(raw: string | null | undefined): AddressParseResult {
  const cleaned = sanitizeText(raw)
  const empty: StructuredAddress = {
    addressLine1: '', street: '', city: '', state: '', country: 'India', pinCode: '',
  }
  if (!cleaned) return { address: empty, lowConfidence: [] }

  const tokens = cleaned.split(',').map(t => t.trim()).filter(Boolean)
  const lowConfidence: Array<keyof StructuredAddress> = []
  const remaining: string[] = []
  let pinCode = ''
  let city = ''
  let state = ''
  let country = ''

  for (let i = 0; i < tokens.length; i++) {
    let token = tokens[i]

    // Country — only meaningful as the final token.
    if (i === tokens.length - 1 && COUNTRY_ALIASES[token.toLowerCase()]) {
      country = COUNTRY_ALIASES[token.toLowerCase()]
      continue
    }

    // A bare 6-digit token, or a trailing PIN inside "Phagwara 144411".
    const pinMatch = token.match(/(?:^|\s)([1-9]\d{5})$/)
    if (pinMatch) {
      pinCode = pinMatch[1]
      token = token.slice(0, token.length - pinMatch[0].length).trim()
      if (token) {
        city = token
      }
      if (!token) lowConfidence.push('city')
      continue
    }

    if (INDIAN_STATES[token.toLowerCase()]) {
      state = INDIAN_STATES[token.toLowerCase()]
      continue
    }

    remaining.push(token)
  }

  // City not carried alongside the PIN: the token just before the state is the best guess.
  if (!city && remaining.length > 1) {
    city = remaining.pop()!
    lowConfidence.push('city')
  }

  if (!country) {
    country = 'India'
    lowConfidence.push('country')
  }
  if (!state) lowConfidence.push('state')
  if (!pinCode) lowConfidence.push('pinCode')

  return {
    address: {
      addressLine1: remaining.join(', '),
      street: '',
      city,
      state,
      country,
      pinCode,
    },
    lowConfidence,
  }
}

/** Street-ish tokens the review UI offers to move out of addressLine1. */
const STREET_HINT_RE = /\b(road|rd|marg|street|st|lane|ln|sector|block|phase|highway|nagar|colony)\b/i

export function suggestStreetSplit(addressLine1: string): { addressLine1: string; street: string } | null {
  const parts = sanitizeText(addressLine1).split(',').map(p => p.trim()).filter(Boolean)
  if (parts.length < 2) return null
  const idx = parts.findIndex(p => STREET_HINT_RE.test(p))
  if (idx === -1) return null
  const street = parts[idx]
  const rest = parts.filter((_, i) => i !== idx)
  return { addressLine1: rest.join(', '), street }
}

// ---------------------------------------------------------------------------
// Stage 3 — nationality
// ---------------------------------------------------------------------------

/**
 * Form 1 wants the demonym ("Indian") in Nationality and the country name ("India") in
 * Country of Residence, so these are two separate values, not one field formatted twice.
 */
const DEMONYMS: Record<string, string> = {
  india: 'Indian', 'united states': 'American', usa: 'American', 'united kingdom': 'British',
  uk: 'British', germany: 'German', france: 'French', japan: 'Japanese', china: 'Chinese',
  canada: 'Canadian', australia: 'Australian', singapore: 'Singaporean', 'south korea': 'Korean',
  israel: 'Israeli', italy: 'Italian', spain: 'Spanish', netherlands: 'Dutch', sweden: 'Swedish',
  switzerland: 'Swiss', brazil: 'Brazilian', russia: 'Russian', 'south africa': 'South African',
  nepal: 'Nepalese', 'sri lanka': 'Sri Lankan', bangladesh: 'Bangladeshi',
}

export function deriveNationality(country: string | null | undefined): string {
  const key = sanitizeField(country).toLowerCase()
  return DEMONYMS[key] || ''
}

// ---------------------------------------------------------------------------
// Stage 4 — case policy
// ---------------------------------------------------------------------------

const NAME_PARTICLES = new Set(['van', 'der', 'den', 'de', 'del', 'della', 'di', 'da', 'du', 'la', 'le', 'bin', 'binti', 'al', 'von', 'ter'])
const NAME_SUFFIXES = new Set(['ii', 'iii', 'iv', 'jr', 'sr'])

/**
 * Title-casing names is genuinely risky — McDonald, D'Souza, van der Berg, III — so
 * `preserve` is the default and this only runs when a firm opts in. Tokens that are already
 * meaningfully mixed-case are left untouched on the assumption the typist meant them.
 */
export function applyNameCase(text: string, policy: CasePolicy): string {
  const cleaned = sanitizeField(text)
  if (!cleaned || policy === 'preserve') return cleaned
  if (policy === 'upper') return cleaned.toUpperCase()

  return cleaned.split(' ').map((token, index) => {
    const lower = token.toLowerCase()
    if (NAME_SUFFIXES.has(lower.replace(/\./g, ''))) return token.toUpperCase()
    // Particles stay lowercase unless they lead the name.
    if (index > 0 && NAME_PARTICLES.has(lower)) return lower
    // Already meaningfully mixed-case (McDonald, DeSouza) — the typist meant it.
    if (/[a-z]/.test(token) && /[A-Z]/.test(token.slice(1))) return token
    // Mc/Mac/O' compounds
    const mc = lower.match(/^(mc|mac|o')(.+)$/)
    if (mc) return cap(mc[1]) + cap(mc[2])
    // Hyphenated and apostrophed parts each get capitalised
    return lower.split(/([-'])/).map(part => (part === '-' || part === "'" ? part : cap(part))).join('')
  }).join(' ')
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

export function applyTitleCase(title: string, policy: CasePolicy): string {
  const cleaned = sanitizeText(title)
  if (policy === 'upper') return cleaned.toUpperCase()
  if (policy === 'title') return applyNameCase(cleaned, 'title')
  return cleaned
}

/** Full printable name, honorific included. */
export function renderPersonName(name: PersonName, policy: CasePolicy = 'preserve'): string {
  const body = applyNameCase(name.nameBody, policy)
  return name.honorific ? `${name.honorific} ${body}`.trim() : body
}

// ---------------------------------------------------------------------------
// Stage 5 — render
// ---------------------------------------------------------------------------

/** An empty *field* (Street with no value). */
export function renderEmptyField(style: EmptyFieldStyle): string {
  return style === 'dash' ? '-' : style === 'na' ? 'NA' : ''
}

/** A whole inapplicable *section* (the agent block when self-filing). Genuinely different
 *  from an empty field — the sample bundle dashes Street but writes NA across para 6. */
export function renderNotApplicable(style: NotApplicableStyle): string {
  return style === 'dash' ? '-' : style === 'na' ? 'NA' : style === 'strike' ? '' : ''
}

export interface AddressRow {
  label: string
  value: string
}

/**
 * Form 1's fixed rows. Labels differ by one word between the applicant and inventor blocks
 * in the official form ("Pin Code" vs "Pin code"), which is why the caller passes the set.
 */
export function renderAddressRows(
  address: StructuredAddress,
  emptyFieldStyle: EmptyFieldStyle,
  labels: { houseAndAddress?: string; pinCode?: string } = {}
): AddressRow[] {
  const fill = (v: string | null | undefined) => sanitizeField(v) || renderEmptyField(emptyFieldStyle)
  const line1Parts = [sanitizeField(address.orgPrefix), sanitizeField(address.addressLine1)].filter(Boolean)
  return [
    { label: labels.houseAndAddress || 'House No. & Address', value: line1Parts.join(', ') || renderEmptyField(emptyFieldStyle) },
    { label: 'Street', value: fill(address.street) },
    { label: 'City', value: fill(address.city) },
    { label: 'State', value: fill(address.state) },
    { label: 'Country', value: fill(address.country) },
    { label: labels.pinCode || 'Pin Code', value: fill(address.pinCode) },
  ]
}

/**
 * Flowed prose for Form 5 and the address-for-service block.
 * City and PIN bind with a single space per Indian convention ("Phagwara 144411"); every
 * other part joins with a comma.
 */
export function renderAddressLine(
  address: StructuredAddress,
  opts: { terminalPeriod?: boolean } = {}
): string {
  const cityPin = [sanitizeField(address.city), sanitizeField(address.pinCode)].filter(Boolean).join(' ')
  const parts = [
    sanitizeField(address.orgPrefix),
    sanitizeField(address.addressLine1),
    sanitizeField(address.street),
    cityPin,
    sanitizeField(address.state),
    sanitizeField(address.country),
  ].filter(Boolean)
  const line = parts.join(', ')
  if (!line) return ''
  return opts.terminalPeriod === false ? line : `${line}.`
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

/**
 * "Dated this ….. day of June, 2026" (the attorney convention — the day is inked in when
 * the form is physically signed) vs a fully-printed date.
 */
export function renderDatedThis(date: Date, style: 'blankDay' | 'fullDate'): string {
  if (style === 'fullDate') {
    return `Dated this ${String(date.getDate()).padStart(2, '0')} day of ${MONTHS[date.getMonth()]}, ${date.getFullYear()}`
  }
  return `Dated this …… day of ${MONTHS[date.getMonth()]}, ${date.getFullYear()}`
}

/** dd-mm-yyyy, used for the per-inventor declaration dates in Form 1 para 12(i). */
export function renderShortDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  return `${dd}-${mm}-${date.getFullYear()}`
}

/** Form 5 leaves the application number blank until the Office allots one. */
export function renderDottedBlank(width = 12): string {
  return '…'.repeat(width)
}

/**
 * The filing date on Form 5 before the application is filed. Attorneys leave only the day
 * open and print the month and year they are filing in — "…/06/2026" — because the form
 * goes in the same day as Form 1 and only the day is inked at signing.
 */
export function renderPartialFilingDate(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  return `…/${mm}/${date.getFullYear()}`
}
