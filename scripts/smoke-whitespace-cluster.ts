/**
 * Deep smoke test: stages 2-4 against SYNTHETIC embeddings.
 *
 * The local corpus carries no binary vectors, so this script plants structured
 * fake ones (three seed patterns + bit noise) for the A61K slice, runs
 * CLUSTER → SIGNALS → DEEP_DIVE for real, then removes every vector it planted.
 * Cleanup is exact because the script refuses to run at all if any real vector
 * exists (with_binary must be 0 before seeding).
 *
 * Expected outcomes:
 *   - CLUSTER completes; areas exist; labels are numbered (no LLM auth here) —
 *     which exercises the label-fallback path.
 *   - SIGNALS completes; density/crowdedness land on each area.
 *   - DEEP_DIVE completes with the honest "no claims readable" record (the
 *     Indian corpus has no claims text), feeding gate G1's fail condition.
 *
 * Run: npx tsx scripts/smoke-whitespace-cluster.ts
 */
import { Prisma } from '@prisma/client'
import { prisma } from '../src/lib/prisma'
import { startWhitespaceRun } from '../src/lib/whitespace/service'
import { emptyWhitespaceScope } from '../src/lib/whitespace/types'
import { mulberry32 } from '../src/lib/whitespace/binary-kmeans'

const BITS = 512

