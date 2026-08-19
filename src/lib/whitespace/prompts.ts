/**
 * Whitespace Studio — prompts.
 *
 * Kept apart from the service because this module accumulates one prompt per
 * pipeline stage and they are reviewed as a set. Two rules apply to all of them:
 *
 *   1. No prompt may ask a model to produce a measurement. Counts, ratios,
 *      densities and distances are computed in SQL or TypeScript. Models name,
 *      extract, synthesise and criticise — nothing else.
 *   2. No prompt may invite a legal conclusion. "Patentable", "novel",
 *      "non-obvious" and "freedom to operate" are out of scope for this product
 *      and the prompts say so explicitly rather than hoping the model abstains.
 */

import { CORPUS_FIRST_YEAR } from './types'

export const WS_SCOPE_STAGE_CODE = 'WHITESPACE_SCOPE_COMPILE'
export const WS_CLUSTER_LABEL_STAGE_CODE = 'WHITESPACE_CLUSTER_LABEL'
export const WS_CLAIM_ELEMENTS_STAGE_CODE = 'WHITESPACE_CLAIM_ELEMENTS'
export const WS_HYPOTHESIZE_STAGE_CODE = 'WHITESPACE_HYPOTHESIZE'
export const WS_VALIDATE_STAGE_CODE = 'WHITESPACE_VALIDATE'
export const WS_REDTEAM_STAGE_CODE = 'WHITESPACE_REDTEAM'
export const WS_DIMENSION_SEED_STAGE_CODE = 'WHITESPACE_DIMENSION_SEED'
export const WS_DIMENSION_GROW_STAGE_CODE = 'WHITESPACE_DIMENSION_GROW'

/**
 * Turns a plain-language brief into a reviewable research scope.
 *
 * The assumptions block is the point of this prompt. Scope errors are the
 * dominant source of wrong answers in patent analytics and they are invisible
 * unless written down, so the model is required to state its interpretations
 * where a reasonable reader could have read the brief differently.
 */
