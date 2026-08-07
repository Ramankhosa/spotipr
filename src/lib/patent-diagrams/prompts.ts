import type { FigureSetPlanItem, PatentDiagramComponent, PatentDiagram, DiagramKind } from './types'
import { DEFAULT_FIGURE_KINDS } from './types'
import { PATENT_DIAGRAM_STYLE } from './style'
import { PATENT_DIAGRAM_COMPLEXITY } from './policy'

// Reference signs are shown because the builder prints them on the drawn boxes —
// a model that cannot see them cannot pick the right component per step or
// preserve the disclosed order. They are identification only; the prompts forbid
// copying them into labels (the builder appends the sign itself).
function componentLines(components: PatentDiagramComponent[], options?: { withClaims?: boolean }): string {
  return components.map(component => {
    const detail = component.description ? ` — ${component.description}` : ''
    const parent = component.parentId ? `; parent=${component.parentId}` : ''
    const reference = component.referenceLabel ? `; ref=${component.referenceLabel}` : ''
    const claims = options?.withClaims && component.claimSupport?.matchedClaims?.length
      ? `; claims=${component.claimSupport.matchedClaims.join(',')}`
      : ''
    return `- id=${component.id}${reference}; name=${component.name}; type=${component.type || 'OTHER'}${parent}${claims}${detail}`
  }).join('\n')
}

// The evidence catalog is the only record of disclosed OPERATIONS the figure
// model sees — the Component Planner registry is components (nouns) only, so a
// flowchart verb has no other anchor. Process-step facts are surfaced first and
// under their own heading so they read as the step vocabulary rather than as
// provenance tags to sprinkle on.
function evidenceCatalogBlock(catalog: Array<{ id: string; value: string }>): string {
  if (!catalog.length) return 'No structured evidence IDs are available; return an empty evidenceIds array.'
  const line = (item: { id: string; value: string }) => `- ${item.id}: ${item.value}`
  const processSteps = catalog.filter(item => item.id.startsWith('SF-processSteps-'))
  const rest = catalog.filter(item => !item.id.startsWith('SF-processSteps-'))
  if (!processSteps.length) return rest.map(line).join('\n')
  return [
    'DISCLOSED METHOD STEPS (preferred step vocabulary):',
    ...processSteps.map(line),
    '',
    'OTHER DISCLOSED FACTS:',
    ...rest.map(line),
  ].join('\n')
}

// A normalized idea record runs to ~95k characters, and embedding it verbatim
// pushed prompts past 27k tokens — enough to exceed the configured stage input
// limit on larger inventions and fail the figure outright. These keys never
// inform a drawing: claim-generation QA metadata, evidence ledgers and claim
// copies supplied separately below, and the component list that the COMPONENT
// PLANNER REGISTRY section already renders verbatim.
const NON_FIGURE_CONTEXT_KEYS = new Set([
  'claimGenerationQuality',
  'components',
  'claims',
  'claimsFinal',
  'claimsProvisional',
  'claimsStructured',
  'claimsStructuredFinal',
  'claimsStructuredProvisional',
  'claimsApprovedAt',
  'claimsApprovedBy',
  'claimsGeneratedAt',
  'detailedDescriptionSourceSelection',
  'detailedDescriptionInjectionControls',
  'normalizationReviewWarnings',
  'sourceInputMeta',
  'sourceHandlingMode',
  'riskFlags',
  'searchQuery',
])
const MAXIMUM_CONTEXT_CHARACTERS = 12_000
const MAXIMUM_CLAIMS_CHARACTERS = 6_000

function compactInventionContext(context: unknown): string {
  if (!context || typeof context !== 'object') return JSON.stringify(context ?? {})
  const priority = [
    'processSteps', 'relationships', 'interactions', 'materials', 'constituents',
    'conditions', 'ranges', 'quantities', 'embodiments', 'alternatives',
    'sourceFactLedger', 'supportDataSources', 'technicalProblem', 'technicalSolution',
    'novelFeatures', 'advantages', 'detailedDescription',
  ]
  const entries = Object.entries(context as Record<string, unknown>)
    .filter(([key, value]) => !NON_FIGURE_CONTEXT_KEYS.has(key) && value != null && value !== '')
    .sort(([left], [right]) => {
      const leftPriority = priority.indexOf(left)
      const rightPriority = priority.indexOf(right)
      return (leftPriority < 0 ? priority.length : leftPriority) - (rightPriority < 0 ? priority.length : rightPriority)
    })
  const selected: Record<string, unknown> = {}
  for (const [key, value] of entries) {
    const candidate = JSON.stringify({ ...selected, [key]: value })
    if (candidate.length <= MAXIMUM_CONTEXT_CHARACTERS) selected[key] = value
  }
  return JSON.stringify(selected)
}

