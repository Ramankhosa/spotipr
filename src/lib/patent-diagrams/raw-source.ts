import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { cleanPlantUmlForRendering } from '@/lib/plantuml-renderer'
import { renderAndWriteDiagramArtifacts, resolveDiagramPagePolicy } from './artifacts'
import { validatePatentPlantUmlSource } from './validation'
import { extractReferenceMapComponents, PatentDiagramPipelineError, semanticChecksum } from './pipeline'
import { patentDiagramSchema, type DiagramValidationIssue, type PatentDiagramComponent } from './types'
import { PATENT_DIAGRAM_COMPLEXITY } from './policy'

const DECLARATION = /^\s*(rectangle|participant|diamond)\s+(?:"((?:\\.|[^"])*)"\s+as\s+([A-Za-z_][\w.]*)|([A-Za-z_][\w.]*))(?:\s+<<([^>]+)>>)?\s*\{?\s*$/i
const CONNECTION = /^\s*([A-Za-z_][\w.]*)\s+(--|-[^\s]*->|\.\.?[^\s]*>|<[^\s]*|->|-->|<--|<-)\s+([A-Za-z_][\w.]*)(?:\s*:\s*(.*))?$/i
const UNSAFE_DIRECTIVE = /^\s*!\s*(include|import|theme|pragma|define|function|procedure|unquoted|startsub|endsub)\b/im
const PROHIBITED_RAW_ENTITY = /^\s*(actor|cloud|database|artifact|node|note|hnote|rnote|sprite)\b/im

export interface ExtractedRawFacts {
  nodes: Array<{ id: string; label: string; referenceLabel: string | null; componentId: string | null }>
  edges: Array<{ from: string; to: string; label: string; layoutOnly: false }>
  labelMap: Record<string, string>
}

function unescapeLabel(value: string): string {
  return value.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim()
}

function referenceFromLabel(label: string): string | null {
  const lines = label.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const finalLine = lines.at(-1) || ''
  const parenthesized = finalLine.match(/^\(([^()]+)\)$/)?.[1]
  if (parenthesized) return parenthesized.trim()
  if (/^[SD]\d+$/i.test(finalLine)) return finalLine.toUpperCase()
  if (/^[SD]\d+$/i.test(lines[0] || '')) return lines[0].toUpperCase()
  return null
}

