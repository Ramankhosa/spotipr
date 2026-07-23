import crypto from 'crypto'
import { compilePatentDiagramStyle, escapePlantUmlLabel, PATENT_DIAGRAM_STYLE, wrapPatentLabel } from './style'
import { normalizePatentDiagram } from './normalize'
import { validatePatentDiagram, validatePatentPlantUmlSource } from './validation'
import type {
  BuiltPatentDiagram,
  ComponentDiagram,
  ConstituentDiagram,
  PatentDiagram,
  PatentDiagramComponent,
  ProcessDiagram,
  RelationshipCategory,
  SequenceDiagram,
} from './types'
import { PATENT_DIAGRAM_COMPLEXITY } from './policy'
import { relationshipVisualStyle } from './relationships'

function componentMap(components: PatentDiagramComponent[]): Map<string, PatentDiagramComponent> {
  return new Map(components.map(component => [component.id, component]))
}

function aliasMap(ids: string[], prefix = 'N'): Map<string, string> {
  const aliases = new Map<string, string>()
  const used = new Set<string>()
  Array.from(new Set(ids)).forEach(id => {
    const base = `${prefix}${crypto.createHash('sha256').update(id).digest('hex').slice(0, 12).toUpperCase()}`
    let alias = base
    let collision = 2
    while (used.has(alias)) alias = `${base}_${collision++}`
    used.add(alias)
    aliases.set(id, alias)
  })
  return aliases
}

function serializableAliasMap(aliases: Map<string, string>): Record<string, string> {
  return Object.fromEntries(Array.from(aliases, ([componentId, alias]) => [alias, componentId]))
}

function formattedReference(referenceLabel: string): string {
  const value = String(referenceLabel || '?').trim()
  if (/^\(.+\)$/.test(value) || /^[SD]\d+$/i.test(value)) return value
  return `(${value})`
}

function normalizedComponentLabel(label: string, referenceLabel: string, lineCount?: number, targetCharacters?: number): string {
  const lines = wrapPatentLabel(label)
  while (lineCount && lines.length < lineCount) lines.push(' ')
  const padded = targetCharacters
    ? lines.map(line => {
      const missing = Math.max(0, targetCharacters - line.length)
      const left = Math.floor(missing / 2)
      return `​${' '.repeat(left)}${line}${' '.repeat(missing - left)}​`
    })
    : lines
  return [...padded, formattedReference(referenceLabel)].map(escapePlantUmlLabel).join('\\n')
}

function normalizedShortLabel(value: string): string {
  return String(value || '').trim().split(/\s+/).filter(Boolean).slice(0, PATENT_DIAGRAM_COMPLEXITY.connectorLabelWords).join(' ')
}

function technicalLink(from: string, to: string, label: string, category: RelationshipCategory, vertical = true): string {
  const suffix = label ? ` : ${escapePlantUmlLabel(normalizedShortLabel(label))}` : ''
  const style = relationshipVisualStyle(category)
  if (style === 'ASSOCIATION') return `${from} -- ${to}${suffix}`
  if (style === 'SECONDARY') return `${from} -[norank,dashed]-> ${to}${suffix}`
  return `${from} -${vertical ? 'down' : 'right'}-> ${to}${suffix}`
}

function managedHeader(kind: PatentDiagram['kind']): string[] {
  const lines = ['@startuml', compilePatentDiagramStyle()]
  // Layout direction is a class/deployment directive; PlantUML rejects it
  // inside sequence diagrams (HTTP 400), so sequence headers must omit it.
  if (kind !== 'SEQUENCE') {
    lines.push(PATENT_DIAGRAM_STYLE.direction === 'top-to-bottom' ? 'top to bottom direction' : 'left to right direction')
  }
  lines.push('')
  return lines
}

