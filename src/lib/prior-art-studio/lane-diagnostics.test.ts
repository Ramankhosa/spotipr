import { describe, expect, it } from 'vitest'

import { describeLaneDiagnostics } from './service'
import type { SearchLaneDiagnostic } from '@/lib/patent-search/types'

const timeout = (lane: string, providerId = 'google-patents-corpus'): SearchLaneDiagnostic => ({
  providerId,
  lane,
  reason: 'timeout',
})

describe('describeLaneDiagnostics', () => {
  it('says nothing when every lane completed', () => {
    expect(describeLaneDiagnostics([], 'deep')).toEqual([])
  })

  it('names the lanes that timed out', () => {
    const [warning] = describeLaneDiagnostics([timeout('vector_probe'), timeout('field_search')], 'deep')
    expect(warning).toContain('2 retrieval lanes timed out')
    expect(warning).toContain('vector probe (google-patents-corpus)')
    expect(warning).toContain('field search (google-patents-corpus)')
  })

  it('refuses to let an incomplete search read as an absence of art', () => {
    const [warning] = describeLaneDiagnostics([timeout('vector_probe')], 'deep')
    expect(warning).toContain('searched LESS of the corpus')
    expect(warning).toContain('not as an absence of art')
  })

  it('points a failed deep run at fast scan, but does not tell fast to use fast', () => {
    expect(describeLaneDiagnostics([timeout('vector_probe')], 'deep')[0]).toContain('Fast scan')
    expect(describeLaneDiagnostics([timeout('vector_probe')], 'fast')[0]).not.toContain('Fast scan')
  })

  it('deduplicates repeated lane/provider pairs but keeps the true count', () => {
    const [warning] = describeLaneDiagnostics([timeout('vector_probe'), timeout('vector_probe')], 'deep')
    expect(warning).toContain('2 retrieval lanes timed out')
    expect(warning.match(/vector probe/g)).toHaveLength(1)
  })

  it('reports hard errors separately from timeouts, with the first detail', () => {
    const warnings = describeLaneDiagnostics(
      [
        timeout('vector_probe'),
        { providerId: 'indian-corpus', lane: 'field_search', reason: 'error', detail: 'connection pool timeout' },
      ],
      'deep'
    )
    expect(warnings).toHaveLength(2)
    expect(warnings[1]).toContain('1 retrieval lane failed')
    expect(warnings[1]).toContain('field search (indian-corpus)')
    expect(warnings[1]).toContain('connection pool timeout')
  })

  it('uses singular wording for a single lane', () => {
    expect(describeLaneDiagnostics([timeout('vector_probe')], 'deep')[0]).toContain('1 retrieval lane timed out')
  })
})
