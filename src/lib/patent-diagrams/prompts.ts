import type { FigureSetPlanItem, PatentDiagramComponent, PatentDiagram } from './types'
import { PATENT_DIAGRAM_STYLE } from './style'
import { PATENT_DIAGRAM_COMPLEXITY } from './policy'

// Reference signs are shown because the builder promotes a component's
// reference label to a step identifier when it looks like S100 — a model that
// cannot see them cannot pick the right component per step or preserve the
// disclosed step order. They are identification only; the prompts forbid
// copying them into labels (the builder appends the sign itself).
function componentLines(components: PatentDiagramComponent[], options?: { withClaims?: boolean }): string {
  return components.map(component => {
    const detail = component.description ? ` — ${component.description}` : ''
    const parent = component.parentId ? `; parent=${component.parentId}` : ''
    const reference = component.referenceLabel ? `; ref=${component.referenceLabel}` : ''
    // Planning needs to know which components the claims actually name; the
    // detail prompt does not, and the extra tokens would only add noise there.
    const claims = options?.withClaims && component.claimSupport?.matchedClaims?.length
      ? `; claims=${component.claimSupport.matchedClaims.join(',')}`
      : ''
    return `- id=${component.id}${reference}; name=${component.name}; type=${component.type || 'OTHER'}${parent}${claims}${detail}`
  }).join('\n')
}

// Components the claims depend on, per upstream Stage 0 matching. Empty when
// that matching has not run — planning must still work in that case.
export function claimCriticalComponentIds(components: PatentDiagramComponent[]): string[] {
  return components
    .filter(component => (component.claimSupport?.matchedClaims?.length || 0) > 0)
    .map(component => component.id)
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
// pushed detail prompts past 27k tokens — enough to exceed the configured stage
// input limit on larger inventions and fail the figure outright. These keys
// never inform a drawing: claim-generation QA metadata, evidence ledgers and
// claim copies that are supplied separately below, and the component list that
// the COMPONENT PLANNER REGISTRY section already renders verbatim.
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
  'sourceFactLedger',
  'supportDataSources',
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

function truncateForPrompt(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}\n…[truncated for prompt budget]`
}

function compactInventionContext(context: unknown): string {
  if (!context || typeof context !== 'object') return JSON.stringify(context ?? {})
  const filtered = Object.fromEntries(
    Object.entries(context as Record<string, unknown>)
      .filter(([key, value]) => !NON_FIGURE_CONTEXT_KEYS.has(key) && value != null && value !== ''),
  )
  return truncateForPrompt(JSON.stringify(filtered), MAXIMUM_CONTEXT_CHARACTERS)
}

function compactClaimsContext(claims: unknown): string {
  return truncateForPrompt(JSON.stringify(claims ?? []), MAXIMUM_CLAIMS_CHARACTERS)
}

export function buildFigureSetPlanningPrompt(input: {
  inventionTitle: string
  patentType?: string | null
  inventionContext: unknown
  claimsContext: unknown
  components: PatentDiagramComponent[]
  evidenceCatalog?: Array<{ id: string; value: string }>
  figureCount?: number | null
  instructions?: string
}): string {
  const catalog = input.evidenceCatalog || []
  const processSteps = catalog.filter(item => item.id.startsWith('SF-processSteps-'))
  const claimCritical = claimCriticalComponentIds(input.components)
  const countRule = input.figureCount
    ? `Plan exactly ${input.figureCount} base figure(s), before any density-driven detail figures.`
    : 'Choose the smallest figure set that covers the claims — never more than 6 figures. The server discards any figure past the sixth. One of the six may be an enlarged detail view of a region of another figure when that region is too dense to read at filing scale.'
  return `You are the PatentNest patent figure-set planner.

Return JSON only. Do not return PlantUML, styling, reference numerals, prose outside JSON, or markdown fences.

Use only these diagram kinds: COMPONENT, SEQUENCE, PROCESS, CONSTITUENT.
Use only Component Planner IDs listed below. Component names, types, and hierarchy are immutable; server code resolves reference signs, so never copy a ref= value into any text you return.
Choose COMPONENT for system/product architecture, PROCESS for method or flow figures, SEQUENCE only for meaningful interactions, and CONSTITUENT for composition/formulation figures.
${processSteps.length
  ? `Plan a PROCESS figure only when the DISCLOSED METHOD STEPS below actually support it, and set evidenceIds to the step IDs that figure will depict. Every PROCESS figure you plan is later required to cite these IDs step by step — a flow you cannot back with them cannot be drawn, so do not plan it.`
  : `No disclosed method steps are available for this invention. Do NOT plan a PROCESS figure: there is no disclosed operation to depict, and a flowchart planned here would have to be invented downstream. Leave evidenceIds empty.`}
${claimCritical.length
  ? `These components are named by the claims and every one of them must appear in the componentIds of at least one figure: ${claimCritical.join(', ')}. List the ones a figure covers in that figure's claimCriticalComponentIds.`
  : `Claim-to-component matching is unavailable for this invention; use the claims context below to judge what must be covered.`}
Preserve claim-critical coverage. Prefer functional patent terminology over APIs, SDKs, vendors, or implementation details.
Depict only subject matter disclosed in the invention context, claims, or component registry. Never plan figures, phases, or steps for generic product-lifecycle activity (installation, deployment, login, registration, onboarding, testing, monitoring, maintenance, error handling) unless the disclosure claims it as part of the invention.
Plan subsystem and phase order explicitly. Split coverage across figures instead of overloading one figure.
Stay within per-figure complexity budgets. Each planned figure is rendered as exactly one sheet — a figure that exceeds its budget is not split for you, it ships as one crowded, hard-to-read drawing. Budgets: COMPONENT at most ${PATENT_DIAGRAM_COMPLEXITY.component.warningComponents} components and ${PATENT_DIAGRAM_COMPLEXITY.component.maximumDetailedBands} subsystem bands, PROCESS at most ${PATENT_DIAGRAM_COMPLEXITY.process.warningNodes} steps, SEQUENCE at most ${PATENT_DIAGRAM_COMPLEXITY.sequence.warningInteractions} interactions, CONSTITUENT at most ${PATENT_DIAGRAM_COMPLEXITY.constituent.warningConstituents} constituents.
${countRule}

Required JSON shape:
{
  "schemaVersion": 1,
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
    "evidenceIds": ["disclosed-step-id — PROCESS figures only; empty for other kinds"]
  }]
}

