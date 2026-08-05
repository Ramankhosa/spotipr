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

/**
 * Validation is advisory.
 *
 * normalizePatentDiagram runs first and mechanically repairs every defect that
 * can be repaired — unknown IDs, duplicates, over-wide rows, over-long labels,
 * dangling connectors. Whatever reaches this function is therefore either
 * drawable or a note for the attorney, so findings are reported and none of
 * them fail a figure. Density in particular is a note: a dense drawing is a
 * dense drawing, not an unfileable one, and splitting it is the attorney's call.
 *
 * The only genuine errors left are in validatePatentPlantUmlSource, which
 * inspects the source this module itself emitted.
 */

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
  const densityNotes: string[] = []

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
    if (visibleNodeCount > PATENT_DIAGRAM_COMPLEXITY.component.warningComponents) densityNotes.push(`${visibleNodeCount} components`)
    if (connectorCount > PATENT_DIAGRAM_COMPLEXITY.component.warningConnectors) densityNotes.push(`${connectorCount} connectors`)
    if (groupCount > PATENT_DIAGRAM_COMPLEXITY.component.maximumDetailedBands) densityNotes.push(`${groupCount} subsystem bands`)
  } else if (diagram.kind === 'SEQUENCE') {
    visibleNodeCount = diagram.participants.length
    connectorCount = diagram.interactions.length
    maximumRowSize = visibleNodeCount
    maximumLabelWords = Math.max(0, ...diagram.interactions.map(item => words(item.label)))
    if (visibleNodeCount > PATENT_DIAGRAM_COMPLEXITY.sequence.warningParticipants) densityNotes.push(`${visibleNodeCount} participants`)
    if (connectorCount > PATENT_DIAGRAM_COMPLEXITY.sequence.warningInteractions) densityNotes.push(`${connectorCount} interactions`)
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
    if (visibleNodeCount > PATENT_DIAGRAM_COMPLEXITY.process.warningNodes) densityNotes.push(`${visibleNodeCount} steps`)
  } else {
    visibleNodeCount = diagram.constituents.length
    connectorCount = diagram.relationships.length
    maximumRowSize = Math.min(visibleNodeCount, PATENT_DIAGRAM_STYLE.maximumComponentsPerRow)
    maximumLabelWords = Math.max(0, ...diagram.constituents.map(node => words(node.displayLabel)))
    if (visibleNodeCount > PATENT_DIAGRAM_COMPLEXITY.constituent.warningConstituents) densityNotes.push(`${visibleNodeCount} constituents`)
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
    dense: densityNotes.length > 0,
    densityNotes,
  }
}

function relationshipPairs(diagram: PatentDiagram): Array<{
  fromId: string
  toId: string
  label?: string
  category?: RelationshipCategory
}> {
  if (diagram.kind === 'COMPONENT' || diagram.kind === 'CONSTITUENT') return diagram.relationships
  if (diagram.kind === 'SEQUENCE') return diagram.interactions
  return diagram.transitions
}

export function validatePatentDiagram(
  diagram: PatentDiagram,
  components: PatentDiagramComponent[],
): DiagramValidationReport {
  const issues: DiagramValidationIssue[] = []
  const componentById = new Map(components.map(component => [component.id, component]))
  const visibleIds = diagramComponentIds(diagram)
  const visibleSet = new Set(visibleIds)

  for (const id of Array.from(visibleSet)) {
    if (!componentById.has(id)) {
      issues.push({ code: 'UNKNOWN_COMPONENT', severity: 'warning', message: `Component ${id} is not in the Component Plan`, componentId: id })
    }
  }

  const missingCritical = diagram.claimCriticalComponentIds.filter(id => !visibleSet.has(id))
  missingCritical.forEach(id => issues.push({
    code: 'MISSING_CLAIM_CRITICAL_COMPONENT', severity: 'warning',
    message: `Claim-critical component ${id} is absent from the figure`, componentId: id,
  }))

  for (const link of relationshipPairs(diagram)) {
    if (words(link.label) > PATENT_DIAGRAM_COMPLEXITY.connectorLabelWords) {
      issues.push({ code: 'LONG_CONNECTOR_LABEL', severity: 'warning', message: `Connector label "${link.label}" exceeds ${PATENT_DIAGRAM_COMPLEXITY.connectorLabelWords} words` })
    }
  }

  if (diagram.kind === 'COMPONENT') {
    diagram.groups.forEach((group, groupIndex) => {
      group.rows.forEach((row, rowIndex) => {
        if (row.componentIds.length > PATENT_DIAGRAM_STYLE.maximumComponentsPerRow) {
          issues.push({
            code: 'ROW_LIMIT', severity: 'warning',
            message: `Subsystem ${group.label}, row ${rowIndex + 1} exceeds ${PATENT_DIAGRAM_STYLE.maximumComponentsPerRow} components`,
            path: `groups.${groupIndex}.rows.${rowIndex}`,
          })
        }
      })
    })
  }

  if (diagram.kind === 'PROCESS') {
    const keys = new Set(diagram.nodes.map(node => node.key))
    diagram.transitions.forEach(link => {
      if (!keys.has(link.fromId) || !keys.has(link.toId)) {
        issues.push({ code: 'UNKNOWN_PROCESS_ENDPOINT', severity: 'warning', message: `Transition ${link.fromId} to ${link.toId} references an unknown step` })
      }
    })
    diagram.nodes.forEach(node => {
      // A step with no component linkage cannot be traced back to the Component
      // Plan. Worth telling the attorney; not worth refusing to draw.
      if (node.kind === 'STEP' && !node.componentId) {
        issues.push({
          code: 'UNGROUNDED_STEP', severity: 'warning',
          message: `Step "${node.label}" does not name the Component Planner entry that performs it`,
        })
      }
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
      issues.push({ code: 'LONG_NODE_LABEL', severity: 'warning', message: `Node label "${label}" exceeds ${PATENT_DIAGRAM_STYLE.maximumLabelWords} words` })
    }
  })

  const complexity = analyzeDiagramComplexity(diagram)
  if (complexity.dense) {
    issues.push({
      code: 'DENSE_FIGURE', severity: 'warning',
      message: `Figure is dense (${complexity.densityNotes.join(', ')}); consider dividing it if the drawing reads poorly at filing scale`,
    })
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
