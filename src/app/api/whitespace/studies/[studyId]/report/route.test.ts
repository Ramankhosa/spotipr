import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import mammoth from 'mammoth'

/**
 * Integration test: only the edges are mocked (auth, prisma, branding). The
 * report model and the DOCX renderer run for real, and the assertions read the
 * text out of the produced .docx — so this fails if a section stops rendering,
 * not merely if a function stops being called.
 */

const FIRM = {
  firmName: 'Kapoor & Rao IP',
  logoDataUri: null,
  tagline: 'Patent counsel',
  addressLine1: '4 Residency Road',
  city: 'Bengaluru',
  countryCode: 'IN',
  phone: '+91 80 1234 5678',
  email: 'mail@kapoorrao.test',
  accentColor: '#1D4ED8',
  showPoweredBy: true,
}

const STUDY = {
  id: 'study-abc123',
  title: 'Wearable glucose sensing',
  kind: 'INVENTION',
  scopeVersion: 4,
  tenantId: 'tenant-1',
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
  inventionJson: { problem: 'Sensor drift after two weeks', approach: 'Optical recalibration', constraints: 'Battery' },
  scope: {
    title: 'Wearable glucose sensing',
    summary: 'Continuous glucose monitoring worn on the body.',
    concepts: [{ id: 'c1', label: 'glucose sensing', synonyms: ['analyte detection'], required: true, origin: 'copilot' }],
    classifications: [{ code: 'A61B5/1455', definition: 'Optical measurement', accepted: true, origin: 'copilot' }],
    exclusions: [],
    assumptions: [{ id: 'a1', text: 'The corpus begins in 2000.', kind: 'corpus' }],
    filters: { yearFrom: 2000, yearTo: 2026, jurisdictions: [], assignees: [] },
  },
}

const DIMENSION_RESULTS = {
  familyCount: 1840,
  publicationCount: 4102,
  sample: { families: 1840, weight: 1, method: 'md5-family-key' },
  registry: [
    {
      id: 'd1',
      label: 'Sensing modality',
      description: 'How the measurement is taken',
      values: [
        { id: 'v1', label: 'optical', synonyms: [], query: 'optical', families: 700, share: 0.38, sampleFamilies: 700, round: 1, provenance: 'seed' },
        { id: 'v2', label: 'electrochemical', synonyms: [], query: 'electrochemical', families: 900, share: 0.49, sampleFamilies: 900, round: 1, provenance: 'seed' },
      ],
      introducedInRound: 1,
      assignedFamilies: 1500,
      residualFamilies: 340,
      residualShare: 0.18,
      multiAssignmentRatio: 1.06,
      sampleAssignedFamilies: 1500,
      sampleResidualShare: 0.18,
    },
  ],
  rounds: [
    {
      round: 1,
      slice: { families: 1840, basis: 'sample' },
      proposedDimensions: ['Sensing modality', 'Housing'],
      proposedValues: [],
      acceptedDimensions: ['Sensing modality'],
      acceptedValues: [],
      rejected: [
        { kind: 'dimension', label: 'Housing', reason: 'BELOW_SAMPLE_FLOOR', detail: '11 of 1840 families' },
      ],
      residualShareAfter: 0.18,
      modelCode: 'test-model',
    },
  ],
  settled: true,
  settledReason: 'RESIDUAL_UNDER_FLOOR',
  matrices: [{ aDimensionId: 'd1', bDimensionId: 'd1', redundancy: 0.1, harvested: true, skipReason: null, cells: [] }],
  gaps: [
    {
      id: 'gap-1',
      aDimensionId: 'd1',
      aDimensionLabel: 'Sensing modality',
      aValueId: 'v1',
      aValueLabel: 'optical',
      bDimensionId: 'd1',
      bDimensionLabel: 'Housing',
      bValueId: 'v2',
      bValueLabel: 'disposable',
      observed: 0,
      marginA: 700,
      marginB: 300,
      expected: 114.1,
      z: -10.7,
      rarity: 1,
      surprisal: 49.6,
      nearMissB: { valueId: 'v2', valueLabel: 'reusable', families: 210 },
      nearMissA: null,
      unassignedOnB: 40,
      unassignedOnA: 12,
      armFamilies: 700,
      armClaimsReadable: 420,
      coverageSuspect: false,
      suspectReason: null,
      rank: 0.81,
      hypothesisId: 'hyp-1',
    },
  ],
  thresholds: { marginFloor: 30, expectedFloor: 5, residualCeiling: 0.2, redundancyCeiling: 0.6 },
  unclassifiedFamilies: 340,
  unclassifiedShare: 0.18,
  coverageNotes: ['Applicant names are matched by substring.'],
  limitations: ['This corpus contains Indian publications only.'],
  generatedAt: '2026-08-05T00:00:00.000Z',
}