export function buildScopeCompilePrompt(input: {
  brief: string
  existingTitle?: string
  framing?: 'FIELD' | 'INVENTION'
}): string {
  const currentYear = new Date().getFullYear()
  const inventionFraming =
    input.framing === 'INVENTION'
      ? `
THE BRIEF DESCRIBES A SPECIFIC INVENTION, NOT A FIELD. Define the scope as the technology field IMMEDIATELY SURROUNDING this invention — the space of existing approaches to the same problem, including approaches the invention rejects — not just documents matching the invention itself. A scope that only finds the invention's own wording will make everything look empty; the field around it is what the study measures.

MARK AT MOST ONE CONCEPT AS REQUIRED, AND OFTEN NONE. This is the single most common way an invention scope fails.
Required concepts INTERSECT: a document must contain EVERY required concept to be counted. An invention brief names several elements that work together, and it is tempting to mark them all required — but the documents in the surrounding field solve the same problem in other ways, and almost none of them contain every element of YOUR design. Four required concepts routinely reduce a 30-million-document corpus to nothing.
So: mark required only the single concept that names the problem domain the invention lives in, if any concept does. Leave every component, mechanism and constraint concept optional. Optional concepts are not ignored: the study measures how many documents match at least 1, 2, 3 … of them and picks the tightest count that still yields a field it can analyse — so several well-worded optional concepts give it a ladder to climb, while several required ones give it an empty intersection.
`
      : ''
  return `You are a patent search strategist preparing the scope for a technology landscape study.

The user described ${input.framing === 'INVENTION' ? 'an invention' : 'a field'} in their own words. Convert it into a structured, reviewable research scope. The user will read and correct this before any analysis runs, so favour making your reasoning visible over making it look complete.
${inventionFraming}
USER BRIEF
"""
${input.brief.slice(0, 12000)}
"""
${input.existingTitle ? `\nWorking title: ${input.existingTitle}\n` : ''}
WHAT TO PRODUCE

1. concepts — the 3 to 6 core technical concepts. For each, give the alternative phrasings that actually appear in patent text: functional language, scientific terminology, industry jargon, common acronyms, and the phrasing a patent attorney would use to broaden a claim. This vocabulary determines what the search can see, so be generous and concrete rather than abstract. Mark a concept "required" only if a document that lacks it is certainly irrelevant.

   EVERY LABEL AND SYNONYM IS SEARCHED AS A LITERAL PHRASE. This is the second most common way a scope fails, after marking too many concepts required. A phrase matches only where those words appear together, in that order, in the patent text — so:
   - Keep "label" to at most 6 words. It is searched too, not just displayed. "Soil moisture sensing" works; "Use of weather data and/or forecast for irrigation decisions" matches nothing.
   - Every synonym must be a phrase a patent would literally contain. No explanations, no annotations, no parenthetical asides: write "model predictive control", never "model predictive control (MPC) for irrigation (broadening term)". Give the acronym as its own separate synonym if it is worth searching.
   - Prefer 2 to 4 word phrases. A 7-word synonym is a description, and descriptions match nothing.
   - No slashes joining alternatives — "rain shutoff / rain delay" is two synonyms, not one. Documents are counted when they match every required concept and at least some number of the others — the study measures how many match at least 1, 2, 3 … of the optional concepts and takes the tightest count that still yields a field it can analyse — so prefer several specific optional concepts over one broad one.

2. classifications — 3 to 8 candidate CPC codes, each with a plain-language definition a non-specialist can check. Where a code is broad enough to pull in an adjacent unrelated field, say so in "caution". Prefer subclass or main-group level over very specific subgroups.

3. exclusions — subject matter the brief implies should be kept out, each with a short reason.

4. assumptions — THE MOST IMPORTANT FIELD. Every interpretation you made where the brief was genuinely ambiguous, written as a plain sentence the user can accept or correct. Use kind "interpretation" for these. If the brief was unambiguous throughout, return an empty list rather than inventing doubt.

5. summary — one paragraph restating the field as you understood it.

6. filters — yearFrom (never earlier than ${CORPUS_FIRST_YEAR}), yearTo (never later than ${currentYear}), and jurisdictions as two-letter country codes if and only if the brief names specific territories.

RULES
- Do not assess novelty, patentability or infringement. You are defining a search scope, not evaluating an invention.
- Do not invent CPC codes. If unsure of the exact code, give the closest one you are confident in and note the uncertainty in "caution".
- Prefer the terminology of the field over the user's terminology where they differ, and capture BOTH as synonyms.

Return ONLY a JSON object of this exact shape, with no commentary:

{
  "title": "short field title, max 12 words",
  "summary": "one paragraph",
  "concepts": [
    { "label": "concept name", "synonyms": ["alt phrasing", "..."], "required": true }
  ],
  "classifications": [
    { "code": "A61B5/1455", "definition": "plain language", "caution": "optional warning" }
  ],
  "exclusions": [ { "term": "excluded subject", "reason": "why" } ],
  "assumptions": [ { "text": "I assumed ...", "kind": "interpretation" } ],
  "filters": { "yearFrom": ${CORPUS_FIRST_YEAR}, "yearTo": ${currentYear}, "jurisdictions": [] }
}`
}

/**
 * Narrates the census into the field verdict shown at the top of the overview.
 *
 * Every number is supplied; the model's only job is to read them into prose. It
 * is told not to introduce figures precisely because a plausible invented
 * percentage is the easiest way for this screen to become untrustworthy.
 */
