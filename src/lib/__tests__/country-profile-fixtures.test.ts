/**
 * Validates every real country profile JSON in Countries/ against:
 *  1. the upload Zod validator (validateCountryProfile, after repair), and
 *  2. the import mapping derivation (deriveCountryMappings) — must produce
 *     mappings including enabled title + abstract, with no error issues.
 *
 * This is the regression gate for the one-shot country import pipeline:
 * if a profile ships in this repo, it must be importable.
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { validateCountryProfile } from '../country-profile-validation'
import { repairCountryProfile } from '../country-profile-repair'
import {
  buildSupersetIndexFromSections,
  deriveCountryMappings,
  SupersetSectionInput
} from '../country-import-service'

const COUNTRIES_DIR = path.join(process.cwd(), 'Countries')

const PROFILE_FILES = fs.readdirSync(COUNTRIES_DIR).filter(f =>
  f.endsWith('.json') &&
  !f.startsWith('TEMPLATE') &&
  !f.startsWith('db-') &&
  !f.startsWith('exported-') &&
  !f.includes('backup') &&
  !f.includes('sample') &&
  !f.includes('seed')
)

function loadJson(file: string): any {
  return JSON.parse(fs.readFileSync(path.join(COUNTRIES_DIR, file), 'utf-8'))
}

function loadSupersetFixture(): SupersetSectionInput[] {
  const rows = loadJson('db-superset-sections.json')
  return rows.map((r: any) => ({
    sectionKey: r.sectionKey,
    aliases: r.aliases || [],
    label: r.label,
    displayOrder: r.displayOrder,
    instruction: r.instruction || ''
  }))
}

/**
 * Sections in shipped profiles with NO superset counterpart. Unresolved
 * sections are blocking errors by design (no silent drops), so a shipped
 * profile may only appear here with the exact ids an admin would have to
 * acknowledge skipping in the wizard. Anything not listed must resolve.
 */
const KNOWN_UNMAPPED: Record<string, string[]> = {
  'JP.json': ['citation_list']
}

describe.each(PROFILE_FILES)('country profile %s', (file) => {
  const index = buildSupersetIndexFromSections(loadSupersetFixture())
  const raw = loadJson(file)
  const knownUnmapped = KNOWN_UNMAPPED[file] || []

  it('passes validation after repair', async () => {
    const repair = await repairCountryProfile(raw)
    const profile = repair.success && repair.repairedProfile ? repair.repairedProfile : raw
    const result = validateCountryProfile(profile)
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('derives importable section mappings with enabled title and abstract', async () => {
    const repair = await repairCountryProfile(raw)
    const profile = repair.success && repair.repairedProfile ? repair.repairedProfile : raw

    // Without acknowledgments, the only blocking issues allowed are the
    // documented unmappable sections — nothing else may be lost.
    const unacknowledged = deriveCountryMappings(profile, index)
    const errorIds = unacknowledged.issues.filter(i => i.severity === 'error').map(i => i.sectionId).sort()
    expect(errorIds).toEqual([...knownUnmapped].sort())

    // With those skips acknowledged (as the wizard would), the import is clean.
    const { mappings, issues } = deriveCountryMappings(profile, index, { skipSections: knownUnmapped })
    expect(issues.filter(i => i.severity === 'error')).toEqual([])
    expect(mappings.length).toBeGreaterThanOrEqual(5)

    const keys = new Set(mappings.map(m => m.sectionKey))
    expect(keys.has('title')).toBe(true)
    expect(keys.has('abstract')).toBe(true)
    expect(keys.has('claims')).toBe(true)

    // Orders must be unique (drives the unique supersetCode constraint)
    const orders = mappings.map(m => m.displayOrder)
    expect(new Set(orders).size).toBe(orders.length)
  })
})
