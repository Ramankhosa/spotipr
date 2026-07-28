/**
 * Headless smoke test for the whitespace pipeline machinery.
 *
 * Exercises what can run without LLM stage config or embedding coverage:
 *   1. study creation with a CPC-only scope that matches the local corpus
 *   2. FIELD_MAP end to end (SQL census + optional narration)
 *   3. CLUSTER's graceful failure when the field carries no embeddings
 *   4. run bookkeeping: status transitions, heartbeats, trail entries
 *
 * Cleans up after itself (archives the study). Run:
 *   npx tsx scripts/smoke-whitespace-pipeline.ts
 */
import { prisma } from '../src/lib/prisma'
import { startWhitespaceRun } from '../src/lib/whitespace/service'
import { emptyWhitespaceScope } from '../src/lib/whitespace/types'

const POLL_MS = 2000
const WAIT_LIMIT_MS = 120_000

async function waitForRun(runId: string) {
  const start = Date.now()
  for (;;) {
    const run = await prisma.whitespaceRun.findUnique({ where: { id: runId } })
    if (!run) throw new Error('run vanished')
    if (run.status === 'COMPLETED' || run.status === 'FAILED') return run
    if (Date.now() - start > WAIT_LIMIT_MS) throw new Error('run did not finish in time')
    await new Promise(resolve => setTimeout(resolve, POLL_MS))
  }
}

async function main() {
  let failures = 0
  const check = (name: string, ok: boolean, detail?: string) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
    if (!ok) failures++
  }

  const user = await prisma.user.findFirst({ select: { id: true, tenantId: true } })
  if (!user) {
    console.log('SKIP — no users in the local database.')
    return
  }

  const scope = emptyWhitespaceScope()
  scope.title = 'Smoke: pharmaceutical preparations'
  scope.classifications = [{ code: 'A61K', definition: 'medicinal preparations', origin: 'user', accepted: true }]

  const study = await prisma.whitespaceStudy.create({
    data: {
      userId: user.id,
      tenantId: user.tenantId,
      title: scope.title,
      scope: scope as any,
    },
  })
  console.log(`study ${study.id}`)

  try {
    // --- FIELD_MAP -----------------------------------------------------------
    const fieldMap = await startWhitespaceRun({
      studyId: study.id,
      stage: 'FIELD_MAP',
      scope,
      scopeVersion: study.scopeVersion,
      requestHeaders: {},
    })
    check('FIELD_MAP starts', Boolean(fieldMap.runId) && !fieldMap.existing)

    const fieldMapRun = await waitForRun(fieldMap.runId)
    check('FIELD_MAP completes', fieldMapRun.status === 'COMPLETED', fieldMapRun.lastError ?? undefined)
    const results = fieldMapRun.results as any
    check('census counted families', (results?.familyCount ?? 0) > 0, `familyCount=${results?.familyCount}`)
    check('coverage notes present', Array.isArray(results?.coverageNotes) && results.coverageNotes.length > 0)

    // Dedupe: same stage+params while none live -> new run allowed after completion
    const again = await startWhitespaceRun({
      studyId: study.id,
      stage: 'FIELD_MAP',
      scope,
      scopeVersion: study.scopeVersion,
      requestHeaders: {},
    })
    check('completed run does not dedupe', !again.existing)
    await waitForRun(again.runId)

    // --- CLUSTER: graceful failure without embeddings ------------------------
    const cluster = await startWhitespaceRun({
      studyId: study.id,
      stage: 'CLUSTER',
      scope,
      scopeVersion: study.scopeVersion,
      requestHeaders: {},
    })
    const clusterRun = await waitForRun(cluster.runId)
    check('CLUSTER fails without embeddings', clusterRun.status === 'FAILED')
    check(
      'CLUSTER failure is actionable',
      /embedding/i.test(clusterRun.lastError ?? ''),
      (clusterRun.lastError ?? '').slice(0, 120)
    )

    // --- SIGNALS: refuses without clusters -----------------------------------
    const signals = await startWhitespaceRun({
      studyId: study.id,
      stage: 'SIGNALS',
      scope,
      scopeVersion: study.scopeVersion,
      requestHeaders: {},
    })
    const signalsRun = await waitForRun(signals.runId)
    check('SIGNALS fails without areas', signalsRun.status === 'FAILED')
    check('SIGNALS failure names the fix', /CLUSTER|area/i.test(signalsRun.lastError ?? ''))

    // --- trail ----------------------------------------------------------------
    const trail = await prisma.whitespaceTrailEntry.findMany({ where: { studyId: study.id } })
    check('trail records the runs', trail.length >= 2, `${trail.length} entries`)
  } finally {
    await prisma.whitespaceStudy.update({ where: { id: study.id }, data: { status: 'ARCHIVED' } })
    console.log('study archived')
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