export function buildFieldNarrationPrompt(input: {
  title: string
  familyCount: number
  firstYear: number
  lastYear: number
  peakYear: number | null
  recentTrendPct: number | null
  topAssignees: Array<{ label: string; families: number }>
  topSharePct: number | null
  jurisdictions: Array<{ label: string; families: number }>
  claimsCoveragePct: number
}): string {
  return `You are summarising a patent landscape census for a technically literate reader.

FIELD: ${input.title}

MEASURED FACTS (these are exact; do not restate them as approximations)
- Families in scope: ${input.familyCount.toLocaleString()}
- Filing years covered: ${input.firstYear}-${input.lastYear}
- Peak filing year: ${input.peakYear ?? 'not determinable'}
- Change in filing volume over the last 5 complete years: ${
    input.recentTrendPct === null ? 'not determinable' : `${input.recentTrendPct > 0 ? '+' : ''}${input.recentTrendPct}%`
  }
- Leading assignees: ${input.topAssignees.map(a => `${a.label} (${a.families})`).join(', ') || 'not determinable'}
- Share held by the top 3 assignees: ${input.topSharePct === null ? 'not determinable' : `${input.topSharePct}%`}
- Jurisdictions: ${input.jurisdictions.map(j => `${j.label} ${j.families}`).join(', ') || 'not determinable'}
- Claim text readable for: ${input.claimsCoveragePct}% of families

WRITE
One paragraph, 3 to 5 sentences, describing what this field looks like and what a reader should notice. Lead with the most decision-relevant observation.

RULES
- Use ONLY the figures above. Do not introduce any number that is not listed, and do not round them into vagueness.
- Describe filing activity as filing activity. It is not the same as innovation: propensity to patent varies enormously by industry and firm, and a decline in filings does not establish a decline in inventive work.
- Do not identify opportunities, gaps or whitespace. That is a later stage with its own evidence. This paragraph describes what exists.
- Do not speculate about causes beyond what the figures support.
- No preamble, no headings. Return the paragraph only.`
}

/**
 * Names clusters from their medoid documents. Batched: every cluster in one
 * call, because the labels are read side by side and a shared context stops two
 * adjacent clusters both being named "Machine Learning Methods".
 */
export function buildClusterLabelPrompt(
  clusters: Array<{
    index: number
    medoidTitles: string[]
    abstractSnippets: string[]
    topCpc: Array<{ code: string; families: number }>
  }>
): string {
  const blocks = clusters
    .map(cluster => {
      const cpc = cluster.topCpc.map(entry => `${entry.code} (${entry.families})`).join(', ') || 'none recorded'
      const abstracts = cluster.abstractSnippets
        .slice(0, 2)
        .map(snippet => `  - ${snippet.slice(0, 300)}`)
        .join('\n')
      return `CLUSTER ${cluster.index}
Representative titles:
${cluster.medoidTitles.slice(0, 12).map(title => `  - ${title.slice(0, 160)}`).join('\n')}
Top CPC codes: ${cpc}
${abstracts ? `Abstract snippets:\n${abstracts}` : ''}`
    })
    .join('\n\n')

  return `You are naming technology clusters in a patent landscape. Each cluster below is a group of patent families that sit close together in embedding space. Name what the DOCUMENTS have in common, not what the field generally contains.

${blocks}

For each cluster produce:
- "label": 2-6 words, concrete, distinguishing it from its siblings. Never generic filler like "Miscellaneous" or "Other Technologies".
- "description": one sentence saying what these families are about.
- "keywords": 3-6 terms actually usable as search terms.

RULES
- Name only from the evidence shown. Do not speculate about documents you cannot see.
- Labels must be mutually distinguishing across the set.
- No counts, no percentages, no assessment of opportunity or novelty.

Return ONLY a JSON object:
{ "clusters": [ { "index": 0, "label": "...", "description": "...", "keywords": ["..."] } ] }`
}

/**
 * Claim-element extraction, WIPO-style SAO decomposition. High volume, so the
 * batch carries several families per call. The element vocabulary must be
 * NORMALISED — co-occurrence statistics are computed over these strings, and
 * "ML calibration" vs "machine-learning calibration" as separate elements would
 * quietly destroy the rarity math.
 */
