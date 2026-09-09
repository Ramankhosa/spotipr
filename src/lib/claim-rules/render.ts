// Renders a claim-rule profile as the JURISDICTION CLAIM RULES prompt block.
//
// Deterministic: the same profile always renders the same bytes, with no
// session data, so the block can sit inside the static per-jurisdiction prompt
// prefix that provider prefix caching keys on.

import type { ClaimRuleProfile } from './types'

const EXCLUSION_LABELS: Record<string, string> = {
  abstract_idea: 'abstract ideas',
  law_of_nature: 'laws of nature',
  natural_phenomenon: 'natural phenomena',
  discovery: 'discoveries',
  s3c_discovery: 'the mere discovery of a scientific principle or a naturally occurring substance (s.3(c))',
  mathematical_method: 'mathematical methods as such',
  mental_act_business_scheme: 'schemes, rules or methods for performing mental acts, playing games or doing business as such',
  computer_program_as_such: 'programs for computers as such',
  computer_program_per_se: 'computer programs per se',
  presentation_of_information: 'presentations of information as such',
  method_of_treatment: 'methods of treatment of the human or animal body by surgery or therapy',
  diagnostic_method: 'diagnostic methods practised on the human or animal body',
  medical_treatment_or_diagnosis: 'methods for the diagnosis or treatment of diseases',
  method_of_medical_treatment: 'methods of medical treatment',
  medical_treatment_of_humans: 'methods of treating, diagnosing or operating on humans',
  plant_animal_variety: 'plant and animal varieties and essentially biological processes',
  animal_plant_variety: 'animal and plant varieties',
  s3d_new_form_of_known_substance: 'a new form of a known substance without enhanced efficacy — salts, esters, polymorphs, isomers, particle size, combinations and derivatives are the same substance unless they differ significantly in efficacy (s.3(d))',
  s3e_mere_admixture: 'a substance obtained by mere admixture resulting only in the aggregation of the properties of its components (s.3(e)) — a composition claim must recite the synergistic or non-additive relationship the source states',
  s3i_medical_treatment_or_diagnosis: 'any process for the medicinal, surgical, curative, prophylactic, diagnostic or therapeutic treatment of humans or animals (s.3(i))',
  s3k_program_algorithm_business_or_mathematical_method: 'a mathematical or business method or a computer programme per se or algorithms (s.3(k))',
  s3m_mental_act_or_game: 'a mere scheme or rule or method of performing a mental act or playing a game (s.3(m))',
  s3n_presentation_of_information: 'a presentation of information (s.3(n))',
  s3p_traditional_knowledge: 'an invention which in effect is traditional knowledge (s.3(p))',
  rules_and_methods_for_mental_activities: 'rules and methods for mental activities (Art. 25)',
  not_a_creation_using_a_law_of_nature: 'subject-matter that is not a creation of a technical idea utilising a law of nature',
  mental_act_or_business_scheme_as_such: 'mental acts and business schemes as such',
  mere_scheme_or_business_method: 'mere schemes and business methods without a technical contribution',
  mere_information: 'mere presentations of information',
  human_beings_and_processes_for_their_generation: 'human beings and the biological processes for their generation',
  abstract_idea_without_physicality: 'abstract ideas lacking physicality',
  higher_life_form: 'higher life forms',
  business_method: 'business methods',
  natural_biological_material: 'natural biological material, even if isolated',
  scheme_rule_or_method_for_business_or_a_game: 'schemes, rules or methods for doing business or playing games',
  rules_of_games_or_business: 'rules and methods of games and business',
}

function labelExclusion(code: string): string {
  return EXCLUSION_LABELS[code] || code.replace(/_/g, ' ')
}

function quote(value: string): string {
  return `"${value}"`
}

