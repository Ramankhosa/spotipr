import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { WhitespacePermanentError } from '@/lib/whitespace/run-lease'

const { getOwnedStudy, readScope, startWhitespaceRun, appendTrail, runCount, enforceServiceAccess } = vi.hoisted(
  () => ({
    getOwnedStudy: vi.fn(),
    readScope: vi.fn(),
    startWhitespaceRun: vi.fn(),
    appendTrail: vi.fn(),
    runCount: vi.fn(),
    enforceServiceAccess: vi.fn(),
  })
)

vi.mock('@/lib/auth-middleware', () => ({
  authenticateUser: vi.fn(async () => ({ user: { id: 'user-1', tenantId: 'tenant-1', email: 'a@b.test' } })),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { whitespaceRun: { count: runCount } } }))
vi.mock('@/lib/service-access-middleware', () => ({ enforceServiceAccess }))
vi.mock('@/lib/whitespace/service', () => ({ getOwnedStudy, readScope, startWhitespaceRun, appendTrail }))
vi.mock('@/lib/whitespace/scope-schema', () => ({ scopeIsRunnable: vi.fn(() => ({ runnable: true })) }))

import { POST } from './route'

function post(body: unknown) {
  const request = new NextRequest('http://localhost/api/whitespace/studies/study-1/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(request, { params: { studyId: 'study-1' } })
}

describe('Whitespace run start POST', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getOwnedStudy.mockResolvedValue({ id: 'study-1', scope: {}, scopeVersion: 3 } as never)
    readScope.mockReturnValue({} as never)
    startWhitespaceRun.mockResolvedValue({ runId: 'run-1', existing: false } as never)
    runCount.mockResolvedValue(0 as never)
    enforceServiceAccess.mockResolvedValue({ allowed: true } as never)
  })

  it('starts a stage and answers 202', async () => {
    const response = await post({ stage: 'FIELD_MAP' })
    const payload = await response.json()

    expect(response.status).toBe(202)
    expect(payload).toMatchObject({ runId: 'run-1', stage: 'FIELD_MAP', status: 'PROCESSING' })
  })

  it('refuses a deep dive without a clusterId immediately, with the executor’s message', async () => {
    const response = await post({ stage: 'DEEP_DIVE', params: {} })
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toBe('A deep dive needs the area to read (clusterId).')
    expect(startWhitespaceRun).not.toHaveBeenCalled()
  })

  it('refuses validation without a hypothesisId immediately, with the executor’s message', async () => {
    const response = await post({ stage: 'VALIDATE' })
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toBe('Validation needs the hypothesis to attack (hypothesisId).')
    expect(startWhitespaceRun).not.toHaveBeenCalled()
  })

  it('keeps a curated refusal at 400 with its own message', async () => {
    startWhitespaceRun.mockRejectedValue(
      new WhitespacePermanentError('This field matches more than 250,000 publications — narrow the scope.') as never
    )
    const response = await post({ stage: 'FIELD_MAP' })
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toBe('This field matches more than 250,000 publications — narrow the scope.')
  })

  it('answers an unexpected failure with a generic 500 instead of leaking the internal message', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    startWhitespaceRun.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.7:5432') as never)
    const response = await post({ stage: 'FIELD_MAP' })
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload.error).not.toContain('ECONNREFUSED')
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
