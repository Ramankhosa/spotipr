/**
 * Drive an Invention Miner study end to end against the local fixture.
 *
 * This is a proving harness, not a product path. It calls the service layer
 * directly (startWhitespaceRun + drainWhitespaceRuns), which means it bypasses
 * the HTTP route's authentication and its INVENTION_MINER entitlement check.
 * That is deliberate: the point is to find out whether the SQL runs, the
 * extraction prompt returns parseable JSON, the source-span verification keeps
 * a workable share of what the model extracts, and the engines produce leads —
 * none of which the unit tests can answer. Entitlement is exercised by the
 * route's own tests.
 *
 * It reuses the scope the fixture was built and verified against, so the floors
 * `npm run im:seed-fixture -- --verify` reports are the floors this run meets.
 *
 *   npx tsx scripts/run-miner-e2e.ts                  # field map + harvest + engines
 *   npx tsx scripts/run-miner-e2e.ts -- --stage=HARVEST
 *   npx tsx scripts/run-miner-e2e.ts -- --fresh       # new study, ignore an existing one
 */
import 'dotenv/config'
import { PrismaClient, type Prisma } from '@prisma/client'
import { startWhitespaceRun } from '../src/lib/whitespace/service'
import { emptyWhitespaceScope, CORPUS_FIRST_YEAR, type WhitespaceScope } from '../src/lib/whitespace/types'
import { scopeFingerprint } from '../src/lib/whitespace/miner/scope-fingerprint'

const prisma = new PrismaClient()
const args = process.argv.slice(2)
const fresh = args.includes('--fresh')
const onlyStage = args.find(a => a.startsWith('--stage='))?.split('=')[1]
const USER_EMAIL = 'claude-verify@local.test'
const STUDY_TITLE = 'E2E — gastroretentive controlled-release oral drug delivery'

/** Byte-identical to fixtureScope() in seed-miner-fixture.ts. */
function fixtureScope(): WhitespaceScope {
  const scope = emptyWhitespaceScope()
  scope.title = 'Gastroretentive controlled-release oral drug delivery'
  scope.summary =
    'Oral dosage forms whose residence in the stomach is deliberately prolonged so that an active with a narrow '
    + 'upper-intestinal absorption window can be delivered over many hours from a single unit.'
  scope.concepts = [
    {
      id: 'concept-release',
      label: 'controlled release',
      synonyms: ['sustained release', 'extended release', 'prolonged release', 'modified release'],
      required: true,
      origin: 'user',
    },
    {
      id: 'concept-gastroretention',
      label: 'gastroretentive dosage form',
      synonyms: ['gastroretentive', 'gastric retention', 'gastric residence', 'floating tablet'],
      required: false,
      origin: 'user',
    },
    {
      id: 'concept-oral',
      label: 'oral dosage form',
      synonyms: ['oral administration', 'matrix tablet', 'oral capsule'],
      required: false,
      origin: 'user',
    },
    {
      id: 'concept-burst',
      label: 'burst release',
      synonyms: ['burst', 'dose dumping', 'plasma concentration spike'],
      required: false,
      origin: 'user',
    },
  ]
  scope.filters.yearFrom = CORPUS_FIRST_YEAR
  scope.filters.yearTo = new Date().getFullYear()

  // Restrict the field to the fixture's applicants.
  //
  // Without this the census assembles 952 families, of which only 145 (15.2%)
  // carry any description — because the concept gate is lexical OR SEMANTIC,
  // and the semantic arm admits ~800 ambient Indian families whose abstracts
  // sit near "controlled release". Every one of those is abstract-only: this
  // dev corpus has exactly zero descriptions outside the fixture. The miner
  // then refuses, correctly, on its 20% description floor.
  //
  // That refusal is the product working. But it means the only way to exercise
  // the stages BEHIND it on this box is to scope the field to rows that
  // actually have text, and an assignee filter is a real scope feature rather
  // than a test hook.
  scope.filters.assignees = FIXTURE_APPLICANTS
  return scope
}

/** The ten synthetic applicants seed-miner-fixture.ts writes. */
const FIXTURE_APPLICANTS = [
  'Ashwatha Pharmaceutical Industries Limited',
  'Chandrika Bioceuticals Limited',
  'Ganjam Institute of Pharmaceutical Sciences',
  'Kaveri Formulations Limited',
  'Marudhar Controlled Delivery Private Limited',
  'Nirmaya Drug Delivery Systems Private Limited',
  'Prantik Speciality Excipients Limited',
  'Sundara Therapeutics Private Limited',
  'Trilokh Pharma Research Limited',
  'Veligandu Life Sciences Private Limited',
]

function hr(title: string) {
  console.log(`\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}`)
}

