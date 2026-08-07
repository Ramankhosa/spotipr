import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'fs'
import { buildWhitespaceReportDocx } from '@/lib/whitespace/report-docx'
import { buildWhitespaceReportModel, type WhitespaceReportInput } from '@/lib/whitespace/report-model'

/**
 * Writes a real .docx to disk so the layout can be inspected in Word. Skipped
 * unless DOCX_DUMP_PATH is set — a renderer this typographic cannot be fully
 * judged from extracted text.
 *
 *   DOCX_DUMP_PATH=C:\tmp\ws-report.docx npx vitest run route.dump.test.ts
 */

const OUT = process.env.DOCX_DUMP_PATH

describe.skipIf(!OUT)('Whitespace report visual dump', () => {
  it('writes a fully-populated report', async () => {
    const generatedAt = new Date('2026-08-07T10:00:00.000Z')

    const input: WhitespaceReportInput = {
      study: {
        id: 'study-dump01',
        title: 'Continuous glucose monitoring — wearable optical sensing',
        kind: 'INVENTION',
        scopeVersion: 4,
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        inventionJson: {
          problem: 'Optical glucose sensors drift after roughly two weeks of continuous wear, which forces either a recalibration the patient must perform or an early replacement of the sensor.',
          approach: 'A reference channel measured against a sealed calibration cell inside the disposable housing, so drift is corrected without any patient action.',
          constraints: 'Must run for fourteen days on a single coin cell, and the housing must be manufacturable at single-use cost.',
        },
      },
      scope: {
        title: 'Wearable glucose sensing',
        summary:
          'Continuous glucose monitoring worn on the body, covering optical and electrochemical sensing, the housings that carry them, and the calibration schemes that keep them accurate over a wear period.',
        concepts: [
          { id: 'c1', label: 'glucose sensing', synonyms: ['analyte detection', 'blood sugar measurement'], required: true, origin: 'copilot' },
          { id: 'c2', label: 'wearable form factor', synonyms: ['on-body', 'patch', 'skin-mounted'], required: false, origin: 'user' },
          { id: 'c3', label: 'calibration', synonyms: ['drift correction', 'reference channel'], required: false, origin: 'copilot' },
        ],
        classifications: [
          { code: 'A61B5/1455', definition: 'Measuring characteristics of blood by optical means', accepted: true, origin: 'copilot' },
          { code: 'G01N21/49', definition: 'Scattering measurement, which may drag in unrelated turbidity sensing', caution: 'This class covers industrial turbidity sensing as well as medical use.', accepted: true, origin: 'copilot' },
        ],
        exclusions: [{ term: 'implantable', reason: 'Out of scope — the invention is worn, not implanted.', origin: 'user' }],
        assumptions: [
          { id: 'a1', text: 'You meant sensors worn on the skin, not implanted or ingested devices.', kind: 'interpretation' },
          { id: 'a2', text: 'The corpus begins at the year 2000; earlier art is not visible to this study.', kind: 'corpus' },
          { id: 'a3', text: 'Claim text is stored for only part of the corpus, and coverage varies sharply by jurisdiction.', kind: 'corpus' },
        ],
        filters: { yearFrom: 2000, yearTo: 2026, jurisdictions: ['IN'], assignees: [] },
      },
      preparedBy: 'attorney@firm.test',
      firm: {
        firmName: 'Kapoor & Rao Intellectual Property',
        tagline: 'Patent counsel · Bengaluru',
        addressLine1: '4 Residency Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560025',
        countryCode: 'IN',
        phone: '+91 80 1234 5678',
        email: 'mail@kapoorrao.test',
        website: 'kapoorrao.test',
        accentColor: '#1D4ED8',
        showPoweredBy: true,
      },
      runs: [
        { id: 'r3', stage: 'DIMENSION_MAP', status: 'COMPLETED', scopeVersion: 4, durationMs: 184_000, lastError: null, createdAt: new Date('2026-08-05T09:00:00Z'), completedAt: new Date('2026-08-05T09:03:04Z') },
        { id: 'r2', stage: 'VALIDATE', status: 'COMPLETED', scopeVersion: 4, durationMs: 42_000, lastError: null, createdAt: new Date('2026-08-06T09:00:00Z'), completedAt: new Date('2026-08-06T09:00:42Z') },
        { id: 'r1', stage: 'DIMENSION_MAP', status: 'FAILED', scopeVersion: 3, durationMs: null, lastError: 'The scope matched 412 families, below the 500 needed to read viewpoints from the field.', createdAt: new Date('2026-08-03T09:00:00Z'), completedAt: null },
      ],
      stageResults: {
        dimensionMap: {
          scopeVersion: 4,
          results: {
            familyCount: 1840,
            publicationCount: 4102,
            sample: { families: 1840, weight: 1, method: 'md5-family-key' },
            registry: [
              {
                id: 'd1',
                label: 'Sensing modality',
                description: 'How the measurement is physically taken',
                values: [
                  { id: 'v1', label: 'optical', synonyms: ['photometric', 'spectroscopic'], query: 'optical', families: 700, share: 0.38, sampleFamilies: 700, round: 1, provenance: 'seed' },
                  { id: 'v2', label: 'electrochemical', synonyms: ['enzymatic', 'amperometric'], query: 'electrochemical', families: 900, share: 0.49, sampleFamilies: 900, round: 1, provenance: 'seed' },
                  { id: 'v3', label: 'thermal', synonyms: ['calorimetric'], query: 'thermal', families: 120, share: 0.07, sampleFamilies: 120, round: 2, provenance: 'grow' },
                ],
                introducedInRound: 1,
                assignedFamilies: 1500,
                residualFamilies: 340,
                residualShare: 0.18,
                multiAssignmentRatio: 1.15,
                sampleAssignedFamilies: 1500,
                sampleResidualShare: 0.18,
              },
              {
                id: 'd2',
                label: 'Housing lifecycle',
                description: 'Whether the worn part is reused or discarded',
                values: [
                  { id: 'v4', label: 'reusable', synonyms: ['rechargeable', 'multi-use'], query: 'reusable', families: 640, share: 0.35, sampleFamilies: 640, round: 1, provenance: 'seed' },
                  { id: 'v5', label: 'disposable', synonyms: ['single-use', 'discardable'], query: 'disposable', families: 300, share: 0.16, sampleFamilies: 300, round: 1, provenance: 'seed' },
                ],
                introducedInRound: 1,
                assignedFamilies: 880,
                residualFamilies: 960,
                residualShare: 0.52,
                multiAssignmentRatio: 1.07,
                sampleAssignedFamilies: 880,
                sampleResidualShare: 0.52,
              },
            ],
            rounds: [
              {
                round: 1,
                slice: { families: 1840, basis: 'sample' },
                proposedDimensions: ['Sensing modality', 'Housing lifecycle', 'Patient age group'],
                proposedValues: [],
                acceptedDimensions: ['Sensing modality', 'Housing lifecycle'],
                acceptedValues: [],
                rejected: [
                  { kind: 'dimension', label: 'Patient age group', reason: 'BELOW_SAMPLE_FLOOR', detail: '18 of 1,840 families mention an age group at all' },
                ],
                residualShareAfter: 0.31,
                modelCode: 'dump-model',
              },
              {
                round: 2,
                slice: { families: 570, basis: 'residual' },
                proposedDimensions: ['Measurement site'],
                proposedValues: [{ dimension: 'Sensing modality', value: 'thermal' }],
                acceptedDimensions: [],
                acceptedValues: [{ dimension: 'Sensing modality', value: 'thermal' }],
                rejected: [
                  { kind: 'dimension', label: 'Measurement site', reason: 'DIMENSION_RESTATES_EXISTING', detail: 'redundancy 0.71 against Sensing modality' },
                ],
                residualShareAfter: 0.18,
                modelCode: 'dump-model',
              },
            ],
            settled: true,
            settledReason: 'RESIDUAL_UNDER_FLOOR',
            matrices: [
              { aDimensionId: 'd1', bDimensionId: 'd2', redundancy: 0.12, harvested: true, skipReason: null, cells: [] },
            ],
            gaps: [
              {
                id: 'g1', aDimensionId: 'd1', aDimensionLabel: 'Sensing modality', aValueId: 'v1', aValueLabel: 'optical',
                bDimensionId: 'd2', bDimensionLabel: 'Housing lifecycle', bValueId: 'v5', bValueLabel: 'disposable',
                observed: 0, marginA: 700, marginB: 300, expected: 114.1, z: -10.7, rarity: 1, surprisal: 49.6,
                nearMissB: { valueId: 'v4', valueLabel: 'reusable', families: 210 },
                nearMissA: { valueId: 'v2', valueLabel: 'electrochemical', families: 264 },
                unassignedOnB: 430, unassignedOnA: 96, armFamilies: 700, armClaimsReadable: 420,
                coverageSuspect: false, suspectReason: null, rank: 0.81, hypothesisId: 'h1',
              },
              {
                id: 'g2', aDimensionId: 'd1', aDimensionLabel: 'Sensing modality', aValueId: 'v3', aValueLabel: 'thermal',
                bDimensionId: 'd2', bDimensionLabel: 'Housing lifecycle', bValueId: 'v5', bValueLabel: 'disposable',
                observed: 1, marginA: 120, marginB: 300, expected: 19.6, z: -4.2, rarity: 1, surprisal: 7.1,
                nearMissB: { valueId: 'v4', valueLabel: 'reusable', families: 38 },
                nearMissA: null,
                unassignedOnB: 61, unassignedOnA: 240, armFamilies: 120, armClaimsReadable: 31,
                coverageSuspect: true,
                suspectReason: 'Only 26% of the thermal arm has readable claims, so the emptiness may be a reading limit rather than a technology gap.',
                rank: 0.34, hypothesisId: null,
              },
            ],
            thresholds: { marginFloor: 30, expectedFloor: 5, residualCeiling: 0.2, redundancyCeiling: 0.6 },
            unclassifiedFamilies: 340,
            unclassifiedShare: 0.18,
            coverageNotes: ['Applicant names are matched by substring, so corporate groups may be split across spellings.'],
            limitations: [
              'This corpus contains Indian publications only; art filed elsewhere and never filed in India is invisible to this study.',
              'No legal status was consulted. Nothing here supports a freedom-to-operate conclusion.',
            ],
            generatedAt: '2026-08-05T09:03:04.000Z',
          },
        },
      },
      clusters: [],
      areas: [],
      hypotheses: [
        {
          id: 'h1', clusterId: null, type: 'PATENT_WHITESPACE',
          statement: 'Optical glucose sensing combined with a fully disposable housing appears absent from the field.',
          rationale: 'Optical sensing occupies 700 families and disposable housings 300, yet the two never co-occur where 114 co-occurrences were expected. The nearest neighbours pair optical sensing with reusable housings (210 families) and disposable housings with electrochemical sensing (264 families), so both halves are individually well established.',
          status: 'VALIDATED',
          elementCombination: { elements: ['optical sensing', 'disposable housing', 'sealed calibration reference'] },
          scores: { density: 0.62, rarity: 0.94, semanticNovelty: null, evidenceQuality: 0.58, confidence: 0.51, crowdedness: 0.44, strength: null },
          validation: {
            attacks: [
              { strategy: 'SYNONYM_SHIFTED', query: 'single-use analyte patch photometric', hits: 2, outcome: 'WEAKENING' },
              { strategy: 'SEMANTIC_PARAPHRASE', query: 'discardable optical biosensor worn on skin', hits: 0, outcome: 'CLEAN' },
              { strategy: 'CPC_ADJACENT', query: 'A61B5/1495', hits: 4, outcome: 'WEAKENING' },
              { strategy: 'ASSIGNEE_PIVOT', query: 'Abbott OR Dexcom OR Medtronic', hits: 1, outcome: 'CLEAN' },
              { strategy: 'RED_TEAM', query: 'optical sensor cartridge replaced with electronics retained', hits: 3, outcome: 'WEAKENING' },
              { strategy: 'LITERATURE', query: '', hits: 0, outcome: 'NOT_RUN', reason: 'No scholarly literature source is configured for this deployment.' },
            ],
            gates: [
              { gate: 'G1_DATA', outcome: 'PASSED', basis: '60% of the optical arm has readable claim text, above the 40% floor.', measured: 0.6 },
              { gate: 'G2_TERMINOLOGY', outcome: 'PASSED_WITH_WEAKENING', basis: 'Two attacks in other vocabulary returned partial matches.' },
              { gate: 'G3_ADJACENT_CLAIMS', outcome: 'PASSED', basis: 'No adjacent-class document recites the full combination.' },
              { gate: 'G4_FEASIBILITY', outcome: 'UNASSESSED', basis: 'No literature was searched, so technical feasibility could not be tested.' },
              { gate: 'G5_COMMERCIAL', outcome: 'ADVISORY', basis: 'Single-use optics may not reach a disposable cost point.' },
              { gate: 'G6_REGULATORY', outcome: 'ADVISORY', basis: 'Class II device pathway assumed but not verified.' },
            ],
            attacksPlanned: 6, attacksRun: 5,
            redTeamNotes: 'The strongest unrun attack would look for cartridge architectures where only the optical path is discarded.',
            validatedAt: '2026-08-06T09:00:42.000Z',
          },
          coverageLimitations: [
            'Claim text is unavailable for 40% of the optical arm, so a claim reciting this combination could exist unread.',
            'Technical feasibility was never assessed — no literature source ran.',
          ],
          humanReview: {
            verdict: 'ENDORSED',
            note: 'Consistent with what I see in prosecution: the disposable-optics cost problem is real but the client already manufactures the moulded housing, so the economics are different for them than for the field. Worth a provisional this quarter, drafted around the sealed reference cell rather than the optics generally.',
            reviewedById: 'user-1',
            reviewedAt: '2026-08-07T09:00:00.000Z',
          },
          createdAt: new Date('2026-08-06T09:00:00Z'),
          evidence: [
            { kind: 'STATISTIC', stance: 'CONTEXT', refId: null, passage: 'Observed 0 where 114.1 were expected; surprisal 49.6 decibans.', queryText: null },
            { kind: 'PATENT_PASSAGE', stance: 'CONTRADICTORY', refId: 'IN201847012345', passage: 'A single-use sensor assembly wherein the electrochemical element is discarded with the adhesive patch while the transmitter is retained.', queryText: null },
          ],
        },
        {
          id: 'h2', clusterId: null, type: 'DATA_WHITESPACE',
          statement: 'Thermal glucose sensing in a disposable housing appears absent.',
          rationale: 'The cell is empty against an expectation of 19.6, but only a quarter of the thermal arm can be read at claim level.',
          status: 'INCONCLUSIVE',
          elementCombination: { elements: ['thermal sensing', 'disposable housing'] },
          scores: { density: 0.21, rarity: 0.88, semanticNovelty: null, evidenceQuality: 0.24, confidence: 0.19, crowdedness: 0.12, strength: null },
          validation: {
            attacks: [{ strategy: 'SYNONYM_SHIFTED', query: 'calorimetric single-use glucose', hits: 0, outcome: 'CLEAN' }],
            gates: [{ gate: 'G1_DATA', outcome: 'FAILED', basis: 'Only 26% of the arm has readable claims, below the 40% floor.', measured: 0.26 }],
            attacksPlanned: 6, attacksRun: 1,
            redTeamNotes: null,
            validatedAt: '2026-08-06T09:10:00.000Z',
          },
          coverageLimitations: ['Most of this arm cannot be read at claim level, so absence here is a reading limit.'],
          humanReview: {
            verdict: 'REJECTED',
            note: 'Not pursuing. The data gap is the whole finding here — we would be filing against our own blind spot rather than against the art.',
            reviewedById: 'user-1',
            reviewedAt: '2026-08-07T09:05:00.000Z',
          },
          createdAt: new Date('2026-08-06T09:10:00Z'),
          evidence: [],
        },
      ],
      concepts: [
        {
          id: 'k1', hypothesisId: 'h1',
          title: 'Disposable optical sensing with a sealed calibration reference',
          summary: 'A worn optical glucose sensor whose entire optical path is discarded with the adhesive patch, using a sealed reference cell inside the disposable body to correct drift without patient calibration.',
          status: 'DRAFT',
          features: {
            inventionFeatures: ['optical sensing element', 'fully disposable housing', 'sealed calibration reference cell', 'drift correction without patient action'],
            openQuestions: ['Does the sealed reference survive fourteen days of body-temperature cycling?', 'Is a moulded optical path manufacturable at single-use cost?'],
            differentiation: [{ against: 'IN201847012345', how: 'That assembly discards only the electrochemical element and retains the transmitter; here the optical path itself is discarded.' }],
          },
        },
      ],
      trail: [
        { kind: 'NOTE', actor: 'user:user-1', summary: 'Attorney review — REJECTED: "Thermal glucose sensing in a disposable housing…"', createdAt: new Date('2026-08-07T09:05:00Z') },
        { kind: 'NOTE', actor: 'user:user-1', summary: 'Attorney review — ENDORSED: "Optical glucose sensing combined with a fully…"', createdAt: new Date('2026-08-07T09:00:00Z') },
        { kind: 'HYPOTHESIS', actor: 'user:user-1', summary: 'Promoted to concept: Disposable optical sensing with a sealed calibration reference', createdAt: new Date('2026-08-06T10:00:00Z') },
        { kind: 'RUN', actor: 'model:dump-model', summary: 'DIMENSION_MAP completed — 2 viewpoints, 2 gaps', createdAt: new Date('2026-08-05T09:03:04Z') },
        { kind: 'SCOPE', actor: 'user:user-1', summary: 'Scope edited — glucose sensing marked required', createdAt: new Date('2026-08-04T12:00:00Z') },
        { kind: 'SYSTEM', actor: 'system', summary: 'Run requeued after a worker restart', createdAt: new Date('2026-08-03T09:05:00Z') },
      ],
      generatedAt,
      trailTruncated: false,
    }

    const buffer = await buildWhitespaceReportDocx(buildWhitespaceReportModel(input))
    writeFileSync(OUT!, buffer)
    expect(buffer.length).toBeGreaterThan(5_000)
  }, 120_000)
})
