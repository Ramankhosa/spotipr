import crypto from 'crypto'
import { z } from 'zod'
import { PATENT_DIAGRAM_COMPLEXITY } from './policy'
import {
  COVERAGE_REQUIREMENT_TYPES,
  type DiagramKind,
  type FigureCoverageLedger,
  type FigureCoverageRequirement,
  type FigurePlanRepairSummary,
  type FigureSetPlan,
  type FigureSetPlanItem,
  type PatentDiagramComponent,
  type PendingComponentAddition,
} from './types'

export interface CoverageClaimRecord {
  number: number
  text: string
  type: 'independent' | 'dependent'
  dependsOn?: number
}

const coverageExtractionItemSchema = z.object({
  claimNumber: z.number().int().positive(),
  type: z.enum(COVERAGE_REQUIREMENT_TYPES),
  label: z.string().trim().min(1).max(160),
  sourceText: z.string().trim().min(1).max(800),
  componentIds: z.array(z.string().trim().min(1).max(120)).default([]),
  componentCandidate: z.object({
    name: z.string().trim().min(1).max(160),
    type: z.string().trim().min(1).max(80).default('OTHER'),
    parentId: z.string().trim().min(1).max(120).optional(),
  }).optional(),
})

export const coverageExtractionSchema = z.object({
  requirements: z.array(coverageExtractionItemSchema).min(1).max(500),
})

export type CoverageExtraction = z.infer<typeof coverageExtractionSchema>

function compactWhitespace(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function stableHash(value: string, length = 16): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex').slice(0, length)
}

function claimArray(value: unknown): any[] {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (Array.isArray(record.claims)) return record.claims
  }
  return []
}

function claimsFromText(value: string): CoverageClaimRecord[] {
  const normalized = String(value || '').replace(/\r\n/g, '\n')
  const matches = Array.from(normalized.matchAll(/(?:^|\n)\s*(?:claim\s*)?(\d{1,3})\s*[.)\-:]\s*([\s\S]*?)(?=(?:\n\s*(?:claim\s*)?\d{1,3}\s*[.)\-:]\s+)|$)/gi))
  if (!matches.length && compactWhitespace(normalized)) {
    return [{ number: 1, type: 'independent', text: compactWhitespace(normalized) }]
  }
  return matches.flatMap(match => {
    const number = Number(match[1])
    const text = compactWhitespace(match[2])
    if (!number || !text) return []
    const dependency = text.match(/\bclaims?\s+(\d+)\b/i)
    return [{
      number,
      type: number === 1 || !dependency ? 'independent' as const : 'dependent' as const,
      ...(dependency ? { dependsOn: Number(dependency[1]) } : {}),
      text,
    }]
  })
}

export function normalizeCoverageClaims(value: unknown): CoverageClaimRecord[] {
  if (typeof value === 'string') return claimsFromText(value)
  const claims = claimArray(value).flatMap((claim, index) => {
    if (typeof claim === 'string') {
      const text = compactWhitespace(claim)
      return text ? [{ number: index + 1, type: index === 0 ? 'independent' as const : 'dependent' as const, text }] : []
    }
    if (!claim || typeof claim !== 'object') return []
    const number = Number((claim as any).number ?? (claim as any).claimNumber ?? index + 1)
    const text = compactWhitespace(String((claim as any).text ?? (claim as any).claimText ?? (claim as any).content ?? ''))
    if (!Number.isInteger(number) || number < 1 || !text) return []
    const explicitType = String((claim as any).type || '').toLowerCase()
    const dependency = Number((claim as any).dependsOn ?? (claim as any).depends_on)
    const type = explicitType.includes('dep') || Number.isInteger(dependency)
      ? 'dependent' as const
      : 'independent' as const
    return [{ number, type, ...(Number.isInteger(dependency) && dependency > 0 ? { dependsOn: dependency } : {}), text }]
  })
  return Array.from(new Map(claims.sort((a, b) => a.number - b.number).map(claim => [claim.number, claim])).values())
}

