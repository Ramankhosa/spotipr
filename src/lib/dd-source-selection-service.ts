import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { getSectionStageCode } from '@/lib/metering/section-stage-mapping'
import {
  getAuthoritativeClaims,
  normalizeClaimsForSession,
} from '@/lib/claims-context'
import { normalizeDraftClaimType } from '@/lib/draft-claims-parser'
import { buildDetailedDescriptionScopeContext } from '@/lib/section-injection-config'
import { areFiguresSkipped } from '@/lib/figure-availability'
import {
  buildDeterministicDetailedDescriptionSelection,
  coerceSupportDataSources,
  isDetailedDescriptionGuardrailCandidate,
  isDetailedDescriptionPositiveCandidate,
  normalizeDetailedDescriptionSourceSelection,
  previewSupportDataSource,
  type DetailedDescriptionEvidenceConfidence,
  type DetailedDescriptionEvidenceRole,
  type DetailedDescriptionSourceSelection,
  type SupportDataSource,
} from '@/lib/support-data-sources'

type EnsureParams = {
  session: any
  jurisdiction?: string
  requestHeaders?: Record<string, string>
  tenantId?: string
  force?: boolean
}

type EvidenceFigure = {
  figureNo: number
  title: string
  description?: string
  type?: string
}

type EvidenceContext = {
  normalizedData: Record<string, any>
  normalizedFacts: Record<string, unknown>
  claimsText: string
  claimsStructured: Array<{ number?: number; type?: string; category?: string; text?: string }>
  supportDataSources: SupportDataSource[]
  scopedComponents: any[]
  scopedFigures: EvidenceFigure[]
  inputHash: string
}

const VALID_ROLES = new Set<DetailedDescriptionEvidenceRole>([
  'claim_support',
  'component_support',
  'figure_support',
  'embodiment_support',
  'example_support',
])

const VALID_CONFIDENCE = new Set<DetailedDescriptionEvidenceConfidence>(['high', 'medium', 'low'])

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(value: string) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex')
}

function cleanText(value: unknown, max = 2000) {
  const text = value === null || value === undefined ? '' : String(value)
  const cleaned = text
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
  return cleaned.length > max ? `${cleaned.slice(0, max).trim()}...` : cleaned
}

function htmlToText(value: string) {
  return cleanText(value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '), 12000)
}

function extractReferenceMapComponents(referenceMap: any): any[] {
  const raw = referenceMap?.components
  return Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.components)
      ? raw.components
      : []
}

function sanitizeFigureTitle(value: unknown) {
  const title = cleanText(value, 240).replace(/\s+/g, ' ')
  return title || ''
}

