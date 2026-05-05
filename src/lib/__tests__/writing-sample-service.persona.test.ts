import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    writingPersona: {
      findMany: vi.fn()
    },
    writingSample: {
      findMany: vi.fn(),
      findFirst: vi.fn()
    }
  }
}))

import { prisma } from '@/lib/prisma'
import {
  PersonaAccessError,
  buildWritingSampleBlock,
  getPersonaCoverageWarnings,
  getWritingSample,
  invalidateWritingSampleCache,
  validatePersonaSelectionForUser
} from '@/lib/writing-sample-service'

const mockPrisma = prisma as any

describe('writing sample persona resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invalidateWritingSampleCache('user-1')
  })

  test('allows own and same-tenant organization personas and cleans secondaries', async () => {
    mockPrisma.writingPersona.findMany.mockResolvedValue([
      { id: 'persona-own', name: 'Own Style' },
      { id: 'persona-org', name: 'Org Style' }
    ])

    const resolved = await validatePersonaSelectionForUser('user-1', 'tenant-1', {
      primaryPersonaId: 'persona-own',
      secondaryPersonaIds: ['persona-org', 'persona-org', 'persona-own']
    })

    expect(mockPrisma.writingPersona.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: { in: ['persona-own', 'persona-org'] },
        isActive: true,
        OR: [
          { createdBy: 'user-1' },
          { tenantId: 'tenant-1', visibility: 'ORGANIZATION' }
        ]
      })
    }))
    expect(resolved).toEqual({
      primaryPersonaId: 'persona-own',
      primaryPersonaName: 'Own Style',
      secondaryPersonaIds: ['persona-org'],
      secondaryPersonaNames: ['Org Style']
    })
  })

  test('rejects inaccessible, other-tenant, private, or inactive personas', async () => {
    mockPrisma.writingPersona.findMany.mockResolvedValue([
      { id: 'persona-own', name: 'Own Style' }
    ])

    await expect(validatePersonaSelectionForUser('user-1', 'tenant-1', {
      primaryPersonaId: 'persona-own',
      secondaryPersonaIds: ['blocked-persona']
    })).rejects.toBeInstanceOf(PersonaAccessError)
  })

  test('uses persona jurisdiction sample before universal sample', async () => {
    mockPrisma.writingPersona.findMany.mockResolvedValue([
      { id: 'persona-own', name: 'Own Style' }
    ])
    mockPrisma.writingSample.findMany.mockResolvedValueOnce([
      {
        id: 'sample-star',
        sampleText: 'Universal style',
        jurisdiction: '*',
        personaId: 'persona-own',
        personaName: null,
        persona: { name: 'Own Style' }
      },
      {
        id: 'sample-us',
        sampleText: 'US style',
        jurisdiction: 'US',
        personaId: 'persona-own',
        personaName: null,
        persona: { name: 'Own Style' }
      }
    ])

    const sample = await getWritingSample('user-1', 'claims', 'US', {
      primaryPersonaId: 'persona-own'
    }, 'tenant-1')

    expect(sample).toMatchObject({
      sampleText: 'US style',
      jurisdiction: 'US',
      isUniversal: false,
      personaId: 'persona-own',
      personaName: 'Own Style',
      sampleId: 'sample-us',
      source: 'persona'
    })
  })

  test('non-persona lookup ignores persona-linked samples', async () => {
    mockPrisma.writingSample.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'sample-direct',
        sampleText: 'Direct universal style',
        jurisdiction: '*',
        personaId: null,
        personaName: null,
        persona: null
      })

    const sample = await getWritingSample('user-1', 'claims', 'US')

    expect(mockPrisma.writingSample.findFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        userId: 'user-1',
        sectionKey: 'claims',
        jurisdiction: 'US',
        personaId: null,
        isActive: true
      })
    }))
    expect(mockPrisma.writingSample.findFirst).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        userId: 'user-1',
        sectionKey: 'claims',
        jurisdiction: '*',
        personaId: null,
        isActive: true
      })
    }))
    expect(sample).toMatchObject({
      sampleText: 'Direct universal style',
      jurisdiction: '*',
      isUniversal: true,
      source: 'personal'
    })
  })

  test('reports coverage warning and direct fallback when persona sample is missing', async () => {
    mockPrisma.writingPersona.findMany.mockResolvedValue([
      { id: 'persona-own', name: 'Own Style' }
    ])
    mockPrisma.writingSample.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'sample-direct',
          sampleText: 'Direct claims style',
          jurisdiction: 'US',
          personaId: null,
          personaName: null,
          persona: null
        }
      ])

    const warnings = await getPersonaCoverageWarnings(
      'user-1',
      'tenant-1',
      ['claims'],
      'US',
      { primaryPersonaId: 'persona-own' }
    )

    expect(warnings).toEqual([
      expect.objectContaining({
        sectionKey: 'claims',
        jurisdiction: 'US',
        primaryPersonaId: 'persona-own',
        primaryPersonaName: 'Own Style',
        fallback: 'personal_sample'
      })
    ])
  })

  test('does not inject persona names as prompt style guidance', () => {
    const block = buildWritingSampleBlock({
      sampleText: 'A device comprising a processor and a memory.',
      jurisdiction: 'US',
      isUniversal: false,
      personaName: 'Confidential Persona Name',
      personaId: 'persona-own',
      source: 'persona'
    }, 'claims')

    expect(block).not.toContain('Confidential Persona Name')
    expect(block).toContain('A device comprising a processor and a memory.')
    expect(block).toContain('STYLE-ONLY BOUNDARY')
    expect(block).toContain('mimic style only, never sample content')
    expect(block).toContain('Do NOT copy or import the sample')
    expect(block).toContain("Draft all technical substance only from the current patent's source facts")
  })
})