function claimDrawingLimitations(claim: CoverageClaimRecord): string[] {
  const normalized = compactWhitespace(claim.text)
  const candidates = normalized.split(/\s*;\s*|\s*,\s+(?=(?:and\s+|or\s+)?(?:a|an|the|at least|one or more)\b)|\s+and\s+(?=(?:a|an|the|at least|one or more)\b)|\bwherein\b|\bfurther comprising\b|\bconfigured to\b/i)
    .map(value => compactWhitespace(value).replace(/^(?:and|or)\s+/i, '').replace(/[.;,]+$/, '').trim())
    .filter(value => value.length >= 3)
    .filter(value => !/^(?:the|said)\s+.+\bof claim\s+\d+$/i.test(value))
  return candidates.length ? candidates : [normalized]
}

export function uncoveredClaimLimitations(
  claims: CoverageClaimRecord[],
  requirements: Array<{ claimNumber: number; sourceText: string }>,
): Array<{ claimNumber: number; limitation: string }> {
  return claims.flatMap(claim => {
    const sources = requirements
      .filter(requirement => requirement.claimNumber === claim.number)
      .map(requirement => compactWhitespace(requirement.sourceText).toLowerCase())
    return claimDrawingLimitations(claim).flatMap(limitation => {
      const normalized = limitation.toLowerCase()
      return sources.some(source => source.includes(normalized) || normalized.includes(source))
        ? []
        : [{ claimNumber: claim.number, limitation }]
    })
  })
}

export function buildCoverageExtractionPrompt(input: {
  claims: CoverageClaimRecord[]
  components: PatentDiagramComponent[]
}): string {
  return `You are the claim-to-figure coverage auditor for a patent drawing system.

Return JSON only. Break EVERY claim, including every dependent claim, into the smallest concepts that a drawing can prove it covers.

Allowed requirement types: ${COVERAGE_REQUIREMENT_TYPES.join(', ')}.
- COMPONENT: a claimed structural, logical, biological, chemical, or data-bearing element.
- RELATIONSHIP: a claimed connection, containment, communication, or dependency.
- PROCESS_STEP: an operation or transformation.
- STATE_CONDITION: a state, trigger, threshold, decision, or condition.
- ALTERNATIVE: an optional or dependent-claim branch/embodiment.
- QUANTITY_RANGE: an expressly claimed amount, ratio, dimension, or range.
- CONSTITUENT_ROLE: a material/constituent and its technical role.
- DATA_STRUCTURE: a claimed logical record, field set, model, or stored representation.

Grounding rules:
1. sourceText MUST be an exact contiguous excerpt from the identified claim.
2. Use only Component Plan IDs below. Map every known participant to componentIds.
3. If a COMPONENT or DATA_STRUCTURE is not in the registry, provide componentCandidate with the shortest functional name copied or faithfully shortened from sourceText.
4. If any other requirement has no componentIds, provide componentCandidate for the component that performs, owns, or contains it.
5. Do not add implementation details or lifecycle activity absent from the claims.
6. Cover every span in the REQUIRED LIMITATION SPANS checklist below. Do not merge unrelated limitations.

Required JSON:
{"requirements":[{"claimNumber":1,"type":"COMPONENT|RELATIONSHIP|PROCESS_STEP|STATE_CONDITION|ALTERNATIVE|QUANTITY_RANGE|CONSTITUENT_ROLE|DATA_STRUCTURE","label":"short concept","sourceText":"exact claim excerpt","componentIds":["known-id"],"componentCandidate":{"name":"missing element","type":"OTHER","parentId":"known-parent-id"}}]}

COMPONENT PLAN:
${input.components.map(component => `- ${component.id}: ${component.name}${component.parentId ? ` | parent=${component.parentId}` : ''}`).join('\n')}

CLAIMS (complete and untruncated):
${input.claims.map(claim => `CLAIM ${claim.number} (${claim.type}${claim.dependsOn ? `, depends on ${claim.dependsOn}` : ''}):\n${claim.text}`).join('\n\n')}

REQUIRED LIMITATION SPANS — this is the exact checklist your reply is graded against.
The server splits each claim into the spans below. Every span must be matched by at
least one requirement for that claim whose sourceText either CONTAINS the span or is
CONTAINED BY it. An excerpt that straddles two spans without containing either one
matches NEITHER — so keep each sourceText inside a single span, and emit a separate
requirement per span rather than one long excerpt spanning several.
${input.claims.map(claim => `CLAIM ${claim.number}:\n${claimDrawingLimitations(claim).map(span => `  - ${span}`).join('\n')}`).join('\n')}`
}