function dependentPhraseLines(rules: ClaimRuleProfile): string[] {
  if (rules.language === 'pt-BR') {
    return [
      '- Dependent claims: "<Categoria> de acordo com a reivindicação N, caracterizado por ..." — every claim, independent or dependent, carries "caracterizado por" (mandatory two-part form).',
      rules.multipleDependencyMode === 'none'
        ? '- Each dependent claim refers to exactly one earlier claim.'
        : '- Multiple dependency only in the alternative ("de acordo com a reivindicação 1 ou 2"); a multiple dependent claim must not depend on another multiple dependent claim.',
    ]
  }
  if (rules.language === 'ru') {
    return [
      '- Dependent claims: "<Объект> по п. N, отличающийся тем, что ..." — the independent claim uses the two-part form (ограничительная часть + "отличающийся тем, что" + отличительная часть).',
      rules.multipleDependencyMode === 'none'
        ? '- Each dependent claim refers to exactly one earlier claim.'
        : '- Multiple dependency only in the alternative ("по п. 1 или 2"); a multiple dependent claim must not depend on another multiple dependent claim.',
    ]
  }

  const single: Record<ClaimRuleProfile['dependentClaimPhrase'], string> = {
    of: '"The <preamble noun> of claim N, wherein ..."',
    according_to: '"The <preamble noun> according to claim N, wherein ..."',
    as_claimed_in: '"The <preamble noun> as claimed in claim N, wherein ..."',
    characterized: '"The <preamble noun> according to claim N, characterized in that ..."',
  }
  const multi: Record<ClaimRuleProfile['dependentClaimPhrase'], string> = {
    of: 'of claim 1 or claim 2',
    according_to: 'according to any one of claims 1 to 3',
    as_claimed_in: 'as claimed in any one of claims 1 to 3',
    characterized: 'according to claim 1 or 2',
  }
  const lines = [`- Dependent claims read ${single[rules.dependentClaimPhrase]}; the preamble noun must match the parent claim's preamble noun.`]
  if (rules.multipleDependencyMode === 'none') {
    lines.push('- Each dependent claim refers to exactly ONE earlier claim; never "claims 1 or 2" or "any one of claims".')
  } else if (rules.multipleDependencyMode === 'alternative_only') {
    lines.push(
      `- A dependent claim may refer to several earlier claims only in the alternative (${quote(multi[rules.dependentClaimPhrase])}), never conjunctively ("claims 1 and 2")${rules.multiOnMultiProhibited ? ', and a multiple dependent claim must not serve as the basis for another multiple dependent claim' : ''}.`
    )
  } else {
    lines.push(
      `- Multiple dependency is permitted (${quote(multi[rules.dependentClaimPhrase])})${rules.multiOnMultiProhibited ? ', but a multiple dependent claim must not depend on another multiple dependent claim' : ' and a multiple dependent claim may depend on another'}; use it to keep the set compact.`
    )
  }
  return lines
}

function twoPartLine(rules: ClaimRuleProfile): string {
  const spelling = rules.characterisedSpelling === 's' ? 'characterised in that' : 'characterized in that'
  switch (rules.twoPartForm) {
    case 'required':
      return `- Independent claims use the two-part form: a preamble reciting the subject-matter and the features shared with the closest prior art, then "${rules.language === 'en' ? spelling : rules.preferredTransitions[0] || spelling}" introducing the distinguishing features. Where no closest art is known yet, put the generic, conventional context in the preamble and every source-distinguishing feature in the characterising portion.`
    case 'preferred':
      return `- Two-part form ("${spelling}") is the expected form once the closest prior art is known. Without a completed prior-art search, draft one-part "comprising" claims; the post-search refinement stage converts them. Never place a distinguishing feature in the preamble.`
    case 'discouraged':
      return '- Do not use two-part ("characterized in that" / Jepson) form; a Jepson preamble is an admission that its content is prior art. Use one-part "comprising" claims.'
    default:
      return `- Two-part form ("${spelling}") is permitted but not required; use it only where the closest prior art is known and the split is clean, otherwise draft one-part "comprising" claims.`
  }
}

function useClaimLine(rules: ClaimRuleProfile): string {
  switch (rules.useClaims) {
    case 'not_allowed':
      return '- Use claims ("Use of X for Y") are not a permitted claim category; claim a method (with steps) or a product instead.'
    case 'allowed_as_method':
      return '- A use claim is examined as a method claim; draft it as a method with operative steps rather than as "Use of X for Y".'
    default:
      return '- Use claims ("Use of X for Y") are acceptable for non-medical uses where the source supports the use.'
  }
}

