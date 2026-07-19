/**
 * Sync the `officeActionProfile` block from Countries/<CODE>.json into the
 * database CountryProfile.profileData, validating it first.
 *
 * The drafting profile is imported by the jurisdictions hub; this patches in the
 * office-action block without disturbing anything else, so an existing country
 * can gain FER/OA support in place.
 *
 * Run: npx tsx scripts/sync-oa-profile.ts [CODE ...]   (default: IN)
 */
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { PrismaClient } from '@prisma/client'
import { validateOfficeActionProfile, computeOaReadiness } from '../src/lib/office-action/oa-profile-schema'

const prisma = new PrismaClient()

async function syncOne(code: string): Promise<boolean> {
  const file = join(__dirname, '..', 'Countries', `${code}.json`)
  if (!existsSync(file)) { console.error(`  ✗ ${code}: Countries/${code}.json not found`); return false }

  const profile = JSON.parse(readFileSync(file, 'utf-8'))
  const block = profile.officeActionProfile
  if (!block) { console.error(`  ✗ ${code}: no officeActionProfile block in the file`); return false }

  const validation = validateOfficeActionProfile(block)
  if (!validation.valid) {
    console.error(`  ✗ ${code}: invalid officeActionProfile:`)
    validation.errors.slice(0, 5).forEach(e => console.error(`      ${e}`))
    return false
  }
  validation.warnings.forEach(w => console.warn(`      warn: ${w}`))

  const row = await prisma.countryProfile.findUnique({ where: { countryCode: code } })
  if (!row) { console.error(`  ✗ ${code}: no CountryProfile row — import the drafting profile first`); return false }

  const merged = { ...(row.profileData as any), officeActionProfile: block }
  await prisma.countryProfile.update({
    where: { countryCode: code },
    data: { profileData: merged as any, updatedAt: new Date() }
  })

  const readiness = computeOaReadiness(block)
  const fails = readiness.checks.filter(c => c.status === 'fail')
  console.log(`  ✓ ${code}: office-action profile synced — readiness ${readiness.ready ? 'READY' : 'NOT READY'} (${readiness.status})`)
  fails.forEach(f => console.log(`      fail: ${f.label}${f.detail ? ` — ${f.detail}` : ''}`))
  return true
}

async function main() {
  const codes = process.argv.slice(2).filter(a => !a.startsWith('-'))
  const targets = codes.length ? codes.map(c => c.toUpperCase()) : ['IN']
  console.log(`\nSyncing office-action profiles: ${targets.join(', ')}\n`)
  let ok = 0
  for (const c of targets) if (await syncOne(c)) ok++
  console.log(`\nDone — ${ok}/${targets.length} synced.\n`)
  await prisma.$disconnect()
  process.exit(ok === targets.length ? 0 : 1)
}
main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