function compactClaimsContext(claims: unknown): string {
  const rows = Array.isArray(claims)
    ? claims
    : claims && typeof claims === 'object' && Array.isArray((claims as any).claims)
      ? (claims as any).claims
      : [claims]
  const selected: unknown[] = []
  for (const row of rows.filter(Boolean)) {
    const candidate = JSON.stringify([...selected, row])
    if (candidate.length <= MAXIMUM_CLAIMS_CHARACTERS) selected.push(row)
  }
  return JSON.stringify(selected)
}

export function buildFigureSetPlanningPrompt(input: {
  inventionTitle: string
  patentType?: string | null
  inventionContext: unknown
  claimsContext: unknown
  components: PatentDiagramComponent[]
  evidenceCatalog?: Array<{ id: string; value: string }>
  existingFigures?: Array<{ figureNo: number; title: string; kind?: string | null; componentIds: string[] }>
  /** Exact count in manual mode; the computed suggestion in auto mode. */
  figureCount: number
  exactFigureCount?: boolean
  instructions?: string
}): string {
  const catalog = input.evidenceCatalog || []
  const kindPlan = Array.from({ length: input.figureCount }, (_, index) => DEFAULT_FIGURE_KINDS[index % DEFAULT_FIGURE_KINDS.length])
  const claimedComponents = input.components.filter(component => (component.claimSupport?.matchedClaims?.length || 0) > 0)
  const targets = PATENT_DIAGRAM_COMPLEXITY.planningTargets
  // Manual mode pins the count and cycles the four kinds; auto mode lets the
  // planner size the set to the disclosure so complex inventions get more,
  // smaller figures instead of four dense ones.
  const figureSetBlock = input.exactFigureCount
    ? `FIGURE SLOTS — plan exactly ${input.figureCount} figure(s), in this order and of these kinds:
${kindPlan.map((kind, index) => `${index + 1}. ${kind}`).join('\n')}`
    : `FIGURE SET — choose the figure count yourself: at least 4 and at most 20 figures.
- Include at least one figure of each kind: COMPONENT, PROCESS, SEQUENCE, CONSTITUENT.
- Suggested for this disclosure: about ${input.figureCount} figure(s). Exceed the suggestion whenever it keeps figures readable.
- When the architecture is larger than one readable figure, plan one COMPONENT overview (subsystem level, using the registry's parent components) plus one COMPONENT detail figure per subsystem showing its children.
- When the method is longer than one readable flowchart, plan one PROCESS figure per phase, in disclosed order.
- Prefer MORE, SMALLER figures over one dense figure — a figure that must be zoomed to be read is a defective patent drawing.`

  return `You are the PatentNest patent figure-set planner. Your plan drives formal patent drawings, so precision beats creativity.

OUTPUT
Return JSON only. No PlantUML, no styling, no reference numerals, no prose outside JSON, no markdown fences.

${figureSetBlock}

WHAT EACH KIND DEPICTS
- COMPONENT: the system/product architecture — subsystems and the registry elements inside them.
- PROCESS: the claimed method — every operation and decision performed by a named registry component. Never a generic application walkthrough or product-lifecycle story.
- SEQUENCE: the ordered technical interactions between registry components over time.
- CONSTITUENT: the composition — constituents, their technical roles, and disclosed quantities or ranges.

RULES
1. Use only Component Planner IDs from the registry below. Component names, types, and hierarchy are immutable.
2. Never copy a ref= numeral into any text you return; the server prints every reference numeral itself.
3. Plan only subject matter found in the invention context, claims, or registry. If the disclosure is thin for a kind, plan the most faithful figure it supports rather than inventing content.
${claimedComponents.length
  ? `4. CLAIM COVERAGE — each of these claim-recited components must appear in the componentIds of at least one figure: ${claimedComponents.map(component => `${component.id} (claims ${component.claimSupport!.matchedClaims.join(',')})`).join(', ')}. Place each where it belongs technically; the COMPONENT figure usually carries most.`
  : `4. CLAIM COVERAGE — claim-to-component matching has not run for this invention; use the claims context below to judge which components must be depicted.`}
5. For COMPONENT figures, state the subsystem grouping and its order in orderedGroups.
6. For PROCESS and SEQUENCE figures, set evidenceIds to the disclosed-step IDs the figure depicts and phaseHints to the phase order.
7. READABILITY — target at most ${targets.components} components, ${targets.steps} steps, ${targets.interactions} interactions, or ${targets.constituents} constituents per figure so every label prints legibly on A4 without zooming. Split subject matter into further figures rather than exceeding a target; a figure that comes out denser is flagged for attorney review.
8. Give every figure a distinct stable key, a short filing title, and a one-sentence technical purpose.

QUALITY BAR
A planned figure must read like a patent drawing, not a software diagram: functional patent terminology (never vendors, APIs, SDKs, or implementation details), disclosed order preserved, one idea per figure, and every element traceable to a registry component.

Required JSON shape:
{
  "schemaVersion": 3,
  "figures": [{
    "key": "stable-key",
    "kind": "COMPONENT|SEQUENCE|PROCESS|CONSTITUENT",
    "title": "short filing title",
    "purpose": "technical purpose",
    "detailLevel": "OVERVIEW|DETAIL",
    "direction": "TB|LR",
    "componentIds": ["component-id"],
    "claimCriticalComponentIds": ["component-id"],
    "orderedGroups": [{"id":"group-id","label":"short subsystem label","componentIds":["component-id"]}],
    "phaseHints": ["short phase label"],
    "evidenceIds": ["supported evidence ID"]
  }]
}

INVENTION TITLE: ${input.inventionTitle}
PATENT TYPE: ${input.patentType || 'SYSTEM'}
USER INSTRUCTIONS: ${input.instructions || 'None'}
INVENTION CONTEXT:
${compactInventionContext(input.inventionContext)}

CLAIMS CONTEXT:
${compactClaimsContext(input.claimsContext)}

${input.existingFigures?.length ? `EXISTING FIGURES (do not repeat their subject matter):\n${JSON.stringify(input.existingFigures)}` : 'EXISTING FIGURES: none supplied.'}

SUPPORTED EVIDENCE CATALOG:
${evidenceCatalogBlock(catalog)}

COMPONENT PLANNER REGISTRY (listed in disclosed order; preserve it):
${componentLines(input.components, { withClaims: true })}`
}

