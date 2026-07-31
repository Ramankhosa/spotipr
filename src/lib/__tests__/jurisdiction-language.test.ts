import { describe, it, expect } from 'vitest'
import {
  defaultLanguageForJurisdiction,
  getJurisdictionLanguage,
  hasJurisdictionLanguage,
  languageDisplayName,
  orderLanguagesForJurisdiction,
  resolveJurisdictionLanguage
} from '@/lib/jurisdiction-language'

// The stored catalogue for PCT: the ten PCT publication languages, alphabetical
// by ISO code. Index 0 is Arabic, which is what made PCT drafts come out in
// Arabic wherever code treated `meta.languages[0]` as the default.
const PCT_LANGUAGES = ['ar', 'zh', 'en', 'fr', 'de', 'ja', 'ko', 'pt', 'ru', 'es']

// Catalogues as actually stored for the other seeded jurisdictions.
const STORED_CATALOGUES: Record<string, string[]> = {
  AU: ['en'],
  BR: ['pt'],
  CA: ['en', 'fr'],
  CN: ['zh', 'en'],
  DE: ['de', 'en'],
  EP: ['en', 'de', 'fr'],
  IN: ['en'],
  JP: ['ja', 'en'],
  KR: ['ko', 'en'],
  UK: ['en'],
  US: ['en']
}

describe('resolveJurisdictionLanguage', () => {
  it('never returns Arabic for PCT when nothing was requested', () => {
    expect(resolveJurisdictionLanguage('PCT', PCT_LANGUAGES)).toBe('en')
  })

  it('honours an explicitly chosen language', () => {
    expect(resolveJurisdictionLanguage('PCT', PCT_LANGUAGES, 'fr')).toBe('fr')
    expect(resolveJurisdictionLanguage('PCT', PCT_LANGUAGES, 'en')).toBe('en')
  })

  it('falls back to the session common language before the catalogue', () => {
    expect(resolveJurisdictionLanguage('PCT', PCT_LANGUAGES, '', ['de'])).toBe('de')
    expect(resolveJurisdictionLanguage('PCT', PCT_LANGUAGES, undefined, [undefined, 'ja'])).toBe('ja')
  })

  it('ignores a requested language the office does not accept', () => {
    expect(resolveJurisdictionLanguage('IN', ['en'], 'ar')).toBe('en')
    expect(resolveJurisdictionLanguage('BR', ['pt'], 'en')).toBe('pt')
  })

  it('trims whitespace and skips blank candidates', () => {
    expect(resolveJurisdictionLanguage('PCT', PCT_LANGUAGES, '  fr  ')).toBe('fr')
    expect(resolveJurisdictionLanguage('PCT', PCT_LANGUAGES, '   ', ['', 'ko'])).toBe('ko')
  })

  it('trusts the requested language when no catalogue is available', () => {
    expect(resolveJurisdictionLanguage('PCT', [], 'hi')).toBe('hi')
    expect(resolveJurisdictionLanguage('PCT', null, 'hi')).toBe('hi')
  })

  it('defaults to English for an unknown jurisdiction with no catalogue', () => {
    expect(resolveJurisdictionLanguage('ZZ')).toBe('en')
    expect(resolveJurisdictionLanguage('')).toBe('en')
  })

  it('uses the catalogue as a last resort when English is not accepted', () => {
    expect(resolveJurisdictionLanguage('ZZ', ['th', 'vi'])).toBe('th')
  })

  it('is case-insensitive in the jurisdiction code', () => {
    expect(resolveJurisdictionLanguage('pct', PCT_LANGUAGES)).toBe('en')
    expect(resolveJurisdictionLanguage('de', ['de', 'en'])).toBe('de')
  })

  it('preserves the existing default for every seeded jurisdiction', () => {
    // Before the PCT fix these all resolved to languages[0]; the canonical map
    // must agree so the fix changes PCT and nothing else.
    for (const [code, langs] of Object.entries(STORED_CATALOGUES)) {
      expect(resolveJurisdictionLanguage(code, langs)).toBe(langs[0])
    }
  })
})

describe('orderLanguagesForJurisdiction', () => {
  it('moves the effective language to the front for PCT', () => {
    expect(orderLanguagesForJurisdiction('PCT', PCT_LANGUAGES)[0]).toBe('en')
    expect(orderLanguagesForJurisdiction('PCT', PCT_LANGUAGES, 'ja')[0]).toBe('ja')
  })

  it('keeps every catalogued language exactly once', () => {
    const ordered = orderLanguagesForJurisdiction('PCT', PCT_LANGUAGES, 'de')
    expect(ordered).toHaveLength(PCT_LANGUAGES.length)
    expect([...ordered].sort()).toEqual([...PCT_LANGUAGES].sort())
  })

  it('does not reorder catalogues that already lead with the office language', () => {
    expect(orderLanguagesForJurisdiction('DE', ['de', 'en'])).toEqual(['de', 'en'])
    expect(orderLanguagesForJurisdiction('EP', ['en', 'de', 'fr'])).toEqual(['en', 'de', 'fr'])
  })

  it('returns the resolved language even when the catalogue is empty', () => {
    expect(orderLanguagesForJurisdiction('PCT', [])).toEqual(['en'])
  })
})

describe('defaultLanguageForJurisdiction', () => {
  it('preselects English for PCT in the UI', () => {
    expect(defaultLanguageForJurisdiction('PCT', PCT_LANGUAGES)).toBe('en')
  })

  it('preselects the local language where that is the office default', () => {
    expect(defaultLanguageForJurisdiction('JP', ['ja', 'en'])).toBe('ja')
    expect(defaultLanguageForJurisdiction('BR', ['pt'])).toBe('pt')
  })
})

describe('languageDisplayName', () => {
  it('expands ISO codes so prompts name the language', () => {
    expect(languageDisplayName('en')).toBe('English')
    expect(languageDisplayName('ja')).toBe('Japanese')
    expect(languageDisplayName('AR')).toBe('Arabic')
  })

  it('passes through names and unknown codes unchanged', () => {
    expect(languageDisplayName('English')).toBe('English')
    expect(languageDisplayName('Klingon')).toBe('Klingon')
  })

  it('defaults to English for empty input', () => {
    expect(languageDisplayName('')).toBe('English')
    expect(languageDisplayName(undefined)).toBe('English')
    expect(languageDisplayName(null)).toBe('English')
  })
})

describe('jurisdiction language map', () => {
  it('maps PCT to English', () => {
    expect(getJurisdictionLanguage('PCT')).toBe('en')
    expect(hasJurisdictionLanguage('PCT')).toBe(true)
  })

  it('reports unknown jurisdictions as unmapped but still answers English', () => {
    expect(hasJurisdictionLanguage('ZZ')).toBe(false)
    expect(getJurisdictionLanguage('ZZ')).toBe('en')
  })

  it('covers every seeded jurisdiction', () => {
    for (const code of Object.keys(STORED_CATALOGUES)) {
      expect(hasJurisdictionLanguage(code)).toBe(true)
    }
  })
})