export function extractRawPlantUmlFacts(code: string, components: PatentDiagramComponent[], allowedProcessIdentifiers?: Set<string>): {
  facts: ExtractedRawFacts
  issues: DiagramValidationIssue[]
} {
  const issues: DiagramValidationIssue[] = []
  const aliases = new Map<string, { label: string; referenceLabel: string | null; boundary: boolean }>()
  const seenReferences = new Set<string>()
  const normalizedReference = (value: string) => value.replace(/^\(|\)$/g, '').trim().toUpperCase()
  const byReference = new Map(components.map(component => [normalizedReference(component.referenceLabel), component]))
  const edges: ExtractedRawFacts['edges'] = []
  const edgeSignatures = new Set<string>()

  const sourceLines = code.split(/\r?\n/)
  for (let index = 0; index < sourceLines.length; index++) {
    const line = sourceLines[index]
    const declaration = line.match(DECLARATION)
    if (declaration) {
      const alias = declaration[3] || declaration[4]
      const label = unescapeLabel(declaration[2] || declaration[4] || alias)
      const boundary = /^(SYSTEM|SUBSYSTEM)$/i.test(String(declaration[5] || '').trim())
      if (aliases.has(alias)) {
        issues.push({ code: 'DUPLICATE_ALIAS', severity: 'error', message: `Alias ${alias} is declared more than once`, path: `line ${index + 1}` })
        continue
      }
      const referenceLabel = referenceFromLabel(label)
      if (!boundary && referenceLabel) {
        if (seenReferences.has(referenceLabel)) {
          issues.push({ code: 'DUPLICATE_REFERENCE', severity: 'error', message: `Reference ${referenceLabel} appears more than once`, path: `line ${index + 1}` })
        }
        seenReferences.add(referenceLabel)
        const normalized = normalizedReference(referenceLabel)
        // An S###/D### label passes only when the figure's own semantic model
        // already carries that identifier. The previous `!size ||` shortcut gave
        // every S/D label a blanket exemption from the Component Planner check
        // whenever no allow-list was supplied, which is exactly how invented
        // step numbers reached a filed drawing.
        const processIdentifierAllowed = /^[SD]\d+$/i.test(referenceLabel)
          && !!allowedProcessIdentifiers?.has(normalized)
        if (!byReference.has(normalized) && !processIdentifierAllowed) {
          issues.push({ code: 'UNKNOWN_REFERENCE', severity: 'error', message: `Reference ${referenceLabel} is not in the Component Planner`, path: `line ${index + 1}` })
        }
      }
      aliases.set(alias, { label, referenceLabel, boundary })
      continue
    }

    if (/\[hidden\]/i.test(line)) continue
    const connection = line.match(CONNECTION)
    if (connection) {
      const [, from, , to, rawLabel = ''] = connection
      const label = rawLabel.trim()
      const signature = `${from}\u0000${to}\u0000${label.toLowerCase()}`
      if (edgeSignatures.has(signature)) {
        issues.push({ code: 'DUPLICATE_RELATIONSHIP', severity: 'error', message: `Relationship ${from} to ${to} is duplicated`, path: `line ${index + 1}` })
      }
      edgeSignatures.add(signature)
      edges.push({ from, to, label, layoutOnly: false })
    }
  }

  for (const edge of edges) {
    if (!aliases.has(edge.from)) issues.push({ code: 'UNKNOWN_ALIAS', severity: 'error', message: `Connection uses unknown alias ${edge.from}` })
    if (!aliases.has(edge.to)) issues.push({ code: 'UNKNOWN_ALIAS', severity: 'error', message: `Connection uses unknown alias ${edge.to}` })
  }

  const nodes = Array.from(aliases, ([id, node]) => {
    if (node.boundary) return null
    const component = node.referenceLabel ? byReference.get(normalizedReference(node.referenceLabel)) : undefined
    return { id, label: node.label, referenceLabel: node.referenceLabel, componentId: component?.id || null }
  }).filter((node): node is NonNullable<typeof node> => !!node)
  const labelMap = Object.fromEntries(nodes.filter(node => node.componentId).map(node => [node.id, node.componentId as string]))
  return { facts: { nodes, edges, labelMap }, issues }
}

