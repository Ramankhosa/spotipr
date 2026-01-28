/**
 * Backfill countedAt for PatentDraftingUsage rows before dropping countedDate.
 *
 * Run:
 *   node scripts/backfill-patent-drafting-counted-at.js
 *   node scripts/backfill-patent-drafting-counted-at.js --dry-run
 *
 * Notes:
 * - This script assumes Postgres (uses ::timestamptz cast).
 * - Run BEFORE applying the migration that drops countedDate.
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  console.log('Backfilling patent_drafting_usage.countedAt')
  console.log(`Dry run: ${dryRun ? 'yes' : 'no'}`)
  console.log('')

  const steps = [
    {
      label: 'countedDate -> countedAt',
      countSql: `
        SELECT COUNT(*)::int AS "count"
        FROM "patent_drafting_usage"
        WHERE "countedAt" IS NULL
          AND "countedDate" IS NOT NULL
      `,
      updateSql: `
        UPDATE "patent_drafting_usage"
        SET "countedAt" = ("countedDate" || 'T00:00:00.000Z')::timestamptz
        WHERE "countedAt" IS NULL
          AND "countedDate" IS NOT NULL
      `
    },
    {
      label: 'fallback to updatedAt for counted rows',
      countSql: `
        SELECT COUNT(*)::int AS "count"
        FROM "patent_drafting_usage"
        WHERE "countedAt" IS NULL
          AND "isCounted" = true
      `,
      updateSql: `
        UPDATE "patent_drafting_usage"
        SET "countedAt" = "updatedAt"
        WHERE "countedAt" IS NULL
          AND "isCounted" = true
      `
    }
  ]

  for (const step of steps) {
    const countRows = await prisma.$queryRawUnsafe(step.countSql)
    const count = Array.isArray(countRows) && countRows[0]?.count ? countRows[0].count : 0
    console.log(`${step.label}: ${count} row(s) to update`)

    if (!dryRun && count > 0) {
      const updated = await prisma.$executeRawUnsafe(step.updateSql)
      console.log(`  Updated: ${updated}`)
    }
  }

  console.log('')
  console.log('Backfill complete.')
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