const HYPOTHESIS = {
  id: 'hyp-1',
  clusterId: null,
  type: 'PATENT_WHITESPACE',
  statement: 'Optical sensing combined with a disposable housing appears absent.',
  rationale: 'Both arms are well populated; the combination is never observed.',
  status: 'VALIDATED',
  elementCombination: { elements: ['optical sensing', 'disposable housing'] },
  scores: {
    density: 0.62,
    rarity: 0.94,
    semanticNovelty: null,
    evidenceQuality: 0.58,
    confidence: 0.51,
    crowdedness: 0.44,
    strength: null,
  },
  validation: {
    attacks: [
      { strategy: 'SYNONYM_SHIFTED', query: 'single-use analyte patch', hits: 2, outcome: 'WEAKENING' },
      { strategy: 'LITERATURE', query: '', hits: 0, outcome: 'NOT_RUN', reason: 'No literature source is configured.' },
    ],
    gates: [{ gate: 'G1_DATA', outcome: 'PASSED', basis: '60% of the arm is claim-readable.', measured: 0.6 }],
    attacksPlanned: 6,
    attacksRun: 5,
    redTeamNotes: 'Consider continuous calibration prior art.',
    validatedAt: '2026-08-06T00:00:00.000Z',
  },
  coverageLimitations: ['Claim text is unavailable for 40% of this arm.'],
  humanReview: {
    verdict: 'ENDORSED',
    note: 'Worth a provisional filing this quarter.',
    reviewedById: 'user-1',
    reviewedAt: '2026-08-07T09:00:00.000Z',
  },
  createdAt: new Date('2026-08-06T00:00:00.000Z'),
  evidence: [
    { kind: 'STATISTIC', stance: 'CONTEXT', refId: null, passage: 'Expected 114.1, observed 0.', queryText: null },
  ],
}

const { getOwnedStudy, readScope, loadFirmBranding, runFindMany, runFindFirst, prismaMock } = vi.hoisted(() => {
  const runFindMany = vi.fn()
  const runFindFirst = vi.fn()
  return {
    getOwnedStudy: vi.fn(),
    readScope: vi.fn((value: unknown) => value),
    loadFirmBranding: vi.fn(),
    runFindMany,
    runFindFirst,
    prismaMock: {
      whitespaceRun: { findMany: runFindMany, findFirst: runFindFirst },
      whitespaceCluster: { findMany: vi.fn(async () => []) },
      whitespaceAreaAnalysis: { findMany: vi.fn(async () => []) },
      whitespaceHypothesis: { findMany: vi.fn(async () => []) },
      whitespaceConcept: { findMany: vi.fn(async () => []) },
      whitespaceTrailEntry: { findMany: vi.fn(async () => []) },
      // NOTE: whitespaceClusterMember is deliberately absent. Members are the one
      // table that scales with sample size; if the route ever loads them this
      // test throws rather than silently getting slower.
    },
  }
})

