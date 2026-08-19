/**
 * Whitespace funnel doctor — answers "why is my field the size it is?".
 *
 * whitespace-scope-doctor.ts answers "can the corpus be reached at all". This
 * answers the question after that one: given a reachable corpus, WHICH ARM is
 * actually defining the field — the concept wording, or the semantic
 * neighbourhood — and what every rung of the ladder came to.
 *
 * It prints, per study:
 *   1. per-concept lexical reach (each concept alone, structural filters on),
 *   2. every rung of the ladder measured LEXICALLY ONLY (no semantic ids),
 *   3. the semantic candidate count and the ceiling that produced it,
 *   4. the rung the fit chose, and the split of the final field into
 *      lexical-only / semantic-only / both.
 *
 * (4) is the number to read first. When "semantic-only" is ~100% of the field,
 * the concept list and the match rule are decorative: the study is being run
 * over an embedding neighbourhood and the coverage note's "a document counts
 * when it matches all N concepts" is not describing what happened.
 *
 * Usage:
 *   npx tsx scripts/whitespace-funnel-doctor.ts            # 4 newest studies
 *   npx tsx scripts/whitespace-funnel-doctor.ts <studyId>  # one study
 */

import { Prisma, PrismaClient } from '@prisma/client'
import { buildConceptQuery, buildScopeFilter, textMatchPredicate } from '../src/lib/whitespace/field-map'
import { candidateCoverageNote, resolveFieldCandidates } from '../src/lib/whitespace/candidates'
import { resolveFieldBand, resolveFieldDefinition } from '../src/lib/whitespace/field-definition'
import type { WhitespaceScope } from '../src/lib/whitespace/types'

const prisma = new PrismaClient()

async function families(where: Prisma.Sql): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
    SELECT COUNT(DISTINCT COALESCE(lp."familyId", lp."publicationNumber"))::bigint AS n
    FROM "local_patents" lp WHERE ${where}`)
  return Number(rows[0]?.n ?? 0)
}

async function main() {
  const wanted = process.argv[2]
  console.log(`band = ${JSON.stringify(resolveFieldBand())}`)
  const studies = await prisma.whitespaceStudy.findMany({ orderBy: { createdAt: 'desc' }, take: wanted ? 100 : 4 })

  for (const study of studies) {
    if (wanted && !study.id.startsWith(wanted)) continue
    const scope = study.scope as unknown as WhitespaceScope
    if (!scope?.concepts?.length) continue

    console.log('\n================================================================')
    console.log(`STUDY ${study.id}  ${study.title}`)
    console.log(
      `years ${scope.filters.yearFrom}-${scope.filters.yearTo}  ` +
        `cpcAccepted=${scope.classifications.filter(c => c.accepted).length}  ` +
        `exclusions=${scope.exclusions.length}  ` +
        `matching=${JSON.stringify(scope.matching ?? 'auto')}`
    )

    console.log('\n-- per-concept lexical reach (this concept alone + structural filters) --')
    for (const concept of scope.concepts) {
      const solo = { ...scope, concepts: [{ ...concept, required: false }], exclusions: [] } as WhitespaceScope
      const plan = buildConceptQuery(solo, 1)
      if (!plan || !textMatchPredicate(plan)) {
        console.log(`   (no searchable query)  ${concept.label}`)
        continue
      }
      const n = await families(buildScopeFilter(solo, [], 1))
      console.log(
        `   ${String(n).padStart(7)}  ${concept.required ? '[must]' : '[opt] '} ${concept.label.slice(0, 64)} (+${concept.synonyms.length} syn)`
      )
    }

    const optional = scope.concepts.filter(c => !c.required && c.label.trim()).length
    const required = scope.concepts.filter(c => c.required && c.label.trim()).length
    console.log(`\n-- ladder, LEXICAL ONLY (must-appear=${required}, optional=${optional}) --`)
    for (let k = optional; k >= (required > 0 ? 0 : 1); k--) {
      try {
        const started = Date.now()
        const n = await families(buildScopeFilter(scope, [], k))
        console.log(`   k=${k}: ${String(n).padStart(7)} families  (${Date.now() - started}ms)`)
      } catch (error) {
        console.log(`   k=${k}: ERROR ${(error as Error).message.replace(/\s+/g, ' ').slice(0, 130)}`)
      }
    }
    const bare = { ...scope, concepts: [] } as WhitespaceScope
    console.log(`   no concept gate at all: ${await families(buildScopeFilter(bare, [], 0))} families`)

    console.log('\n-- semantic arm --')
    const candidates = await resolveFieldCandidates(scope)
    console.log(`   candidates: ${candidates.ids.length}${candidates.saturated ? ' (SATURATED)' : ''}`)
    console.log(`   ${candidateCoverageNote(candidates).replace(/\s+/g, ' ').slice(0, 300)}`)

    console.log('\n-- what the fit chose, and who supplied the field --')
    const field = await resolveFieldDefinition(scope, { studyId: study.id, reuse: false })
    const total = await families(field.where)
    const lexicalOnly = await families(buildScopeFilter(scope, [], field.rule.minimumOptional))
    const bothRows = await prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
      SELECT COUNT(DISTINCT COALESCE(lp."familyId", lp."publicationNumber"))::bigint AS n
      FROM "local_patents" lp
      WHERE ${buildScopeFilter(scope, [], field.rule.minimumOptional)}
        AND lp."id" = ANY(${candidates.ids}::int[])`)
    const both = Number(bothRows[0]?.n ?? 0)
    console.log(`   rule: k=${field.rule.minimumOptional} of ${field.rule.optionalCount}, fit=${field.rule.fit}`)
    console.log(`   final field:      ${total} families`)
    console.log(`   matched wording:  ${lexicalOnly} (${total ? Math.round((100 * lexicalOnly) / total) : 0}%)`)
    console.log(`   matched meaning:  ${candidates.ids.length} (${total ? Math.round((100 * candidates.ids.length) / total) : 0}%)`)
    console.log(`   matched both:     ${both}`)
    if (total && lexicalOnly / total < 0.05) {
      console.log('   >>> The concept list is decorative here: the field is the embedding neighbourhood.')
    }
  }
  await prisma.$disconnect()
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