export function materializeCoverageLedger(input: {
  contextChecksum: string
  claims: CoverageClaimRecord[]
  extraction: CoverageExtraction
  components: PatentDiagramComponent[]
}): FigureCoverageLedger {
  const claimByNumber = new Map(input.claims.map(claim => [claim.number, claim]))
  const componentIds = new Set(input.components.map(component => component.id))
  const seen = new Set<string>()
  const requirements: FigureCoverageRequirement[] = []

  for (const candidate of input.extraction.requirements) {
    const claim = claimByNumber.get(candidate.claimNumber)
    if (!claim) throw new Error(`Coverage requirement referenced unknown claim ${candidate.claimNumber}`)
    const sourceText = compactWhitespace(candidate.sourceText)
    if (!compactWhitespace(claim.text).includes(sourceText)) {
      throw new Error(`Coverage source for claim ${candidate.claimNumber} is not an exact claim excerpt: ${sourceText}`)
    }
    const unknownIds = candidate.componentIds.filter(id => !componentIds.has(id))
    if (unknownIds.length) throw new Error(`Coverage requirement referenced unknown Component Plan IDs: ${unknownIds.join(', ')}`)
    if (!candidate.componentIds.length && !candidate.componentCandidate) {
      throw new Error(`Coverage requirement "${candidate.label}" has no Component Plan anchor or component candidate`)
    }
    if (candidate.componentCandidate?.parentId && !componentIds.has(candidate.componentCandidate.parentId)) {
      throw new Error(`Coverage component candidate referenced unknown parent ${candidate.componentCandidate.parentId}`)
    }
    const fingerprint = `${candidate.claimNumber}|${candidate.type}|${sourceText.toLowerCase()}`
    if (seen.has(fingerprint)) continue
    seen.add(fingerprint)
    const suffix = stableHash(fingerprint)
    const evidenceId = `CLM-${candidate.claimNumber}-${suffix.slice(0, 10)}`
    requirements.push({
      id: `COV-${candidate.claimNumber}-${suffix}`,
      claimNumber: candidate.claimNumber,
      type: candidate.type,
      label: candidate.label,
      sourceText,
      sourceId: `CLAIM-${candidate.claimNumber}`,
      componentIds: Array.from(new Set(candidate.componentIds)),
      evidenceIds: [evidenceId],
      required: true,
      ...(candidate.componentCandidate ? { componentCandidate: candidate.componentCandidate } : {}),
    })
  }

  const uncovered = uncoveredClaimLimitations(input.claims, input.extraction.requirements)
  if (uncovered.length) {
    throw new Error(`Coverage extraction omitted claim limitations: ${uncovered.map(item => `claim ${item.claimNumber}: ${item.limitation}`).join('; ')}`)
  }

  return {
    schemaVersion: 1,
    contextChecksum: input.contextChecksum,
    basis: 'CLAIMS',
    requirements,
  }
}

export function buildDisclosureCoverageLedger(input: {
  contextChecksum: string
  evidenceCatalog: Array<{ id: string; value: string }>
  components: PatentDiagramComponent[]
}): FigureCoverageLedger {
  const requirements: FigureCoverageRequirement[] = input.evidenceCatalog.map((entry, index) => {
    const component = input.components[index % Math.max(1, input.components.length)]
    return {
      id: `COV-DISC-${stableHash(`${entry.id}|${entry.value}`)}`,
      claimNumber: null,
      type: entry.id.startsWith('SF-processSteps-') ? 'PROCESS_STEP' : 'COMPONENT',
      label: compactWhitespace(entry.value).slice(0, 160),
      sourceText: compactWhitespace(entry.value).slice(0, 800),
      sourceId: entry.id,
      componentIds: component ? [component.id] : [],
      evidenceIds: [entry.id],
      required: true,
    }
  })
  if (!requirements.length) {
    input.components.forEach(component => requirements.push({
      id: `COV-DISC-${stableHash(component.id)}`,
      claimNumber: null,
      type: 'COMPONENT',
      label: component.name,
      sourceText: component.description || component.name,
      sourceId: `COMPONENT-${component.id}`,
      componentIds: [component.id],
      evidenceIds: [],
      required: true,
    }))
  }
  return { schemaVersion: 1, contextChecksum: input.contextChecksum, basis: 'DISCLOSURE', requirements }
}

