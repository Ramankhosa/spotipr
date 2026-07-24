import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * The Idea Bank listing is platform-wide: `searchIdeas` has no owner or tenant filter by default,
 * so a confidential pre-filing idea (saved from a novelty assessment) is only safe if PRIVATE rows
 * are scoped to their creator in every read path — list, single-fetch, export, and reservation.
 */

const prisma = vi.hoisted(() => ({
  ideaBankIdea: {
    findMany: vi.fn(),
    count: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  ideaBankHistory: {
    create: vi.fn(),
  },
  ideaBankReservation: {
    count: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma }))
vi.mock('@/lib/org-access-service', () => ({ checkServiceAccess: vi.fn().mockResolvedValue({ allowed: true }) }))
vi.mock('@/lib/service-completion', () => ({ recordServiceCompletion: vi.fn() }))
// Write operations (reserve/edit) route through enforceMetering, which the service reads as
// `result.decision.allowed`.
vi.mock('@/lib/metering/enforcement', () => ({
  enforceMetering: vi.fn().mockResolvedValue({ decision: { allowed: true } }),
}))
vi.mock('@/lib/metering/gateway', () => ({ llmGateway: { executeLLMOperation: vi.fn() } }))

import { IdeaBankService } from '@/lib/idea-bank-service'

const service = new IdeaBankService()
const owner = { id: 'user_owner', email: 'owner@example.com', name: 'Owner', tenantId: 'tenant_1' } as any
const other = { id: 'user_other', email: 'other@example.com', name: 'Other', tenantId: 'tenant_1' } as any

/** Flattens the nested AND/OR clause tree so assertions do not depend on nesting order. */
function flattenClauses(where: any): any[] {
  const out: any[] = []
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return
    out.push(node)
    for (const value of [node.AND, node.OR]) {
      if (Array.isArray(value)) value.forEach(walk)
    }
  }
  walk(where)
  return out
}

function privateGuardFor(where: any, userId: string): boolean {
  return flattenClauses(where).some(node =>
    Array.isArray(node.OR) &&
    node.OR.some((branch: any) => branch?.status?.not === 'PRIVATE') &&
    node.OR.some((branch: any) => branch?.createdBy === userId)
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  prisma.ideaBankIdea.findMany.mockResolvedValue([])
  prisma.ideaBankIdea.count.mockResolvedValue(0)
})

describe('searchIdeas PRIVATE scoping', () => {
  test('restricts PRIVATE ideas to their creator', async () => {
    await service.searchIdeas({}, {}, owner)

    const where = prisma.ideaBankIdea.findMany.mock.calls[0][0].where
    expect(privateGuardFor(where, owner.id)).toBe(true)
  })

  test('scopes the guard to the requesting user, not a shared constant', async () => {
    await service.searchIdeas({}, {}, other)

    const where = prisma.ideaBankIdea.findMany.mock.calls[0][0].where
    expect(privateGuardFor(where, other.id)).toBe(true)
    expect(privateGuardFor(where, owner.id)).toBe(false)
  })

  test('keeps the text search when a tenant filter is also applied', async () => {
    // Regression guard: both filters used to assign `where.OR`, so the tenant clause silently
    // replaced the text search — and would equally have replaced the privacy guard.
    await service.searchIdeas({}, { query: 'thermal pump', tenantId: 'tenant_1' }, owner)

    const where = prisma.ideaBankIdea.findMany.mock.calls[0][0].where
    const clauses = flattenClauses(where)

    const hasTextSearch = clauses.some(node =>
      Array.isArray(node.OR) && node.OR.some((branch: any) => branch?.title?.contains === 'thermal pump')
    )
    const hasTenantFilter = clauses.some(node =>
      Array.isArray(node.OR) && node.OR.some((branch: any) => branch?.tenantId === 'tenant_1')
    )

    expect(hasTextSearch).toBe(true)
    expect(hasTenantFilter).toBe(true)
    expect(privateGuardFor(where, owner.id)).toBe(true)
  })

  test('still excludes archived ideas', async () => {
    await service.searchIdeas({}, {}, owner)

    const where = prisma.ideaBankIdea.findMany.mock.calls[0][0].where
    expect(flattenClauses(where).some(node => node?.status?.not === 'ARCHIVED')).toBe(true)
  })
})

describe('exportIdeas PRIVATE scoping', () => {
  test('applies the same owner-only guard so exports cannot leak private ideas', async () => {
    await service.exportIdeas({}, {}, owner)

    const where = prisma.ideaBankIdea.findMany.mock.calls[0][0].where
    expect(privateGuardFor(where, owner.id)).toBe(true)
  })
})

describe('getIdeaById PRIVATE scoping', () => {
  const privateIdea = {
    id: 'idea_1',
    status: 'PRIVATE',
    createdBy: owner.id,
    description: 'Confidential unfiled invention',
    abstract: 'Confidential',
    keyFeatures: ['a'],
    potentialApplications: ['b'],
    reservedCount: 0,
    reservations: [],
  }

  test('returns the idea to its creator', async () => {
    prisma.ideaBankIdea.findUnique.mockResolvedValue(privateIdea)

    const result = await service.getIdeaById({}, 'idea_1', owner)
    expect(result).toBeTruthy()
    expect(result?.description).toBe('Confidential unfiled invention')
  })

  test('hides another user\'s private idea', async () => {
    prisma.ideaBankIdea.findUnique.mockResolvedValue(privateIdea)

    const result = await service.getIdeaById({}, 'idea_1', other)
    expect(result).toBeNull()
  })

  test('leaves PUBLIC ideas readable by anyone', async () => {
    prisma.ideaBankIdea.findUnique.mockResolvedValue({ ...privateIdea, status: 'PUBLIC', description: 'Shared idea' })

    const result = await service.getIdeaById({}, 'idea_1', other)
    expect(result).toBeTruthy()
    expect(result?.description).toBe('Shared idea')
  })
})

describe('reserveIdea', () => {
  test('refuses to reserve a PRIVATE idea', async () => {
    prisma.ideaBankIdea.findUnique.mockResolvedValue({
      id: 'idea_1',
      status: 'PRIVATE',
      createdBy: owner.id,
      reservations: [],
    })

    await expect(service.reserveIdea({}, 'idea_1', other)).rejects.toThrow(/not available for reservation/i)
  })
})

describe('createIdea', () => {
  beforeEach(() => {
    prisma.ideaBankIdea.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'idea_new', ...data }))
    prisma.ideaBankHistory.create.mockResolvedValue({})
  })

  const base = {
    title: 'Adaptive pump controller',
    description: 'A controller couples a thermal model to commanded speed.',
    domainTags: ['mechanical'],
    keyFeatures: ['thermal model'],
    potentialApplications: ['industrial pumps'],
  }

  test('a PRIVATE idea is never published', async () => {
    await service.createIdea({}, { ...base, status: 'PRIVATE' as any }, owner)

    const data = prisma.ideaBankIdea.create.mock.calls[0][0].data
    expect(data.status).toBe('PRIVATE')
    expect(data.publishedAt).toBeNull()
    expect(data.createdBy).toBe(owner.id)
  })

  test('defaults to PUBLIC and published when no status is given', async () => {
    await service.createIdea({}, base, owner)

    const data = prisma.ideaBankIdea.create.mock.calls[0][0].data
    expect(data.status).toBe('PUBLIC')
    expect(data.publishedAt).toBeInstanceOf(Date)
  })
})