export function buildDetailedDescriptionEvidenceFigures(session: any): EvidenceFigure[] {
  if (areFiguresSkipped(session)) return []

  const figurePlans = Array.isArray(session?.figurePlans) ? session.figurePlans : []
  const diagramSources = Array.isArray(session?.diagramSources) ? session.diagramSources : []
  const sketchRecords = Array.isArray(session?.sketchRecords) ? session.sketchRecords : []
  const figures: EvidenceFigure[] = []

  if (session?.figureSequenceFinalized && Array.isArray(session.figureSequence) && session.figureSequence.length > 0) {
    const sequencedSourceIds = new Set(session.figureSequence.map((item: any) => item?.sourceId).filter(Boolean))
    session.figureSequence.forEach((seqItem: any) => {
      if (seqItem?.type === 'diagram') {
        const plan = figurePlans.find((figure: any) => figure.id === seqItem.sourceId)
        const source = diagramSources.find((diagram: any) => diagram.figureNo === plan?.figureNo)
        if (!plan) return
        figures.push({
          figureNo: Number(seqItem.finalFigNo) || figures.length + 1,
          title: sanitizeFigureTitle(plan.title) || `Figure ${seqItem.finalFigNo}`,
          description: cleanText(plan.description || source?.description, 1000),
          type: 'diagram',
        })
      } else if (seqItem?.type === 'sketch') {
        const sketch = sketchRecords.find((item: any) => item.id === seqItem.sourceId && item.status === 'SUCCESS')
        if (!sketch) return
        figures.push({
          figureNo: Number(seqItem.finalFigNo) || figures.length + 1,
          title: sanitizeFigureTitle(sketch.title) || `Figure ${seqItem.finalFigNo}`,
          description: cleanText(sketch.description, 1000),
          type: 'sketch',
        })
      }
    })

    figurePlans.forEach((plan: any) => {
      if (sequencedSourceIds.has(plan.id)) return
      figures.push({
        figureNo: figures.length + 1,
        title: sanitizeFigureTitle(plan.title) || `Figure ${figures.length + 1}`,
        description: cleanText(plan.description, 1000),
        type: 'diagram',
      })
    })
    sketchRecords
      .filter((item: any) => item.status === 'SUCCESS' && !sequencedSourceIds.has(item.id))
      .forEach((sketch: any) => {
        figures.push({
          figureNo: figures.length + 1,
          title: sanitizeFigureTitle(sketch.title) || `Figure ${figures.length + 1}`,
          description: cleanText(sketch.description, 1000),
          type: 'sketch',
        })
      })

    return figures.sort((a, b) => a.figureNo - b.figureNo)
  }

  const planFigures = figurePlans.map((figure: any) => ({
    figureNo: Number(figure.figureNo) || 0,
    title: sanitizeFigureTitle(figure.title) || `Figure ${figure.figureNo}`,
    description: cleanText(figure.description, 1000),
    type: 'diagram',
  }))
  const diagramFigures = diagramSources.map((diagram: any) => {
    const found = planFigures.find((figure: any) => figure.figureNo === diagram.figureNo)
    return {
      figureNo: Number(diagram.figureNo) || 0,
      title: sanitizeFigureTitle(found?.title || diagram.title) || `Figure ${diagram.figureNo}`,
      description: cleanText(found?.description || diagram.description, 1000),
      type: 'diagram',
    }
  })
  const maxDiagramNo = Math.max(0, ...planFigures.map((figure: any) => figure.figureNo), ...diagramFigures.map((figure: any) => figure.figureNo))
  const sketchFigures = sketchRecords
    .filter((item: any) => item.status === 'SUCCESS')
    .map((sketch: any, index: number) => ({
      figureNo: maxDiagramNo + index + 1,
      title: sanitizeFigureTitle(sketch.title) || `Figure ${maxDiagramNo + index + 1}`,
      description: cleanText(sketch.description, 1000),
      type: 'sketch',
    }))

  const merged = new Map<number, EvidenceFigure>()
  ;[...planFigures, ...diagramFigures, ...sketchFigures].forEach((figure: any) => {
    if (figure.figureNo > 0) merged.set(figure.figureNo, figure)
  })
  return Array.from(merged.values()).sort((a, b) => a.figureNo - b.figureNo)
}

function claimTextFromSnapshot(snapshot: ReturnType<typeof getAuthoritativeClaims>) {
  if (Array.isArray(snapshot.structured) && snapshot.structured.length > 0) {
    return snapshot.structured
      .map((claim: any) => `Claim ${claim.number || '?'} (${normalizeDraftClaimType(claim.type)}): ${cleanText(claim.text, 4000)}`)
      .join('\n\n')
  }
  return htmlToText(snapshot.html || '')
}

function compactComponent(component: any) {
  return {
    name: cleanText(component?.name || component?.label || component?.title, 180),
    referenceLabel: cleanText(component?.referenceLabel || component?.numeral, 80),
    description: cleanText(component?.description, 500),
  }
}

function compactFigure(figure: EvidenceFigure) {
  return {
    figureNo: figure.figureNo,
    title: cleanText(figure.title, 180),
    description: cleanText(figure.description, 500),
    type: figure.type,
  }
}

const NORMALIZED_FACT_KEYS = [
  'inventionTitle',
  'title',
  'technicalField',
  'technicalProblem',
  'problem',
  'technicalSolution',
  'solution',
  'inventiveConcept',
  'summary',
  'advantages',
  'novelty',
  'embodiments',
  'useCases',
  'systemComponents',
  'processSteps',
  'implementationDetails',
]

function compactFactValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined || depth > 3) return undefined
  if (typeof value === 'string') {
    const cleaned = cleanText(value, depth === 0 ? 1200 : 500)
    return cleaned || undefined
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    const items = value
      .slice(0, 12)
      .map(item => compactFactValue(item, depth + 1))
      .filter(item => item !== undefined)
    return items.length ? items : undefined
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    Object.entries(value as Record<string, unknown>)
      .slice(0, 16)
      .forEach(([key, item]) => {
        const cleanedKey = cleanText(key, 80)
        const cleanedValue = compactFactValue(item, depth + 1)
        if (cleanedKey && cleanedValue !== undefined) out[cleanedKey] = cleanedValue
      })
    return Object.keys(out).length ? out : undefined
  }
  return undefined
}

function compactNormalizedInventionFacts(normalizedData: Record<string, any>): Record<string, unknown> {
  const facts: Record<string, unknown> = {}
  NORMALIZED_FACT_KEYS.forEach((key) => {
    if (!(key in normalizedData)) return
    const value = compactFactValue(normalizedData[key])
    if (value !== undefined) facts[key] = value
  })
  return facts
}

function buildEvidenceContext(session: any, jurisdiction: string): EvidenceContext {
  const ideaRecord = session?.ideaRecord || {}
  const normalizedData = normalizeClaimsForSession((ideaRecord.normalizedData as any) || {})
  const snapshot = getAuthoritativeClaims(normalizedData)
  const supportDataSources = coerceSupportDataSources(normalizedData.supportDataSources)
  const components = extractReferenceMapComponents(session?.referenceMap)
  const figures = buildDetailedDescriptionEvidenceFigures(session)
  const scope = buildDetailedDescriptionScopeContext(
    normalizedData,
    ideaRecord,
    components,
    figures,
    { figuresSkipped: areFiguresSkipped(session) }
  )
  const claimsText = claimTextFromSnapshot(snapshot)
  const claimsStructured = Array.isArray(snapshot.structured) ? snapshot.structured : []
  const hashPayload = {
    jurisdiction: jurisdiction.toUpperCase(),
    claimsApprovedAt: normalizedData.claimsApprovedAt || '',
    claimsText,
    supportDataSources,
    scopedComponents: scope.scopedComponents.map(compactComponent),
    scopedFigures: scope.scopedFigures.map(compactFigure),
  }

  return {
    normalizedData,
    normalizedFacts: compactNormalizedInventionFacts(normalizedData),
    claimsText,
    claimsStructured,
    supportDataSources,
    scopedComponents: scope.scopedComponents,
    scopedFigures: scope.scopedFigures as EvidenceFigure[],
    inputHash: sha256(stableStringify(hashPayload)),
  }
}

function sourceForPrompt(item: SupportDataSource) {
  return {
    id: item.id,
    kind: item.kind,
    label: item.label,
    claimUse: item.claimUse,
    figureUse: item.figureUse,
    sectionTargets: item.sectionTargets,
    status: item.status,
    value: cleanText(item.value, 1200),
    sourceText: item.sourceText ? cleanText(item.sourceText, 800) : undefined,
    details: item.details ? cleanText(JSON.stringify(item.details), 900) : undefined,
  }
}

