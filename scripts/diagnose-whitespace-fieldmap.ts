/**
 * Read-only diagnosis of a timing-out field-map census.
 *
 * Loads the scope snapshot of the most recent FAILED (or latest) FIELD_MAP run,
 * rebuilds the exact predicate the stage uses, and reports: corpus size, the
 * planner's chosen plan, how selective the predicate is, and how long the size
 * facet actually needs. Runs EXPLAIN without ANALYZE and bounded probes only.
 *
 *   npx tsx scripts/diagnose-whitespace-fieldmap.ts [runId]
 *
 * With no run to read (a corpus-only environment, e.g. local dev where the
 * whitespace tables are not migrated), pass concepts instead and it exercises the
 * census end to end against whatever corpus is present:
 *
 *   npx tsx scripts/diagnose-whitespace-fieldmap.ts --concepts "steel, rolling"
 */
import { Prisma } from '@prisma/client'
import { prisma } from '../src/lib/prisma'
import { buildScopeFilter, buildConceptQuery, runFieldMap } from '../src/lib/whitespace/field-map'
import { candidateCoverageNote, resolveFieldCandidates } from '../src/lib/whitespace/candidates'
import { resolveFieldDefinition } from '../src/lib/whitespace/field-definition'
import { fieldRuleNote, rungLabel } from '../src/lib/whitespace/field-rule'
import { readScope } from '../src/lib/whitespace/service'
import { emptyWhitespaceScope, scopeMatching } from '../src/lib/whitespace/types'
import type { WhitespaceScope } from '../src/lib/whitespace/types'

const PROBE_CAP = 200_000

async function withTimeout<T>(ms: number, query: Prisma.Sql): Promise<T[]> {
  const [, rows] = await prisma.$transaction([
    prisma.$executeRaw`SELECT set_config('statement_timeout', ${String(ms)}, true)`,
    prisma.$queryRaw<T[]>(query),
  ])
  return rows
}

/**
 * Ad-hoc scope from a comma-separated list. Terms are OPTIONAL by default so
 * the match-rule ladder has rungs to show; prefix a term with `*` to make it
 * must-appear ("*irrigation, soil moisture, weather forecast").
 */
function scopeFromConcepts(raw: string): WhitespaceScope {
  const scope = emptyWhitespaceScope()
  scope.title = `ad-hoc: ${raw}`
  scope.concepts = raw
    .split(',')
    .map(term => term.trim())
    .filter(Boolean)
    .map((term, index) => ({
      id: `c${index}`,
      label: term.replace(/^\*/, '').trim(),
      synonyms: [],
      required: term.startsWith('*'),
      origin: 'user' as const,
    }))
  return scope
}

async function loadScope(): Promise<{ scope: WhitespaceScope; label: string } | null> {
  const cpcFlag = process.argv.indexOf('--cpc')
  if (cpcFlag !== -1) {
    const raw = process.argv[cpcFlag + 1] || ''
    const scope = emptyWhitespaceScope()
    scope.title = `ad-hoc CPC: ${raw}`
    scope.classifications = raw
      .split(',')
      .map(code => code.trim())
      .filter(Boolean)
      .map(code => ({ code, origin: 'user' as const, accepted: true }))
    return { scope, label: `ad-hoc CPC: ${raw}` }
  }

  const conceptsFlag = process.argv.indexOf('--concepts')
  if (conceptsFlag !== -1) {
    const raw = process.argv[conceptsFlag + 1] || ''
    if (!raw.trim()) {
      console.log('--concepts needs a comma-separated list of terms.')
      return null
    }
    return { scope: scopeFromConcepts(raw), label: `ad-hoc concepts: ${raw}` }
  }

  const runId = process.argv[2]
  try {
    const run = runId
      ? await prisma.whitespaceRun.findUnique({ where: { id: runId } })
      : ((await prisma.whitespaceRun.findFirst({
          where: { stage: 'FIELD_MAP', status: 'FAILED' },
          orderBy: { createdAt: 'desc' },
        })) ??
        (await prisma.whitespaceRun.findFirst({ where: { stage: 'FIELD_MAP' }, orderBy: { createdAt: 'desc' } })))

    if (!run) {
      console.log('No FIELD_MAP run in this database. Pass --concepts "term, term" to exercise the census directly.')
      return null
    }
    console.log(`Run ${run.id}  status=${run.status}  created=${run.createdAt.toISOString()}`)
    if (run.lastError) console.log(`lastError: ${run.lastError.slice(0, 300)}`)
    return {
      scope: readScope(run.scopeSnapshot as Prisma.JsonValue) as WhitespaceScope,
      label: `run ${run.id}`,
    }
  } catch (error) {
    if ((error as { code?: string })?.code === 'P2021') {
      console.log('This database has no whitespace tables (migration not applied here).')
      console.log('Pass --concepts "term, term" to exercise the census against the corpus alone.')
      return null
    }
    throw error
  }
}

