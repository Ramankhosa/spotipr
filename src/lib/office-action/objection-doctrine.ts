import type { OfficeActionProfile } from './oa-profile-schema'

/**
 * Office Action Studio — jurisdiction law block
 *
 * The country profile carries the operative law per objection type: the statute,
 * the office's own doctrine steps, sub-clause guidance, procedural actions, and
 * the whitelist of authorities that may be cited. This renders the slice that
 * applies to ONE objection so the strategy and drafting stages argue from the
 * jurisdiction's rules instead of the model's memory.
 *
 * Selection is deliberately narrow — the stages already spend their context
 * budget on retrieved specification text, so this block carries only:
 *   - the entry for the objection's canonical code,
 *   - the ONE sub-clause the classifier identified (all of them only when it
 *     could not tell, since 3(d) guidance is useless against a 3(k) objection),
 *   - the doctrine the entry names, resolved from the doctrines map.
 *
 * The whitelist is emitted even when empty: a drafter told "cite only from the
 * whitelist" and handed nothing must know that means "cite no authority",
 * otherwise it falls back on half-remembered case names.
 */

/** Keep the block bounded when the sub-clause is unknown and every one is sent. */
const MAX_UNMATCHED_SUBTYPES = 8

export interface DoctrineTarget {
  canonicalCode: string
  subTypeId?: string
}

export function renderObjectionDoctrine(profile: OfficeActionProfile, objection: DoctrineTarget): string {
  const entry = (profile.objections || []).find(o => o.canonical === objection.canonicalCode)
  if (!entry) return ''

  const lines: string[] = []
  const label = entry.localLabel || entry.canonical
  lines.push(`Jurisdiction law for this objection — ${label} [${(entry.legalBasis || []).join(', ')}]`)

  if (entry.guidance) lines.push(entry.guidance)

  // Sub-clause guidance: the identified one, or all when the classifier could
  // not pin it down (Section 3 objections in particular).
  const subTypes = entry.subTypes || []
  if (subTypes.length) {
    const matched = objection.subTypeId ? subTypes.find(s => s.id === objection.subTypeId) : undefined
    const chosen = matched ? [matched] : subTypes.slice(0, MAX_UNMATCHED_SUBTYPES)
    const heading = matched
      ? `Sub-clause ${matched.basis || matched.id}:`
      : 'Sub-clauses in play (identify which the examiner invoked before arguing):'
    lines.push(heading)
    for (const s of chosen) {
      lines.push(`- ${s.basis || s.id}${s.guidance ? `: ${s.guidance}` : ''}`)
    }
  }

  if (entry.argumentSkeleton) lines.push(`Argument structure to follow: ${entry.argumentSkeleton}`)

  // Doctrine framework (ordered steps the office expects the reply to track).
  const doctrine = entry.doctrine ? (profile.doctrines || {})[entry.doctrine] : undefined
  if (doctrine) {
    lines.push('Doctrine steps, in order:')
    doctrine.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`))
    if (doctrine.styleNotes) lines.push(`Style: ${doctrine.styleNotes}`)
  }

  if (entry.actions?.length) {
    lines.push('Procedural compliance required:')
    for (const a of entry.actions) lines.push(`- ${a}`)
  }

  // Authorities: the whitelist is exhaustive, including when it is empty.
  // Entries tagged with sub-clauses are dropped once we know the objection is a
  // different one — a 3(d) reply should never see the 3(k) authority.
  type Authority = { name: string; citation?: string; point?: string; subTypes?: string[] }
  const applies = (c: Authority) =>
    !c.subTypes?.length || !objection.subTypeId || c.subTypes.includes(objection.subTypeId)
  const cases = [
    ...((entry.caseLawWhitelist || []) as Authority[]),
    ...((doctrine?.leadingCases || []) as Authority[])
  ].filter(applies)
  const seen = new Set<string>()
  const unique = cases.filter(c => (seen.has(c.name) ? false : (seen.add(c.name), true)))
  if (unique.length) {
    lines.push('Authorities you may cite (this list is exhaustive — cite no others):')
    for (const c of unique) {
      lines.push(`- ${c.name}${c.citation ? `, ${c.citation}` : ''}${c.point ? ` — ${c.point}` : ''}`)
    }
  } else {
    lines.push('No authorities are whitelisted for this objection: argue from the statute and the specification only, and cite no case law.')
  }

  return lines.join('\n')
}
