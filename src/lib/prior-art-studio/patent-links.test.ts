import { describe, expect, it } from 'vitest'

import { googlePatentsId, googlePatentsUrl, resolvePatentLink } from './patent-links'

describe('googlePatentsId', () => {
  it('zero-pads the serial of US pre-grant publications stored DOCDB-style', () => {
    expect(googlePatentsId('US-2025178928-A1')).toBe('US20250178928A1')
    expect(googlePatentsId('US-2019012345-A1')).toBe('US20190012345A1')
  })

  it('handles kindless and lowercase input', () => {
    expect(googlePatentsId('us-2025178928')).toBe('US20250178928')
  })

  it('leaves already-canonical 11-digit US publication numbers alone', () => {
    expect(googlePatentsId('US20250178928A1')).toBe('US20250178928A1')
  })

  it('leaves granted US patents alone', () => {
    expect(googlePatentsId('US10123456B2')).toBe('US10123456B2')
    expect(googlePatentsId('US7654321')).toBe('US7654321')
  })

  it('leaves design patents alone', () => {
    expect(googlePatentsId('USD1034567S')).toBe('USD1034567S')
  })

  it('compacts non-US numbers without repair', () => {
    expect(googlePatentsId('WO-2020178928-A1')).toBe('WO2020178928A1')
    expect(googlePatentsId('IN-202847012345-A')).toBe('IN202847012345A')
    expect(googlePatentsId('EP-3456789-B1')).toBe('EP3456789B1')
  })
})

describe('googlePatentsUrl', () => {
  it('builds the canonical patents.google.com URL', () => {
    expect(googlePatentsUrl('US-2025178928-A1')).toBe('https://patents.google.com/patent/US20250178928A1')
  })
})

describe('resolvePatentLink', () => {
  it('recomputes broken stored patents.google.com links', () => {
    expect(
      resolvePatentLink({
        publicationNumber: 'US-2025178928-A1',
        link: 'https://patents.google.com/patent/US-2025178928-A1',
      }),
    ).toBe('https://patents.google.com/patent/US20250178928A1')
  })

  it('keeps genuinely external links', () => {
    expect(
      resolvePatentLink({ publicationNumber: 'IN-202847012345-A', link: 'https://iprsearch.ipindia.gov.in/x' }),
    ).toBe('https://iprsearch.ipindia.gov.in/x')
  })

  it('falls back to the computed URL when no link is stored', () => {
    expect(resolvePatentLink({ publicationNumber: 'US-2025178928-A1', link: null })).toBe(
      'https://patents.google.com/patent/US20250178928A1',
    )
  })
})
