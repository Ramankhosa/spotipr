import { PATENT_DIAGRAM_STYLE } from './style'
import { PATENT_DIAGRAM_COMPLEXITY } from './policy'
import type {
  DiagramComplexityMetrics,
  DiagramValidationIssue,
  DiagramValidationReport,
  PatentDiagram,
  PatentDiagramComponent,
  RelationshipCategory,
} from './types'
import { relationshipVisualStyle } from './relationships'

function words(value: string | undefined): number {
  return String(value || '').trim().split(/\s+/).filter(Boolean).length
}

function diagramComponentIds(diagram: PatentDiagram): string[] {
  switch (diagram.kind) {
    case 'COMPONENT': return diagram.components.map(node => node.componentId)
    case 'SEQUENCE': return diagram.participants.map(node => node.componentId)
    case 'PROCESS': return diagram.nodes.flatMap(node => [node.componentId, ...node.relatedComponentIds].filter(Boolean) as string[])
    case 'CONSTITUENT': return diagram.constituents.map(node => node.componentId)
  }
}

export function analyzeDiagramComplexity(diagram: PatentDiagram): DiagramComplexityMetrics {
  let visibleNodeCount = 0
  let connectorCount = 0
  let groupCount = 0
  let maximumRowSize = 0
  let maximumLabelWords = 0
  let crossLayerConnectorCount = 0
  let nestingDepth = 1
  let branchDepth = 0
  const splitReasons: string[] = []

  if (diagram.kind === 'COMPONENT') {
    visibleNodeCount = diagram.components.length
    connectorCount = diagram.relationships.length
    groupCount = diagram.groups.length
    nestingDepth = 3
    maximumRowSize = Math.max(0, ...diagram.groups.flatMap(group => group.rows.map(row => row.componentIds.length)))
    maximumLabelWords = Math.max(0, ...diagram.components.map(node => words(node.displayLabel)))
    const groupByComponent = new Map<string, string>()
    diagram.groups.forEach(group => group.rows.forEach(row => row.componentIds.forEach(id => groupByComponent.set(id, group.id))))
    crossLayerConnectorCount = diagram.relationships.filter(link => {
      const from = groupByComponent.get(link.fromId)
      const to = groupByComponent.get(link.toId)
      return from && to && from !== to
    }).length
    if (visibleNodeCount > PATENT_DIAGRAM_COMPLEXITY.component.splitComponents) splitReasons.push(`component count ${visibleNodeCount} exceeds ${PATENT_DIAGRAM_COMPLEXITY.component.splitComponents}`)
    if (connectorCount > PATENT_DIAGRAM_COMPLEXITY.component.splitConnectors) splitReasons.push(`connector count ${connectorCount} exceeds ${PATENT_DIAGRAM_COMPLEXITY.component.splitConnectors}`)
    if (maximumRowSize > PATENT_DIAGRAM_STYLE.maximumComponentsPerRow) splitReasons.push(`row size ${maximumRowSize} exceeds ${PATENT_DIAGRAM_STYLE.maximumComponentsPerRow}`)
    if (diagram.detailLevel === 'DETAIL' && groupCount > PATENT_DIAGRAM_COMPLEXITY.component.maximumDetailedBands) splitReasons.push(`detailed figure contains ${groupCount} subsystem bands`)
  } else if (diagram.kind === 'SEQUENCE') {
    visibleNodeCount = diagram.participants.length
    connectorCount = diagram.interactions.length
    maximumRowSize = visibleNodeCount
    maximumLabelWords = Math.max(0, ...diagram.interactions.map(item => words(item.label)))
    const alternativeConditions = new Set(diagram.interactions.map(item => item.alternative?.condition).filter(Boolean))
    if (visibleNodeCount > PATENT_DIAGRAM_COMPLEXITY.sequence.splitParticipants) splitReasons.push(`participant count ${visibleNodeCount} exceeds ${PATENT_DIAGRAM_COMPLEXITY.sequence.splitParticipants}`)
    if (connectorCount > PATENT_DIAGRAM_COMPLEXITY.sequence.splitInteractions) splitReasons.push(`interaction count ${connectorCount} exceeds ${PATENT_DIAGRAM_COMPLEXITY.sequence.splitInteractions}`)
    if (alternativeConditions.size > PATENT_DIAGRAM_COMPLEXITY.sequence.maximumAlternatives) splitReasons.push('sequence contains multiple independent alternatives')
  } else if (diagram.kind === 'PROCESS') {
    visibleNodeCount = diagram.nodes.length
    connectorCount = diagram.transitions.length
    maximumRowSize = 1
    maximumLabelWords = Math.max(0, ...diagram.nodes.map(node => words(node.label)))
    const nodeByKey = new Map(diagram.nodes.map(node => [node.key, node]))
    const outgoing = new Map<string, string[]>()
    diagram.transitions.forEach(link => outgoing.set(link.fromId, [...(outgoing.get(link.fromId) || []), link.toId]))
    const measureDecisionDepth = (key: string, visiting = new Set<string>()): number => {
      if (visiting.has(key)) return 0
      const nextVisiting = new Set(visiting).add(key)
      const own = nodeByKey.get(key)?.kind === 'DECISION' ? 1 : 0
      return own + Math.max(0, ...(outgoing.get(key) || []).map(next => measureDecisionDepth(next, nextVisiting)))
    }
    branchDepth = Math.max(0, ...diagram.nodes.map(node => measureDecisionDepth(node.key)))
    if (visibleNodeCount > PATENT_DIAGRAM_COMPLEXITY.process.splitNodes) splitReasons.push(`process node count ${visibleNodeCount} exceeds ${PATENT_DIAGRAM_COMPLEXITY.process.splitNodes}`)
    if (branchDepth > PATENT_DIAGRAM_COMPLEXITY.process.maximumBranchDepth) splitReasons.push(`process branch depth ${branchDepth} exceeds ${PATENT_DIAGRAM_COMPLEXITY.process.maximumBranchDepth}`)
  } else {
    visibleNodeCount = diagram.constituents.length
    connectorCount = diagram.relationships.length
    maximumRowSize = Math.min(visibleNodeCount, PATENT_DIAGRAM_STYLE.maximumComponentsPerRow)
    maximumLabelWords = Math.max(0, ...diagram.constituents.map(node => words(node.displayLabel)))
    if (visibleNodeCount > PATENT_DIAGRAM_COMPLEXITY.constituent.splitConstituents) splitReasons.push(`constituent count ${visibleNodeCount} exceeds ${PATENT_DIAGRAM_COMPLEXITY.constituent.splitConstituents}`)
  }

  return {
    visibleNodeCount,
    connectorCount,
    groupCount,
    maximumRowSize,
    maximumLabelWords,
    crossLayerConnectorCount,
    nestingDepth,
    branchDepth,
    requiresSplit: splitReasons.length > 0,
    splitReasons,
  }
}

