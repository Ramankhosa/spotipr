/**
 * Flag emoji for a jurisdiction code.
 *
 * ISO 3166-1 alpha-2 codes are converted via Unicode regional indicators, so
 * any 2-letter country works without a lookup table. Non-country jurisdictions
 * (PCT, EP, …) and unknown codes get explicit symbols or a globe.
 */

const SPECIAL_FLAGS: Record<string, string> = {
  PCT: '🌐',
  WIPO: '🌐',
  EP: '🇪🇺',
  EU: '🇪🇺',
  UK: '🇬🇧', // legacy code used in seed data (ISO is GB)
  UAE: '🇦🇪', // legacy 3-letter code used in seed data (ISO is AE)
  REFERENCE: '📋',
  SUPERSET: '🧪',
  '*': '🌍'
}

const REGIONAL_INDICATOR_OFFSET = 0x1f1e6 - 65 // 'A' → 🇦

export function getFlagEmoji(code: string): string {
  const normalized = (code || '').trim().toUpperCase()
  if (!normalized) return '🌐'
  if (SPECIAL_FLAGS[normalized]) return SPECIAL_FLAGS[normalized]
  if (!/^[A-Z]{2}$/.test(normalized)) return '🌐'
  return String.fromCodePoint(
    normalized.charCodeAt(0) + REGIONAL_INDICATOR_OFFSET,
    normalized.charCodeAt(1) + REGIONAL_INDICATOR_OFFSET
  )
}
