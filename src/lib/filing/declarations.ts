/**
 * Form 1 para 12(iii) — the applicant's declaration checklist.
 *
 * Each clause is ticked when it applies and crossed (or struck) when it does not. Which
 * clauses apply is DERIVED from the filing facts, not remembered as a preference: an
 * ordinary provisional filing and a PCT national-phase filing differ because the rules read
 * `applicationType`, not because someone saved two preference sets.
 *
 * The cascade then layers deliberate overrides on top:
 *
 *     RULES  ->  firm preset  ->  project  ->  patent
 *
 * so a firm that never touches biological material crosses that one clause once, forever,
 * while everything that follows from the application type keeps deriving itself.
 */

import type {
  DeclarationClauseKey,
  DeclarationGroup,
  DeclarationState,
  FilingDetails,
  ResolvedDeclarationClause,
  SettingSource,
} from './types'

export interface DeclarationClauseDef {
  key: DeclarationClauseKey
  /** Exact form wording. `specType` picks the variant where the form has two. */
  text: string | ((details: FilingDetails) => string)
  /** Short label for the UI matrix. */
  label: string
  /** Which document/section this belongs to. Defaults to Form 1 paragraph 12(iii). */
  group?: DeclarationGroup
}

export const GROUP_LABELS: Record<DeclarationGroup, string> = {
  form1_12iii: 'Form 1 — paragraph 12(iii)',
  form1_12ii: 'Form 1 — paragraph 12(ii)',
  form5: 'Form 5 — sections struck out when they do not apply',
}

export const DECLARATION_CLAUSES: DeclarationClauseDef[] = [
  {
    key: 'possession',
    label: 'In possession of the invention',
    text: 'I am/We are in possession of the above-mentioned invention.',
  },
  {
    key: 'specFiled',
    label: 'Specification filed with this application',
    text: (d) =>
      d.specType === 'complete'
        ? 'The Complete specification relating to the invention is filed with this application.'
        : 'The Provisional specification relating to the invention is filed with this application.',
  },
  {
    key: 'biologicalMaterial',
    label: 'Uses biological material from India',
    text: 'The invention as disclosed in the specification uses the biological material from India and the necessary permission from the competent authority shall be submitted by me/us before the grant of patent to me/us.',
  },
  {
    key: 'noLawfulGround',
    label: 'No lawful ground of objection',
    text: 'There is no lawful ground of objection to the grant of the Patent to us.',
  },
  {
    key: 'assigneeOfInventors',
    label: 'Assignee of true & first inventors',
    text: 'I/We are the assignee or legal representative of true & first inventors.',
  },
  {
    key: 'firstAppInConvention',
    label: 'First application in convention country',
    text: 'The application or each of the applications, particulars of which are given in Paragraph – 8 was first application in convention country/countries in respect of my/our invention.',
  },
  {
    key: 'priorityClaim',
    label: 'Claiming convention priority',
    text: 'I/We claim the priority from the above mentioned application filed in convention country/countries and state that no application for protection in respect of the invention had been made in a convention country before that date by me/us or by any person from which I/We derive the title.',
  },
  {
    key: 'pctBased',
    label: 'Based on a PCT application',
    text: 'My/our application in India is based on international application under Patent Cooperation Treaty (PCT) as mentioned in Paragraph – 9.',
  },
  {
    key: 'divisional',
    label: 'Divided out of an earlier application',
    text: 'My/Our application is divided out of My/our application particulars of which are given in Paragraph – 10 and pray that this application may be treated as deemed to have been filed on ____________ under sec. 16 of the Act.',
  },
  {
    key: 'patentOfAddition',
    label: 'Improvement in or modification of an earlier invention',
    text: 'The said invention is an improvement in or modification of the invention particulars of which are given in Paragraph – 11.',
  },
  // --- Whole blocks, not tick-boxes -------------------------------------
  {
    key: 'form1ConventionApplicant',
    group: 'form1_12ii',
    label: 'Declaration by the applicant in the convention country',
    text: 'I/We, the applicant(s) in the convention country declare that the applicant(s) herein is/are my/our assignee or legal representative.',
  },
  {
    key: 'form5Convention',
    group: 'form5',
    label: 'Section 3 — convention-country declaration',
    text: 'We the applicants in the convention country hereby declare that our right to apply for a patent in India is by way of assignment from the true and first inventor(s).',
  },
  {
    key: 'form5AdditionalInventors',
    group: 'form5',
    label: 'Section 4 — additional inventors’ assent',
    text: 'I/We assent to the invention referred to in the above declaration, being included in the complete specification filed in pursuance of the stated application.',
  },
]

export function clauseText(def: DeclarationClauseDef, details: FilingDetails): string {
  return typeof def.text === 'function' ? def.text(details) : def.text
}

export interface DeclarationRuleInput {
  details: FilingDetails
  /** Drives `assigneeOfInventors` — an org applicant takes rights by assignment. */
  inventorsSameAsApplicant: boolean
  /** Drives Form 5 section 4 — it exists for inventors who did not sign the application. */
  hasAdditionalInventors?: boolean
}

/**
 * The DERIVED layer. Everything here follows deterministically from the filing facts, so
 * an attorney filing an ordinary provisional touches zero checkboxes.
 *
 * `biologicalMaterial` is the one clause with no derivation — nothing in the filing facts
 * tells us whether the invention uses biological material — so it defaults to crossed and
 * is the classic thing a firm pins once at firm level.
 */
