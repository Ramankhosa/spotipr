/* Throwaway whitespace study fixture for browser verification. Tagged CLAUDEVERIFY for cleanup. */
require('dotenv').config()
const jwt = require('jsonwebtoken')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const TAG = 'CLAUDEVERIFY-WS-REPORT'

async function main() {
  const user = await prisma.user.findFirst({ where: { email: 'claude-verify@local.test' } })
  if (!user) throw new Error('claude-verify@local.test not found')

  const token = jwt.sign(
    {
      sub: user.id,
      email: user.email,
      tenant_id: user.tenantId,
      roles: user.roles || ['USER'],
      ati_id: null,
      tenant_ati_id: null,
      scope: 'platform',
    },
    process.env.JWT_SECRET,
    { expiresIn: '2h' }
  )

  const scope = {
    title: `${TAG} Wearable glucose sensing`,
    summary: 'Continuous glucose monitoring worn on the body, covering optical and electrochemical sensing.',
    concepts: [
      { id: 'c1', label: 'glucose sensing', synonyms: ['analyte detection'], required: true, origin: 'copilot' },
      { id: 'c2', label: 'wearable', synonyms: ['on-body', 'patch'], required: false, origin: 'user' },
    ],
    classifications: [{ code: 'A61B5/1455', definition: 'Optical measurement of blood characteristics', accepted: true, origin: 'copilot' }],
    exclusions: [{ term: 'implantable', reason: 'Worn, not implanted.', origin: 'user' }],
    assumptions: [
      { id: 'a1', text: 'You meant skin-worn sensors, not implants.', kind: 'interpretation' },
      { id: 'a2', text: 'The corpus begins at the year 2000.', kind: 'corpus' },
    ],
    filters: { yearFrom: 2000, yearTo: 2026, jurisdictions: ['IN'], assignees: [] },
  }

  const study = await prisma.whitespaceStudy.create({
    data: {
      userId: user.id,
      tenantId: user.tenantId,
      title: `${TAG} Wearable glucose sensing`,
      kind: 'INVENTION',
      scope,
      scopeVersion: 2,
      inventionJson: {
        problem: 'Optical glucose sensors drift after two weeks of wear.',
        approach: 'A sealed reference cell inside the disposable housing corrects drift.',
        constraints: 'Fourteen days on a coin cell; single-use cost.',
      },
    },
  })

  const dimensionResults = {
    familyCount: 1840,
    publicationCount: 4102,
    sample: { families: 1840, weight: 1, method: 'md5-family-key' },
    registry: [
      {
        id: 'd1', label: 'Sensing modality', description: 'How the measurement is taken',
        values: [
          { id: 'v1', label: 'optical', synonyms: ['photometric'], query: 'optical', families: 700, share: 0.38, sampleFamilies: 700, round: 1, provenance: 'seed' },
          { id: 'v2', label: 'electrochemical', synonyms: ['enzymatic'], query: 'electrochemical', families: 900, share: 0.49, sampleFamilies: 900, round: 1, provenance: 'seed' },
        ],
        introducedInRound: 1, assignedFamilies: 1500, residualFamilies: 340, residualShare: 0.18,
        multiAssignmentRatio: 1.07, sampleAssignedFamilies: 1500, sampleResidualShare: 0.18,
      },
      {
        id: 'd2', label: 'Housing lifecycle', description: 'Whether the worn part is reused or discarded',
        values: [
          { id: 'v4', label: 'reusable', synonyms: ['multi-use'], query: 'reusable', families: 640, share: 0.35, sampleFamilies: 640, round: 1, provenance: 'seed' },
          { id: 'v5', label: 'disposable', synonyms: ['single-use'], query: 'disposable', families: 300, share: 0.16, sampleFamilies: 300, round: 1, provenance: 'seed' },
        ],
        introducedInRound: 1, assignedFamilies: 880, residualFamilies: 960, residualShare: 0.52,
        multiAssignmentRatio: 1.07, sampleAssignedFamilies: 880, sampleResidualShare: 0.52,
      },
    ],
    rounds: [{
      round: 1, slice: { families: 1840, basis: 'sample' },
      proposedDimensions: ['Sensing modality', 'Housing lifecycle', 'Patient age group'],
      proposedValues: [],
      acceptedDimensions: ['Sensing modality', 'Housing lifecycle'], acceptedValues: [],
      rejected: [{ kind: 'dimension', label: 'Patient age group', reason: 'BELOW_SAMPLE_FLOOR', detail: '18 of 1,840 families' }],
      residualShareAfter: 0.18, modelCode: 'fixture',
    }],
    settled: true, settledReason: 'RESIDUAL_UNDER_FLOOR',
    matrices: [{ aDimensionId: 'd1', bDimensionId: 'd2', redundancy: 0.12, harvested: true, skipReason: null, cells: [{ aValueId: 'v1', bValueId: 'v4', observed: 210 }] }],
    gaps: [{
      id: 'g1', aDimensionId: 'd1', aDimensionLabel: 'Sensing modality', aValueId: 'v1', aValueLabel: 'optical',
      bDimensionId: 'd2', bDimensionLabel: 'Housing lifecycle', bValueId: 'v5', bValueLabel: 'disposable',
      observed: 0, marginA: 700, marginB: 300, expected: 114.1, z: -10.7, rarity: 1, surprisal: 49.6,
      nearMissB: { valueId: 'v4', valueLabel: 'reusable', families: 210 }, nearMissA: null,
      unassignedOnB: 430, unassignedOnA: 96, armFamilies: 700, armClaimsReadable: 420,
      coverageSuspect: false, suspectReason: null, rank: 0.81, hypothesisId: null,
    }],
    thresholds: { marginFloor: 30, expectedFloor: 5, residualCeiling: 0.2, redundancyCeiling: 0.6 },
    unclassifiedFamilies: 340, unclassifiedShare: 0.18,
    coverageNotes: ['Applicant names are matched by substring.'],
    limitations: ['This corpus contains Indian publications only.'],
    generatedAt: new Date().toISOString(),
  }

  await prisma.whitespaceRun.create({
    data: {
      studyId: study.id, stage: 'DIMENSION_MAP', status: 'COMPLETED', scopeVersion: 2,
      scopeSnapshot: scope, results: dimensionResults, durationMs: 184000, completedAt: new Date(),
    },
  })

  const hypothesis = await prisma.whitespaceHypothesis.create({
    data: {
      studyId: study.id,
      type: 'PATENT_WHITESPACE',
      statement: 'Optical glucose sensing combined with a fully disposable housing appears absent from the field.',
      rationale: 'Optical sensing occupies 700 families and disposable housings 300, yet the two never co-occur where 114 were expected.',
      status: 'VALIDATED',
      elementCombination: { elements: ['optical sensing', 'disposable housing'] },
      scores: { density: 0.62, rarity: 0.94, semanticNovelty: null, evidenceQuality: 0.58, confidence: 0.51, crowdedness: 0.44, strength: null },
      validation: {
        attacks: [
          { strategy: 'SYNONYM_SHIFTED', query: 'single-use analyte patch', hits: 2, outcome: 'WEAKENING' },
          { strategy: 'LITERATURE', query: '', hits: 0, outcome: 'NOT_RUN', reason: 'No literature source is configured.' },
        ],
        gates: [
          { gate: 'G1_DATA', outcome: 'PASSED', basis: '60% of the optical arm has readable claim text.', measured: 0.6 },
          { gate: 'G4_FEASIBILITY', outcome: 'UNASSESSED', basis: 'No literature was searched.' },
        ],
        attacksPlanned: 6, attacksRun: 5, redTeamNotes: null, validatedAt: new Date().toISOString(),
      },
      coverageLimitations: ['Claim text is unavailable for 40% of the optical arm.'],
      createdBy: user.id,
    },
  })

  await prisma.whitespaceTrailEntry.create({
    data: { studyId: study.id, kind: 'RUN', actor: 'model:fixture', summary: 'DIMENSION_MAP completed — 2 viewpoints, 1 gap' },
  })

  console.log(JSON.stringify({ token, studyId: study.id, hypothesisId: hypothesis.id, userId: user.id }, null, 2))
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
