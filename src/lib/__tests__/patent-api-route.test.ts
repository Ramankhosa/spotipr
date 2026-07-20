import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/patent-corpus-service', () => ({
  getPatentCorpusCoverageStats: vi.fn(),
  hasSearchEmbeddingApiKey: () => true,
  PATENT_CORPUS_EMBEDDING_MODEL: 'text-embedding-3-small',
  PATENT_CORPUS_SOURCE_INDIAN: 'indian-corpus',
}))
vi.mock('@/lib/patent-search', () => ({ patentSearchOrchestrator: { search: vi.fn() } }))

import { PATENT_API_MAX_BODY_BYTES, readPatentApiJsonBody } from '@/lib/patent-api-route'

function postJson(body: string, headers: Record<string, string> = {}) {
  return new NextRequest('http://local/api/v1/patents/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  })
}

describe('patent API request bodies', () => {
  it('parses a well-formed JSON object', async () => {
    await expect(readPatentApiJsonBody(postJson('{"query":"thermal battery"}'))).resolves.toEqual({ query: 'thermal battery' })
  })

  it('rejects a body that exceeds the cap even when Content-Length understates it', async () => {
    const oversized = JSON.stringify({ query: 'x'.repeat(PATENT_API_MAX_BODY_BYTES) })
    await expect(readPatentApiJsonBody(postJson(oversized, { 'content-length': '10' })))
      .rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE', status: 413 })
  })

  it('rejects an oversized body from the declared Content-Length alone', async () => {
    await expect(readPatentApiJsonBody(postJson('{}', { 'content-length': String(PATENT_API_MAX_BODY_BYTES + 1) })))
      .rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE', status: 413 })
  })

  it('rejects malformed JSON and non-object bodies', async () => {
    await expect(readPatentApiJsonBody(postJson('{not json'))).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 })
    await expect(readPatentApiJsonBody(postJson('[1,2]'))).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 })
  })

  it('allows a top-level array only when the caller opts in, as the MCP transport does', async () => {
    await expect(readPatentApiJsonBody(postJson('[1,2]'), { allowArray: true })).resolves.toEqual([1, 2])
  })
})
