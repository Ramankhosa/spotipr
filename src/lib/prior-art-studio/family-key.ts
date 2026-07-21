import { canonicalPublicationNumber } from '@/lib/patent-search/utils'
import type { StudioResultFamily } from './types'

/**
 * Preserve a real corpus family id. When the provider has no family id it uses
 * the publication number as the key; strip the kind code in that case so an
 * application and grant do not become separate Studio families.
 */
export function canonicalStudioFamilyKey(
  familyKey: unknown,
  publicationNumber: unknown,
  applicationNumber?: unknown,
): string {
  const supplied = String(familyKey || '').trim()
  const publication = String(publicationNumber || '').trim()
  const canonicalPublication = canonicalPublicationNumber(publication)
  const canonicalApplication = canonicalPublicationNumber(applicationNumber)
  if (!supplied) return canonicalApplication ? `application:${canonicalApplication}` : canonicalPublication || publication

  const compactSupplied = supplied.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const compactPublication = publication.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (compactSupplied === compactPublication || canonicalPublicationNumber(supplied) === canonicalPublication) {
    return canonicalPublication || supplied
  }
  return supplied
}

/** Map every publication variant in a result set to the family shown by Studio. */
export function studioFamilyAliasMap(families: StudioResultFamily[]): Map<string, string> {
  const aliases = new Map<string, string>()
  for (const family of families) {
    const familyKey = canonicalStudioFamilyKey(family.familyKey, family.publicationNumber)
    for (const publicationNumber of [family.publicationNumber, ...family.members.map(member => member.publicationNumber)]) {
      const publicationKey = canonicalPublicationNumber(publicationNumber)
      if (publicationKey) aliases.set(publicationKey, familyKey)
    }
  }
  return aliases
}

export function studioFamilyKeyForState(
  row: { familyKey: string; publicationNumber: string },
  familyAliases?: Map<string, string>,
): string {
  return familyAliases?.get(canonicalPublicationNumber(row.publicationNumber)) ||
    canonicalStudioFamilyKey(row.familyKey, row.publicationNumber)
}

/** Most-recent state wins when legacy publication-kind keys collapse together. */
export function mergeCanonicalFamilyStates<T extends {
  familyKey: string
  publicationNumber: string
  updatedAt: Date | string
}>(rows: T[], familyAliases?: Map<string, string>): T[] {
  const byFamily = new Map<string, T>()
  for (const row of rows) {
    const familyKey = studioFamilyKeyForState(row, familyAliases)
    const existing = byFamily.get(familyKey)
    if (!existing || new Date(row.updatedAt).getTime() >= new Date(existing.updatedAt).getTime()) {
      byFamily.set(familyKey, { ...row, familyKey })
    }
  }
  return Array.from(byFamily.values())
}