export function validateRawPlantUmlSource(rawCode: string, components: PatentDiagramComponent[], allowedProcessIdentifiers?: Set<string>) {
  const cleanedCode = cleanPlantUmlForRendering(rawCode)
  const issues = validatePatentPlantUmlSource(cleanedCode)
  if (UNSAFE_DIRECTIVE.test(rawCode)) {
    issues.push({ code: 'UNSAFE_DIRECTIVE', severity: 'error', message: 'PlantUML includes/imports/macros are not permitted' })
  }
  if (PROHIBITED_RAW_ENTITY.test(rawCode)) {
    issues.push({ code: 'PROHIBITED_ENTITY', severity: 'error', message: 'Decorative entities, icons, sprites, and notes are not permitted' })
  }
  const facts = extractRawPlantUmlFacts(cleanedCode, components, allowedProcessIdentifiers)
  issues.push(...facts.issues)
  if (!facts.facts.nodes.length) issues.push({ code: 'EMPTY_DIAGRAM', severity: 'error', message: 'No supported diagram elements were found' })
  for (const node of facts.facts.nodes) {
    const nameLines = node.label.split(/\r?\n/).filter(line => !/^\([^)]+\)$/.test(line.trim()) && !/^[SD]\d+$/i.test(line.trim()))
    const wordCount = nameLines.join(' ').trim().split(/\s+/).filter(Boolean).length
    if (wordCount > 7 || nameLines.length > 3) {
      issues.push({ code: 'FILING_NODE_LABEL', severity: 'error', message: `Node ${node.id} exceeds the filing label limit` })
    }
    if (!node.referenceLabel) {
      issues.push({ code: 'FILING_MISSING_REFERENCE', severity: 'error', message: `Node ${node.id} has no canonical reference sign` })
    }
  }
  for (const edge of facts.facts.edges) {
    if (edge.label.split(/\s+/).filter(Boolean).length > PATENT_DIAGRAM_COMPLEXITY.connectorLabelWords) {
      issues.push({ code: 'FILING_CONNECTOR_LABEL', severity: 'error', message: `Connector ${edge.from} to ${edge.to} exceeds ${PATENT_DIAGRAM_COMPLEXITY.connectorLabelWords} label words` })
    }
  }
  if (facts.facts.nodes.length > PATENT_DIAGRAM_COMPLEXITY.component.splitComponents) issues.push({ code: 'FILING_COMPLEXITY', severity: 'error', message: `Raw figure exceeds ${PATENT_DIAGRAM_COMPLEXITY.component.splitComponents} visible elements and requires decomposition` })
  if (facts.facts.edges.length > PATENT_DIAGRAM_COMPLEXITY.component.splitConnectors) issues.push({ code: 'FILING_COMPLEXITY', severity: 'error', message: `Raw figure exceeds ${PATENT_DIAGRAM_COMPLEXITY.component.splitConnectors} technical connectors and requires decomposition` })
  return { cleanedCode, issues, facts: facts.facts, filingReady: !issues.some(issue => issue.severity === 'error') }
}

export interface SaveRawPlantUmlInput {
  userId: string
  patentId: string
  sessionId: string
  figureNo: number
  plantumlCode: string
  title?: string
  description?: string
}