function kindShape(kind: DiagramKind): string {
  if (kind === 'COMPONENT') {
    return `{
  "kind":"COMPONENT", "systemBoundaryLabel":"short system name",
  "groups":[{"id":"group-id","label":"subsystem label","rows":[{"componentIds":["one-to-${PATENT_DIAGRAM_STYLE.maximumComponentsPerRow} IDs in semantic order"]}]}],
  "components":[{"componentId":"id","displayLabel":"maximum ${PATENT_DIAGRAM_STYLE.maximumLabelWords} words","optional":false,"external":false}],
  "relationships":[{"fromId":"id","toId":"id","category":"PRIMARY|DATA_INPUT|TECHNICAL_OUTPUT|EVIDENCE|GENERATED_CONTENT|CONTROL|CONFIGURATION|VALIDATION|RESPONSE|REVIEW_FEEDBACK|STORAGE|OPTIONAL|ASSOCIATION","evidenceIds":["id"]}]
}`
  }
  if (kind === 'SEQUENCE') {
    return `{
  "kind":"SEQUENCE",
  "participants":[{"componentId":"id","displayLabel":"maximum ${PATENT_DIAGRAM_STYLE.maximumLabelWords} words"}],
  "interactions":[{"order":1,"fromId":"id","toId":"id","label":"maximum ${PATENT_DIAGRAM_COMPLEXITY.connectorLabelWords} words","category":"PRIMARY|RESPONSE|CONTROL|OPTIONAL","phase":"short phase","alternative":{"condition":"short condition","branch":"IF|ELSE"},"evidenceIds":["id"]}]
}`
  }
  if (kind === 'PROCESS') {
    return `{
  "kind":"PROCESS",
  "nodes":[{"key":"stable-step-key","kind":"STEP|DECISION","componentId":"REQUIRED — the registry ID performing this operation","relatedComponentIds":["other participating registry IDs"],"evidenceIds":["catalog IDs this step paraphrases"],"label":"verb-led maximum ${PATENT_DIAGRAM_STYLE.maximumLabelWords} words","phase":"short phase"}],
  "transitions":[{"fromId":"step-key","toId":"step-key","label":"decision outcome only (e.g. yes/no); empty string for step-to-step","category":"PRIMARY|CONTROL|OPTIONAL","evidenceIds":["id"]}]
}`
  }
  return `{
  "kind":"CONSTITUENT", "boundaryLabel":"short composition name",
  "constituents":[{"componentId":"id","displayLabel":"maximum ${PATENT_DIAGRAM_STYLE.maximumLabelWords} words","technicalRole":"maximum 4 words — long role text widens the box and shrinks the printed figure","quantityOrRange":"only when disclosed","evidenceIds":["id"]}],
  "relationships":[{"fromId":"id","toId":"id","category":"ASSOCIATION|PRIMARY|OPTIONAL","evidenceIds":["id"]}]
}`
}