function medicalLine(rules: ClaimRuleProfile): string {
  switch (rules.medicalMethodClaims) {
    case 'allowed':
      return '- Methods of medical treatment and diagnosis are patentable here; a method-of-treatment claim may be drafted where the source supports the regimen.'
    case 'allowed_with_for_use_mirror':
      return '- Method-of-treatment claims are accepted here but excluded in several national phases (EP, IN, JP, KR, CN); draft any treatment method together with a purpose-limited product mirror ("X for use in the treatment of Y") so the set survives national entry.'
    case 'for_use_only':
      return '- Methods of treatment, surgery and diagnosis practised on the human or animal body are excluded (Art. 53(c) EPC); claim the substance in purpose-limited product form: "X for use in the treatment of Y" (Art. 54(4)/(5) EPC). Never draft a method-of-treatment claim and never use Swiss-type wording ("use of X in the manufacture of a medicament").'
    case 'swiss_type_only':
      return '- Methods of treatment and diagnosis are excluded; claim a medical use in Swiss-type form, "Use of X in the manufacture of a medicament for treating Y", or claim the composition and its preparation. Never draft a method-of-treatment claim.'
    case 'composition_only':
      return '- Methods of treating, diagnosing or preventing disease in humans or animals are excluded and second-medical-use claims are not accepted; claim the composition ("A pharmaceutical composition for treating Y, comprising X ..." plus the compositional relationship that distinguishes it) and its preparation process. Never draft a method-of-treatment claim, a "for use in treating" claim, or a Swiss-type use claim.'
    case 'use_claim_only':
      return '- Methods of medical treatment are not patentable; claim a medical use as "Use of X for treating Y" (and claim the composition), never as a method of treatment.'
  }
}

function crmLines(rules: ClaimRuleProfile): string[] {
  switch (rules.crmClaimForm) {
    case 'non_transitory_medium':
      return [
        '- Computer-implemented inventions: draft a method, a system (processor, memory and the operative steps the processor performs) and "A non-transitory computer-readable medium storing instructions which, when executed by a processor, cause the processor to ..." mirroring the method. Every independent claim must recite the specific technical improvement (what the steps change in the machine, signal or data structure), never an abstract idea performed on a generic computer (35 USC 101, Alice).',
      ]
    case 'program_and_medium':
      return [
        '- Computer-implemented inventions: draft a computer-implemented method; a data-processing system or apparatus comprising means configured to carry out the method; "A computer program comprising instructions which, when the program is executed by a computer, cause the computer to carry out the method of claim N"; and "A computer-readable medium having stored thereon the computer program of claim M". The claims need technical character: recite the technical effect and the technical means, not a business, mathematical or administrative method as such.',
      ]
    case 'program_stored_in_medium':
      return [
        '- Computer-implemented inventions: draft a method, an apparatus, and "A computer program stored in a computer-readable medium for executing the method of claim N" (or "A computer-readable medium storing a program that causes a computer to execute the method of claim N"). A program per se is not a permitted category; the invention must be a creation of a technical idea utilising a law of nature.',
      ]
    case 'medium_and_program_product':
      return [
        '- Computer-implemented inventions: draft a method, an apparatus whose technical means perform the steps, "A computer-readable storage medium storing a computer program which, when executed by a processor, implements the method of claim N", and optionally a computer program product. The claims must be a technical solution to a technical problem that achieves a technical effect by technical means; rules and methods for mental activities are excluded.',
      ]
    case 'medium_only':
      return [
        '- Computer-implemented inventions: draft a method, an apparatus and a computer-readable medium claim mirroring the method; do not claim a program per se, and anchor every independent claim in a technical effect achieved by technical means.',
      ]
    case 'not_recommended':
      return [
        '- Computer-implemented inventions: do not draft a bare "computer-readable medium" or "computer program" claim (s.3(k): computer programme per se). Draft a method whose steps recite the technical effect and the hardware the steps act on or cooperate with, and a system whose hardware elements (processor, sensors, controllers, interfaces) cooperate to produce that technical effect. A pure algorithm, business method or mathematical method is not claimable in any form.',
      ]
  }
}

function numeralLine(rules: ClaimRuleProfile): string {
  switch (rules.referenceNumerals) {
    case 'recommended_if_drawings':
      return '- Reference signs: where drawings exist, put the reference sign of each claimed feature in parentheses after the feature; reference signs do not limit the claim. Omit them when no drawings exist yet.'
    case 'not_allowed':
      return '- Do not use reference numerals inside claims.'
    case 'optional':
      return '- Reference numerals in claims are optional; omit them unless supplied.'
    default:
      return '- Reference numerals in parentheses are permitted and non-limiting; include them only when supplied.'
  }
}

