#!/usr/bin/env node
/**
 * Migration safety check — refuses destructive SQL against the corpus assets.
 *
 * WHY THIS EXISTS
 * `prisma migrate diff` / `migrate dev` / `db push` perpetually propose
 * statements this repo must never apply:
 *   - ALTER COLUMN "embeddingBinary" SET DATA TYPE bit(512) on
 *     local_patent_embeddings (~29.8M Voyage vectors; Prisma itself warns the
 *     cast can lose the column data). Root cause: the column is declared
 *     Unsupported("bit(512)"), which Prisma cannot prove equal to the live type.
 *   - DROP INDEX on hand-built ANN / trigram indexes that exist only in raw SQL
 *     (local_patent_embeddings_binary_ivf_idx was built CONCURRENTLY on prod
 *     and is not modelled in schema.prisma at all).
 * Twice already a migration had to be hand-stripped (see the "drift,
 * intentionally skipped" markers in 20260717140213 and the safety contract in
 * 20260721120000). This script makes the stripping enforceable instead of
 * remembered.
 *
 * USAGE
 *   node scripts/check-migration-safety.mjs        # scan prisma/migrations
 * Exit 0 = safe to `migrate deploy`. Exit 1 = a forbidden statement was found.
 *
 * Run it in CI and immediately before every production `prisma migrate deploy`.
 * It scans migration FILES only — it cannot protect against `prisma db push`
 * or `prisma migrate dev` pointed at production. Never run those on prod.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations')

/** Tables whose data must never be touched by a migration. */
const PROTECTED_TABLES = [
  'local_patents',
  'local_patent_embeddings',
  'oa_document_chunks',
  'epo_ep_fulltext',
  'epo_patent_bib',
]

/** Index name prefixes belonging to protected tables (incl. hand-built ones). */
const PROTECTED_INDEX_PREFIXES = [
  'local_patents_',
  'local_patent_embeddings_',
  'oa_document_chunks_',
  'epo_ep_fulltext_',
  'epo_patent_bib_',
]

/**
 * Everything up to and including this migration is the reviewed historical set:
 * audited 23 Jul 2026, applied (or superseded) on production. Two UPDATE
 * backfills on local_patents (corpusSources, publicationNumberKey) and one
 * index-only trigram rebuild live in that history and are known-safe. The full
 * rule set below applies to every migration AFTER this baseline.
 */
const REVIEWED_BASELINE = '20260723170000_add_whitespace_studio'

const stripComments = (sql) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')

const statements = (sql) =>
  stripComments(sql)
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

const touchesProtectedTable = (upper) =>
  PROTECTED_TABLES.some(
    (t) => upper.includes(`"${t.toUpperCase()}"`) || new RegExp(`\\b${t.toUpperCase()}\\b`).test(upper)
  )

function checkStatement(stmt, isAfterBaseline) {
  const upper = stmt.toUpperCase()
  const violations = []

  // --- Always fatal, regardless of migration age -------------------------
  if (touchesProtectedTable(upper)) {
    if (upper.startsWith('DROP TABLE')) violations.push('DROP TABLE on a protected table')
    if (upper.startsWith('TRUNCATE')) violations.push('TRUNCATE on a protected table')
    if (upper.startsWith('ALTER TABLE') && /\b(DROP COLUMN|ALTER COLUMN|SET DATA TYPE)\b/.test(upper)) {
      violations.push('column-level ALTER on a protected table (the bit(512) drift class — full-table rewrite, possible data loss)')
    }
  }

  // --- Fatal only for NEW migrations (history is audited + allowlisted) --
  if (isAfterBaseline) {
    if (touchesProtectedTable(upper) && (upper.startsWith('DELETE FROM') || upper.startsWith('UPDATE '))) {
      violations.push('DML (UPDATE/DELETE) on a protected table in a new migration')
    }
    const dropIndex = stmt.match(/^DROP INDEX (?:IF EXISTS )?"?([A-Za-z0-9_]+)"?/i)
    if (dropIndex && PROTECTED_INDEX_PREFIXES.some((p) => dropIndex[1].startsWith(p))) {
      violations.push(`DROP INDEX on protected index "${dropIndex[1]}" (ANN/trigram indexes take hours to rebuild on 45M rows)`)
    }
  }

  return violations
}

function main() {
  if (!existsSync(MIGRATIONS_DIR)) {
    console.error(`No migrations directory at ${MIGRATIONS_DIR}`)
    process.exit(1)
  }

  const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

  const failures = []
  let scanned = 0

  for (const dir of dirs) {
    const file = join(MIGRATIONS_DIR, dir, 'migration.sql')
    if (!existsSync(file)) continue
    scanned += 1
    const isAfterBaseline = dir > REVIEWED_BASELINE
    for (const stmt of statements(readFileSync(file, 'utf8'))) {
      for (const violation of checkStatement(stmt, isAfterBaseline)) {
        failures.push({ dir, violation, stmt: stmt.slice(0, 160) })
      }
    }
  }

  if (failures.length) {
    console.error(`\nMIGRATION SAFETY CHECK FAILED — ${failures.length} forbidden statement(s):\n`)
    for (const f of failures) {
      console.error(`  [${f.dir}]`)
      console.error(`    ${f.violation}`)
      console.error(`    ${f.stmt}\n`)
    }
    console.error('Do NOT run `prisma migrate deploy` until these are removed or the')
    console.error('change is made deliberately outside Prisma (see the safety contract')
    console.error('in migration 20260721120000_epo_bdds_ingest).')
    process.exit(1)
  }

  console.log(`Migration safety check passed — ${scanned} migrations scanned, 0 forbidden statements.`)
  console.log('Protected: ' + PROTECTED_TABLES.join(', '))
  console.log('Reminder: this checks migration FILES. Never run `prisma db push` or')
  console.log('`prisma migrate dev` against production — those generate the drift SQL live.')
}

main()
