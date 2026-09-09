/**
 * Syncs the claims base prompt into the live database.
 *
 * Source of truth: Countries/prompts/claims-base.v2.md (first line is the
 * version marker CLAIMS-BASE-V2). The runtime reads SupersetSection('claims')
 * from the DB, so an edit to the file changes nothing until this script runs.
 *
 *   node scripts/sync-claims-base-prompt.js            # dry run: shows the diff summary
 *   node scripts/sync-claims-base-prompt.js --apply    # updates SupersetSection('claims')
 *
 * Never run Countries/MasterSeed.js --force to push a prompt change: it
 * re-seeds every section and every country top-up. MasterSeed reads the same
 * file for a fresh database, so the two cannot drift.
 */
const { PrismaClient } = require('@prisma/client')
const fs = require('fs')
const path = require('path')

const PROMPT_FILE = path.join(__dirname, '..', 'Countries', 'prompts', 'claims-base.v2.md')
const MARKER = 'CLAIMS-BASE-V2'
const CONSTRAINTS = [
  'Single sentence per claim',
  'Proper antecedent basis',
  'Clear transition phrases',
  'Independent + dependent structure',
  'Office form per the JURISDICTION CLAIM RULES block',
]

function firstDifference(a, b) {
  const left = String(a || '').split('\n')
  const right = String(b || '').split('\n')
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] !== right[i]) return { line: i + 1, before: left[i] ?? '(none)', after: right[i] ?? '(none)' }
  }
  return null
}

async function main() {
  const apply = process.argv.includes('--apply')
  const next = fs.readFileSync(PROMPT_FILE, 'utf8').trim()
  if (!next.startsWith(MARKER)) {
    console.error(`! ${PROMPT_FILE} must start with the ${MARKER} marker.`)
    process.exit(1)
  }

  const prisma = new PrismaClient()
  try {
    const row = await prisma.supersetSection.findUnique({ where: { sectionKey: 'claims' } })
    if (!row) {
      console.error('! No SupersetSection with sectionKey=claims. Seed the superset sections first (Countries/MasterSeed.js).')
      process.exit(1)
    }

    const current = String(row.instruction || '').trim()
    console.log(`DB prompt: ${current.length} chars, starts with "${current.slice(0, 40).replace(/\n/g, ' ')}"`)
    console.log(`File prompt: ${next.length} chars (${MARKER})`)
    if (current === next) {
      console.log('Already in sync; nothing to do.')
      return
    }
    const diff = firstDifference(current, next)
    if (diff) {
      console.log(`First difference at line ${diff.line}:`)
      console.log(`  DB  : ${diff.before.slice(0, 120)}`)
      console.log(`  file: ${diff.after.slice(0, 120)}`)
    }

    if (!apply) {
      console.log('\nDry run. Re-run with --apply to update SupersetSection(claims).')
      return
    }

    await prisma.supersetSection.update({
      where: { sectionKey: 'claims' },
      data: {
        instruction: next,
        constraints: CONSTRAINTS,
        isActive: true,
        updatedBy: 'sync-claims-base-prompt',
      },
    })
    const verify = await prisma.supersetSection.findUnique({ where: { sectionKey: 'claims' } })
    if (!String(verify?.instruction || '').startsWith(MARKER)) {
      console.error('! Update did not stick (marker missing after write).')
      process.exit(1)
    }
    console.log('Updated SupersetSection(claims). Clear the section-prompt cache in Super Admin (or wait two minutes) before generating.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