function buildComponent(diagram: ComponentDiagram, components: PatentDiagramComponent[]) {
  const byId = componentMap(components)
  const ids = diagram.components.map(node => node.componentId)
  const aliases = aliasMap(ids, 'C')
  const nodeById = new Map(diagram.components.map(node => [node.componentId, node]))
  const lines = managedHeader(diagram.kind)
  lines.push(`rectangle "${escapePlantUmlLabel(diagram.systemBoundaryLabel)}" as SYSTEM <<SYSTEM>> {`)

  const firstAliasByGroup: string[] = []
  diagram.groups.forEach((group, groupIndex) => {
    lines.push(`  rectangle "${escapePlantUmlLabel(group.label)}" as BAND${groupIndex + 1} <<SUBSYSTEM>> {`)
    let previousRow: string[] = []
    for (const row of group.rows) {
      const rowIds = row.componentIds.filter(id => aliases.has(id))
      const labels = rowIds.map(id => nodeById.get(id)?.displayLabel || byId.get(id)?.name || id)
      const wrappedLabels = labels.map(label => wrapPatentLabel(label))
      const rowLineCount = Math.max(1, ...wrappedLabels.map(lines => lines.length))
      const rowCharacterWidth = Math.max(1, ...wrappedLabels.flat().map(line => line.length))
      lines.push('    together {')
      rowIds.forEach(id => {
        const source = byId.get(id)
        const label = nodeById.get(id)?.displayLabel || source?.name || id
        lines.push(`      ${PATENT_DIAGRAM_STYLE.componentStyle} "${normalizedComponentLabel(label, source?.referenceLabel || '?', rowLineCount, rowCharacterWidth)}" as ${aliases.get(id)}`)
      })
      lines.push('    }')
      for (let index = 1; index < rowIds.length; index++) {
        lines.push(`    ${aliases.get(rowIds[index - 1])} -right[hidden]-> ${aliases.get(rowIds[index])}`)
      }
      if (previousRow.length) {
        const anchors = Math.min(previousRow.length, rowIds.length)
        for (let index = 0; index < anchors; index++) {
          lines.push(`    ${aliases.get(previousRow[index])} -down[hidden]-> ${aliases.get(rowIds[index])}`)
        }
      }
      if (!firstAliasByGroup[groupIndex] && rowIds[0]) firstAliasByGroup[groupIndex] = aliases.get(rowIds[0]) || ''
      previousRow = rowIds
    }
    lines.push('  }')
  })
  lines.push('}')
  for (let index = 1; index < firstAliasByGroup.length; index++) {
    if (firstAliasByGroup[index - 1] && firstAliasByGroup[index]) {
      lines.push(`${firstAliasByGroup[index - 1]} -down[hidden]-> ${firstAliasByGroup[index]}`)
    }
  }
  lines.push('')
  diagram.relationships.forEach(link => {
    const from = aliases.get(link.fromId)
    const to = aliases.get(link.toId)
    if (from && to) lines.push(technicalLink(from, to, link.label, link.category, diagram.direction !== 'LR'))
  })
  lines.push('@enduml')

  return {
    code: lines.join('\n'),
    labelMap: serializableAliasMap(aliases),
    nodes: diagram.components.map(node => ({
      id: node.componentId,
      label: node.displayLabel || byId.get(node.componentId)?.name || node.componentId,
      referenceLabel: byId.get(node.componentId)?.referenceLabel || null,
      optional: node.optional,
      external: node.external,
    })),
    edges: diagram.relationships.map(link => ({ ...link })),
  }
}