vi.mock('@/lib/auth-middleware', () => ({
  authenticateUser: vi.fn(async () => ({ user: { id: 'user-1', tenantId: 'tenant-1', email: 'attorney@firm.test' } })),
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/whitespace/service', () => ({ getOwnedStudy, readScope }))
vi.mock('@/lib/firm-profile-service', () => ({ loadFirmBranding }))

import { GET } from './route'

function get() {
  const request = new NextRequest('http://localhost/api/whitespace/studies/study-abc123/report')
  return GET(request, { params: { studyId: 'study-abc123' } })
}

async function textOf(response: Response): Promise<string> {
  const buffer = Buffer.from(await response.arrayBuffer())
  const { value } = await mammoth.extractRawText({ buffer })
  return value
}

describe('Whitespace study report', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getOwnedStudy.mockResolvedValue(STUDY as never)
    readScope.mockImplementation((value: unknown) => value)
    loadFirmBranding.mockResolvedValue(FIRM as never)
    prismaMock.whitespaceCluster.findMany.mockResolvedValue([] as never)
    prismaMock.whitespaceAreaAnalysis.findMany.mockResolvedValue([] as never)
    prismaMock.whitespaceHypothesis.findMany.mockResolvedValue([HYPOTHESIS] as never)
    prismaMock.whitespaceConcept.findMany.mockResolvedValue([] as never)
    prismaMock.whitespaceTrailEntry.findMany.mockResolvedValue([
      { kind: 'NOTE', actor: 'user:user-1', summary: 'Attorney review — ENDORSED', createdAt: new Date('2026-08-07T09:00:00.000Z') },
    ] as never)

    // The capped metadata list feeds diagnostics; results come from a direct
    // latest-COMPLETED findFirst per rendered stage.
    runFindMany.mockResolvedValue([
      {
        id: 'run-1',
        stage: 'DIMENSION_MAP',
        status: 'COMPLETED',
        scopeVersion: 4,
        durationMs: 62_000,
        lastError: null,
        createdAt: new Date('2026-08-05T00:00:00.000Z'),
        completedAt: new Date('2026-08-05T00:01:02.000Z'),
      },
      {
        id: 'run-0',
        stage: 'CLUSTER',
        status: 'FAILED',
        scopeVersion: 4,
        durationMs: null,
        lastError: 'Clustering requires binary embeddings.',
        createdAt: new Date('2026-08-04T00:00:00.000Z'),
        completedAt: null,
      },
    ] as never)
    runFindFirst.mockImplementation(async (args: { where?: { stage?: string } }) =>
      args.where?.stage === 'DIMENSION_MAP'
        ? { stage: 'DIMENSION_MAP', results: DIMENSION_RESULTS, scopeVersion: 4 }
        : null
    )
  })

  it('returns a downloadable Word document named from the study id', async () => {
    const response = await get()

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="Whitespace-Report_abc123_v4.docx"'
    )
  })

  it('carries the firm branding and the study premise', async () => {
    const text = await textOf(await get())

    expect(text).toContain('Kapoor & Rao IP')
    expect(text).toContain('Wearable glucose sensing')
    expect(text).toContain('Continuous glucose monitoring worn on the body.')
    expect(text).toContain('A61B5/1455')
    expect(text).toContain('The corpus begins in 2000.')
    expect(text).toContain('Sensor drift after two weeks')
  })

  it('states what was run, including the failure, before the findings', async () => {
    const text = await textOf(await get())

    expect(text).toContain('What was run')
    expect(text).toContain('Clustering requires binary embeddings.')
    expect(text.indexOf('What was run')).toBeLessThan(text.indexOf('Unoccupied combinations'))
  })

  it('renders the gap with its margins, expectation and near miss', async () => {
    const text = await textOf(await get())

    expect(text).toContain('optical (Sensing modality) × disposable (Housing)')
    expect(text).toContain('114.1')
    expect(text).toContain('reusable')
    expect(text).toMatch(/Round 1/)
    // Rejections are part of the record.
    expect(text).toContain('too few documents matched it')
  })

  it('records an attack that could not run, with its reason', async () => {
    const text = await textOf(await get())

    expect(text).toContain('Could not run — No literature source is configured.')
    expect(text).toMatch(/5 of 6/i)
  })

  it('presents the attorney review as the operative judgment', async () => {
    const text = await textOf(await get())

    expect(text).toContain('Attorney review')
    expect(text).toContain('ENDORSED')
    expect(text).toContain('Worth a provisional filing this quarter.')
    expect(text).toContain('operative judgment')
  })

  it('closes with the limitations and an anonymised trail', async () => {
    const text = await textOf(await get())

    expect(text).toContain('Read this before drawing conclusions')
    expect(text).toContain('This corpus contains Indian publications only.')
    expect(text).toContain('Claim text is unavailable for 40% of this arm.')
    expect(text).toContain('Evidence trail')
    expect(text).not.toContain('user:user-1')
  })

  it('never loads cluster members', async () => {
    await get()
    expect(prismaMock.whitespaceCluster.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { studyId: STUDY.id, depth: 0 } })
    )
    // No `include` — an include is the only way members could be pulled in.
    expect(prismaMock.whitespaceCluster.findMany).toHaveBeenCalledWith(
      expect.not.objectContaining({ include: expect.anything() })
    )
  })

  it('queries the latest COMPLETED run per rendered stage directly, keeping results out of the metadata list', async () => {
    await get()

    // The diagnostics list never loads result payloads.
    for (const call of runFindMany.mock.calls) {
      expect((call[0] as { select?: Record<string, boolean> }).select?.results).toBeUndefined()
    }

    // One direct latest-COMPLETED query per rendered stage.
    const stages = runFindFirst.mock.calls.map(call => (call[0] as { where: { stage: string } }).where.stage)
    expect(stages.sort()).toEqual(['DIMENSION_MAP', 'FIELD_MAP', 'SIGNALS'])
    for (const call of runFindFirst.mock.calls) {
      expect(call[0]).toMatchObject({
        where: expect.objectContaining({ studyId: STUDY.id, status: 'COMPLETED' }),
        orderBy: { createdAt: 'desc' },
      })
    }
  })

  it('still renders a completed stage whose run has aged past the capped metadata list', async () => {
    // The metadata list no longer mentions the DIMENSION_MAP run at all.
    runFindMany.mockResolvedValue([
      {
        id: 'run-9',
        stage: 'CLUSTER',
        status: 'FAILED',
        scopeVersion: 4,
        durationMs: null,
        lastError: 'Clustering requires binary embeddings.',
        createdAt: new Date('2026-08-06T00:00:00.000Z'),
        completedAt: null,
      },
    ] as never)

    const text = await textOf(await get())
    expect(text).toContain('optical (Sensing modality) × disposable (Housing)')
  })

  it('answers an unexpected failure with a generic 500, not the internal message', async () => {
    loadFirmBranding.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.7:5432') as never)
    const response = await get()
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload.error).not.toContain('ECONNREFUSED')
  })

  it('still builds a report when the tenant has no firm profile', async () => {
    loadFirmBranding.mockResolvedValue(null as never)
    const response = await get()

    expect(response.status).toBe(200)
    expect(await textOf(response)).toContain('Whitespace Study Report')
  })

  it('404s a study the caller does not own, without querying anything', async () => {
    getOwnedStudy.mockResolvedValue(null as never)
    const response = await get()

    expect(response.status).toBe(404)
    expect(runFindMany).not.toHaveBeenCalled()
    expect(runFindFirst).not.toHaveBeenCalled()
  })
})
