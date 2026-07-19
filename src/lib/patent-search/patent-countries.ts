// Country registry for the local patent corpus.
//
// The corpus is loaded from the Google Patents Public Data dataset, whose
// `country_code` is a two-letter authority code (US, CN, EP, WO, ...). The older
// IPIndia PDF pipeline predates that convention and stored the literal string
// 'INDIA' in local_patents.country, so every lookup has to accept both spellings.
// `countryMatchValues()` is the single place that reconciles them — SQL filters and
// display code must both go through this module rather than comparing raw values.

export interface PatentCountry {
  /** Two-letter authority code as stored by the Google Patents import. */
  code: string
  name: string
  /** Regional/international authorities are grouped apart from national offices. */
  kind: 'national' | 'regional'
  /**
   * Offices with enough volume to be worth surfacing first in the picker. Everything
   * else stays selectable but sits behind "show all".
   */
  primary?: boolean
  /** Legacy spellings found in local_patents.country for the same authority. */
  aliases?: string[]
}

// Ordered by corpus volume for the primary group, then alphabetically. Codes match
// the `country_code` values in patents-public-data.patents.publications.
export const PATENT_COUNTRIES: PatentCountry[] = [
  { code: 'US', name: 'United States', kind: 'national', primary: true },
  { code: 'CN', name: 'China', kind: 'national', primary: true },
  { code: 'JP', name: 'Japan', kind: 'national', primary: true },
  { code: 'KR', name: 'South Korea', kind: 'national', primary: true },
  { code: 'EP', name: 'European Patent Office', kind: 'regional', primary: true },
  { code: 'WO', name: 'WIPO (PCT)', kind: 'regional', primary: true },
  { code: 'DE', name: 'Germany', kind: 'national', primary: true },
  { code: 'GB', name: 'United Kingdom', kind: 'national', primary: true },
  { code: 'FR', name: 'France', kind: 'national', primary: true },
  { code: 'IN', name: 'India', kind: 'national', primary: true, aliases: ['INDIA'] },
  { code: 'CA', name: 'Canada', kind: 'national', primary: true },
  { code: 'AU', name: 'Australia', kind: 'national', primary: true },

  { code: 'AT', name: 'Austria', kind: 'national' },
  { code: 'AR', name: 'Argentina', kind: 'national' },
  { code: 'BE', name: 'Belgium', kind: 'national' },
  { code: 'BR', name: 'Brazil', kind: 'national' },
  { code: 'CH', name: 'Switzerland', kind: 'national' },
  { code: 'CL', name: 'Chile', kind: 'national' },
  { code: 'CO', name: 'Colombia', kind: 'national' },
  { code: 'CZ', name: 'Czechia', kind: 'national' },
  { code: 'DK', name: 'Denmark', kind: 'national' },
  { code: 'EA', name: 'Eurasian Patent Organization', kind: 'regional' },
  { code: 'ES', name: 'Spain', kind: 'national' },
  { code: 'FI', name: 'Finland', kind: 'national' },
  { code: 'GR', name: 'Greece', kind: 'national' },
  { code: 'HK', name: 'Hong Kong', kind: 'national' },
  { code: 'HU', name: 'Hungary', kind: 'national' },
  { code: 'ID', name: 'Indonesia', kind: 'national' },
  { code: 'IE', name: 'Ireland', kind: 'national' },
  { code: 'IL', name: 'Israel', kind: 'national' },
  { code: 'IT', name: 'Italy', kind: 'national' },
  { code: 'MX', name: 'Mexico', kind: 'national' },
  { code: 'MY', name: 'Malaysia', kind: 'national' },
  { code: 'NL', name: 'Netherlands', kind: 'national' },
  { code: 'NO', name: 'Norway', kind: 'national' },
  { code: 'NZ', name: 'New Zealand', kind: 'national' },
  { code: 'OA', name: 'African Intellectual Property Organization', kind: 'regional' },
  { code: 'AP', name: 'African Regional IP Organization', kind: 'regional' },
  { code: 'PE', name: 'Peru', kind: 'national' },
  { code: 'PH', name: 'Philippines', kind: 'national' },
  { code: 'PL', name: 'Poland', kind: 'national' },
  { code: 'PT', name: 'Portugal', kind: 'national' },
  { code: 'RO', name: 'Romania', kind: 'national' },
  { code: 'RU', name: 'Russia', kind: 'national' },
  { code: 'SA', name: 'Saudi Arabia', kind: 'national' },
  { code: 'SE', name: 'Sweden', kind: 'national' },
  { code: 'SG', name: 'Singapore', kind: 'national' },
  { code: 'SK', name: 'Slovakia', kind: 'national' },
  { code: 'TH', name: 'Thailand', kind: 'national' },
  { code: 'TR', name: 'Turkey', kind: 'national' },
  { code: 'TW', name: 'Taiwan', kind: 'national' },
  { code: 'UA', name: 'Ukraine', kind: 'national' },
  { code: 'VN', name: 'Vietnam', kind: 'national' },
  { code: 'ZA', name: 'South Africa', kind: 'national' },
]

const BY_CODE = new Map(PATENT_COUNTRIES.map(country => [country.code, country]))

// Reverse index over codes AND aliases, so 'INDIA' and 'IN' both resolve to IN.
const BY_ANY_SPELLING = new Map<string, PatentCountry>()
for (const country of PATENT_COUNTRIES) {
  BY_ANY_SPELLING.set(country.code, country)
  for (const alias of country.aliases || []) BY_ANY_SPELLING.set(alias.toUpperCase(), country)
}

export function listPatentCountries() {
  return PATENT_COUNTRIES
}

export function getPatentCountry(code: unknown) {
  return BY_CODE.get(String(code || '').trim().toUpperCase()) || null
}

/** Canonical two-letter code for any stored spelling ('INDIA' -> 'IN'). */
export function normalizeCountryCode(value: unknown): string {
  const raw = String(value || '').trim().toUpperCase()
  if (!raw) return ''
  const matched = BY_ANY_SPELLING.get(raw)
  if (matched) return matched.code
  // Unknown authority: keep the two-letter prefix so new codes still group sensibly.
  return /^[A-Z]{2}$/.test(raw) ? raw : raw.slice(0, 2)
}

/** Display name for any stored spelling; falls back to the raw value. */
export function countryDisplayName(value: unknown): string {
  const code = normalizeCountryCode(value)
  return BY_CODE.get(code)?.name || String(value || '').trim() || code
}

/**
 * Every spelling of `code` that may appear in local_patents.country. Callers build
 * SQL `IN (...)` lists from this so the Indian corpus's legacy 'INDIA' rows are not
 * silently excluded when the user selects India.
 */
export function countryMatchValues(code: unknown): string[] {
  const country = getPatentCountry(code)
  if (!country) {
    const raw = String(code || '').trim().toUpperCase()
    return raw ? [raw] : []
  }
  return Array.from(new Set([country.code, ...(country.aliases || []).map(alias => alias.toUpperCase())]))
}

/** Expand a selection of country codes into the full set of stored spellings. */
export function expandCountrySelection(codes: unknown): string[] {
  const list = Array.isArray(codes) ? codes : codes ? [codes] : []
  const values = list.flatMap(code => countryMatchValues(code))
  return Array.from(new Set(values.filter(Boolean)))
}

export const DEFAULT_PATENT_COUNTRY_CODES = PATENT_COUNTRIES
  .filter(country => country.primary)
  .map(country => country.code)