async function main() {
  const loaded = await loadScope()
  if (!loaded) return
  const { scope } = loaded
  console.log(`\nScope: "${scope.title}"`)
  console.log(`  concepts:        ${scope.concepts.length} (${scope.concepts.filter(c => c.required).length} required)`)
  console.log(`  classifications: ${scope.classifications.filter(c => c.accepted).length} accepted`)
  console.log(`  years:           ${scope.filters.yearFrom}-${scope.filters.yearTo}`)
  console.log(`  jurisdictions:   ${scope.filters.jurisdictions.join(', ') || '(all)'}`)
  const conceptPlan = buildConceptQuery(scope)
  if (conceptPlan) {
    conceptPlan.required.forEach((group, index) => console.log(`  must-appear group ${index + 1}: ${group.slice(0, 200)}`))
    conceptPlan.optional.forEach((group, index) => console.log(`  optional group ${index + 1}:    ${group.slice(0, 200)}`))
    if (conceptPlan.exclusions) console.log(`  tsquery NOT:     ${conceptPlan.exclusions.slice(0, 200)}`)
    console.log(`  match rule:      ${JSON.stringify(scopeMatching(scope))}`)
  } else {
    console.log('  tsquery:         (none — classification only)')
  }

  // --- corpus size and server timeouts -------------------------------------
  const [size] = await withTimeout<{ approx_rows: number; total_bytes: string }>(
    10_000,
    Prisma.sql`
      SELECT reltuples::bigint AS approx_rows,
             pg_size_pretty(pg_total_relation_size('local_patents')) AS total_bytes
      FROM pg_class WHERE relname = 'local_patents'`
  )
  const [settings] = await withTimeout<{ statement_timeout: string }>(
    10_000,
    Prisma.sql`SELECT current_setting('statement_timeout') AS statement_timeout`
  )
  console.log(`\nCorpus: ~${Number(size?.approx_rows ?? 0).toLocaleString()} rows, ${size?.total_bytes}`)
  console.log(`Session statement_timeout outside a facet: ${settings?.statement_timeout}`)

  // --- the semantic arm of the hybrid gate ----------------------------------
  // Reported separately from the census because "the field is empty" has two
  // very different causes now, and this is the line that tells them apart.
  console.log('\n--- Semantic candidate arm ---')
  const semanticStart = Date.now()
  const candidates = await resolveFieldCandidates(scope)
  if (!candidates.available) {
    console.log(`  UNAVAILABLE — ${candidates.reason}`)
    console.log('  The field below is therefore matched on concept WORDING alone.')
  } else {
    console.log(
      `  ${candidates.ids.length.toLocaleString()} documents admitted by meaning in ${Date.now() - semanticStart}ms` +
        `${candidates.saturated ? ` (clipped at the ${candidates.cap.toLocaleString()} cap)` : ''}`
    )
  }

  // --- the match rule: every rung, tightest first -----------------------------
  // The line that answers "why is this field too big / too small": it prints
  // what each "at least k of the optional concepts" rung matches and which one
  // the fit chose (or would choose — the fit is what the census runs with).
  console.log('\n--- Match rule ladder (auto fit) ---')
  const fitStart = Date.now()
  const field = await resolveFieldDefinition(scope, { reuse: false })
  console.log(`  band: ${field.rule.band.minFamilies.toLocaleString()} families .. ${field.rule.band.maxPublications.toLocaleString()} publications`)
  console.log(`  ${field.rule.requiredCount} must-appear, ${field.rule.optionalCount} optional; mode ${field.rule.mode}, fit ${field.rule.fit}, k=${field.rule.minimumOptional} (${Date.now() - fitStart}ms)`)
  for (const rung of field.rule.ladder) console.log(`  ${rungLabel(rung, field.rule)}${rung.minimumOptional === field.rule.minimumOptional ? '   <== used' : ''}`)
  console.log(`  ${fieldRuleNote(field.rule)}`)

  const lexicalOnly = buildScopeFilter(scope, undefined, field.rule.minimumOptional)
  const where = field.where

  // --- lexical vs hybrid, side by side --------------------------------------
  console.log('\n--- Lexical-only vs hybrid match counts ---')
  for (const [label, predicate] of [
    ['lexical only', lexicalOnly],
    ['hybrid      ', where],
  ] as const) {
    const started = Date.now()
    try {
      const [row] = await withTimeout<{ matched: bigint }>(
        60_000,
        Prisma.sql`
          SELECT COUNT(*)::bigint AS matched
          FROM (SELECT 1 FROM "local_patents" lp WHERE ${predicate} LIMIT ${PROBE_CAP}) t`
      )
      const matched = Number(row?.matched ?? 0)
      console.log(
        `  ${label}: ${matched.toLocaleString()}${matched >= PROBE_CAP ? '+ (hit the cap)' : ''} in ${Date.now() - started}ms`
      )
    } catch (error) {
      console.log(`  ${label}: FAILED after ${Date.now() - started}ms — ${(error as Error).message.slice(0, 200)}`)
    }
  }

  // --- the plan the census actually gets -----------------------------------
  console.log('\n--- EXPLAIN: the staging pass (the only statement that reads the corpus) ---')
  const plan = await withTimeout<{ 'QUERY PLAN': string }>(
    30_000,
    Prisma.sql`
      EXPLAIN
      SELECT lp."id", COALESCE(lp."familyId", lp."publicationNumber") AS family_key
      FROM "local_patents" lp
      WHERE ${where}`
  )
  for (const row of plan) console.log('  ' + row['QUERY PLAN'])

  // --- how many rows match, bounded ---------------------------------------
  console.log(`\n--- Bounded match probe (stops at ${PROBE_CAP.toLocaleString()}) ---`)
  const probeStart = Date.now()
  try {
    const [probe] = await withTimeout<{ matched: bigint }>(
      60_000,
      Prisma.sql`
        SELECT COUNT(*)::bigint AS matched
        FROM (SELECT 1 FROM "local_patents" lp WHERE ${where} LIMIT ${PROBE_CAP}) t`
    )
    const matched = Number(probe?.matched ?? 0)
    console.log(
      `  matched ${matched.toLocaleString()}${matched >= PROBE_CAP ? '+ (hit the cap)' : ''} in ${Date.now() - probeStart}ms`
    )
  } catch (error) {
    console.log(`  probe failed after ${Date.now() - probeStart}ms: ${(error as Error).message.slice(0, 200)}`)
  }

  // --- the whole census, as the stage runs it ------------------------------
  console.log('\n--- Full census (staging pass + all seven facets) ---')
  const start = Date.now()
  const timeoutFlag = process.argv.indexOf('--census-timeout')
  const censusTimeoutMs = timeoutFlag !== -1 ? Number(process.argv[timeoutFlag + 1]) : undefined
  if (censusTimeoutMs) console.log(`  (census ceiling forced to ${censusTimeoutMs}ms)`)
  try {
    const result = await runFieldMap(scope, {
      ...(censusTimeoutMs ? { censusTimeoutMs } : {}),
      candidateIds: candidates.ids,
      candidateNote: candidateCoverageNote(candidates),
      fieldRule: field.rule,
    })
    const elapsed = Date.now() - start
    console.log(
      `  ${result.familyCount.toLocaleString()} families / ${result.publicationCount.toLocaleString()} publications in ${elapsed}ms`
    )
    console.log(`  years:           ${result.filingsByYear.length} buckets`)
    console.log(`  jurisdictions:   ${result.jurisdictions.length}`)
    console.log(`  classifications: ${result.classifications.length}`)
    console.log(`  assignees:       ${result.assignees.length}`)
    console.log(
      `  status proxy:    granted ${result.statusProxy.granted}, pending ${result.statusProxy.pending}, unknown ${result.statusProxy.unknown}`
    )
    console.log(
      `  claims readable: ${result.textCoverage.withClaims.toLocaleString()} of ${result.textCoverage.familiesTotal.toLocaleString()} families`
    )
    for (const note of result.coverageNotes) console.log(`  note: ${note}`)
  } catch (error) {
    console.log(`  FAILED after ${Date.now() - start}ms: ${(error as Error).message.slice(0, 300)}`)
  }
}

main()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