export function buildClaimElementsPrompt(
  families: Array<{ familyKey: string; publicationNumber: string; title: string; claimsText: string }>,
  priorVocabulary: string[]
): string {
  const blocks = families
    .map(
      family => `FAMILY ${family.familyKey} (${family.publicationNumber})
Title: ${family.title.slice(0, 200)}
Claims:
"""
${family.claimsText.slice(0, 6000)}
"""`
    )
    .join('\n\n')

  return `You are decomposing patent claims for co-occurrence analysis. For each family, read the broadest independent claim (or the claim set given) and extract its technical elements.

${priorVocabulary.length ? `VOCABULARY ALREADY IN USE — reuse these exact strings whenever a claim recites the same element, and add new elements only when genuinely new:\n${priorVocabulary.map(term => `  - ${term}`).join('\n')}\n` : ''}
${blocks}

For each family extract:
- "elements": the claim's distinct technical elements, each as a short noun phrase (2-6 words, lowercase, singular). An element is a component, step, or capability the claim actually recites — not the field it belongs to.
- "problem": what the claim addresses, as ACTION + OBJECT (e.g. "measuring glucose non-invasively"). One phrase.
- "solution": the SUBJECT that does it (e.g. "photoacoustic sensor with pressure compensation"). One phrase.
- "constraint": a limitation the claim imposes on itself, if it recites one, else null.

RULES
- Extract only what the claim text recites. Title alone is not evidence of an element.
- Normalise aggressively: same concept, same string, every time.
- 3 to 12 elements per family. If the claims text is a single first claim, extract from that claim only.
- No novelty or quality judgments.

Return ONLY a JSON object:
{ "families": [ { "familyKey": "...", "elements": ["..."], "problem": "...", "solution": "...", "constraint": null } ] }`
}

/**
 * Hypothesis generation. The generator proposes candidates for TESTING — the
 * prompt says so, the schema enforces it (type stays UNDETERMINED until the gate
 * ladder rules), and every input it sees is a measured signal, never a guess.
 */