async function waitForRun(runId: string) {
  const start = Date.now()
  for (;;) {
    const run = await prisma.whitespaceRun.findUnique({ where: { id: runId } })
    if (!run) throw new Error('run vanished')
    if (run.status === 'COMPLETED' || run.status === 'FAILED') return run
    if (Date.now() - start > 180_000) throw new Error('run did not finish in time')
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
}

function randomBits(random: () => number, from?: string, flips = 0): string {
  if (from) {
    const chars = from.split('')
    for (let i = 0; i < flips; i++) {
      const at = Math.floor(random() * BITS)
      chars[at] = chars[at] === '0' ? '1' : '0'
    }
    return chars.join('')
  }
  let out = ''
  for (let i = 0; i < BITS; i++) out += random() < 0.5 ? '0' : '1'
  return out
}

async function main() {
  let failures = 0
  const check = (name: string, ok: boolean, detail?: string) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
    if (!ok) failures++
  }

  // Refuse to touch a database that has real vectors.
  const [{ existing }] = await prisma.$queryRaw<Array<{ existing: bigint }>>(
    Prisma.sql`SELECT count(*)::bigint AS existing FROM local_patent_embeddings WHERE "embeddingBinary" IS NOT NULL`
  )
  if (Number(existing) > 0) {
    console.log('SKIP — this database already has real embedding vectors; not planting synthetic ones.')
    return
  }

  const user = await prisma.user.findFirst({ select: { id: true, tenantId: true } })
  if (!user) {
    console.log('SKIP — no users in the local database.')
    return
  }

  // --- plant structured synthetic vectors on the A61K slice -----------------
  const targets = await prisma.$queryRaw<Array<{ embeddingId: string }>>(Prisma.sql`
    SELECT e."id" AS "embeddingId"
    FROM local_patent_embeddings e
    JOIN local_patents lp ON lp."id" = e."localPatentId"
    WHERE lp."filingDate" IS NOT NULL
      AND (lp."classifications" && ARRAY['A61K']::text[]
           OR EXISTS (SELECT 1 FROM unnest(lp."classifications") c WHERE c LIKE 'A61K%'))
  `)
  console.log(`planting ${targets.length} synthetic vectors`)
  const random = mulberry32(42)
  const seeds = [randomBits(random), randomBits(random), randomBits(random)]
  for (let offset = 0; offset < targets.length; offset += 500) {
    const batch = targets.slice(offset, offset + 500)
    const values = batch.map(target => {
      const bits = randomBits(random, seeds[Math.floor(random() * seeds.length)], 40)
      return Prisma.sql`(${target.embeddingId}, ${bits})`
    })
    await prisma.$executeRaw(Prisma.sql`
      UPDATE local_patent_embeddings AS e
      SET "embeddingBinary" = v.bits::bit(512)
      FROM (VALUES ${Prisma.join(values, ', ')}) AS v(id, bits)
      WHERE e."id" = v.id`)
  }

  const scope = emptyWhitespaceScope()
  scope.title = 'Smoke: clustering'
  scope.classifications = [{ code: 'A61K', definition: 'medicinal preparations', origin: 'user', accepted: true }]

  const study = await prisma.whitespaceStudy.create({
    data: { userId: user.id, tenantId: user.tenantId, title: scope.title, scope: scope as any },
  })

  try {
    // --- CLUSTER --------------------------------------------------------------
    const cluster = await startWhitespaceRun({
      studyId: study.id,
      stage: 'CLUSTER',
      scope,
      scopeVersion: study.scopeVersion,
      requestHeaders: {},
    })
    const clusterRun = await waitForRun(cluster.runId)
    check('CLUSTER completes', clusterRun.status === 'COMPLETED', clusterRun.lastError ?? undefined)

    const clusters = await prisma.whitespaceCluster.findMany({ where: { studyId: study.id } })
    check('areas persisted', clusters.length >= 3, `${clusters.length} areas`)
    const members = await prisma.whitespaceClusterMember.count({ where: { studyId: study.id } })
    check('members persisted with vectors', members > 1000, `${members} members`)
    const withBits = await prisma.whitespaceClusterMember.count({ where: { studyId: study.id, bits: { not: null } } })
    check('member vectors stored', withBits === members)
    const results = clusterRun.results as any
    check('label fallback engaged', clusters.every(c => /^Area \d+$/.test(c.label)),
      'no LLM auth here, so numbered labels + a coverage note are correct')
    check('fallback is disclosed', Array.isArray(results?.coverageNotes) && results.coverageNotes.some((n: string) => /numbered/i.test(n)))

    // --- SIGNALS --------------------------------------------------------------
    const signals = await startWhitespaceRun({
      studyId: study.id,
      stage: 'SIGNALS',
      scope,
      scopeVersion: study.scopeVersion,
      requestHeaders: {},
    })
    const signalsRun = await waitForRun(signals.runId)
    check('SIGNALS completes', signalsRun.status === 'COMPLETED', signalsRun.lastError ?? undefined)
    const scored = await prisma.whitespaceCluster.findMany({ where: { studyId: study.id } })
    const withDensity = scored.filter(c => typeof (c.metrics as any)?.density === 'number')
    check('density landed on areas', withDensity.length === scored.length, `${withDensity.length}/${scored.length}`)
    const withCrowding = scored.filter(c => typeof (c.metrics as any)?.crowdedness === 'number')
    check('crowdedness landed on areas', withCrowding.length === scored.length)

    // --- DEEP_DIVE: the honest no-claims path ---------------------------------
    const biggest = scored.sort((a, b) => b.fieldEstimate - a.fieldEstimate)[0]
    const dive = await startWhitespaceRun({
      studyId: study.id,
      stage: 'DEEP_DIVE',
      scope,
      scopeVersion: study.scopeVersion,
      requestHeaders: {},
      params: { clusterId: biggest.id },
    })
    const diveRun = await waitForRun(dive.runId)
    check('DEEP_DIVE completes without claims', diveRun.status === 'COMPLETED', diveRun.lastError ?? undefined)
    const diveResults = diveRun.results as any
    check('dive reports zero readable claims', diveResults?.familiesWithClaims === 0)
    check(
      'dive says it is a data gap, not a finding',
      (diveResults?.coverageNotes ?? []).some((note: string) => /data gap/i.test(note))
    )
    const area = await prisma.whitespaceAreaAnalysis.findFirst({ where: { studyId: study.id, clusterId: biggest.id } })
    check('area analysis persisted for G1', Boolean(area), area?.status)

    // --- params-aware dedupe --------------------------------------------------
    const dupe = await startWhitespaceRun({
      studyId: study.id,
      stage: 'DEEP_DIVE',
      scope,
      scopeVersion: study.scopeVersion,
      requestHeaders: {},
      params: { clusterId: biggest.id },
    })
    // The prior dive completed, so this starts fresh; a *different* cluster while
    // one is live is the interesting case, but that needs a live run — covered
    // by the JSON-compare in startWhitespaceRun. Here we just confirm no crash.
    check('second dive starts cleanly', Boolean(dupe.runId))
    await waitForRun(dupe.runId)
  } finally {
    await prisma.whitespaceStudy.update({ where: { id: study.id }, data: { status: 'ARCHIVED' } })
    const cleaned = await prisma.$executeRaw(
      Prisma.sql`UPDATE local_patent_embeddings SET "embeddingBinary" = NULL WHERE "embeddingBinary" IS NOT NULL`
    )
    console.log(`cleanup: ${cleaned} synthetic vectors removed, study archived`)
  }

  if (failures) {
    console.log(`\n${failures} check(s) FAILED`)
    process.exitCode = 1
  } else {
    console.log('\nAll checks passed.')
  }
}

main()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
