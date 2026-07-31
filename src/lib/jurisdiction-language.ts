/**
 * Jurisdiction language resolution (pure, client-safe — no prisma imports)
 *
 * A country profile's `meta.languages` is an UNORDERED catalogue of the
 * languages an office accepts. It is NOT a preference order. PCT, for example,
 * lists the ten publication languages of the PCT alphabetically by ISO code:
 *
 *   ["ar","zh","en","fr","de","ja","ko","pt","ru","es"]
 *
 * so `languages[0]` is Arabic. Any code that treats `languages[0]` as "the
 * default language" silently drafts PCT in Arabic. Every resolution must go
 * through `resolveJurisdictionLanguage` / `defaultLanguageForJurisdiction`
 * instead of indexing the array.
 */

/**
 * Map jurisdiction code to ISO 639-1 language code.
 * This is the canonical drafting language for the office.
 */
const JURISDICTION_LANGUAGE_MAP: Record<string, string> = {
  // Asia
  JP: 'ja',    // Japan → Japanese
  CN: 'zh',    // China → Chinese
  KR: 'ko',    // Korea → Korean
  IN: 'en',    // India → English (official patent language)
  TW: 'zh',    // Taiwan → Chinese
  MY: 'en',    // Malaysia → English
  SG: 'en',    // Singapore → English

  // Europe
  EP: 'en',    // European Patent → English (primary)
  DE: 'de',    // Germany → German
  FR: 'fr',    // France → French
  ES: 'es',    // Spain → Spanish
  IT: 'it',    // Italy → Italian
  NL: 'nl',    // Netherlands → Dutch
  CH: 'de',    // Switzerland → German (primary)
  AT: 'de',    // Austria → German
  SE: 'sv',    // Sweden → Swedish
  PL: 'pl',    // Poland → Polish
  UK: 'en',    // United Kingdom → English
  GB: 'en',    // United Kingdom (ISO code) → English

  // Americas
  US: 'en',    // United States → English
  CA: 'en',    // Canada → English (primary)
  BR: 'pt',    // Brazil → Portuguese
  MX: 'es',    // Mexico → Spanish
  AR: 'es',    // Argentina → Spanish

  // Other
  AU: 'en',    // Australia → English
  NZ: 'en',    // New Zealand → English
  RU: 'ru',    // Russia → Russian
  IL: 'he',    // Israel → Hebrew
  SA: 'ar',    // Saudi Arabia → Arabic
  UAE: 'ar',   // UAE → Arabic
  ZA: 'en',    // South Africa → English

  // International / pseudo-jurisdictions
  PCT: 'en',   // PCT → English (default filing/publication language)
  WIPO: 'en',  // WIPO → English
  REFERENCE: 'en', // Internal reference draft → English
}

/** Fallback used whenever nothing else can be determined. */
export const DEFAULT_DRAFTING_LANGUAGE = 'en'

/** ISO 639-1 code → English display name, for use inside LLM prompts. */
const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
  ar: 'Arabic',
  de: 'German',
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  he: 'Hebrew',
  hi: 'Hindi',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
  nl: 'Dutch',
  pl: 'Polish',
  pt: 'Portuguese',
  ru: 'Russian',
  sv: 'Swedish',
  zh: 'Chinese',
}

/**
 * Human-readable language name for prompts. An LLM told "output must be in en"
 * is being asked to guess; "output must be in English" is not.
 * Values that are already names (e.g. 'English') pass through unchanged.
 */
export function languageDisplayName(language?: string | null): string {
  const raw = typeof language === 'string' ? language.trim() : ''
  if (!raw) return LANGUAGE_DISPLAY_NAMES[DEFAULT_DRAFTING_LANGUAGE]
  return LANGUAGE_DISPLAY_NAMES[raw.toLowerCase()] || raw
}

/**
 * Get the canonical drafting language code for a jurisdiction.
 */
export function getJurisdictionLanguage(jurisdiction: string): string {
  return JURISDICTION_LANGUAGE_MAP[(jurisdiction || '').toUpperCase()] || DEFAULT_DRAFTING_LANGUAGE
}

/**
 * Whether the jurisdiction has an explicit language mapping
 * (unknown jurisdictions silently fall back to English)
 */
export function hasJurisdictionLanguage(jurisdiction: string): boolean {
  return (jurisdiction || '').toUpperCase() in JURISDICTION_LANGUAGE_MAP
}

function normalize(lang: unknown): string {
  return typeof lang === 'string' ? lang.trim() : ''
}

/**
 * Resolve the language to draft/translate a jurisdiction in.
 *
 * Priority:
 *  1. `requested`  — the language the user actually chose (if the office accepts it)
 *  2. `fallbacks`  — session-level hints, e.g. the common language for the filing
 *  3. the jurisdiction's canonical language (PCT → en, DE → de, …)
 *  4. English, if the office accepts it
 *  5. the first catalogued language (last resort only)
 *
 * Passing an empty/undefined `availableLanguages` means "no catalogue to check
 * against", in which case the requested language is trusted as-is.
 */
export function resolveJurisdictionLanguage(
  jurisdiction: string,
  availableLanguages?: string[] | null,
  requested?: string | null,
  fallbacks: Array<string | null | undefined> = []
): string {
  const langs = (Array.isArray(availableLanguages) ? availableLanguages : [])
    .map(normalize)
    .filter(Boolean)
  const supports = (lang: string) => langs.length === 0 || langs.includes(lang)

  for (const candidate of [requested, ...fallbacks]) {
    const lang = normalize(candidate)
    if (lang && supports(lang)) return lang
  }

  const canonical = getJurisdictionLanguage(jurisdiction)
  if (supports(canonical)) return canonical

  if (supports(DEFAULT_DRAFTING_LANGUAGE)) return DEFAULT_DRAFTING_LANGUAGE

  return langs[0] || DEFAULT_DRAFTING_LANGUAGE
}

/**
 * The default language to preselect for a jurisdiction in the UI.
 * Never `languages[0]` — see the module note.
 */
export function defaultLanguageForJurisdiction(
  jurisdiction: string,
  availableLanguages?: string[] | null
): string {
  return resolveJurisdictionLanguage(jurisdiction, availableLanguages)
}

/**
 * Order a jurisdiction's language catalogue so the effective drafting language
 * comes first. Used where downstream code reads `meta.languages[0]`.
 */
export function orderLanguagesForJurisdiction(
  jurisdiction: string,
  availableLanguages?: string[] | null,
  requested?: string | null,
  fallbacks: Array<string | null | undefined> = []
): string[] {
  const langs = (Array.isArray(availableLanguages) ? availableLanguages : [])
    .map(normalize)
    .filter(Boolean)
  const primary = resolveJurisdictionLanguage(jurisdiction, langs, requested, fallbacks)
  return [primary, ...langs.filter(l => l !== primary)]
}