function buildSelectorPrompt(context: EvidenceContext, jurisdiction: string) {
  const positiveCandidates = context.supportDataSources
    .filter(isDetailedDescriptionPositiveCandidate)
    .slice(0, 60)
    .map(sourceForPrompt)
  const guardrailCandidates = context.supportDataSources
    .filter(isDetailedDescriptionGuardrailCandidate)
    .slice(0, 30)
    .map(sourceForPrompt)

  return `
You are selecting source evidence for the Detailed Description section of a patent draft.

Return JSON only. Do not draft patent prose. Do not create new technical facts.

Selection principles:
- Select source IDs that help describe the claimed invention, embodiments, components, process steps, figures, algorithms, compositions, materials, values, examples, or test results.
- Do not select prior art or background-only data as positive invention support.
- Deleted, unsupported, and not-stated sources are unavailable and must not be selected.
- Put risk, missing-fact, and do-not-claim items in guardrailSources only.
- Prefer sources tied to frozen claims, scoped components, or scoped figures.
- Source facts are evidence only. You may classify relevance, but must not rewrite source facts.

Jurisdiction: ${jurisdiction.toUpperCase()}

FROZEN CLAIMS:
${context.claimsText || 'No frozen claims supplied.'}

NORMALIZED INVENTION FACTS:
${JSON.stringify(context.normalizedFacts, null, 2)}

SCOPED COMPONENTS:
${JSON.stringify(context.scopedComponents.map(compactComponent), null, 2)}

SCOPED FIGURES:
${JSON.stringify(context.scopedFigures.map(compactFigure), null, 2)}

POSITIVE CANDIDATE SOURCES:
${JSON.stringify(positiveCandidates, null, 2)}

GUARDRAIL CANDIDATE SOURCES:
${JSON.stringify(guardrailCandidates, null, 2)}

Required JSON shape:
{
  "selectedSources": [
    {
      "sourceId": "SDS-001",
      "role": "claim_support | component_support | figure_support | embodiment_support | example_support",
      "reason": "short user-friendly reason",
      "confidence": "high | medium | low"
    }
  ],
  "guardrailSources": [
    { "sourceId": "SDS-010", "reason": "short reason" }
  ],
  "excludedSources": [
    { "sourceId": "SDS-011", "reason": "short reason" }
  ],
  "warnings": []
}
`.trim()
}

function parseJsonObject(text: string): any {
  const trimmed = (text || '').trim()
  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = codeBlock ? codeBlock[1].trim() : trimmed
  try {
    return JSON.parse(candidate)
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1))
    }
    throw new Error('Could not parse DD source selection JSON')
  }
}

function normalizeRole(value: unknown): DetailedDescriptionEvidenceRole {
  const role = cleanText(value, 80) as DetailedDescriptionEvidenceRole
  return VALID_ROLES.has(role) ? role : 'claim_support'
}

function normalizeConfidence(value: unknown): DetailedDescriptionEvidenceConfidence {
  const confidence = cleanText(value, 20) as DetailedDescriptionEvidenceConfidence
  return VALID_CONFIDENCE.has(confidence) ? confidence : 'medium'
}