function nextReferenceLabel(style: string, existing: Array<{ referenceLabel?: unknown; numeral?: unknown }>): { referenceLabel: string; numeral?: number } {
  const labels = new Set(existing.map(component => String(component.referenceLabel || component.numeral || '').toLowerCase()).filter(Boolean))
  if (style === 'STEP_LABEL') {
    const maximum = existing.reduce((max, component) => Math.max(max, Number(String(component.referenceLabel || '').match(/^s(\d+)$/i)?.[1] || 0)), 0)
    let value = Math.max(100, maximum + 100)
    while (labels.has(`s${value}`)) value += 100
    return { referenceLabel: `S${value}` }
  }
  if (style === 'CONSTITUENT_LABEL') {
    for (let index = 0; index < 26; index++) {
      const label = `(${String.fromCharCode(97 + index)})`
      if (!labels.has(label)) return { referenceLabel: label }
    }
    throw new Error('No unused constituent reference labels remain')
  }
  const numerals = existing.map(component => Number(component.numeral ?? component.referenceLabel)).filter(value => Number.isInteger(value) && value > 0)
  let value = Math.max(100, Math.ceil(((Math.max(0, ...numerals) + 1) / 100)) * 100)
  while (labels.has(String(value))) value += 100
  return { referenceLabel: String(value), numeral: value }
}

export function stageCoverageComponentAdditions(input: {
  ledger: FigureCoverageLedger
  storedComponents: any[]
  numberingStyle: string
}): { ledger: FigureCoverageLedger; additions: PendingComponentAddition[] } {
  const stored = input.storedComponents.map(component => ({ ...component }))
  const stableIds = stored.map(component => compactWhitespace(String(component.id || '')))
  const stableLabels = stored.map(component => compactWhitespace(String(component.referenceLabel || component.numeral || '')))
  if (stableIds.some(id => !id) || new Set(stableIds).size !== stableIds.length) {
    throw new Error('Stable Component Plan append is unavailable because existing component IDs are missing or duplicated')
  }
  if (stableLabels.some(label => !label) || new Set(stableLabels.map(label => label.toLowerCase())).size !== stableLabels.length) {
    throw new Error('Stable Component Plan append is unavailable because existing reference labels are missing or duplicated')
  }
  if (!['NUMERIC_BUCKET', 'STEP_LABEL', 'CONSTITUENT_LABEL'].includes(input.numberingStyle)) {
    throw new Error(`Stable Component Plan append is unavailable for unknown numbering style ${input.numberingStyle}`)
  }
  const idByName = new Map(stored.map(component => [compactWhitespace(String(component.name)).toLowerCase(), String(component.id)]))
  const additions: PendingComponentAddition[] = []
  const requirementToComponent = new Map<string, string>()

  for (const requirement of input.ledger.requirements) {
    if (requirement.componentIds.length || !requirement.componentCandidate) continue
    const normalizedName = compactWhitespace(requirement.componentCandidate.name).toLowerCase()
    const existingId = idByName.get(normalizedName)
    if (existingId) {
      requirementToComponent.set(requirement.id, existingId)
      continue
    }
    const duplicate = additions.find(item => compactWhitespace(item.name).toLowerCase() === normalizedName)
    if (duplicate) {
      duplicate.requirementIds = Array.from(new Set([...duplicate.requirementIds, requirement.id]))
      duplicate.claimNumbers = Array.from(new Set([...duplicate.claimNumbers, ...(requirement.claimNumber ? [requirement.claimNumber] : [])])).sort((a, b) => a - b)
      requirementToComponent.set(requirement.id, duplicate.id)
      continue
    }
    const id = `auto_cov_${stableHash(`${normalizedName}|${requirement.sourceText}`, 20)}`
    if (stableIds.includes(id)) throw new Error(`Stable Component Plan append would duplicate component ID ${id}`)
    const reference = nextReferenceLabel(input.numberingStyle, [...stored, ...additions])
    const addition: PendingComponentAddition = {
      id,
      name: requirement.componentCandidate.name,
      type: requirement.componentCandidate.type || 'OTHER',
      description: `Automatically added for drawing coverage: ${requirement.sourceText}`.slice(0, 600),
      ...(requirement.componentCandidate.parentId ? { parentId: requirement.componentCandidate.parentId } : {}),
      sequence: stored.length + additions.length + 1,
      ...reference,
      requirementIds: [requirement.id],
      claimNumbers: requirement.claimNumber ? [requirement.claimNumber] : [],
      sourceText: requirement.sourceText,
      autoGeneratedAt: new Date().toISOString(),
    }
    additions.push(addition)
    if (stableLabels.some(label => label.toLowerCase() === addition.referenceLabel.toLowerCase())) {
      throw new Error(`Stable Component Plan append would duplicate reference label ${addition.referenceLabel}`)
    }
    idByName.set(normalizedName, id)
    requirementToComponent.set(requirement.id, id)
  }

  return {
    ledger: {
      ...input.ledger,
      requirements: input.ledger.requirements.map(requirement => {
        const componentId = requirementToComponent.get(requirement.id)
        return componentId ? { ...requirement, componentIds: [componentId] } : requirement
      }),
    },
    additions,
  }
}

