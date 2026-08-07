import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'

const { findFirst, update, getOwnedStudy, appendTrail } = vi.hoisted(() => ({
  findFirst: vi.fn(async () => ({ id: 'hyp-1', statement: 'X combined with Y appears absent' })),
  update: vi.fn(async () => ({ id: 'hyp-1' })),
  getOwnedStudy: vi.fn(async () => ({ id: 'study-1', scopeVersion: 3 })),
  appendTrail: vi.fn(),
}))

vi.mock('@/lib/auth-middleware', () => ({
  authenticateUser: vi.fn(async () => ({ user: { id: 'user-1', tenantId: 'tenant-1', email: 'a@b.test' } })),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { whitespaceHypothesis: { findFirst, update } } }))
vi.mock('@/lib/whitespace/service', () => ({ getOwnedStudy, appendTrail }))

import { PATCH } from './route'

function patch(body: unknown) {
  const request = new NextRequest('http://localhost/api/whitespace/studies/study-1/hypotheses/hyp-1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return PATCH(request, { params: { studyId: 'study-1', hypothesisId: 'hyp-1' } })
}

describe('Whitespace hypothesis attorney review PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findFirst.mockResolvedValue({ id: 'hyp-1', statement: 'X combined with Y appears absent' })
    getOwnedStudy.mockResolvedValue({ id: 'study-1', scopeVersion: 3 } as never)
    update.mockResolvedValue({ id: 'hyp-1' } as never)
  })

  it('refuses a REJECTED verdict without a written reason, and writes nothing', async () => {
    const response = await patch({ verdict: 'REJECTED', note: 'too thin' })
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toMatch(/has to be yours/)
    expect(update).not.toHaveBeenCalled()
    expect(appendTrail).not.toHaveBeenCalled()
  })

  it('accepts a REJECTED verdict once the reason is written', async () => {
    const note = 'The near-miss families already claim this combination in substance.'
    const response = await patch({ verdict: 'REJECTED', note })

    expect(response.status).toBe(200)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { humanReview: expect.objectContaining({ verdict: 'REJECTED', note }) },
      })
    )
  })

  it('stamps the reviewer and time on an endorsement and trails it as a NOTE', async () => {
    const response = await patch({ verdict: 'ENDORSED', note: 'Worth a provisional.' })

    expect(response.status).toBe(200)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'hyp-1' },
        data: {
          humanReview: {
            verdict: 'ENDORSED',
            note: 'Worth a provisional.',
            reviewedById: 'user-1',
            reviewedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
          },
        },
      })
    )
    expect(appendTrail).toHaveBeenCalledWith(
      'study-1',
      'NOTE',
      'user:user-1',
      expect.stringContaining('ENDORSED'),
      expect.objectContaining({ hypothesisId: 'hyp-1', verdict: 'ENDORSED' })
    )
  })

  it('allows an endorsement with no note', async () => {
    const response = await patch({ verdict: 'ENDORSED' })

    expect(response.status).toBe(200)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { humanReview: expect.objectContaining({ note: null }) } })
    )
  })

  it('clears the review with DbNull, not a JSON null', async () => {
    const response = await patch({ verdict: null })

    expect(response.status).toBe(200)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { humanReview: Prisma.DbNull } })
    )
    expect(appendTrail).toHaveBeenCalledWith(
      'study-1',
      'NOTE',
      'user:user-1',
      expect.stringContaining('cleared'),
      expect.objectContaining({ verdict: null })
    )
  })

  it('rejects an unknown verdict', async () => {
    const response = await patch({ verdict: 'MAYBE' })

    expect(response.status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })

  it('404s a hypothesis belonging to another study', async () => {
    findFirst.mockResolvedValue(null as never)
    const response = await patch({ verdict: 'ENDORSED' })

    expect(response.status).toBe(404)
    expect(update).not.toHaveBeenCalled()
  })

  it('404s before touching the hypothesis when the study is not the caller’s', async () => {
    getOwnedStudy.mockResolvedValue(null as never)
    const response = await patch({ verdict: 'ENDORSED' })

    expect(response.status).toBe(404)
    expect(findFirst).not.toHaveBeenCalled()
  })
})