INVENTION TITLE: ${input.inventionTitle}
PATENT TYPE: ${input.patentType || 'SYSTEM'}
USER INSTRUCTIONS: ${input.instructions || 'None'}
INVENTION CONTEXT:
${compactInventionContext(input.inventionContext)}

CLAIMS CONTEXT:
${compactClaimsContext(input.claimsContext)}

${processSteps.length
  ? `DISCLOSED METHOD STEPS (the only operations a PROCESS figure may depict):\n${processSteps.map(item => `- ${item.id}: ${item.value}`).join('\n')}`
  : 'DISCLOSED METHOD STEPS: none recorded for this invention.'}

COMPONENT PLANNER REGISTRY (listed in disclosed order; preserve it):
${componentLines(input.components, { withClaims: true })}`
}

export function buildDiagramDetailPrompt(input: {
  plan: FigureSetPlanItem
  inventionContext: unknown
  claimsContext: unknown
  components: PatentDiagramComponent[]
  evidenceCatalog?: Array<{ id: string; value: string }>
  existingDiagram?: PatentDiagram | null
  instructions?: string
}): string {
  const kindShape = input.plan.kind === 'COMPONENT'
    ? `{
  "kind":"COMPONENT", "systemBoundaryLabel":"short system name",
  "groups":[{"id":"group-id","label":"subsystem label","rows":[{"componentIds":["one-to-${PATENT_DIAGRAM_STYLE.maximumComponentsPerRow} IDs in semantic order"]}]}],
  "components":[{"componentId":"id","displayLabel":"maximum ${PATENT_DIAGRAM_STYLE.maximumLabelWords} words","optional":false,"external":false}],
  "relationships":[{"fromId":"id","toId":"id","category":"PRIMARY|DATA_INPUT|TECHNICAL_OUTPUT|EVIDENCE|GENERATED_CONTENT|CONTROL|CONFIGURATION|VALIDATION|RESPONSE|REVIEW_FEEDBACK|STORAGE|OPTIONAL|ASSOCIATION"}]
}`
    : input.plan.kind === 'SEQUENCE'
      ? `{
  "kind":"SEQUENCE",
  "participants":[{"componentId":"id","displayLabel":"maximum ${PATENT_DIAGRAM_STYLE.maximumLabelWords} words"}],
  "interactions":[{"order":1,"fromId":"id","toId":"id","label":"maximum ${PATENT_DIAGRAM_COMPLEXITY.connectorLabelWords} words","category":"PRIMARY|RESPONSE|CONTROL|OPTIONAL","phase":"short phase","alternative":{"condition":"short condition","branch":"IF|ELSE"}}]
}`
      : input.plan.kind === 'PROCESS'
        ? `{
  "kind":"PROCESS",
  "nodes":[{"key":"stable-step-key","kind":"STEP|DECISION","componentId":"registry ID performing this step — REQUIRED for STEP","relatedComponentIds":["other participating registry IDs"],"evidenceIds":["catalog IDs this step paraphrases — REQUIRED when the catalog is non-empty"],"label":"verb-led maximum ${PATENT_DIAGRAM_STYLE.maximumLabelWords} words","phase":"short phase"}],
  "transitions":[{"fromId":"step-key","toId":"step-key","label":"decision outcome only (e.g. yes/no); empty string for step-to-step","category":"PRIMARY|CONTROL|OPTIONAL"}]
}`
        : `{
  "kind":"CONSTITUENT", "boundaryLabel":"short composition name",
  "constituents":[{"componentId":"id","displayLabel":"maximum ${PATENT_DIAGRAM_STYLE.maximumLabelWords} words","technicalRole":"short supported role","quantityOrRange":"only when disclosed"}],
  "relationships":[{"fromId":"id","toId":"id","category":"ASSOCIATION|PRIMARY|OPTIONAL"}]
}`

  return `You are the PatentNest semantic figure detailer.