function minimumContent(kind: DiagramKind): string {
  if (kind === 'COMPONENT') return 'at least 1 group, at least 1 component ID in EVERY row (never an empty row), and at least 1 component'
  if (kind === 'SEQUENCE') return 'at least 2 participants and at least 1 interaction'
  if (kind === 'PROCESS') return 'at least 2 nodes and at least 1 transition'
  return 'at least 1 constituent'
}

/**
 * Details a batch of planned figures (the pipeline sends two) in one call.
 *
 * Ordering matters for provider prompt caching: every block up to the
 * figure-specific tail is identical across all generation calls of one run, so
 * those calls share one cached prefix. Do not interleave plan-specific values
 * above the FIGURES TO DETAIL marker.
 *
 * That boundary is returned as `cacheablePrefixLength` rather than left as a
 * convention: OpenAI and Gemini find the shared prefix themselves, but Anthropic
 * caches nothing without an explicit breakpoint, and a breakpoint guessed inside
 * the provider would silently drift the first time this template is edited.
 */
export function buildDiagramBatchPrompt(input: {
  plans: FigureSetPlanItem[]
  inventionContext: unknown
  claimsContext: unknown
  components: PatentDiagramComponent[]
  evidenceCatalog?: Array<{ id: string; value: string }>
  existingDiagrams?: PatentDiagram[]
  instructions?: string
}): { prompt: string; cacheablePrefixLength: number } {
  const prefix = `You are the PatentNest semantic figure detailer. Your JSON becomes a formal patent drawing, so precision beats creativity.

OUTPUT
Return JSON only. Never return PlantUML, reference numerals, styles, colours, layout-only links, markdown, or commentary.

RULES
1. IDENTITY — use only Component Planner IDs from the registry below. Never invent components, operations, or unsupported quantities. Reference signs (ref=) are shown for identification only.
2. NUMBERING — the server prints each component's reference numeral on its drawn box; you never write numerals (100, S100, D100 or similar) into any label. In a PROCESS figure every STEP and every DECISION MUST set componentId to the registry component that performs it — that componentId is where the box's printed numeral comes from, and a node without one is drawn unnumbered and flagged for attorney review. List further participating components in relatedComponentIds.
3. GROUNDING — depict only what the invention context, claims, or registry disclose. Never add boilerplate or lifecycle content: no start/end terminals, initialization, login, deployment, testing, monitoring, or generic error handling unless the disclosure claims it as part of the invention. Write PROCESS steps by paraphrasing the DISCLOSED METHOD STEPS in the catalog below when it exists, and cite the IDs you paraphrase in evidenceIds. Do not invent evidence IDs.
4. LABELS — functional names of at most ${PATENT_DIAGRAM_STYLE.maximumLabelWords} words. COMPONENT and CONSTITUENT connectors are UNLABELLED: omit the label field entirely; the category carries the meaning and picks the arrow style. Only SEQUENCE interaction labels and PROCESS decision-branch outcomes are drawn — keep those to at most ${PATENT_DIAGRAM_COMPLEXITY.connectorLabelWords} words.
5. ORDER — preserve the supplied component, group, participant, step, and phase order.
6. SCOPE — draw each planned figure whole and nothing more: include every planned componentId, honour the planned coverage, and leave content beyond the plan out.

The server assigns canonical names, reference numerals, wrapping, rows, arrows, and all visual styling.

USER MODIFICATION INSTRUCTIONS:
${input.instructions || 'None'}

INVENTION CONTEXT:
${compactInventionContext(input.inventionContext)}

CLAIMS CONTEXT:
${compactClaimsContext(input.claimsContext)}

SUPPORTED EVIDENCE CATALOG:
${evidenceCatalogBlock(input.evidenceCatalog || [])}

COMPONENT PLANNER REGISTRY (listed in disclosed order; preserve it):
${componentLines(input.components)}

`
  const tail = `FIGURES TO DETAIL — return exactly ${input.plans.length} diagram(s) in this order:
{"diagrams":[ ${input.plans.map(plan => `<${plan.kind} for key "${plan.key}">`).join(', ')} ]}

${input.plans.map((plan, index) => `--- FIGURE ${index + 1} of ${input.plans.length} ---
Common fields this diagram must carry verbatim:
{"schemaVersion":3,"key":"${plan.key}","title":"${plan.title}","purpose":"${plan.purpose}","detailLevel":"${plan.detailLevel}","direction":"${plan.direction}","claimCriticalComponentIds":${JSON.stringify(plan.claimCriticalComponentIds)},"evidenceIds":${JSON.stringify(plan.evidenceIds)}}

Merge those with this ${plan.kind} shape:
${kindShape(plan.kind)}

Minimum content: ${minimumContent(plan.kind)}. If the disclosure cannot support that much, still return the
elements you CAN ground rather than an empty figure.

FIGURE PLAN:
${JSON.stringify(plan)}`).join('\n\n')}

${input.existingDiagrams?.length ? `\nEXISTING MANAGED SEMANTIC MODELS (retain stable keys unless instructed otherwise):\n${JSON.stringify(input.existingDiagrams)}` : ''}`
  return { prompt: `${prefix}${tail}`, cacheablePrefixLength: prefix.length }
}

