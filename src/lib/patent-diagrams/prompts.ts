import type { FigureSetPlanItem, PatentDiagramComponent, PatentDiagram } from './types'
import { PATENT_DIAGRAM_STYLE } from './style'
import { PATENT_DIAGRAM_COMPLEXITY } from './policy'

function componentLines(components: PatentDiagramComponent[]): string {
  return components.map(component => {
    const detail = component.description ? ` — ${component.description}` : ''
    const parent = component.parentId ? `; parent=${component.parentId}` : ''
    return `- id=${component.id}; name=${component.name}; type=${component.type || 'OTHER'}${parent}${detail}`
  }).join('\n')
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
  figureCount?: number | null
  instructions?: string
}): string {
  const countRule = input.figureCount
    ? `Plan exactly ${input.figureCount} base figure(s), before any density-driven detail figures.`
    : 'Choose the smallest figure set that covers the claims — never more than 5 figures. The server discards any figure past the fifth.'
  return `You are the PatentNest patent figure-set planner.

Return JSON only. Do not return PlantUML, styling, reference numerals, prose outside JSON, or markdown fences.

Use only these diagram kinds: COMPONENT, SEQUENCE, PROCESS, CONSTITUENT.
Use only Component Planner IDs listed below. Component names, types, and hierarchy are immutable; server code resolves reference signs.
Choose COMPONENT for system/product architecture, PROCESS for method or flow figures, SEQUENCE only for meaningful interactions, and CONSTITUENT for composition/formulation figures.
Preserve claim-critical coverage. Prefer functional patent terminology over APIs, SDKs, vendors, or implementation details.
Depict only subject matter disclosed in the invention context, claims, or component registry. Never plan figures, phases, or steps for generic product-lifecycle activity (installation, deployment, login, registration, onboarding, testing, monitoring, maintenance, error handling) unless the disclosure claims it as part of the invention.
Plan subsystem and phase order explicitly. Recommend overview/detail figures instead of overloading one figure.
Stay within per-figure complexity budgets — the server splits oversize figures into extra sheets, inflating the final figure count. Budgets: COMPONENT at most ${PATENT_DIAGRAM_COMPLEXITY.component.warningComponents} components, PROCESS at most ${PATENT_DIAGRAM_COMPLEXITY.process.warningNodes} steps, SEQUENCE at most ${PATENT_DIAGRAM_COMPLEXITY.sequence.warningInteractions} interactions, CONSTITUENT at most ${PATENT_DIAGRAM_COMPLEXITY.constituent.warningConstituents} constituents.
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
    "phaseHints": ["short phase label"]
  }]
}

INVENTION TITLE: ${input.inventionTitle}
PATENT TYPE: ${input.patentType || 'SYSTEM'}
USER INSTRUCTIONS: ${input.instructions || 'None'}
INVENTION CONTEXT:
${compactInventionContext(input.inventionContext)}

CLAIMS CONTEXT:
${compactClaimsContext(input.claimsContext)}

COMPONENT PLANNER REGISTRY:
${componentLines(input.components)}`
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
  "relationships":[{"fromId":"id","toId":"id","label":"maximum ${PATENT_DIAGRAM_COMPLEXITY.connectorLabelWords} words","category":"PRIMARY|DATA_INPUT|TECHNICAL_OUTPUT|EVIDENCE|GENERATED_CONTENT|CONTROL|CONFIGURATION|VALIDATION|RESPONSE|REVIEW_FEEDBACK|STORAGE|OPTIONAL|ASSOCIATION"}]
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
  "nodes":[{"key":"stable-step-key","kind":"STEP|DECISION","componentId":"registry ID performing this step","relatedComponentIds":["participating registry IDs — required when componentId is absent"],"label":"verb-led maximum ${PATENT_DIAGRAM_STYLE.maximumLabelWords} words","identifier":"optional stable S100 or D100","phase":"short phase"}],
  "transitions":[{"fromId":"step-key","toId":"step-key","label":"maximum ${PATENT_DIAGRAM_COMPLEXITY.connectorLabelWords} words","category":"PRIMARY|CONTROL|OPTIONAL"}]
}`
        : `{
  "kind":"CONSTITUENT", "boundaryLabel":"short composition name",
  "constituents":[{"componentId":"id","displayLabel":"maximum ${PATENT_DIAGRAM_STYLE.maximumLabelWords} words","technicalRole":"short supported role","quantityOrRange":"only when disclosed"}],
  "relationships":[{"fromId":"id","toId":"id","label":"maximum ${PATENT_DIAGRAM_COMPLEXITY.connectorLabelWords} words","category":"ASSOCIATION|PRIMARY|OPTIONAL"}]
}`

  return `You are the PatentNest semantic figure detailer.

Return JSON only. Never return PlantUML, reference numerals, styles, colours, layout-only links, markdown, or commentary.
Use only Component Planner IDs supplied below. Do not invent technical components or unsupported quantities.
Depict only what the invention context, claims, or component registry disclose. Every PROCESS step or decision must restate a disclosed operation of the claimed method — never add boilerplate or lifecycle steps (start/end terminals, initialization, login, deployment, testing, monitoring, generic error handling) that the disclosure does not describe. The same applies to SEQUENCE interactions and relationships.
Every PROCESS step and decision MUST be anchored to the Component Planner registry: set componentId to the registry ID performing the operation, or list the participating registry IDs in relatedComponentIds. A node with no registry linkage is rejected and the figure fails. If an operation cannot be attributed to any planned component, it is not part of this invention — omit it.
Preserve the supplied component, group, participant, step, and phase order.
Names must be functional and no more than ${PATENT_DIAGRAM_STYLE.maximumLabelWords} words. Relationship and interaction labels must be no more than ${PATENT_DIAGRAM_COMPLEXITY.connectorLabelWords} words.
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
${input.evidenceCatalog?.length ? input.evidenceCatalog.map(item => `- ${item.id}: ${item.value}`).join('\n') : 'No structured evidence IDs are available; return an empty evidenceIds array.'}

COMPONENT PLANNER REGISTRY:
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