export function buildHypothesizePrompt(input: {
  fieldTitle: string
  scopeSummary: string
  clusters: Array<{
    label: string
    description: string | null
    grade: string
    density: number | null
    velocityPct: number | null
    crowdedness: number | null
    fieldEstimate: number
  }>
  rarePairs: Array<{
    a: string
    b: string
    supportA: number
    supportB: number
    observed: number
    expected: number
    rarity: number
    clusterLabel: string
  }>
  divergentConcepts: Array<{ concept: string; overlapPct: number; semanticOnlyVocabulary: string | null }>
  maxHypotheses: number
}): string {
  const clusterBlock = input.clusters
    .map(
      cluster =>
        `- "${cluster.label}" (${cluster.grade}): ~${cluster.fieldEstimate} families, density ${
          cluster.density?.toFixed(2) ?? 'n/a'
        }, 5y filing change ${cluster.velocityPct === null ? 'n/a' : `${cluster.velocityPct}%`}, crowdedness ${
          cluster.crowdedness?.toFixed(2) ?? 'n/a'
        }. ${cluster.description ?? ''}`
    )
    .join('\n')

  const pairsBlock = input.rarePairs.length
    ? input.rarePairs
        .map(
          pair =>
            `- "${pair.a}" x "${pair.b}" in ${pair.clusterLabel}: appears together in ${pair.observed} families vs ${pair.expected.toFixed(
              1
            )} expected by chance (supports ${pair.supportA} and ${pair.supportB}); rarity ${pair.rarity.toFixed(2)}`
        )
        .join('\n')
    : 'None computed — no deep dive has run, or no pair cleared the support floor.'

  const divergenceBlock = input.divergentConcepts.length
    ? input.divergentConcepts
        .map(
          concept =>
            `- "${concept.concept}": lexical and semantic retrieval agree on only ${concept.overlapPct}% of top results.${
              concept.semanticOnlyVocabulary ? ` Semantic-only hits use vocabulary like: ${concept.semanticOnlyVocabulary}` : ''
            }`
        )
        .join('\n')
    : 'None detected.'

  return `You are proposing whitespace HYPOTHESES for a patent landscape study. A hypothesis is a candidate for adversarial testing — the system will actively try to refute each one. You are NOT identifying opportunities, and nothing you write will be shown as a finding.

FIELD: ${input.fieldTitle}
${input.scopeSummary}

MEASURED AREA SIGNALS (all numbers computed from the corpus; do not alter them)
${clusterBlock}

UNDER-COMBINED ELEMENT PAIRS (statistically rarer together than chance predicts, both individually well-established)
${pairsBlock}

TERMINOLOGY DIVERGENCE
${divergenceBlock}

PROPOSE up to ${input.maxHypotheses} hypotheses using these three strategies, in priority order:
1. RARE COMBINATION — two well-established elements the field systematically does not combine. Strongest basis; prefer it whenever rare pairs exist.
2. SPARSE-NEXT-TO-ACCELERATING — a low-density area adjacent to a high-velocity one, where the acceleration suggests capability that has not yet been applied to the sparse problem.
3. VOID BETWEEN AREAS — a technically coherent middle ground between two named areas that neither covers.

Each hypothesis:
- "statement": one sentence of the form "X combined with Y for purpose Z appears absent from this field" — concrete and falsifiable. A searcher must be able to attack it.
- "rationale": 2-3 sentences citing ONLY the measured signals above.
- "strategy": "RARE_COMBINATION" | "SPARSE_ADJACENT" | "SEMANTIC_VOID"
- "clusterLabel": the area it belongs to, from the list above.
- "elements": the 2-5 element strings involved, reusing the exact vocabulary from the pairs where applicable.
- "searchTerms": 4-8 terms a skeptical searcher would use to try to find prior art that refutes it.

RULES
- Falsifiable statements only. "There may be opportunities in X" is not a hypothesis.
- Do not claim novelty, patentability, or value. The word "opportunity" must not appear.
- Do not propose anything based on emptiness in a map. Every hypothesis must trace to a signal above.
- Fewer, sharper hypotheses beat more, vaguer ones. Return fewer than ${input.maxHypotheses} if the signals only support fewer.

Return ONLY a JSON object:
{ "hypotheses": [ { "statement": "...", "rationale": "...", "strategy": "...", "clusterLabel": "...", "elements": ["..."], "searchTerms": ["..."] } ] }`
}

/**
 * Disproof query generation + element mapping for one attack round. Prompted to
 * SUCCEED at refutation: a validation loop prompted neutrally will confirm; one
 * prompted adversarially occasionally kills good ideas, which is the correct
 * error direction.
 */
export function buildDisproofQueriesPrompt(input: {
  statement: string
  elements: string[]
  searchTerms: string[]
  cpcCodes: string[]
}): string {
  return `You are attacking a whitespace hypothesis. Your goal is to FIND prior art that refutes it — you are rewarded for destroying the hypothesis, not for defending it.

HYPOTHESIS: ${input.statement}
ELEMENTS: ${input.elements.join(' · ')}
SEARCH TERMS ALREADY KNOWN: ${input.searchTerms.join(', ')}
CPC CODES IN SCOPE: ${input.cpcCodes.join(', ') || 'none'}

Produce disproof search queries across four strategies:
1. "synonymShifted" — 3-4 full-text queries using vocabulary the hypothesis authors did NOT use: competitor jargon, older terminology, adjacent-discipline phrasing, acronyms. Each query is a websearch-style string: quoted phrases and plain terms, where a space means AND and the word OR means OR. Parentheses do NOT group in this syntax — never use them; put each alternative phrasing in its own query instead.
2. "semanticParaphrases" — 2-3 restatements of the hypothesis in completely different words, for embedding search.
3. "cpcAdjacent" — 2-4 CPC codes at subclass or main-group level ADJACENT to the codes in scope, where the same combination might be classified by an examiner who read it differently.
4. "assigneeCandidates" — 3-5 organisations most likely to have filed near this idea, by name as it appears on patents.

Return ONLY a JSON object:
{ "synonymShifted": ["..."], "semanticParaphrases": ["..."], "cpcAdjacent": ["..."], "assigneeCandidates": ["..."] }`
}