function relationshipPairs(diagram: PatentDiagram): Array<{ fromId: string; toId: string; label?: string; category?: RelationshipCategory }> {
  if (diagram.kind === 'COMPONENT' || diagram.kind === 'CONSTITUENT') return diagram.relationships
  if (diagram.kind === 'SEQUENCE') return diagram.interactions
  return diagram.transitions
}

export function validatePatentDiagram(
  diagram: PatentDiagram,
  components: PatentDiagramComponent[],
  supportedEvidenceIds?: Set<string>,
): DiagramValidationReport {
  const issues: DiagramValidationIssue[] = []
  const componentById = new Map(components.map(component => [component.id, component]))
  const visibleIds = diagramComponentIds(diagram)
  const visibleSet = new Set(visibleIds)
  const duplicateIds = visibleIds.filter((id, index) => visibleIds.indexOf(id) !== index)

  for (const id of Array.from(new Set(duplicateIds))) {
    issues.push({ code: 'DUPLICATE_COMPONENT', severity: 'error', message: `Component ${id} appears more than once`, componentId: id })
  }
  for (const id of Array.from(visibleSet)) {
    if (!componentById.has(id)) {
      issues.push({ code: 'UNKNOWN_COMPONENT', severity: 'error', message: `Unknown Component Planner ID: ${id}`, componentId: id })
    }
  }

  const missingCritical = diagram.claimCriticalComponentIds.filter(id => !visibleSet.has(id))
  missingCritical.forEach(id => issues.push({
    code: 'MISSING_CLAIM_CRITICAL_COMPONENT', severity: 'error',
    message: `Claim-critical component ${id} is absent from the figure`, componentId: id,
  }))
  // Evidence IDs are provenance metadata, not drawn content: a figure whose
  // elements and relationships are all valid is still a correct drawing without
  // them, so these are review notes rather than filing blockers.
  if (supportedEvidenceIds?.size) {
    if (!diagram.evidenceIds.length) {
      issues.push({ code: 'MISSING_DISCLOSURE_EVIDENCE', severity: 'warning', message: 'Figure has no linked disclosure evidence IDs' })
    }
    diagram.evidenceIds.filter(id => !supportedEvidenceIds.has(id)).forEach(id => {
      issues.push({ code: 'UNKNOWN_DISCLOSURE_EVIDENCE', severity: 'warning', message: `Unrecognized disclosure evidence ID: ${id}` })
    })
  }

  const seenRelationships = new Set<string>()
  for (const link of relationshipPairs(diagram)) {
    if (!visibleSet.has(link.fromId) && diagram.kind !== 'PROCESS') {
      issues.push({ code: 'UNKNOWN_RELATION_ENDPOINT', severity: 'error', message: `Relationship source ${link.fromId} is not visible` })
    }
    if (!visibleSet.has(link.toId) && diagram.kind !== 'PROCESS') {
      issues.push({ code: 'UNKNOWN_RELATION_ENDPOINT', severity: 'error', message: `Relationship target ${link.toId} is not visible` })
    }
    const signature = `${link.fromId}\u0000${link.toId}\u0000${String(link.label || '').toLowerCase()}\u0000${link.category || ''}`
    if (seenRelationships.has(signature)) {
      issues.push({ code: 'DUPLICATE_RELATIONSHIP', severity: 'warning', message: `Duplicate relationship ${link.fromId} to ${link.toId}` })
    }
    seenRelationships.add(signature)
    if (words(link.label) > PATENT_DIAGRAM_COMPLEXITY.connectorLabelWords) {
      issues.push({ code: 'LONG_CONNECTOR_LABEL', severity: 'error', message: `Connector label "${link.label}" exceeds ${PATENT_DIAGRAM_COMPLEXITY.connectorLabelWords} words` })
    }
  }

  if (diagram.kind === 'COMPONENT') {
    const groupedIds = diagram.groups.flatMap(group => group.rows.flatMap(row => row.componentIds))
    for (const id of Array.from(visibleSet)) {
      if (!groupedIds.includes(id)) issues.push({ code: 'UNGROUPED_COMPONENT', severity: 'error', message: `Component ${id} is not placed in a subsystem row`, componentId: id })
    }
    diagram.groups.forEach((group, groupIndex) => {
      if (!group.rows.length) issues.push({ code: 'EMPTY_SUBSYSTEM', severity: 'error', message: `Subsystem ${group.label} is empty` })
      group.rows.forEach((row, rowIndex) => {
        if (row.componentIds.length > PATENT_DIAGRAM_STYLE.maximumComponentsPerRow) {
          issues.push({ code: 'ROW_LIMIT', severity: 'error', message: `Subsystem ${group.label}, row ${rowIndex + 1} exceeds four components` })
        }
      })
      if (diagram.detailLevel === 'DETAIL' && groupIndex >= PATENT_DIAGRAM_COMPLEXITY.component.maximumDetailedBands) {
        issues.push({ code: 'DETAIL_BAND_LIMIT', severity: 'warning', message: 'Detailed component figure contains more than four subsystem bands' })
      }
    })
  }

  if (diagram.kind === 'PROCESS') {
    const keys = new Set(diagram.nodes.map(node => node.key))
    const identifiers = diagram.nodes.map(node => node.identifier).filter(Boolean) as string[]
    const duplicateIdentifiers = identifiers.filter((identifier, index) => identifiers.indexOf(identifier) !== index)
    Array.from(new Set(duplicateIdentifiers)).forEach(identifier => issues.push({
      code: 'DUPLICATE_PROCESS_IDENTIFIER', severity: 'error', message: `Process identifier ${identifier} appears more than once`,
    }))
    diagram.nodes.forEach(node => {
      if (node.identifier && !new RegExp(node.kind === 'DECISION' ? '^D\\d+$' : '^S\\d+$', 'i').test(node.identifier)) {
        issues.push({ code: 'INVALID_PROCESS_IDENTIFIER', severity: 'error', message: `${node.kind} ${node.key} has invalid identifier ${node.identifier}` })
      }
      // A step with no component linkage cannot be traced to the Component
      // Plan, which is the pattern hallucinated lifecycle steps follow. It is
      // a warning here so figures persisted before the anchoring rule still
      // translate and re-render; the generation path (detailManagedFigure)
      // escalates it to a blocker for newly generated figures.
      if (!node.componentId && !node.relatedComponentIds.length) {
        issues.push({ code: 'UNGROUNDED_STEP', severity: 'warning', message: `Step "${node.label}" is not linked to any Component Planner entry; confirm it is disclosed by the invention` })
      }
    })
    diagram.transitions.forEach(link => {
      if (!keys.has(link.fromId)) issues.push({ code: 'UNKNOWN_PROCESS_ENDPOINT', severity: 'error', message: `Transition source ${link.fromId} is unknown` })
      if (!keys.has(link.toId)) issues.push({ code: 'UNKNOWN_PROCESS_ENDPOINT', severity: 'error', message: `Transition target ${link.toId} is unknown` })
    })
  }

  const labels: string[] = diagram.kind === 'COMPONENT'
    ? diagram.components.map(node => node.displayLabel || componentById.get(node.componentId)?.name || '')
    : diagram.kind === 'SEQUENCE'
      ? diagram.participants.map(node => node.displayLabel || componentById.get(node.componentId)?.name || '')
      : diagram.kind === 'PROCESS'
        ? diagram.nodes.map(node => node.label)
        : diagram.constituents.map(node => node.displayLabel || componentById.get(node.componentId)?.name || '')
  labels.forEach(label => {
    if (words(label) > PATENT_DIAGRAM_STYLE.maximumLabelWords) {
      issues.push({ code: 'LONG_NODE_LABEL', severity: 'error', message: `Node label "${label}" exceeds ${PATENT_DIAGRAM_STYLE.maximumLabelWords} words` })
    }
  })

  const complexity = analyzeDiagramComplexity(diagram)
  complexity.splitReasons.forEach(reason => issues.push({ code: 'SPLIT_REQUIRED', severity: 'error', message: reason }))

  if (diagram.kind === 'COMPONENT') {
    if (complexity.visibleNodeCount > PATENT_DIAGRAM_COMPLEXITY.component.warningComponents) issues.push({ code: 'COMPONENT_DENSITY_WARNING', severity: 'warning', message: `Component count exceeds the review threshold of ${PATENT_DIAGRAM_COMPLEXITY.component.warningComponents}` })
    if (complexity.connectorCount > PATENT_DIAGRAM_COMPLEXITY.component.warningConnectors) issues.push({ code: 'CONNECTOR_DENSITY_WARNING', severity: 'warning', message: `Technical connector count exceeds the review threshold of ${PATENT_DIAGRAM_COMPLEXITY.component.warningConnectors}` })
    if (complexity.crossLayerConnectorCount > PATENT_DIAGRAM_COMPLEXITY.component.warningCrossLayerLinks) issues.push({ code: 'CROSS_LAYER_WARNING', severity: 'warning', message: `Major cross-layer link count exceeds ${PATENT_DIAGRAM_COMPLEXITY.component.warningCrossLayerLinks}` })
  } else if (diagram.kind === 'SEQUENCE') {
    if (complexity.visibleNodeCount > PATENT_DIAGRAM_COMPLEXITY.sequence.warningParticipants) issues.push({ code: 'PARTICIPANT_DENSITY_WARNING', severity: 'warning', message: `Sequence participant count exceeds ${PATENT_DIAGRAM_COMPLEXITY.sequence.warningParticipants}` })
    if (complexity.connectorCount > PATENT_DIAGRAM_COMPLEXITY.sequence.warningInteractions) issues.push({ code: 'INTERACTION_DENSITY_WARNING', severity: 'warning', message: `Sequence interaction count exceeds ${PATENT_DIAGRAM_COMPLEXITY.sequence.warningInteractions}` })
  } else if (diagram.kind === 'PROCESS' && complexity.visibleNodeCount > PATENT_DIAGRAM_COMPLEXITY.process.warningNodes) {
    issues.push({ code: 'PROCESS_DENSITY_WARNING', severity: 'warning', message: `Process node count exceeds ${PATENT_DIAGRAM_COMPLEXITY.process.warningNodes}` })
  } else if (diagram.kind === 'CONSTITUENT' && complexity.visibleNodeCount > PATENT_DIAGRAM_COMPLEXITY.constituent.warningConstituents) {
    issues.push({ code: 'CONSTITUENT_DENSITY_WARNING', severity: 'warning', message: `Constituent count exceeds ${PATENT_DIAGRAM_COMPLEXITY.constituent.warningConstituents}` })
  }

  if (diagram.kind === 'COMPONENT' && diagram.relationships.length) {
    const primaryCount = diagram.relationships.filter(link => relationshipVisualStyle(link.category) === 'PRIMARY').length
    if (!primaryCount) issues.push({ code: 'NO_PRIMARY_FLOW', severity: 'warning', message: 'Component diagram has no primary technical flow' })
  }

  return {
    filingReady: !issues.some(issue => issue.severity === 'error'),
    issues,
    corrections: [],
    claimCriticalCoverage: {
      required: diagram.claimCriticalComponentIds,
      covered: diagram.claimCriticalComponentIds.filter(id => visibleSet.has(id)),
      missing: missingCritical,
    },
    complexity,
  }
}

