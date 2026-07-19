import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PATENT_COUNTRY_CODES,
  countryDisplayName,
  countryMatchValues,
  expandCountrySelection,
  getPatentCountry,
  listPatentCountries,
  normalizeCountryCode,
} from './patent-countries'

describe('patent country registry', () => {
  it('resolves the IPIndia corpus legacy spelling to the ISO code', () => {
    // local_patents.country holds 'INDIA' for every IPIndia-imported row and 'IN' for
    // Google Patents rows. Both must resolve to one country or India-filtered searches
    // silently drop most of the Indian corpus.
    expect(normalizeCountryCode('INDIA')).toBe('IN')
    expect(normalizeCountryCode('India')).toBe('IN')
    expect(normalizeCountryCode('IN')).toBe('IN')
  })

  it('matches both spellings when India is selected', () => {
    expect(countryMatchValues('IN').sort()).toEqual(['IN', 'INDIA'])
  })

  it('returns only the code for countries with no legacy spelling', () => {
    expect(countryMatchValues('US')).toEqual(['US'])
    expect(countryMatchValues('CN')).toEqual(['CN'])
  })

  it('expands a mixed selection into every stored spelling, de-duplicated', () => {
    expect(expandCountrySelection(['US', 'IN', 'US']).sort()).toEqual(['IN', 'INDIA', 'US'])
  })

  it('ignores empty selections', () => {
    expect(expandCountrySelection([])).toEqual([])
    expect(expandCountrySelection(undefined)).toEqual([])
  })

  it('keeps an unrecognised two-letter authority code usable', () => {
    // New authorities appear in the dataset between corpus refreshes; they should
    // still filter rather than being silently discarded.
    expect(normalizeCountryCode('XX')).toBe('XX')
    expect(countryMatchValues('XX')).toEqual(['XX'])
  })

  it('gives every country a display name', () => {
    for (const country of listPatentCountries()) {
      expect(country.name.length).toBeGreaterThan(0)
      expect(country.code).toMatch(/^[A-Z]{2}$/)
    }
  })

  it('names countries from any stored spelling', () => {
    expect(countryDisplayName('INDIA')).toBe('India')
    expect(countryDisplayName('US')).toBe('United States')
    expect(countryDisplayName('EP')).toBe('European Patent Office')
  })

  it('has no duplicate codes', () => {
    const codes = listPatentCountries().map(country => country.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('surfaces the major patent offices by default', () => {
    expect(DEFAULT_PATENT_COUNTRY_CODES).toContain('US')
    expect(DEFAULT_PATENT_COUNTRY_CODES).toContain('EP')
    expect(DEFAULT_PATENT_COUNTRY_CODES).toContain('WO')
    expect(DEFAULT_PATENT_COUNTRY_CODES).toContain('IN')
    expect(DEFAULT_PATENT_COUNTRY_CODES).toContain('CN')
  })

  it('exposes a country object for known codes only', () => {
    expect(getPatentCountry('JP')?.name).toBe('Japan')
    expect(getPatentCountry('ZZ')).toBeNull()
  })
})
