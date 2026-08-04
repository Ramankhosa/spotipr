/**
 * Plan feature bullets.
 *
 * Built straight from the plan catalog, so any surface that lists what a plan
 * includes — /api/pricing, the /pricing cards, the homepage pricing section —
 * shows the quotas the database actually enforces rather than a hand-written
 * list that quietly goes stale.
 *
 * Lives here rather than inside the pricing API route because the homepage
 * renders its plans on the server, without going through HTTP.
 */

import { PLAN_BY_CODE, type PlanCatalogCode } from './catalog'

export interface PlanFeatureBullet {
  /** The number, when the bullet is a quota. Rendered in bold ahead of the label. */
  value?: string
  label: string
}

/** Headline metered features, in the order buyers care about. */
const ORDERED_FEATURES: Array<[string, string]> = [
  ['PATENT_DRAFTING', 'Patent drafts / month'],
  ['NOVELTY_SEARCH', 'Novelty searches / month'],
  ['IDEATION', 'Ideation runs / month'],
  ['DIAGRAM_GENERATION', 'Diagrams & sketches / month'],
  ['PATENT_REVIEW', 'AI patent reviews / month'],
  ['OFFICE_ACTION_RESPONSE', 'Office Action responses / month'],
  ['IDEA_BANK', 'Idea Bank reservations / month'],
  ['PERSONA_SYNC', 'PersonaSync style trainings / month'],
]

export function buildPlanFeatureBullets(dbPlanCode: PlanCatalogCode): PlanFeatureBullet[] {
  const def = PLAN_BY_CODE[dbPlanCode]
  if (!def) return []

  const bullets: PlanFeatureBullet[] = []

  for (const [code, label] of ORDERED_FEATURES) {
    const grant = def.features[code as keyof typeof def.features]
    if (!grant) continue
    bullets.push({ value: String(grant.monthlyQuota), label })
  }

  bullets.push({
    label:
      def.maxJurisdictionsPerPatent === 1
        ? 'Single-jurisdiction filing pack'
        : `Multi-jurisdiction filing (up to ${def.maxJurisdictionsPerPatent} countries per patent)`,
  })

  bullets.push({
    value: String(def.seats),
    label: def.seats === 1 ? 'Seat included' : 'Seats included',
  })

  if (def.modelClasses.allowed.includes('ADVANCED')) {
    bullets.push({ label: 'Frontier AI models (Advanced tier)' })
  } else if (def.modelClasses.allowed.includes('PRO_M')) {
    bullets.push({ label: 'Professional AI models' })
  }

  return bullets
}
