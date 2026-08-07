import { describe, expect, it } from 'vitest'
import { buildWhitespaceReportModel, type WhitespaceReportInput } from '../report-model'
import { emptyWhitespaceScope, type WhitespaceScope } from '../types'

const GENERATED_AT = new Date('2026-08-07T10:00:00.000Z')

function scope(overrides: Partial<WhitespaceScope> = {}): WhitespaceScope {
  return { ...emptyWhitespaceScope(), summary: 'A field.', ...overrides }
}

function input(overrides: Partial<WhitespaceReportInput> = {}): WhitespaceReportInput {
  return {
    study: {
      id: 'study-1',
      title: 'Wearable glucose sensing',
      kind: 'FIELD',
      scopeVersion: 3,
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      inventionJson: null,
    },
    scope: scope(),
    preparedBy: 'attorney@firm.test',
    firm: null,
    runs: [],
    stageResults: {},
    clusters: [],
    areas: [],
    hypotheses: [],
    concepts: [],
    trail: [],
    generatedAt: GENERATED_AT,
    ...overrides,
  }
}

describe('buildWhitespaceReportModel', () => {
  it('builds a usable model for a study with nothing run yet', () => {
    const model = buildWhitespaceReportModel(input())

    expect(model.meta.title).toBe('Wearable glucose sensing')
    expect(model.meta.generatedOn).toBe('2026-08-07')
    expect(model.fieldMap).toBeNull()
    expect(model.dimensionMap).toBeNull()
    expect(model.invention).toBeNull()
    expect(model.runDiagnostics).toEqual([])
    expect(model.limitations).toEqual([])
  })

  it('omits the dimension section for a field study and the field section for an invention study', () => {
    const fieldModel = buildWhitespaceReportModel(
      input({
        stageResults: {
          fieldMap: {
            scopeVersion: 3,
            results: {
              familyCount: 1200,
              publicationCount: 3400,
              filingsByYear: [{ year: 2020, families: 100 }],
              publicationLagMonths: 18,
              jurisdictions: [],
              classifications: [],
              assignees: [],
              statusProxy: { granted: 400, pending: 500, unknown: 300 },
              textCoverage: { familiesTotal: 1200, withClaims: 600, withDescription: 500, byJurisdiction: [] },
              gateCounts: { corpus: null, afterFilters: null, afterConcepts: 3400, families: 1200 },
              coverageNotes: ['Claims are absent for most IN publications.'],
              generatedAt: '2026-08-01T00:00:00.000Z',
            },
          },
        },
      })
    )
    expect(fieldModel.fieldMap?.familyCount).toBe(1200)
    expect(fieldModel.dimensionMap).toBeNull()

    const inventionModel = buildWhitespaceReportModel(
      input({
        study: {
          id: 'study-2',
          title: 'My invention',
          kind: 'INVENTION',
          scopeVersion: 1,
          createdAt: GENERATED_AT,
          inventionJson: { problem: 'Drift', approach: 'Recalibrate', constraints: 'Battery' },
        },
        stageResults: {
          dimensionMap: {
            scopeVersion: 1,
            results: {
              familyCount: 900,
              publicationCount: 2000,
              sample: { families: 900, weight: 1, method: 'md5-family-key' },
              registry: [],
              rounds: [],
              settled: true,
              settledReason: 'RESIDUAL_UNDER_FLOOR',
              matrices: [],
              gaps: [],
              thresholds: { marginFloor: 30, expectedFloor: 5, residualCeiling: 0.2, redundancyCeiling: 0.6 },
              unclassifiedFamilies: 10,
              unclassifiedShare: 0.01,
              coverageNotes: [],
              limitations: ['Indian corpus only.'],
              generatedAt: '2026-08-01T00:00:00.000Z',
            },
          },
        },
      })
    )
    expect(inventionModel.fieldMap).toBeNull()
    expect(inventionModel.dimensionMap?.familyCount).toBe(900)
    expect(inventionModel.invention?.problem).toBe('Drift')
    expect(inventionModel.limitations).toContain('Indian corpus only.')
  })

  it('ranks rare pairs by surprisal, not by the saturating rarity', () => {
    const model = buildWhitespaceReportModel(
      input({
        clusters: [
          {
            id: 'c1',
            label: 'Optical sensing',
            description: null,
            keywords: [],
            memberCount: 40,
            fieldEstimate: 400,
            cohesion: null,
            separation: null,
            silhouette: null,
            metrics: null,
          },
        ],
        areas: [
          {
            clusterId: 'c1',
            status: 'COMPLETED',
            textCoverage: {},
            results: {
              familiesConsidered: 60,
              familiesWithClaims: 50,
              familiesExtracted: 48,
              elementSupport: [],
              // Both saturate rarity at 1.0; only surprisal separates them.
              rarePairs: [
                { a: 'weak', b: 'pair', supportA: 8, supportB: 8, observed: 0, expected: 6, z: -3, rarity: 1, surprisal: 2.6 },
                { a: 'strong', b: 'pair', supportA: 90, supportB: 90, observed: 0, expected: 500, z: -9, rarity: 1, surprisal: 217 },
              ],
              problemSolution: [],
              coverageNotes: [],
            },
          },
        ],
      })
    )

    const pairs = model.areas[0].deepDive!.rarePairs
    expect(pairs.map(pair => pair.a)).toEqual(['strong', 'weak'])
  })

  it('ranks gaps by their stored deterministic rank', () => {
    const gap = (id: string, rank: number) => ({
      id,
      aDimensionId: 'd1',
      aDimensionLabel: 'Stage',
      aValueId: `${id}-a`,
      aValueLabel: 'Early',
      bDimensionId: 'd2',
      bDimensionLabel: 'Failure',
      bValueId: `${id}-b`,
      bValueLabel: 'Drift',
      observed: 0,
      marginA: 100,
      marginB: 100,
      expected: 12,
      z: -3.4,
      rarity: 1,
      surprisal: 5.2,
      nearMissB: null,
      nearMissA: null,
      unassignedOnB: 0,
      unassignedOnA: 0,
      armFamilies: null,
      armClaimsReadable: null,
      coverageSuspect: false,
      suspectReason: null,
      rank,
      hypothesisId: null,
    })

    const model = buildWhitespaceReportModel(
      input({
        stageResults: {
          dimensionMap: {
            scopeVersion: 3,
            results: {
              familyCount: 900,
              publicationCount: 2000,
              sample: { families: 900, weight: 1, method: 'md5-family-key' },
              registry: [],
              rounds: [],
              settled: true,
              settledReason: 'RESIDUAL_UNDER_FLOOR',
              matrices: [],
              gaps: [gap('low', 0.2), gap('high', 0.9)],
              thresholds: { marginFloor: 30, expectedFloor: 5, residualCeiling: 0.2, redundancyCeiling: 0.6 },
              unclassifiedFamilies: 0,
              unclassifiedShare: 0,
              coverageNotes: [],
              limitations: [],
              generatedAt: '2026-08-01T00:00:00.000Z',
            },
          },
        },
      })
    )

    expect(model.dimensionMap!.gaps.map(g => g.rank)).toEqual([0.9, 0.2])
  })

  it('marks a run computed against a superseded scope as stale', () => {
    const model = buildWhitespaceReportModel(
      input({
        runs: [
          {
            id: 'run-1',
            stage: 'DIMENSION_MAP',
            status: 'COMPLETED',
            scopeVersion: 2,
            durationMs: 4200,
            lastError: null,
            createdAt: new Date('2026-08-01T00:00:00.000Z'),
            completedAt: new Date('2026-08-01T00:01:00.000Z'),
          },
          {
            id: 'run-2',
            stage: 'FIELD_MAP',
            status: 'COMPLETED',
            scopeVersion: 3,
            durationMs: 900,
            lastError: null,
            createdAt: new Date('2026-08-02T00:00:00.000Z'),
            completedAt: new Date('2026-08-02T00:00:30.000Z'),
          },
        ],
      })
    )

    expect(model.runDiagnostics[0].stale).toBe(true)
    expect(model.runDiagnostics[1].stale).toBe(false)
  })

  it('keeps failed runs in the diagnostics with their error', () => {
    const model = buildWhitespaceReportModel(
      input({
        runs: [
          {
            id: 'run-1',
            stage: 'CLUSTER',
            status: 'FAILED',
            scopeVersion: 3,
            durationMs: null,
            lastError: 'Clustering requires binary embeddings.',
            createdAt: new Date('2026-08-01T00:00:00.000Z'),
            completedAt: null,
          },
        ],
      })
    )

    expect(model.runDiagnostics[0]).toMatchObject({
      status: 'FAILED',
      error: 'Clustering requires binary embeddings.',
    })
  })

  it('deduplicates limitations gathered from every stage', () => {
    const shared = 'Claims are unavailable for most Indian publications.'
    const model = buildWhitespaceReportModel(
      input({
        stageResults: {
          fieldMap: {
            scopeVersion: 3,
            results: {
              familyCount: 10,
              publicationCount: 10,
              filingsByYear: [],
              publicationLagMonths: 18,
              jurisdictions: [],
              classifications: [],
              assignees: [],
              statusProxy: { granted: 0, pending: 0, unknown: 0 },
              textCoverage: { familiesTotal: 10, withClaims: 1, withDescription: 1, byJurisdiction: [] },
              gateCounts: { corpus: null, afterFilters: null, afterConcepts: 10, families: 10 },
              coverageNotes: [shared],
              generatedAt: '2026-08-01T00:00:00.000Z',
            },
          },
        },
        hypotheses: [hypothesis({ coverageLimitations: [shared, 'Another caveat.'] })],
      })
    )

    expect(model.limitations.filter(line => line === shared)).toHaveLength(1)
    expect(model.limitations).toContain('Another caveat.')
  })

  it('renders an attorney review as its own block and counts reviewed hypotheses', () => {
    const model = buildWhitespaceReportModel(
      input({
        hypotheses: [
          hypothesis({
            humanReview: {
              verdict: 'ENDORSED',
              note: 'Worth a provisional filing this quarter.',
              reviewedById: 'user-1',
              reviewedAt: '2026-08-06T09:00:00.000Z',
            },
          }),
          hypothesis({ id: 'hyp-2' }),
        ],
      })
    )

    expect(model.reviewedCount).toBe(1)
    expect(model.hypotheses[0].review).toMatchObject({
      verdictLabel: 'Endorsed',
      note: 'Worth a provisional filing this quarter.',
      reviewedOn: '2026-08-06',
    })
    // The reviewer id is never carried into the document.
    expect(JSON.stringify(model.hypotheses[0].review)).not.toContain('user-1')
    expect(model.hypotheses[1].review).toBeNull()
  })

  it('treats a malformed review as unreviewed rather than throwing', () => {
    const model = buildWhitespaceReportModel(
      input({ hypotheses: [hypothesis({ humanReview: { verdict: 'BANANA' } })] })
    )
    expect(model.hypotheses[0].review).toBeNull()
  })

  it('keeps every score separate and never averages them', () => {
    const model = buildWhitespaceReportModel(
      input({
        hypotheses: [
          hypothesis({
            scores: {
              density: 0.4,
              rarity: 0.9,
              semanticNovelty: null,
              evidenceQuality: 0.5,
              confidence: 0.6,
              crowdedness: 0.3,
              strength: null,
            },
          }),
        ],
      })
    )

    const line = model.hypotheses[0].scoreLine
    expect(line).toHaveLength(6)
    expect(line.find(score => score.label === 'Novelty')?.value).toBe('—')
    expect(line.find(score => score.label === 'Rarity')?.value).toBe('0.90')
  })

  it('preserves attacks that did not run, with their reason', () => {
    const model = buildWhitespaceReportModel(
      input({
        hypotheses: [
          hypothesis({
            validation: {
              attacks: [
                { strategy: 'LITERATURE', query: '', hits: 0, outcome: 'NOT_RUN', reason: 'No literature source is configured.' },
                { strategy: 'CPC_ADJACENT', query: 'A61B5/1455', hits: 3, outcome: 'WEAKENING' },
              ],
              gates: [{ gate: 'G1_DATA', outcome: 'PASSED', basis: '61% of the arm is claim-readable.' }],
              attacksPlanned: 5,
              attacksRun: 4,
              redTeamNotes: null,
              validatedAt: '2026-08-05T00:00:00.000Z',
            },
          }),
        ],
      })
    )

    const attacks = model.hypotheses[0].attacks
    expect(attacks[0]).toMatchObject({ notRun: true, reason: 'No literature source is configured.' })
    expect(attacks[1].notRun).toBe(false)
    expect(model.hypotheses[0].attacksRun).toBe(4)
    expect(model.hypotheses[0].gates[0].label).toBe('Data coverage')
  })

  it('anonymises trail actors the same way the trail API does', () => {
    const model = buildWhitespaceReportModel(
      input({
        trail: [
          { kind: 'NOTE', actor: 'user:abc123', summary: 'Attorney review — ENDORSED', createdAt: GENERATED_AT },
          { kind: 'RUN', actor: 'model:gpt-x', summary: 'Scope compiled', createdAt: GENERATED_AT },
          { kind: 'SYSTEM', actor: 'system', summary: 'Run requeued', createdAt: GENERATED_AT },
        ],
      })
    )

    expect(model.trail.map(entry => entry.actor)).toEqual(['you', 'gpt-x', 'system'])
    expect(JSON.stringify(model.trail)).not.toContain('abc123')
  })

  it('warns when more than one concept is required', () => {
    const model = buildWhitespaceReportModel(
      input({
        scope: scope({
          concepts: [
            { id: '1', label: 'glucose', synonyms: [], required: true, origin: 'copilot' },
            { id: '2', label: 'wearable', synonyms: [], required: true, origin: 'user' },
          ],
        }),
      })
    )

    expect(model.scope.intersectionWarning).toMatch(/glucose, wearable/)
  })

  it('lists only the funnel steps that were measured', () => {
    const model = buildWhitespaceReportModel(
      input({
        stageResults: {
          fieldMap: {
            scopeVersion: 3,
            results: {
              familyCount: 66,
              publicationCount: 66,
              filingsByYear: [],
              publicationLagMonths: 18,
              jurisdictions: [],
              classifications: [],
              assignees: [],
              statusProxy: { granted: 0, pending: 0, unknown: 0 },
              textCoverage: { familiesTotal: 66, withClaims: 40, withDescription: 20, byJurisdiction: [] },
              gateCounts: { corpus: null, afterFilters: null, afterConcepts: 66, families: 66 },
              coverageNotes: [],
              generatedAt: '2026-08-01T00:00:00.000Z',
            },
          },
        },
      })
    )

    expect(model.fieldMap!.funnel.map(step => step.label)).toEqual(['Matching the concepts', 'Distinct families'])
  })
})

function hypothesis(overrides: Record<string, unknown> = {}) {
  return {
    id: 'hyp-1',
    clusterId: null,
    type: 'PATENT_WHITESPACE',
    statement: 'Optical sensing combined with disposable housings appears absent.',
    rationale: 'Both elements are common; the pair is not observed.',
    status: 'VALIDATED',
    elementCombination: { elements: ['optical sensing', 'disposable housing'] },
    scores: {
      density: 0.5,
      rarity: 0.8,
      semanticNovelty: 0.4,
      evidenceQuality: 0.6,
      confidence: 0.55,
      crowdedness: 0.3,
      strength: 0.2,
    },
    validation: null,
    coverageLimitations: [],
    humanReview: null,
    createdAt: GENERATED_AT,
    evidence: [],
    ...overrides,
  } as never
}