export function deriveDeclarations(input: DeclarationRuleInput): Record<DeclarationClauseKey, DeclarationState> {
  const { details, inventorsSameAsApplicant } = input
  const isConvention = details.applicationType === 'convention'
  const isPct = details.applicationType === 'pct_np'

  return {
    possession: 'tick',
    specFiled: 'tick',
    biologicalMaterial: 'cross',
    noLawfulGround: 'tick',
    // When the applicant IS the inventor there is nothing to be an assignee of.
    assigneeOfInventors: inventorsSameAsApplicant ? 'cross' : 'tick',
    firstAppInConvention: isConvention ? 'tick' : 'cross',
    priorityClaim: isConvention ? 'tick' : 'cross',
    pctBased: isPct ? 'tick' : 'cross',
    divisional: details.isDivisional ? 'tick' : 'cross',
    patentOfAddition: details.isPatentOfAddition ? 'tick' : 'cross',
    // Whole blocks default to struck when they do not apply, which is what the form's
    // "strike out the portion which is not applicable" instruction asks for. The attorney
    // can switch any of them to a tick or a cross instead.
    form1ConventionApplicant: isConvention ? 'tick' : 'strike',
    form5Convention: isConvention ? 'tick' : 'strike',
    form5AdditionalInventors: input.hasAdditionalInventors ? 'tick' : 'strike',
  }
}

/**
 * Detect a chosen state that contradicts the filing facts.
 *
 * Reported as a warning rather than enforced as a lock: attorneys occasionally have reasons
 * we cannot model, but they should never file a contradiction without having seen it.
 */
export function detectConflict(
  key: DeclarationClauseKey,
  state: DeclarationState,
  input: DeclarationRuleInput
): string | undefined {
  const { details, inventorsSameAsApplicant } = input
  const ticked = state === 'tick'

  if (ticked && key === 'pctBased' && details.applicationType !== 'pct_np') {
    return 'Ticked, but this is not a PCT national-phase application. Paragraph 9 will be blank.'
  }
  if (ticked && (key === 'firstAppInConvention' || key === 'priorityClaim') && details.applicationType !== 'convention') {
    return 'Ticked, but the application type is not Convention. Paragraph 8 will be blank.'
  }
  if (ticked && key === 'divisional' && !details.isDivisional) {
    return 'Ticked, but this filing is not marked as a divisional application.'
  }
  if (ticked && key === 'patentOfAddition' && !details.isPatentOfAddition) {
    return 'Ticked, but this filing is not marked as a patent of addition.'
  }
  if (ticked && key === 'assigneeOfInventors' && inventorsSameAsApplicant) {
    return 'Ticked, but the inventors are the same as the applicant — there is no assignment.'
  }
  if (!ticked && key === 'divisional' && details.isDivisional) {
    return 'This filing is marked as a divisional application, but the clause is not ticked.'
  }
  if (!ticked && key === 'patentOfAddition' && details.isPatentOfAddition) {
    return 'This filing is marked as a patent of addition, but the clause is not ticked.'
  }
  if (!ticked && key === 'pctBased' && details.applicationType === 'pct_np') {
    return 'The application type is PCT national phase, but the clause is not ticked.'
  }
  if (!ticked && key === 'possession') {
    return 'The applicant must declare possession of the invention.'
  }
  // Whole-block clauses: warn when a block is kept on a filing it does not belong to, or
  // struck on one where it does.
  if (ticked && (key === 'form1ConventionApplicant' || key === 'form5Convention') && details.applicationType !== 'convention') {
    return 'Kept in, but this is not a convention application — it is normally struck out.'
  }
  if (state === 'strike' && (key === 'form1ConventionApplicant' || key === 'form5Convention') && details.applicationType === 'convention') {
    return 'Struck out on a convention application, where this declaration is required.'
  }
  if (state === 'strike' && key === 'form5AdditionalInventors' && input.hasAdditionalInventors) {
    return 'Struck out, but an inventor is marked as an additional inventor who must assent here.'
  }
  if (ticked && key === 'form5AdditionalInventors' && !input.hasAdditionalInventors) {
    return 'Kept in, but no inventor is marked as an additional inventor.'
  }
  return undefined
}

/**
 * Merge the derived layer with the cascade overrides, keeping per-clause provenance so the
 * UI can label each row "rules" / "firm default" / "set on this project" / "you changed
 * this" — attorneys should see what they are overriding before they override it.
 */
export function resolveDeclarations(
  input: DeclarationRuleInput,
  overrides: Array<{ source: SettingSource; patch?: Partial<Record<DeclarationClauseKey, DeclarationState>> | null }>
): ResolvedDeclarationClause[] {
  const derived = deriveDeclarations(input)

  return DECLARATION_CLAUSES.map((def) => {
    let state: DeclarationState = derived[def.key]
    let source: SettingSource = 'rules'

    // Later layers win; an absent key means "inherit", which is why a sparse patch matters.
    for (const layer of overrides) {
      const candidate = layer.patch?.[def.key]
      if (candidate) {
        state = candidate
        source = layer.source
      }
    }

    return {
      key: def.key,
      text: clauseText(def, input.details),
      state,
      group: def.group ?? 'form1_12iii',
      source,
      conflict: detectConflict(def.key, state, input),
    }
  })
}

/** Look up a resolved clause's state, falling back to the derived default. */
export function clauseState(
  declarations: ResolvedDeclarationClause[],
  key: DeclarationClauseKey,
  fallback: DeclarationState = 'strike'
): DeclarationState {
  return declarations.find(c => c.key === key)?.state ?? fallback
}