/**
 * Maps retrieved candidates against the hypothesis combination. PRESENT for the
 * full combination is the kill condition, so the mapping is asked per element
 * with quotes — a verdict that cannot cite the text does not count.
 */
export function buildElementMappingPrompt(input: {
  statement: string
  elements: string[]
  candidates: Array<{ publicationNumber: string; title: string; abstract: string | null; claimsText: string | null }>
}): string {
  const blocks = input.candidates
    .map(
      candidate => `CANDIDATE ${candidate.publicationNumber}
Title: ${candidate.title.slice(0, 200)}
${candidate.claimsText ? `Claims:\n"""\n${candidate.claimsText.slice(0, 4000)}\n"""` : `Abstract:\n"""\n${(candidate.abstract || '').slice(0, 1200)}\n"""`}`
    )
    .join('\n\n')

  return `You are checking whether retrieved patents refute a whitespace hypothesis by already disclosing its element combination.

HYPOTHESIS: ${input.statement}
ELEMENT COMBINATION TO MAP: ${input.elements.map((element, index) => `E${index + 1}: ${element}`).join(' · ')}

${blocks}

For each candidate, map every element:
- "PRESENT" — the text discloses this element. Quote the disclosing phrase (max 15 words).
- "PARTIAL" — the text discloses something close but narrower/different. Quote and say what differs in <=10 words.
- "ABSENT" — not disclosed.

Judge only from the text shown. Claims text outranks abstract. If only an abstract is shown, mark "basis": "abstract" — an abstract cannot establish PRESENT for a claim-level combination, so cap such elements at PARTIAL.

Return ONLY a JSON object:
{ "candidates": [ { "publicationNumber": "...", "basis": "claims" | "abstract", "elements": [ { "element": "E1", "verdict": "PRESENT" | "PARTIAL" | "ABSENT", "quote": "..." } ], "fullCombination": "PRESENT" | "PARTIAL" | "ABSENT" } ] }`
}

/**
 * The premium red-team pass: reads everything that survived and names the
 * strongest REMAINING attack, plus advisory feasibility/commercial/regulatory
 * flags (G4-G6). Explicitly rewarded for refutation.
 */
export function buildRedTeamPrompt(input: {
  statement: string
  rationale: string
  elements: string[]
  attacksRun: Array<{ strategy: string; query: string; hits: number; outcome: string }>
  survivingNearest: Array<{ publicationNumber: string; title: string; verdict: string }>
}): string {
  return `You are the red team. A whitespace hypothesis has survived the attacks below. Your job is to refute it anyway, or failing that, to name exactly what would.

HYPOTHESIS: ${input.statement}
RATIONALE GIVEN: ${input.rationale}
ELEMENTS: ${input.elements.join(' · ')}

ATTACKS ALREADY RUN
${input.attacksRun.map(attack => `- [${attack.strategy}] "${attack.query}" -> ${attack.hits} hits, ${attack.outcome}`).join('\n')}

CLOSEST SURVIVING ART
${input.survivingNearest.map(candidate => `- ${candidate.publicationNumber}: ${candidate.title.slice(0, 140)} (${candidate.verdict})`).join('\n') || '- none retrieved'}

PRODUCE
1. "strongestRemainingAttack": the single search most likely to kill this hypothesis that has NOT been run — as { "description": one sentence, "query": a full-text query string to execute, or null if no local search could help }.
2. "feasibilityConcern": if the combination was plausibly tried and abandoned, say why in one sentence, else null. Signals: the elements are old, the combination is obvious to attempt, and yet it is absent.
3. "commercialConcern": one sentence naming the most likely commercial reason this is unoccupied, else null. This is advisory — you have no market data and must not imply you do.
4. "regulatoryConcern": one sentence, same standard, else null.
5. "verdict": "REFUTED" only if the evidence above already contains a refutation the earlier mapping missed; otherwise "STANDS".
6. "verdictReason": one sentence.

Return ONLY a JSON object with exactly those keys.`
}