export function validateDetailedDescriptionSourceSelection(
  raw: any,
  sources: SupportDataSource[],
  metadata: {
    jurisdiction: string
    inputHash: string
    generatedAt?: string
    warnings?: string[]
    status?: 'ready' | 'failed'
  }
): DetailedDescriptionSourceSelection {
  const byId = new Map(sources.map(source => [source.id, source]))
  const seenSelected = new Set<string>()
  const seenGuardrails = new Set<string>()
  const warnings = [...(metadata.warnings || [])]
  const selectedSources: NonNullable<DetailedDescriptionSourceSelection['selectedSources']> = []
  const guardrailSources: NonNullable<DetailedDescriptionSourceSelection['guardrailSources']> = []
  const excludedSources: NonNullable<DetailedDescriptionSourceSelection['excludedSources']> = []

  const exclude = (sourceId: string, reason: string) => {
    if (!sourceId || excludedSources.some(item => item.sourceId === sourceId)) return
    excludedSources.push({ sourceId, reason })
  }

  const rawSelected = Array.isArray(raw?.selectedSources) ? raw.selectedSources : []
  rawSelected.forEach((item: any) => {
    const sourceId = cleanText(item?.sourceId || item?.id, 40)
    const source = byId.get(sourceId)
    if (!source) {
      if (sourceId) warnings.push(`Ignored unknown selected source ID ${sourceId}.`)
      return
    }
    if (seenSelected.has(sourceId)) return
    if (!isDetailedDescriptionPositiveCandidate(source)) {
      exclude(sourceId, 'Rejected as positive Detailed Description support by safety validation.')
      warnings.push(`Rejected ${sourceId} as positive Detailed Description support.`)
      return
    }
    seenSelected.add(sourceId)
    selectedSources.push({
      sourceId,
      role: normalizeRole(item?.role),
      reason: cleanText(item?.reason || 'Selected as Detailed Description support.', 500),
      confidence: normalizeConfidence(item?.confidence),
    })
  })

  const rawGuardrails = Array.isArray(raw?.guardrailSources) ? raw.guardrailSources : []
  rawGuardrails.forEach((item: any) => {
    const sourceId = cleanText(item?.sourceId || item?.id, 40)
    const source = byId.get(sourceId)
    if (!source) {
      if (sourceId) warnings.push(`Ignored unknown guardrail source ID ${sourceId}.`)
      return
    }
    if (seenGuardrails.has(sourceId)) return
    if (!isDetailedDescriptionGuardrailCandidate(source)) {
      exclude(sourceId, 'Rejected as guardrail because the source is not a DD guardrail candidate.')
      return
    }
    seenGuardrails.add(sourceId)
    guardrailSources.push({
      sourceId,
      reason: cleanText(item?.reason || 'Use as a Detailed Description guardrail.', 500),
    })
  })

  const rawExcluded = Array.isArray(raw?.excludedSources) ? raw.excludedSources : []
  rawExcluded.forEach((item: any) => {
    const sourceId = cleanText(item?.sourceId || item?.id, 40)
    if (!sourceId || !byId.has(sourceId)) return
    exclude(sourceId, cleanText(item?.reason || 'Excluded from Detailed Description injection.', 500))
  })

  sources.forEach(source => {
    if (seenSelected.has(source.id) || seenGuardrails.has(source.id) || excludedSources.some(item => item.sourceId === source.id)) return
    if (isDetailedDescriptionPositiveCandidate(source)) {
      exclude(source.id, 'Not selected by DD evidence selector.')
    } else if (!isDetailedDescriptionGuardrailCandidate(source)) {
      exclude(source.id, source.kind === 'prior_art' || source.claimUse === 'background_only'
        ? 'Prior art/background-only data is not positive invention support for Detailed Description.'
        : 'Not eligible for Detailed Description injection.')
    }
  })

  const rawWarnings = Array.isArray(raw?.warnings)
    ? raw.warnings.map((warning: unknown) => cleanText(warning, 500)).filter(Boolean)
    : []

  return {
    schemaVersion: 1,
    status: metadata.status || 'ready',
    sectionKey: 'detailedDescription',
    jurisdiction: metadata.jurisdiction.toUpperCase(),
    inputHash: metadata.inputHash,
    generatedAt: metadata.generatedAt || new Date().toISOString(),
    selectedSources: selectedSources.slice(0, 40),
    guardrailSources: guardrailSources.slice(0, 20),
    excludedSources: excludedSources.slice(0, 100),
    warnings: Array.from(new Set([...warnings, ...rawWarnings])).slice(0, 30),
  }
}

async function saveSelection(session: any, normalizedData: Record<string, any>, selection: DetailedDescriptionSourceSelection) {
  const updatedNormalized = {
    ...normalizedData,
    detailedDescriptionSourceSelection: selection,
  }
  if (session?.id) {
    await prisma.ideaRecord.update({
      where: { sessionId: session.id },
      data: { normalizedData: updatedNormalized },
    })
  }
  if (session?.ideaRecord) {
    session.ideaRecord.normalizedData = updatedNormalized
  }
  return updatedNormalized
}