export async function saveRawPlantUmlOverride(input: SaveRawPlantUmlInput) {
  const session = await prisma.draftingSession.findFirst({
    where: { id: input.sessionId, patentId: input.patentId, userId: input.userId },
    include: { referenceMap: true, figurePlans: true },
  })
  if (!session) throw new PatentDiagramPipelineError('Session not found or access denied', 404)
  const components = extractReferenceMapComponents(session.referenceMap)
  if (!components.length) throw new PatentDiagramPipelineError('Save a valid Component Plan before editing PlantUML')
  const referenceMapChecksum = semanticChecksum((session.referenceMap as any)?.components || [])

  const priorPlan = session.figurePlans.find(plan => plan.figureNo === input.figureNo)
  const priorSemantic = patentDiagramSchema.safeParse(priorPlan?.semanticModel)
  const allowedProcessIdentifiers = priorSemantic.success && priorSemantic.data.kind === 'PROCESS'
    ? new Set(priorSemantic.data.nodes.map(node => node.identifier?.toUpperCase()).filter(Boolean) as string[])
    : undefined
  const validation = validateRawPlantUmlSource(input.plantumlCode, components, allowedProcessIdentifiers)
  const cleaned = validation.cleanedCode
  const errors = validation.issues.filter(issue => issue.severity === 'error' && !issue.code.startsWith('FILING_'))
  if (errors.length) throw new PatentDiagramPipelineError('PlantUML validation failed; the previous valid diagram was retained', 422, errors)

  let rendered: Awaited<ReturnType<typeof renderAndWriteDiagramArtifacts>>
  try {
    const countryCode = session.activeJurisdiction || session.draftingJurisdictions[0] || 'US'
    const pagePolicy = await resolveDiagramPagePolicy(countryCode)
    rendered = await renderAndWriteDiagramArtifacts({
      patentId: input.patentId,
      figureNo: input.figureNo,
      plantumlCode: cleaned,
      pagePolicy,
    })
    if (rendered.effectiveFontSizePt != null && rendered.effectiveFontSizePt < pagePolicy.minimumTextSizePt) {
      validation.issues.push({
        code: 'FILING_PAGE_FIT', severity: 'error',
        message: `Page fitting would reduce text to ${rendered.effectiveFontSizePt.toFixed(1)} pt below the ${pagePolicy.minimumTextSizePt} pt minimum`,
      })
    }
  } catch (error) {
    throw new PatentDiagramPipelineError('PlantUML render failed; the previous valid diagram was retained', 422, error instanceof Error ? error.message : error)
  }

  const { svg, png, artifacts: renderArtifacts } = rendered
  const svgFilename = renderArtifacts.svg.filename!
  const pngFilename = renderArtifacts.png.filename!
  const svgPath = renderArtifacts.svg.path!
  const pngPath = renderArtifacts.png.path!

  const checksum = crypto.createHash('sha256').update(cleaned).digest('hex')
  const report = {
    filingReady: !validation.issues.some(issue => issue.severity === 'error'),
    issues: validation.issues,
    corrections: ['Removed user style directives and injected the PatentNest filing style'],
    sourceMode: 'RAW_OVERRIDE',
    semanticsDetached: true,
    render: { width: svg.width, height: svg.height, viewBox: svg.viewBox },
  }
  const [diagramSource] = await prisma.$transaction([
    prisma.diagramSource.upsert({
      where: { sessionId_figureNo_language: { sessionId: input.sessionId, figureNo: input.figureNo, language: 'en' } },
      create: {
        sessionId: input.sessionId, figureNo: input.figureNo, language: 'en', plantumlCode: cleaned, checksum,
        sourceMode: 'RAW_OVERRIDE', labelMap: validation.facts.labelMap, renderArtifacts: renderArtifacts as any,
        renderStatus: report.filingReady ? 'SUCCESS' : 'REVIEW_REQUIRED',
        renderError: report.filingReady ? null : validation.issues.filter(issue => issue.severity === 'error').map(issue => issue.message).join('; '),
        semanticChecksum: null, referenceMapChecksum, imageFilename: pngFilename, imagePath: pngPath, imageChecksum: png.checksum, imageUploadedAt: new Date(),
      },
      update: {
        plantumlCode: cleaned, checksum, sourceMode: 'RAW_OVERRIDE', labelMap: validation.facts.labelMap,
        renderArtifacts: renderArtifacts as any,
        renderStatus: report.filingReady ? 'SUCCESS' : 'REVIEW_REQUIRED',
        renderError: report.filingReady ? null : validation.issues.filter(issue => issue.severity === 'error').map(issue => issue.message).join('; '),
        semanticChecksum: null, referenceMapChecksum,
        imageFilename: pngFilename, imagePath: pngPath, imageChecksum: png.checksum, imageUploadedAt: new Date(),
      },
    }),
    prisma.figurePlan.upsert({
      where: { sessionId_figureNo: { sessionId: input.sessionId, figureNo: input.figureNo } },
      create: {
        sessionId: input.sessionId, figureNo: input.figureNo, title: input.title?.trim() || `Figure ${input.figureNo}`,
        description: input.description?.trim() || null, nodes: validation.facts.nodes, edges: validation.facts.edges,
        validationReport: report as any,
      },
      update: {
        title: input.title?.trim() || priorPlan?.title || `Figure ${input.figureNo}`,
        ...(input.description?.trim() ? { description: input.description.trim() } : {}),
        nodes: validation.facts.nodes, edges: validation.facts.edges, validationReport: report as any,
      },
    }),
    prisma.diagramSource.updateMany({
      where: { sessionId: input.sessionId, figureNo: input.figureNo, language: { not: 'en' } },
      data: { renderStatus: 'STALE', translatedFromChecksum: checksum },
    }),
  ])

  return { diagramSource, plantumlCode: cleaned, validationReport: report, renderArtifacts, nodes: validation.facts.nodes, edges: validation.facts.edges }
}