/**
 * User-directed split: re-details ONE managed figure as `parts` figures of the
 * same kind. Unlike the deleted mechanical decomposer, the model partitions
 * semantically — each part must stand alone as a fileable figure — and it sees
 * the rest of the drawing set so the parts do not duplicate other figures.
 */
export function buildFigureSplitPrompt(input: {
  original: PatentDiagram
  parts: number
  otherFigures: Array<{ figureNo: number; title: string; kind?: string | null; componentIds: string[] }>
  inventionContext: unknown
  claimsContext: unknown
  components: PatentDiagramComponent[]
  evidenceCatalog?: Array<{ id: string; value: string }>
  instructions?: string
}): string {
  const kind = input.original.kind
  return `You are the PatentNest figure splitter. Your JSON becomes formal patent drawings, so precision beats creativity.

OUTPUT
Return JSON only: {"diagrams":[ exactly ${input.parts} ${kind} diagram(s) ]}. Never return PlantUML, reference numerals, styles, markdown, or commentary.

TASK
Split the ORIGINAL FIGURE below into exactly ${input.parts} self-contained ${kind} sub-figures.

RULES
1. COMPLETENESS — every element of the original (every ${kind === 'COMPONENT' ? 'component' : kind === 'SEQUENCE' ? 'participant and interaction' : kind === 'PROCESS' ? 'step and decision' : 'constituent'} and every relationship) must appear in exactly one part. Never drop content; an endpoint shared by two parts may repeat in both.
2. COHERENCE — divide along technical seams (subsystems, phases, groups), not by count. Each part must read as one complete idea with its own short filing title and one-sentence purpose. Balance the parts roughly; no part may hold almost everything.
3. NO DUPLICATION — the drawing set already contains the OTHER FIGURES listed below. Do not re-depict their subject matter; the parts replace only the original figure.
4. IDENTITY — use only Component Planner IDs from the registry below. Never invent components, operations, or quantities. Reference signs (ref=) are identification only; the server prints every numeral itself.${kind === 'PROCESS' ? '\n5. NUMBERING — every STEP and DECISION MUST set componentId to the registry component that performs it; a node without one is drawn unnumbered and flagged for attorney review.' : ''}
${kind === 'PROCESS' ? '6' : '5'}. LABELS — functional names of at most ${PATENT_DIAGRAM_STYLE.maximumLabelWords} words; connector rules are unchanged from the original figure's kind.

USER INSTRUCTIONS:
${input.instructions || 'None'}

ORIGINAL FIGURE (semantic model to split):
${JSON.stringify(input.original)}

OTHER FIGURES IN THIS DRAWING SET (do not duplicate their subject matter):
${input.otherFigures.length ? JSON.stringify(input.otherFigures) : 'none'}

INVENTION CONTEXT:
${compactInventionContext(input.inventionContext)}

CLAIMS CONTEXT:
${compactClaimsContext(input.claimsContext)}

SUPPORTED EVIDENCE CATALOG:
${evidenceCatalogBlock(input.evidenceCatalog || [])}

COMPONENT PLANNER REGISTRY (listed in disclosed order; preserve it):
${componentLines(input.components)}

Each returned diagram must carry: {"schemaVersion":3,"kind":"${kind}","key":"part-key","title":"short distinct filing title","purpose":"one-sentence technical purpose","detailLevel":"DETAIL","direction":"${input.original.direction}","claimCriticalComponentIds":[...subset relevant to that part...],"evidenceIds":[...catalog IDs that part depicts...]} merged with this ${kind} shape:
${kindShape(kind)}`
}

export function extractJsonObject(text: string): unknown {
  const trimmed = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(trimmed) } catch {}
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1))
  throw new Error('LLM response did not contain a JSON object')
}
