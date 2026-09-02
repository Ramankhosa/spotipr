import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Runs the real convertHypothesis against a mocked prisma, so the idempotency
 * check-then-create lives under test rather than a mock of it.
 */

const { getOwnedStudy, appendTrail, hypothesisFindUnique, conceptFindFirst, conceptCreate, transaction } =
  vi.hoisted(() => {
    const conceptFindFirst = vi.fn()
    const conceptCreate = vi.fn()
    const tx = { whitespaceConcept: { findFirst: conceptFindFirst, create: conceptCreate } }
    return {
      getOwnedStudy: vi.fn(),
      appendTrail: vi.fn(),
      hypothesisFindUnique: vi.fn(),
      conceptFindFirst,
      conceptCreate,
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx)),
    }
  })

vi.mock('@/lib/auth-middleware', () => ({
  authenticateUser: vi.fn(async () => ({ user: { id: 'user-1', tenantId: 'tenant-1', email: 'a@b.test' } })),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { whitespaceHypothesis: { findUnique: hypothesisFindUnique }, $transaction: transaction },
}))
vi.mock('@/lib/whitespace/service', () => ({ getOwnedStudy, appendTrail }))

import { POST } from './route'

const HYPOTHESIS = {
  id: 'hyp-1',
  studyId: 'study-1',
  status: 'VALIDATED',
  type: 'PATENT_WHITESPACE',
  statement: 'Optical sensing combined with disposable housings appears absent.',
  rationale: 'Both elements are common; the pair is not observed.',
  elementCombination: { elements: ['optical sensing', 'disposable housing'] },
  scores: null,
  validation: {
    attacks: [],
    gates: [],
    attacksPlanned: 6,
    attacksRun: 5,
    redTeamNotes: null,
    validatedAt: '2026-08-06T00:00:00.000Z',
  },
  coverageLimitations: ['Claim text is unavailable for 40% of this arm.'],
  evidence: [],
}

function post() {
  const request = new NextRequest(
    'http://localhost/api/whitespace/studies/study-1/hypotheses/hyp-1/convert',
    { method: 'POST' }
  )
  return POST(request, { params: { studyId: 'study-1', hypothesisId: 'hyp-1' } })
}

describe('Whitespace hypothesis convert POST', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getOwnedStudy.mockResolvedValue({ id: 'study-1', scopeVersion: 3 } as never)
    hypothesisFindUnique.mockResolvedValue(HYPOTHESIS as never)
    conceptFindFirst.mockResolvedValue(null as never)
    conceptCreate.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      id: 'concept-1',
      ...args.data,
    }))
  })

  it('creates the concept once and answers 201', async () => {
    const response = await post()
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload.concept).toMatchObject({ conceptId: 'concept-1', existing: false })
    expect(conceptCreate).toHaveBeenCalledTimes(1)
    expect(appendTrail).toHaveBeenCalledTimes(1)
  })

  it('returns the existing concept on a re-click instead of minting a duplicate', async () => {
    conceptFindFirst.mockResolvedValue({ id: 'concept-1', title: 'Optical sensing combined with disposable housings' } as never)
    const response = await post()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.concept).toMatchObject({ conceptId: 'concept-1', existing: true })
    expect(conceptCreate).not.toHaveBeenCalled()
    expect(appendTrail).not.toHaveBeenCalled()
  })

  it('404s a hypothesis that no longer exists', async () => {
    hypothesisFindUnique.mockResolvedValue(null as never)
    const response = await post()
    const payload = await response.json()

    expect(response.status).toBe(404)
    expect(payload.error).toBe('That hypothesis no longer exists.')
  })

  it('404s a hypothesis belonging to another study', async () => {
    hypothesisFindUnique.mockResolvedValue({ ...HYPOTHESIS, studyId: 'study-9' } as never)
    const response = await post()

    expect(response.status).toBe(404)
  })

  it('refuses a refuted hypothesis with 400', async () => {
    hypothesisFindUnique.mockResolvedValue({ ...HYPOTHESIS, status: 'REFUTED' } as never)
    const response = await post()
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toMatch(/refuted hypothesis cannot be promoted/)
  })

  it('converts a draft hypothesis but stamps the concept as never validated', async () => {
    hypothesisFindUnique.mockResolvedValue({ ...HYPOTHESIS, status: 'DRAFT', validation: null } as never)
    const response = await post()

    expect(response.status).toBe(201)
    const features = (conceptCreate.mock.calls[0][0] as { data: { features: Record<string, unknown> } }).data.features
    expect(features.validationNote).toMatch(/never run/i)
    expect(features.validationSummary).toBeNull()
  })

  it('converts an inconclusive hypothesis but says validation was inconclusive', async () => {
    hypothesisFindUnique.mockResolvedValue({ ...HYPOTHESIS, status: 'INCONCLUSIVE' } as never)
    const response = await post()

    expect(response.status).toBe(201)
    const features = (conceptCreate.mock.calls[0][0] as { data: { features: Record<string, unknown> } }).data.features
    expect(features.validationNote).toMatch(/inconclusive/i)
  })

  it('leaves no validation note on a validated hypothesis', async () => {
    await post()
    const features = (conceptCreate.mock.calls[0][0] as { data: { features: Record<string, unknown> } }).data.features
    expect(features.validationNote).toBeNull()
  })
})