const PROHIBITED_SOURCE = [
  { code: 'COLOR_DIRECTIVE', pattern: /#(?!(?:000|000000|FFF|FFFFFF)\b)(?:[0-9a-f]{3,8}|[A-Za-z][\w-]*)\b/i },
  { code: 'THEME_DIRECTIVE', pattern: /^\s*!\s*(theme|include|import)\b/im },
  { code: 'SHADOW_DIRECTIVE', pattern: /^\s*skinparam\s+shadowing\s+(?!false\b)/im },
  { code: 'ROUNDED_DIRECTIVE', pattern: /^\s*skinparam\s+roundcorner\s+(?!0\b)/im },
  { code: 'DECORATIVE_ENTITY', pattern: /^\s*(actor|cloud|database|artifact|node)\b/im },
  { code: 'NOTE_ENTITY', pattern: /^\s*(note|hnote|rnote)\b/im },
]

export function validatePatentPlantUmlSource(code: string): DiagramValidationIssue[] {
  const issues: DiagramValidationIssue[] = []
  const startCount = (code.match(/@startuml/gi) || []).length
  const endCount = (code.match(/@enduml/gi) || []).length
  if (startCount !== 1 || endCount !== 1) issues.push({ code: 'INVALID_BOUNDS', severity: 'error', message: 'Source requires exactly one @startuml and @enduml' })
  // Quoted label text is data, not directives: a component called "Model #A12"
  // must not trip the color gate.
  const unquoted = code.replace(/"(?:\\.|[^"\\])*"/g, '""')
  PROHIBITED_SOURCE.forEach(rule => {
    if (rule.pattern.test(unquoted)) issues.push({ code: rule.code, severity: 'error', message: `Prohibited PlantUML source: ${rule.code}` })
  })
  return issues
}