Return JSON only. Never return PlantUML, reference numerals, styles, colours, layout-only links, markdown, or commentary.
Use only Component Planner IDs supplied below. Do not invent technical components or unsupported quantities. Reference signs (ref=) are shown for identification only — never copy them into any label; the server appends them.
Depict only what the invention context, claims, or component registry disclose. Every PROCESS step or decision must restate a disclosed operation of the claimed method — never add boilerplate or lifecycle steps (start/end terminals, initialization, login, deployment, testing, monitoring, generic error handling) that the disclosure does not describe. The same applies to SEQUENCE interactions and relationships.
Never invent step or decision numbers (S100, S140, D100 and the like). Those are not part of your output: a step is labelled from the Component Planner reference sign of the component that performs it, and the server adds that sign itself.

PROCESS GROUNDING CONTRACT — both parts are enforced and a violation fails the figure:
1. ANCHOR. Every STEP must set componentId to the registry ID that performs the operation. A DECISION must set componentId or list participating IDs in relatedComponentIds. relatedComponentIds alone is not sufficient for a STEP.
2. CITE. When the SUPPORTED EVIDENCE CATALOG below is non-empty, every step and decision must list in its evidenceIds the catalog IDs it paraphrases. The catalog — especially any DISCLOSED METHOD STEPS section — is your step vocabulary: write steps by paraphrasing those entries, not by imagining what the system probably does. A step you cannot cite is not disclosed by this invention; omit it rather than inventing a citation.

Preserve the supplied component, group, participant, step, and phase order.
Names must be functional and no more than ${PATENT_DIAGRAM_STYLE.maximumLabelWords} words.
COMPONENT and CONSTITUENT connectors are UNLABELLED — omit the label field entirely. The category carries the meaning and the server draws the arrow style from it. Do not describe a connector as "includes", "comprises", "connects to" or similar; the box hierarchy already shows containment and the written description explains the rest.
Only SEQUENCE interaction labels and PROCESS decision-branch outcomes are drawn; keep those to no more than ${PATENT_DIAGRAM_COMPLEXITY.connectorLabelWords} words.
The code will assign canonical names/reference signs, wrapping, rows, arrows, and all visual styling.

Every response must include the common fields:
{"schemaVersion":1,"key":"${input.plan.key}","title":"${input.plan.title}","purpose":"${input.plan.purpose}","detailLevel":"${input.plan.detailLevel}","direction":"${input.plan.direction}","claimCriticalComponentIds":${JSON.stringify(input.plan.claimCriticalComponentIds)},"evidenceIds":["supported-evidence-id"]}

Use one or more IDs from the supported evidence catalog when it is non-empty. Do not invent evidence IDs.

Merge those common fields with this ${input.plan.kind} shape:
${kindShape}

FIGURE PLAN:
${JSON.stringify(input.plan, null, 2)}

USER MODIFICATION INSTRUCTIONS:
${input.instructions || 'None'}

${input.existingDiagram ? `EXISTING MANAGED SEMANTIC MODEL (retain stable keys/identifiers unless instructed):\n${JSON.stringify(input.existingDiagram)}\n` : ''}
INVENTION CONTEXT:
${compactInventionContext(input.inventionContext)}

CLAIMS CONTEXT:
${compactClaimsContext(input.claimsContext)}

SUPPORTED EVIDENCE CATALOG:
${evidenceCatalogBlock(input.evidenceCatalog || [])}

COMPONENT PLANNER REGISTRY (listed in disclosed order; preserve it):
${componentLines(input.components)}`
}

export function extractJsonObject(text: string): unknown {
  const trimmed = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(trimmed) } catch {}
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1))
  throw new Error('LLM response did not contain a JSON object')
}
