// Smoke test for Prior-Art Studio: session → plan → compile → run → element
// scoring → grid arithmetic → tagging → saturation → theories → trail,
// directly against the service layer (no HTTP/auth).
// Run with: npx tsx scripts/smoke-prior-art-studio.ts

import './load-env'
import { prisma } from '../src/lib/prisma'
import { compileStudioPlan, renderBooleanPreview } from '../src/lib/prior-art-studio/compiler'
import { computeSaturation, runStudioPlan } from '../src/lib/prior-art-studio/service'
import { findAnticipationCandidates, findCombinations } from '../src/lib/prior-art-studio/element-math'
import { emptyStudioPlan } from '../src/lib/prior-art-studio/types'

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`FAIL: ${message}`)
  console.log(`  ok — ${message}`)
}

async function main() {
  const user = await prisma.user.findFirst({ select: { id: true, email: true } })
  if (!user) throw new Error('No users in local DB — seed first.')
  console.log(`Using user ${user.email}`)

  const plan = emptyStudioPlan()
  plan.title = 'Smoke: torque-limited driver'
  plan.conceptSummary = 'A screwdriver with a clutch that slips at a preset torque to protect the fastener.'
  plan.blocks = [
    {
      id: 'b1',
      label: 'torque limiting',
      mode: 'MATCH',
      terms: [
        { text: 'torque', origin: 'user', accepted: true },
        { text: 'clutch', origin: 'copilot', accepted: true },
        { text: 'ghost-term-should-not-run', origin: 'copilot', accepted: false },
      ],
    },
    {
      id: 'b2',
      label: 'driver tool',
      mode: 'EXPAND',
      terms: [{ text: 'screwdriver for fasteners', origin: 'user', accepted: true }],
    },
  ]
  plan.notTerms = [{ text: 'bicycle', origin: 'user', accepted: true }]
  plan.elements = [
    { id: 'e1', text: 'a driver shaft engaging a fastener head', origin: 'user' },
    { id: 'e2', text: 'a torque limiting clutch with a preset release threshold', origin: 'user' },
    { id: 'e3', text: 'the clutch re-engages automatically after release', origin: 'user' },
  ]
  plan.steer = { enabled: true, publicationNumbers: ['IN40652006A'], weight: 0.3 }

  console.log('\n[1] Compiler')
  const compiled = compileStudioPlan(plan)
  console.log('  boolean:', renderBooleanPreview(plan))
  assert(!compiled.queryPlan.searchQuery?.includes('ghost-term-should-not-run'), 'unaccepted ghost term never reaches the query')
  const ids = (compiled.queryPlan.retrievalQueries || []).map(q => q.id)
  assert(ids.includes('concept'), 'concept probe emitted')
  assert(plan.elements.every(e => ids.includes(`element:${e.id}`)), 'one probe emitted per claim element')
  assert(ids.includes('steer'), 'steering emitted as an explicit probe')
  assert(renderBooleanPreview(plan).includes('STEER'), 'steering is visible in the query line')

  const session = await prisma.priorArtStudioSession.create({
    data: { userId: user.id, title: plan.title, plan: plan as any },
  })
  console.log(`\n[2] Session ${session.id}`)

  try {
    console.log('\n[3] Run')
    const run = await runStudioPlan({
      sessionId: session.id,
      userId: user.id,
      plan,
      planVersion: 1,
      requestHeaders: {},
    })
    console.log('  gates:', JSON.stringify(run.gateCounts))
    console.log('  duration:', run.durationMs, 'ms · families:', run.families.length)
    assert(run.families.length > 0, 'run returned families')
    assert(run.gateCounts.steered === true, 'gate counts record that ranking was steered')
    assert(typeof run.gateCounts.vocabularyGap === 'number', 'vocabulary gap computed')

    console.log('\n[3b] MATCH semantics — adapts to whether a keyword index serves this corpus')
    console.log(`  matchMode=${run.gateCounts.matchMode} matchRemoved=${run.gateCounts.matchRemoved}`)
    assert(
      run.gateCounts.matchMode === 'lane' || run.gateCounts.matchMode === 'filter',
      `MATCH reports how it ran (got "${run.gateCounts.matchMode}")`
    )
    assert(typeof run.gateCounts.matchRemoved === 'number', 'MATCH narrowing is counted, never invisible')

    // When no keyword index serves the corpus, MATCH is enforced by us, so every
    // shown document must literally satisfy it. When the index DOES serve it,
    // Postgres already judged the document over four fields (including ragText,
    // which the result payload doesn't carry) — re-checking here would wrongly
    // discard legitimate top_terms matches, so we trust the database's verdict.
    if (run.gateCounts.matchMode === 'filter') {
      const required = [['torque', 'clutch']]
      const violating = run.families.filter(f => {
        const text = `${f.title || ''} ${f.abstract || ''} ${f.snippet || ''}`.toLowerCase()
        return !required.every(group => group.some(term => text.includes(term)))
      })
      assert(violating.length === 0, `every shown document satisfies the MATCH blocks (${violating.length} violations)`)
    } else {
      console.log('  (keyword index served this corpus — DB verdict trusted, no client-side re-filter)')
    }

    console.log('\n[3c] Corpus isolation (no live patent-data APIs)')
    const ALLOWED = new Set(['indian-corpus', 'google-patents-corpus'])
    const foreign = run.families.filter(f => {
      const raw = f as unknown as { sourceProvider?: string; providerId?: string }
      const ids = [raw.sourceProvider, raw.providerId].filter(Boolean) as string[]
      return ids.some(id => !ALLOWED.has(id))
    })
    assert(foreign.length === 0, 'every result came from the stored corpus, not a live patent API')

    console.log('\n[4] Gate inspector')
    assert(Array.isArray(run.gateDetail?.constraints), 'per-constraint elimination detail present')
    assert((run.gateDetail?.disclosures.length || 0) >= 5, 'coverage limits disclosed')
    const disclosures = (run.gateDetail?.disclosures || []).join(' ').toLowerCase()
    assert(disclosures.includes('2000'), 'pre-2000 coverage gap disclosed')
    assert(disclosures.includes('non-patent literature'), 'absence of NPL disclosed')
    assert(disclosures.includes('quarterly'), 'refresh lag disclosed')
    assert(disclosures.includes('legal-status') || disclosures.includes('legal status'), 'absence of legal status disclosed')
    console.log('  disclosures:', run.gateDetail?.disclosures.length, '· sensitivity rows:', run.gateDetail?.sensitivity.length)

    console.log('\n[5] Element scoring')
    const scored = run.families.filter(f => f.elementCells)
    console.log(`  scored ${scored.length} of ${run.families.length} families`)
    assert(scored.length > 0, 'per-element evidence attached to results')
    const sample = scored[0]
    const cell = sample.elementCells![plan.elements[0].id]
    assert(!!cell, 'every scored family has a cell per element')
    assert(['STRONG', 'PART', 'WEAK', 'NONE'].includes(cell.verdict), 'verdict is categorical')
    assert(['abstract', 'claims'].includes(cell.tier), 'evidence tier labelled honestly')
    console.log(`  sample ${sample.publicationNumber}: E1=${cell.verdict} (tier ${cell.tier}, terms: ${cell.matchedTerms.join(',') || 'none'})`)

    console.log('\n[6] Grid arithmetic')
    const rows = scored.map(f => ({ familyKey: f.familyKey, publicationNumber: f.publicationNumber, cells: f.elementCells }))
    const anticipation = findAnticipationCandidates({ elements: plan.elements, rows })
    const combos = findCombinations({ elements: plan.elements, rows })
    console.log(`  §102 candidates: ${anticipation.length} · complementary pairs: ${combos.length}`)
    assert(combos.every(c => c.publicationNumbers.length === 2), 'combinations are minimal pairs')
    assert(combos.every(c => c.covered === c.total), 'combinations cover every element')

    console.log('\n[7] Marks + saturation')
    for (const family of run.families.slice(0, 3)) {
      await prisma.priorArtStudioDocState.upsert({
        where: { sessionId_familyKey: { sessionId: session.id, familyKey: family.familyKey } },
        update: { tag: 'RELEVANT' },
        create: { sessionId: session.id, familyKey: family.familyKey, publicationNumber: family.publicationNumber, tag: 'RELEVANT' },
      })
    }
    const marks = await prisma.priorArtStudioDocState.findMany({
      where: { sessionId: session.id },
      select: { tag: true, updatedAt: true },
    })
    const saturation = computeSaturation(marks)
    assert(saturation.reviewed === 3, 'saturation counts reviewed documents')
    assert(typeof saturation.suggestion === 'string' && saturation.suggestion.length > 0, 'stopping-rule suggestion produced')
    console.log('  suggestion:', saturation.suggestion)

    console.log('\n[8] Theories')
    const theory = await prisma.priorArtStudioTheory.create({
      data: {
        sessionId: session.id,
        kind: 'COMBINATION',
        publicationNumbers: run.families.slice(0, 2).map(f => f.publicationNumber),
        familyKeys: run.families.slice(0, 2).map(f => f.familyKey),
        motivation: 'Both address fastener over-torque in the same field; a skilled person would look to combine them.',
        createdBy: user.id,
      },
    })
    assert(!!theory.id, 'theory persisted with attorney-authored motivation')

    console.log('\n[9] Trail')
    const trail = await prisma.priorArtStudioTrailEntry.findMany({ where: { sessionId: session.id } })
    console.log(`  entries: ${trail.length} (${trail.map(t => t.kind).join(', ')})`)
    assert(trail.some(t => t.kind === 'RUN'), 'run recorded on the evidence trail')
  } finally {
    await prisma.priorArtStudioSession.delete({ where: { id: session.id } })
    console.log('\nCleanup: session deleted (cascades runs, marks, theories, trail)')
  }
}

main()
  .then(() => {
    console.log('\n✅ SMOKE TEST PASSED')
    process.exit(0)
  })
  .catch(err => {
    console.error('\n❌ SMOKE TEST FAILED:', err)
    process.exit(1)
  })