export function preferredDiagramKind(requirement: FigureCoverageRequirement): DiagramKind {
  if (requirement.type === 'PROCESS_STEP' || requirement.type === 'STATE_CONDITION') return 'PROCESS'
  if (requirement.type === 'ALTERNATIVE') return 'SEQUENCE'
  if (requirement.type === 'QUANTITY_RANGE' || requirement.type === 'CONSTITUENT_ROLE') return 'CONSTITUENT'
  return 'COMPONENT'
}

function capacityForKind(kind: DiagramKind): number {
  if (kind === 'PROCESS') return PATENT_DIAGRAM_COMPLEXITY.process.warningNodes
  if (kind === 'SEQUENCE') return PATENT_DIAGRAM_COMPLEXITY.sequence.warningParticipants
  if (kind === 'CONSTITUENT') return PATENT_DIAGRAM_COMPLEXITY.constituent.warningConstituents
  return PATENT_DIAGRAM_COMPLEXITY.component.warningComponents
}

function plannedCoverageIds(figure: FigureSetPlanItem): string[] {
  return figure.coverageRequirementIds || []
}

export function repairFigureSetCoverage(input: {
  plan: FigureSetPlan
  ledger: FigureCoverageLedger
  existingCoveredRequirementIds?: Iterable<string>
  manualExactCount?: boolean
}): { plan: FigureSetPlan; summary: FigurePlanRepairSummary } {
  const figures = input.plan.figures.map(figure => ({
    ...figure,
    componentIds: [...figure.componentIds],
    claimCriticalComponentIds: [...figure.claimCriticalComponentIds],
    evidenceIds: [...figure.evidenceIds],
    coverageRequirementIds: [...plannedCoverageIds(figure)],
  }))
  const existingCovered = new Set(input.existingCoveredRequirementIds || [])
  const covered = new Set([...Array.from(existingCovered), ...figures.flatMap(plannedCoverageIds)])
  const modifiedFigureKeys = new Set<string>()
  const addedFigureKeys: string[] = []
  const changeByFigure = new Map<string, { action: 'MODIFIED' | 'ADDED'; requirementIds: string[] }>()

  for (const requirement of input.ledger.requirements.filter(item => item.required && !covered.has(item.id))) {
    const kind = preferredDiagramKind(requirement)
    let target = figures.find(figure => figure.kind === kind
      && new Set([...figure.componentIds, ...requirement.componentIds]).size <= capacityForKind(kind))
    if (!target && input.manualExactCount) continue
    if (!target) {
      if (figures.length >= 20) throw new Error('Complete claim coverage requires more than the 20-figure generation safety limit')
      if (!requirement.componentIds.length) throw new Error(`Coverage requirement "${requirement.label}" cannot be anchored to a Component Plan entry`)
      const key = `coverage-${requirement.id.toLowerCase()}`.slice(0, 120)
      target = {
        key,
        kind,
        title: requirement.label.slice(0, 160),
        purpose: `Depicts ${requirement.label} as required by ${requirement.claimNumber ? `claim ${requirement.claimNumber}` : 'the invention disclosure'}.`,
        detailLevel: 'DETAIL',
        direction: kind === 'SEQUENCE' ? 'LR' : 'TB',
        componentIds: [...requirement.componentIds],
        claimCriticalComponentIds: [...requirement.componentIds],
        orderedGroups: [],
        phaseHints: requirement.type === 'STATE_CONDITION' ? [requirement.label] : [],
        evidenceIds: [...requirement.evidenceIds],
        coverageRequirementIds: [requirement.id],
      }
      figures.push(target)
      addedFigureKeys.push(key)
      changeByFigure.set(key, { action: 'ADDED', requirementIds: [requirement.id] })
    } else {
      target.componentIds = Array.from(new Set([...target.componentIds, ...requirement.componentIds]))
      target.claimCriticalComponentIds = Array.from(new Set([...target.claimCriticalComponentIds, ...requirement.componentIds]))
      target.evidenceIds = Array.from(new Set([...target.evidenceIds, ...requirement.evidenceIds]))
      target.coverageRequirementIds = Array.from(new Set([...target.coverageRequirementIds, requirement.id]))
      const change = changeByFigure.get(target.key)
      if (change) change.requirementIds = Array.from(new Set([...change.requirementIds, requirement.id]))
      else {
        modifiedFigureKeys.add(target.key)
        changeByFigure.set(target.key, { action: 'MODIFIED', requirementIds: [requirement.id] })
      }
    }
    covered.add(requirement.id)
  }

  const summary: FigurePlanRepairSummary = {
    addedComponents: input.plan.pendingComponentAdditions || [],
    modifiedFigureKeys: Array.from(modifiedFigureKeys),
    addedFigureKeys,
    coveredRequirementIds: Array.from(covered),
    figureChanges: Array.from(changeByFigure, ([figureKey, change]) => ({
      figureKey,
      action: change.action,
      requirementIds: change.requirementIds,
      claimNumbers: Array.from(new Set(change.requirementIds.flatMap(id => {
        const claimNumber = input.ledger.requirements.find(requirement => requirement.id === id)?.claimNumber
        return claimNumber ? [claimNumber] : []
      }))).sort((a, b) => a - b),
    })),
  }
  return {
    plan: {
      ...input.plan,
      schemaVersion: 2,
      coverageLedger: input.ledger,
      figures,
      repairSummary: summary,
    },
    summary,
  }
}