function buildSequence(diagram: SequenceDiagram, components: PatentDiagramComponent[]) {
  const byId = componentMap(components)
  const aliases = aliasMap(diagram.participants.map(item => item.componentId), 'P')
  const lines = managedHeader(diagram.kind)
  diagram.participants.forEach(item => {
    const source = byId.get(item.componentId)
    const label = item.displayLabel || source?.name || item.componentId
    lines.push(`participant "${normalizedComponentLabel(label, source?.referenceLabel || '?')}" as ${aliases.get(item.componentId)}`)
  })
  lines.push('autonumber', '')
  let openAlternative: string | null = null
  for (const item of [...diagram.interactions].sort((a, b) => a.order - b.order)) {
    const from = aliases.get(item.fromId)
    const to = aliases.get(item.toId)
    if (!from || !to) continue
    const condition = item.alternative?.condition || null
    if (condition !== openAlternative) {
      if (openAlternative) lines.push('end')
      if (condition) lines.push(`alt ${escapePlantUmlLabel(condition)}`)
      openAlternative = condition
    } else if (condition && item.alternative?.branch === 'ELSE') {
      lines.push('else')
    }
    const arrow = relationshipVisualStyle(item.category) === 'SECONDARY' ? '-->' : '->'
    lines.push(`${from} ${arrow} ${to} : ${escapePlantUmlLabel(normalizedShortLabel(item.label))}`)
  }
  if (openAlternative) lines.push('end')
  lines.push('@enduml')
  return {
    code: lines.join('\n'),
    labelMap: serializableAliasMap(aliases),
    nodes: diagram.participants.map(item => ({
      id: item.componentId,
      label: item.displayLabel || byId.get(item.componentId)?.name || item.componentId,
      referenceLabel: byId.get(item.componentId)?.referenceLabel || null,
    })),
    edges: diagram.interactions.map(item => ({ ...item })),
  }
}

function assignProcessIdentifiers(diagram: ProcessDiagram, components: PatentDiagramComponent[]): ProcessDiagram {
  const byId = componentMap(components)
  let step = 100
  let decision = 100
  const used = new Set(diagram.nodes.map(node => node.identifier).filter(Boolean))
  const next = (prefix: 'S' | 'D') => {
    let value = prefix === 'S' ? step : decision
    while (used.has(`${prefix}${value}`)) value += 100
    if (prefix === 'S') step = value + 100
    else decision = value + 100
    used.add(`${prefix}${value}`)
    return `${prefix}${value}`
  }
  return {
    ...diagram,
    nodes: diagram.nodes.map(node => {
      if (node.identifier) return node
      const componentReference = node.componentId ? byId.get(node.componentId)?.referenceLabel : undefined
      return {
        ...node,
        identifier: node.kind === 'STEP' && componentReference && /^S\d+$/i.test(componentReference)
          ? componentReference.toUpperCase()
          : next(node.kind === 'DECISION' ? 'D' : 'S'),
      }
    }),
  }
}

function buildProcess(input: ProcessDiagram, components: PatentDiagramComponent[]) {
  const diagram = assignProcessIdentifiers(input, components)
  const aliases = aliasMap(diagram.nodes.map(node => node.key), 'M')
  const nodeByKey = new Map(diagram.nodes.map(node => [node.key, node]))
  const lines = managedHeader(diagram.kind)
  diagram.nodes.forEach(node => {
    const labelLines = wrapPatentLabel(node.label)
    const label = [node.identifier || '', ...labelLines].map(escapePlantUmlLabel).join('\\n')
    // PlantUML has no `diamond` element in deployment syntax (renders HTTP 400);
    // decisions are stereotyped rectangles styled by rectangle<<DECISION>>.
    const stereotype = node.kind === 'DECISION' ? ' <<DECISION>>' : ''
    lines.push(`rectangle "${label}" as ${aliases.get(node.key)}${stereotype}`)
  })
  lines.push('')
  diagram.transitions.forEach(link => {
    const from = aliases.get(link.fromId)
    const to = aliases.get(link.toId)
    if (!from || !to) return
    // Flowchart conventions differ from block diagrams. Every transition stays
    // in the layout ranking (`norank` floated decision branches out of the
    // vertical chain and produced sprawling left-to-right layouts), and only
    // decision outcomes carry labels — step-to-step labels duplicate the step
    // text and collide under ortho edge routing.
    const isDecisionBranch = nodeByKey.get(link.fromId)?.kind === 'DECISION'
    const label = isDecisionBranch && link.label ? ` : ${escapePlantUmlLabel(normalizedShortLabel(link.label))}` : ''
    const arrow = relationshipVisualStyle(link.category) === 'PRIMARY' ? '-down->' : '.down.>'
    lines.push(`${from} ${arrow} ${to}${label}`)
  })
  lines.push('@enduml')
  return {
    diagram,
    code: lines.join('\n'),
    labelMap: serializableAliasMap(aliases),
    nodes: diagram.nodes.map(node => ({ ...node })),
    edges: diagram.transitions.map(link => ({ ...link })),
  }
}