export async function ensureDetailedDescriptionSourceSelection(params: EnsureParams): Promise<{
  selection: DetailedDescriptionSourceSelection
  normalizedData: Record<string, any>
  usedCache: boolean
}> {
  const jurisdiction = (params.jurisdiction || params.session?.activeJurisdiction || params.session?.draftingJurisdictions?.[0] || 'US').toUpperCase()
  const context = buildEvidenceContext(params.session, jurisdiction)
  const existing = normalizeDetailedDescriptionSourceSelection(context.normalizedData.detailedDescriptionSourceSelection)
  // Freezing is optional: whatever claims are saved right now drive evidence selection.
  if (!context.claimsText) {
    const selection = buildDeterministicDetailedDescriptionSelection(context.normalizedData, [
      'No claims are available yet; Detailed Description evidence selection was not run.',
    ])
    selection.jurisdiction = jurisdiction
    selection.inputHash = context.inputHash
    selection.generatedAt = new Date().toISOString()
    const normalizedData = await saveSelection(params.session, context.normalizedData, selection)
    return { selection, normalizedData, usedCache: false }
  }

  if (!params.force && existing?.status === 'ready' && existing.inputHash === context.inputHash && existing.jurisdiction === jurisdiction) {
    return { selection: existing, normalizedData: context.normalizedData, usedCache: true }
  }

  if (!context.supportDataSources.length) {
    const selection: DetailedDescriptionSourceSelection = {
      schemaVersion: 1,
      status: 'ready',
      sectionKey: 'detailedDescription',
      jurisdiction,
      inputHash: context.inputHash,
      generatedAt: new Date().toISOString(),
      selectedSources: [],
      guardrailSources: [],
      excludedSources: [],
      warnings: ['No support data sources are available for Detailed Description evidence selection.'],
    }
    const normalizedData = await saveSelection(params.session, context.normalizedData, selection)
    return { selection, normalizedData, usedCache: false }
  }

  const positiveCandidates = context.supportDataSources.filter(isDetailedDescriptionPositiveCandidate)
  const guardrailCandidates = context.supportDataSources.filter(isDetailedDescriptionGuardrailCandidate)
  if (!positiveCandidates.length && !guardrailCandidates.length) {
    const selection = buildDeterministicDetailedDescriptionSelection(context.normalizedData, [
      'No Detailed Description-eligible support data sources were available.',
    ])
    selection.status = 'ready'
    selection.jurisdiction = jurisdiction
    selection.inputHash = context.inputHash
    selection.generatedAt = new Date().toISOString()
    const normalizedData = await saveSelection(params.session, context.normalizedData, selection)
    return { selection, normalizedData, usedCache: false }
  }

  try {
    const prompt = buildSelectorPrompt(context, jurisdiction)
    const { llmGateway } = await import('@/lib/metering/gateway')
    const result = await llmGateway.executeLLMOperation(
      { headers: params.requestHeaders || {} },
      {
        taskCode: 'LLM2_DRAFT',
        stageCode: getSectionStageCode('detailedDescription'),
        prompt,
        parameters: {
          ...(params.tenantId ? { tenantId: params.tenantId } : {}),
          maxOutputTokens: 1800,
          temperature: 0,
        },
        idempotencyKey: crypto.randomUUID(),
        metadata: {
          patentId: params.session?.patentId,
          sessionId: params.session?.id,
          jurisdiction,
          purpose: 'dd_source_selection',
        },
      }
    )

    if (!result.success || !result.response?.output) {
      throw new Error(result.error?.message || 'DD source selection LLM call failed')
    }

    const parsed = parseJsonObject(result.response.output)
    let selection = validateDetailedDescriptionSourceSelection(parsed, context.supportDataSources, {
      jurisdiction,
      inputHash: context.inputHash,
      status: 'ready',
    })
    if (!selection.selectedSources?.length && positiveCandidates.length > 0) {
      selection = buildDeterministicDetailedDescriptionSelection(context.normalizedData, [
        'LLM selector returned no positive sources; deterministic safe filtering was used.',
      ])
      selection.status = 'failed'
      selection.jurisdiction = jurisdiction
      selection.inputHash = context.inputHash
      selection.generatedAt = new Date().toISOString()
    }
    const normalizedData = await saveSelection(params.session, context.normalizedData, selection)
    return { selection, normalizedData, usedCache: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const selection = buildDeterministicDetailedDescriptionSelection(context.normalizedData, [
      `LLM evidence selection failed; deterministic safe filtering will be used. ${message}`,
    ])
    selection.jurisdiction = jurisdiction
    selection.inputHash = context.inputHash
    selection.generatedAt = new Date().toISOString()
    const normalizedData = await saveSelection(params.session, context.normalizedData, selection)
    return { selection, normalizedData, usedCache: false }
  }
}

export function buildDetailedDescriptionSelectionInputHash(session: any, jurisdiction = 'US') {
  return buildEvidenceContext(session, jurisdiction.toUpperCase()).inputHash
}