/** Shared JSON contract + rules for both dimension-discovery prompts. */
const DIMENSION_SHAPE = `{ "dimensions": [ { "label": "...", "description": "...", "values": [ { "label": "...", "synonyms": ["..."] } ] } ] }`

const DIMENSION_SHARED_RULES = `- Every axis must be READABLE FROM A TITLE AND ABSTRACT. An axis that needs the full description or the claims cannot be measured here and is worse than no axis.
- Axes must be independent of each other. Two axes that would place the same documents in the same groups are one axis said twice.
- Do NOT estimate how many documents fall anywhere. Do not use "most", "few", "common", "rare", "dominant" or any percentage. The system counts the full field in SQL and your estimate would be overwritten by a real number.
- Do NOT identify gaps, opportunities or unoccupied space. You are describing how this field is organised; emptiness is measured later, by counting.
- Do NOT assess novelty, patentability, inventive step, or freedom to operate.`

/**
 * Seeds the viewpoint registry for an invention-whitespace study — the JPO
 * F-term sense of "viewpoint": an axis along which every document in a field
 * can be placed. The synonyms decide what the SQL census can see, so the prompt
 * pushes hard for concrete, generous vocabulary; the counting itself never
 * touches the model (rule 1 of this module).
 */
export function buildDimensionSeedPrompt(input: {
  inventionBrief: string
  fieldTitle: string
  scopeSummary: string
  sample: Array<{ publicationNumber: string; title: string; abstract: string }>
  maxDimensions: number
  maxValuesPerDimension: number
}): string {
  const documents = input.sample
    .map(doc => `- ${doc.publicationNumber}: ${doc.title.slice(0, 160)}\n  ${doc.abstract.slice(0, 400)}`)
    .join('\n')

  return `You are identifying the VIEWPOINTS that organise an existing body of patent documents — axes along which the documents in this field genuinely differ, in the sense the Japanese Patent Office's F-term system uses the word (purpose, means, material, operating condition, object acted upon, lifecycle stage, failure mode addressed...).

THE INVENTION UNDER STUDY (context for which axes matter — not a document to classify)
"""
${input.inventionBrief.slice(0, 4000)}
"""

FIELD: ${input.fieldTitle || 'the field around this invention'}
${input.scopeSummary ? `${input.scopeSummary.slice(0, 1200)}\n` : ''}
DOCUMENTS (${input.sample.length} families drawn at random from the field; you are seeing a sample, and the system will count the full field itself)
${documents}

PRODUCE up to ${input.maxDimensions} viewpoints. For each:
- "label": the axis, 2-5 words, phrased as the property being varied ("actuation principle", "sensing modality", "lifecycle stage addressed") — never as a value.
- "description": one sentence saying what question this axis asks of a document.
- "values": 3 to ${input.maxValuesPerDimension} positions along the axis. Each needs "label" (how a person would say it) and "synonyms" (3-8 phrasings that actually appear in patent text for this value: functional language, scientific terminology, industry jargon, acronyms, and the phrasing an attorney would use to broaden a claim). The synonyms decide what the search can see, so be concrete and generous.

SIZE THE VALUES TO THE FIELD — this is what most often makes a viewpoint useless.
Each value is matched against the documents by its vocabulary, and a value that matches only a handful of them is discarded. Every value must be a BROAD category that a substantial share of this field falls into, described in the words the documents themselves use. Three broad values that between them place most documents beat eight precise ones that each place a few. If a distinction is real but narrow, fold it into a broader value as a synonym rather than giving it its own position.

Two viewpoint families reliably organise crowded fields and are worth considering alongside the domain-specific ones: LIFECYCLE STAGE (manufacture / installation / calibration / operation / diagnosis / repair / end-of-life) and FAILURE MODE ADDRESSED (which problem of prior systems the document says it fixes). Use them only if the documents support them.

RULES
${DIMENSION_SHARED_RULES}
- Values within an axis should be the distinctions the documents actually make. Do not invent a value because the axis feels incomplete.
- Prefer the field's terminology over the brief's, and capture both as synonyms.

Return ONLY a JSON object:
${DIMENSION_SHAPE}`
}