export function evaluateCoverageLedger(input: {
  ledger?: FigureCoverageLedger
  figures: Array<{ coverageRequirementIds?: string[]; componentIds?: string[] }>
  existingCoveredRequirementIds?: Iterable<string>
}) {
  if (!input.ledger) {
    return {
      status: 'NOT_EVALUATED' as const, basis: null, required: 0, covered: 0,
      missing: [] as FigureCoverageRequirement[], claimCompletenessEvaluated: false,
      requiredRequirements: [] as FigureCoverageRequirement[], coveredRequirements: [] as FigureCoverageRequirement[],
      claimNumbers: [] as number[], coveredClaimNumbers: [] as number[], missingClaimNumbers: [] as number[],
      note: 'No coverage ledger was available, so claim completeness was not evaluated.',
    }
  }
  const coveredIds = new Set(input.existingCoveredRequirementIds || [])
  input.figures.forEach(figure => (figure.coverageRequirementIds || []).forEach(id => coveredIds.add(id)))
  const required = input.ledger.requirements.filter(requirement => requirement.required)
  const missing = required.filter(requirement => !coveredIds.has(requirement.id))
  const coveredRequirements = required.filter(requirement => coveredIds.has(requirement.id))
  const claimNumbers = Array.from(new Set(required.flatMap(requirement => requirement.claimNumber ? [requirement.claimNumber] : []))).sort((a, b) => a - b)
  const coveredClaimNumbers = Array.from(new Set(coveredRequirements.flatMap(requirement => requirement.claimNumber ? [requirement.claimNumber] : []))).sort((a, b) => a - b)
  const missingClaimNumbers = Array.from(new Set(missing.flatMap(requirement => requirement.claimNumber ? [requirement.claimNumber] : []))).sort((a, b) => a - b)
  return {
    status: missing.length ? 'INCOMPLETE' as const : 'COMPLETE' as const,
    basis: input.ledger.basis,
    required: required.length,
    covered: required.length - missing.length,
    missing,
    requiredRequirements: required,
    coveredRequirements,
    claimNumbers,
    coveredClaimNumbers,
    missingClaimNumbers,
    claimCompletenessEvaluated: input.ledger.basis === 'CLAIMS',
    note: input.ledger.basis === 'CLAIMS'
      ? null
      : 'No claims were available. Disclosure coverage was checked, but claim completeness could not be evaluated.',
  }
}

export function coverageEvidenceEntries(ledger: FigureCoverageLedger): Array<{ id: string; value: string }> {
  return ledger.requirements.flatMap(requirement => requirement.evidenceIds.map(id => ({ id, value: requirement.sourceText })))
}