function buildConstituent(diagram: ConstituentDiagram, components: PatentDiagramComponent[]) {
  const byId = componentMap(components)
  const aliases = aliasMap(diagram.constituents.map(item => item.componentId), 'K')
  const lines = managedHeader(diagram.kind)
  lines.push(`rectangle "${escapePlantUmlLabel(diagram.boundaryLabel)}" as SYSTEM <<SYSTEM>> {`)
  const rows: typeof diagram.constituents[] = []
  for (let index = 0; index < diagram.constituents.length; index += PATENT_DIAGRAM_STYLE.maximumComponentsPerRow) {
    rows.push(diagram.constituents.slice(index, index + PATENT_DIAGRAM_STYLE.maximumComponentsPerRow))
  }
  let previousRow: typeof diagram.constituents = []
  rows.forEach(row => {
    const rowLineCount = Math.max(1, ...row.map(item => wrapPatentLabel(item.displayLabel || byId.get(item.componentId)?.name || item.componentId).length))
    lines.push('  together {')
    row.forEach(item => {
      const source = byId.get(item.componentId)
      const name = item.displayLabel || source?.name || item.componentId
      const extra = [item.technicalRole, item.quantityOrRange].filter(Boolean).map(value => escapePlantUmlLabel(String(value)))
      const label = [normalizedComponentLabel(name, source?.referenceLabel || '?', rowLineCount), ...extra].join('\\n')
      lines.push(`    ${PATENT_DIAGRAM_STYLE.componentStyle} "${label}" as ${aliases.get(item.componentId)}`)
    })
    lines.push('  }')
    for (let index = 1; index < row.length; index++) {
      lines.push(`  ${aliases.get(row[index - 1].componentId)} -right[hidden]-> ${aliases.get(row[index].componentId)}`)
    }
    const anchors = Math.min(previousRow.length, row.length)
    for (let index = 0; index < anchors; index++) {
      lines.push(`  ${aliases.get(previousRow[index].componentId)} -down[hidden]-> ${aliases.get(row[index].componentId)}`)
    }
    previousRow = row
  })
  lines.push('}')
  diagram.relationships.forEach(link => {
    const from = aliases.get(link.fromId)
    const to = aliases.get(link.toId)
    if (from && to) lines.push(technicalLink(from, to, link.label, link.category, true))
  })
  lines.push('@enduml')
  return {
    code: lines.join('\n'),
    labelMap: serializableAliasMap(aliases),
    nodes: diagram.constituents.map(item => ({
      ...item,
      id: item.componentId,
      referenceLabel: byId.get(item.componentId)?.referenceLabel || null,
    })),
    edges: diagram.relationships.map(link => ({ ...link })),
  }
}

export function buildPatentDiagram(diagramInput: PatentDiagram, components: PatentDiagramComponent[], supportedEvidenceIds?: Set<string>): BuiltPatentDiagram {
  // Repair mechanically fixable defects first so the persisted semantic model
  // matches the drawing and validation only reports genuine blockers.
  const normalized = normalizePatentDiagram(diagramInput, components)
  const source = normalized.diagram
  const built = source.kind === 'COMPONENT'
    ? buildComponent(source, components)
    : source.kind === 'SEQUENCE'
      ? buildSequence(source, components)
      : source.kind === 'PROCESS'
        ? buildProcess(source, components)
        : buildConstituent(source, components)
  const diagram = 'diagram' in built ? built.diagram : source
  const validation = validatePatentDiagram(diagram, components, supportedEvidenceIds)
  const sourceIssues = validatePatentPlantUmlSource(built.code)
  validation.issues.push(...sourceIssues)
  validation.corrections = [...validation.corrections, ...normalized.corrections]
  validation.filingReady = validation.filingReady && !sourceIssues.some(issue => issue.severity === 'error')
  return { diagram, plantumlCode: built.code, labelMap: built.labelMap, nodes: built.nodes, edges: built.edges, validation }
}