/**
 * The growth pass: extends the registry from the residual — documents no
 * current axis places. Returning nothing is a valid answer and the prompt says
 * so; the acceptance thresholds are measured by the system, never asserted by
 * the model.
 */
export function buildDimensionGrowPrompt(input: {
  inventionBrief: string
  fieldTitle: string
  registry: Array<{ label: string; values: string[] }>
  residualSample: Array<{ publicationNumber: string; title: string; abstract: string }>
  residualCount: number
  sampleCount: number
  rejectedEarlier: Array<{ label: string; detail: string }>
  maxDimensions: number
  maxValuesPerDimension: number
}): string {
  const registryBlock = input.registry
    .map(dimension => `- "${dimension.label}": ${dimension.values.join(' | ')}`)
    .join('\n')
  const rejectedBlock = input.rejectedEarlier.length
    ? `\nPROPOSALS THE SYSTEM ALREADY MEASURED AND REJECTED (do not re-propose)\n${input.rejectedEarlier
        .map(entry => `- "${entry.label}" — ${entry.detail}`)
        .join('\n')}\n`
    : ''
  const documents = input.residualSample
    .map(doc => `- ${doc.publicationNumber}: ${doc.title.slice(0, 160)}\n  ${doc.abstract.slice(0, 400)}`)
    .join('\n')

  return `You are extending a set of viewpoints that organise a patent field. An earlier pass produced the axes below. The system then matched every axis value against a sample of the field and found documents that NO axis places anywhere.

THE INVENTION UNDER STUDY (context only)
"""
${input.inventionBrief.slice(0, 2000)}
"""

FIELD: ${input.fieldTitle || 'the field'}

MEASURED FACT (computed by the system; do not restate it as an approximation)
- ${input.residualCount} of ${input.sampleCount} sampled families matched no value of any existing axis.

AXES ALREADY IN THE REGISTRY
${registryBlock}
${rejectedBlock}
THE UNPLACED DOCUMENTS (all ${input.residualSample.length} shown are drawn ONLY from the families no axis explains, so they are a biased slice by construction — they are the question, not the field)
${documents}

PRODUCE whichever of these the documents actually justify, and nothing more:
1. NEW VALUES for an existing axis, when the unplaced documents sit on an axis already in the registry but at a position it does not yet name. Return them under that axis's EXACT existing label.
2. A NEW AXIS (up to ${input.maxDimensions} total), when the unplaced documents differ from the placed ones along a property no existing axis asks about. A new axis needs its own "description" and 3 to ${input.maxValuesPerDimension} values.

Values are matched by their vocabulary and a value matching only a handful of documents is discarded, so every value must be a BROAD category covering a substantial share of these unplaced documents, in the words the documents themselves use.

RULES
- Returning { "dimensions": [] } is a valid and often correct answer. The registry is allowed to be finished. Do not invent an axis to fill this response.
- Do not tell us whether your proposal will "cover" the residual. The system measures that and rejects any proposal that does not clear its floor.
${DIMENSION_SHARED_RULES}

Return ONLY a JSON object of the same shape as before:
${DIMENSION_SHAPE}`
}