async function runStage(studyId: string, stage: string, scope: WhitespaceScope, scopeVersion: number) {
  hr(`STAGE ${stage}`)
  const started = Date.now()
  const { runId, existing } = await startWhitespaceRun({
    studyId,
    stage: stage as never,
    scope,
    scopeVersion,
    requestHeaders: {},
  })
  console.log(`run ${runId}${existing ? ' (attached to an existing run)' : ''}`)

  // startWhitespaceRun kicks the inline drain, which executes the run in THIS
  // process — the same path the HTTP route takes when no worker is deployed.
  // So we poll rather than drain: draining here as well would put two workers
  // on one run, and the lease fence would (correctly) throw one of them out
  // mid-stage, which is exactly what happened the first time this was tried.
  let lastPhase = ''
  const deadline = Date.now() + 45 * 60_000
  for (;;) {
    const row = await prisma.whitespaceRun.findUnique({
      where: { id: runId },
      select: { status: true, progress: true },
    })
    const p = row?.progress as { phase?: string; detail?: string } | null
    if (p?.phase && `${p.phase}:${p.detail}` !== lastPhase) {
      lastPhase = `${p.phase}:${p.detail}`
      console.log(`  [${Math.round((Date.now() - started) / 1000)}s] ${p.phase} — ${p.detail}`)
    }
    if (row && row.status !== 'QUEUED' && row.status !== 'PROCESSING') break
    if (Date.now() > deadline) {
      console.log('  gave up waiting after 45 minutes')
      break
    }
    await new Promise(r => setTimeout(r, 2000))
  }

  const row = await prisma.whitespaceRun.findUnique({ where: { id: runId } })
  const secs = Math.round((Date.now() - started) / 1000)
  console.log(`\nstatus ${row?.status} after ${secs}s`)
  if (row?.lastError) console.log(`error: ${row.lastError}`)
  if (row?.status === 'COMPLETED') {
    const results = row.results as Record<string, unknown> | null
    console.log('result:')
    for (const [k, v] of Object.entries(results ?? {})) {
      if (v === null || v === undefined) continue
      const rendered =
        Array.isArray(v) && v.length > 4
          ? `[${v.length} items] ${JSON.stringify(v.slice(0, 3))}…`
          : typeof v === 'object'
            ? JSON.stringify(v)
            : String(v)
      console.log(`  ${k}: ${rendered.slice(0, 400)}`)
    }
  }
  return row?.status
}

async function main() {
  const user = await prisma.user.findUnique({ where: { email: USER_EMAIL } })
  if (!user?.tenantId) throw new Error(`${USER_EMAIL} not found, or has no tenant`)

  const scope = fixtureScope()
  const fp = scopeFingerprint(scope)
  hr('SETUP')
  console.log(`user            ${user.id}`)
  console.log(`tenant          ${user.tenantId}`)
  console.log(`scopeFingerprint ${fp}`)

  let study = fresh
    ? null
    : await prisma.whitespaceStudy.findFirst({
        where: { userId: user.id, kind: 'MINER', title: STUDY_TITLE },
        orderBy: { createdAt: 'desc' },
      })

  if (!study) {
    study = await prisma.whitespaceStudy.create({
      data: {
        userId: user.id,
        tenantId: user.tenantId,
        title: STUDY_TITLE,
        kind: 'MINER',
        seedText: scope.summary,
        scope: scope as unknown as Prisma.InputJsonValue,
        inventionJson: {
          field: scope.title,
          focusProblems: 'burst release, dose dumping, short gastric residence',
          constraints: '',
          assigneeOfInterest: '',
        } as unknown as Prisma.InputJsonValue,
      },
    })
    console.log(`study           ${study.id} (created)`)
  } else {
    // Keep the scope byte-identical to the fixture's so the fingerprint holds.
    study = await prisma.whitespaceStudy.update({
      where: { id: study.id },
      data: { scope: scope as unknown as Prisma.InputJsonValue },
    })
    console.log(`study           ${study.id} (reused)`)
  }

  const MINER_ONLY = new Set(['HARVEST', 'ENGINES', 'GATE', 'BRIEF'])
  const stages = onlyStage
    ? [MINER_ONLY.has(onlyStage) ? `MINER_${onlyStage}` : onlyStage]
    : ['FIELD_MAP', 'MINER_HARVEST', 'MINER_ENGINES']

  for (const stage of stages) {
    const status = await runStage(study.id, stage, scope, study.scopeVersion)
    if (status !== 'COMPLETED') {
      console.log(`\nStopping: ${stage} ended ${status}.`)
      break
    }
  }

  hr('WHAT LANDED')
  const [fieldPubs, extractions, statements, leads] = await Promise.all([
    prisma.minerFieldPublication.count({ where: { studyId: study.id, scopeFingerprint: fp } }),
    prisma.patentTextExtraction.count(),
    prisma.patentProblemStatement.count(),
    prisma.inventionLead.findMany({
      where: { studyId: study.id },
      orderBy: { createdAt: 'asc' },
      select: {
        origin: true, title: true, status: true, elements: true,
        problemStatement: true, signals: true, coverageLimitations: true,
      },
    }),
  ])
  console.log(`staged field publications  ${fieldPubs}`)
  console.log(`extraction rows (corpus)   ${extractions}`)
  console.log(`indexed statements         ${statements}`)
  console.log(`leads                      ${leads.length}`)
  leads.forEach((lead, i) => {
    console.log(`\n  ${i + 1}. [${lead.origin}] ${lead.title}  (${lead.status})`)
    console.log(`     problem: ${lead.problemStatement.slice(0, 160)}`)
    console.log(`     elements: ${JSON.stringify(lead.elements).slice(0, 200)}`)
    console.log(`     signals: ${JSON.stringify(lead.signals).slice(0, 300)}`)
  })
  if (leads[0]) {
    console.log(`\n  coverage limitations of lead 1:`)
    for (const line of (leads[0].coverageLimitations as string[]) ?? []) console.log(`     - ${line}`)
  }
}

main()
  .catch(e => {
    console.error('\nFAILED:', e?.message ?? e)
    if (e?.stack) console.error(e.stack.split('\n').slice(1, 6).join('\n'))
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