function omnibusLine(rules: ClaimRuleProfile): string {
  switch (rules.omnibusClaims) {
    case 'customary':
      return '- Omnibus claims are valid and customary here: end the set with "A <category> substantially as herein described with reference to the accompanying drawings" (or "... as herein described and exemplified"). Every other claim defines the invention in its own words.'
    case 'permitted':
      return '- Omnibus claims are permitted but not required; every other claim must define the invention in its own words.'
    default:
      return '- Never refer to the description or drawings inside a claim ("as described herein", "as shown in Fig. 2") and never draft an omnibus claim.'
  }
}

function countLines(rules: ClaimRuleProfile): string[] {
  const lines: string[] = [`- Default claim budget: ${rules.defaultClaimBudget} claims unless the attorney asks for a different count.`]
  if (rules.freeTotalClaims === 0) {
    lines.push('- Every claim carries a fee from the first claim; keep the set as compact as the fallback positions allow.')
  } else if (typeof rules.freeTotalClaims === 'number') {
    lines.push(`- ${rules.freeTotalClaims} claims are covered by the basic fee; each further claim costs extra.`)
  }
  if (typeof rules.freeIndependentClaims === 'number' && rules.freeIndependentClaims > 0) {
    lines.push(`- ${rules.freeIndependentClaims} independent claims are covered by the basic fee; each further independent claim costs extra.`)
  }
  if (rules.singleIndependentPerCategory) {
    lines.push('- One independent claim per category (product, process, apparatus, use) unless the subject-matter involves interrelated products, different uses of a product or apparatus, or alternative solutions to one problem that cannot be covered by a single claim (Rule 43(2) EPC).')
  }
  if (rules.feeNote) lines.push(`- Fees: ${rules.feeNote}`)
  return lines
}

export function renderJurisdictionClaimRulesBlock(rules: ClaimRuleProfile): string {
  const form: string[] = [
    ...dependentPhraseLines(rules),
    twoPartLine(rules),
    `- Transitions: prefer ${rules.preferredTransitions.map(quote).join(', ')}${rules.discouragedTransitions.length ? `; avoid ${rules.discouragedTransitions.map(quote).join(', ')} unless the source requires a closed scope` : ''}.`,
    numeralLine(rules),
    omnibusLine(rules),
  ]
  if (rules.forbiddenPhrases.length) {
    form.push(`- Never write: ${rules.forbiddenPhrases.map(quote).join(', ')}.`)
  }
  if (rules.claimOrdering === 'decreasing_scope') {
    form.push('- Arrange the claims of each category in decreasing order of scope, broadest first.')
  } else {
    form.push('- Number claims consecutively from 1; group every dependent claim after the independent claim it narrows, broadest narrowing first.')
  }

  const eligibility: string[] = [
    useClaimLine(rules),
    medicalLine(rules),
    ...crmLines(rules),
  ]
  if (rules.excludedSubjectMatter.length) {
    eligibility.push(`- Not patentable as such: ${rules.excludedSubjectMatter.map(labelExclusion).join('; ')}. Where the invention touches one of these, recite the technical means and technical effect that take it outside the exclusion; where it cannot, do not claim it.`)
  }
  eligibility.push(
    rules.productByProcess === 'only_if_necessary'
      ? '- Product-by-process wording ("obtainable by the process of claim N") only where the product cannot be defined by its structure or composition.'
      : '- Product-by-process wording is acceptable but is construed by the process; prefer structural or compositional definition where the source gives it.'
  )

  const support: string[] = []
  if (rules.requireSupportInDescription) {
    support.push('- Every claim element must be supported by the description; claim only what the disclosure supports.')
  }
  support.push(`- Unity: ${rules.unityStandard}. Every independent claim must share the distinguishing technical features of Claim 1.`)

  const sections = [
    `JURISDICTION CLAIM RULES (${rules.jurisdiction} — ${rules.office}) [claim-rules v${rules.rulesVersion}]`,
    'These are the office\'s form and eligibility requirements. They override the general drafting doctrine below wherever the two differ.',
    'FORM:',
    ...form,
    'ELIGIBILITY AND CATEGORY CONVERSIONS:',
    ...eligibility,
    'COUNT AND FEES:',
    ...countLines(rules),
    'SUPPORT AND UNITY:',
    ...support,
  ]
  if (rules.notes.length) {
    sections.push('OFFICE NOTES:')
    sections.push(...rules.notes.map(note => `- ${note}`))
  }
  return sections.join('\n')
}
