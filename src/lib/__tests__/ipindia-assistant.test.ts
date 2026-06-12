import { describe, expect, it } from 'vitest'
import {
  buildIpIndiaSearchPayload,
  canonicalIndianPublicationFromApplicationNumber,
  normalizeIpIndiaApplicationNumber,
  normalizeIpIndiaApplicationNumbers,
} from '@/lib/ipindia-assistant'

describe('IP India assistant helpers', () => {
  it('normalizes Indian publication numbers to application numbers', () => {
    expect(normalizeIpIndiaApplicationNumber('IN202311032623A')).toBe('202311032623')
    expect(normalizeIpIndiaApplicationNumber(' IN202311032743 A ')).toBe('202311032743')
    expect(normalizeIpIndiaApplicationNumber('202311032820')).toBe('202311032820')
  })

  it('deduplicates normalized application numbers', () => {
    expect(normalizeIpIndiaApplicationNumbers([
      'IN202311032623A',
      '202311032623',
      'IN202311032743A',
    ])).toEqual(['202311032623', '202311032743'])
  })

  it('builds an OR application-number payload for the browser assistant', () => {
    const payload = buildIpIndiaSearchPayload([
      'IN202311032623A',
      'IN202311032743A',
    ], new Date('2026-05-23T00:00:00.000Z'))

    expect(payload).toMatchObject({
      source: 'patentnest',
      field: 'AP',
      operator: 'OR',
      applicationNumbers: ['202311032623', '202311032743'],
      createdAt: '2026-05-23T00:00:00.000Z',
    })
  })

  it('creates the local corpus publication key from an IP India application number', () => {
    expect(canonicalIndianPublicationFromApplicationNumber('202311032623')).toBe('IN202311032623A')
  })
})
