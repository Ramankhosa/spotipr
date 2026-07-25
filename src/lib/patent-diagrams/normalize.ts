import { PATENT_DIAGRAM_STYLE } from './style'
import { PATENT_DIAGRAM_COMPLEXITY } from './policy'
import type { PatentDiagram, PatentDiagramComponent } from './types'

/**
 * Deterministic repair pass applied to LLM-authored semantic models before
 * validation.
 *
 * Most structural defects an LLM produces are mechanically fixable, and several
 * were previously reported as filing errors even though the builder already
 * neutralised them at render time — long labels, for instance, are truncated by
 * wrapPatentLabel/normalizedShortLabel regardless, so failing the figure meant
 * rejecting a diagram that would have rendered correctly. Repairing here keeps
 * the stored semantic model identical to what is drawn and reserves genuine
 * errors for defects no amount of normalization can resolve (a hallucinated
 * component ID has no reference numeral, so it cannot be drawn at all).
 *
 * Every repair is recorded so the UI can show what changed. The function is
 * total and idempotent: it never throws, and re-running it is a no-op.
 */
export interface NormalizedPatentDiagram {
  diagram: PatentDiagram
  corrections: string[]
}

function truncateWords(value: string | undefined, maximumWords: number): { value: string; changed: boolean } {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean)
  if (words.length <= maximumWords) return { value: String(value || '').trim(), changed: false }
  return { value: words.slice(0, maximumWords).join(' '), changed: true }
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}

export function normalizePatentDiagram(
  input: PatentDiagram,
  components: PatentDiagramComponent[],
  supportedEvidenceIds?: Set<string>,
): NormalizedPatentDiagram {
  const corrections: string[] = []
  const known = new Set(components.map(component => component.id))
  const diagram = JSON.parse(JSON.stringify(input)) as PatentDiagram

  const trimNodeLabel = (label: string | undefined, describe: string): string | undefined => {
    if (!label) return label
    const { value, changed } = truncateWords(label, PATENT_DIAGRAM_STYLE.maximumLabelWords)
    if (changed) corrections.push(`Shortened ${describe} label to ${PATENT_DIAGRAM_STYLE.maximumLabelWords} words`)
    return value
  }
  const trimConnectorLabel = (label: string | undefined, describe: string): string => {
    const { value, changed } = truncateWords(label, PATENT_DIAGRAM_COMPLEXITY.connectorLabelWords)
    if (changed) corrections.push(`Shortened ${describe} label to ${PATENT_DIAGRAM_COMPLEXITY.connectorLabelWords} words`)
    return value
  }

  if (diagram.kind === 'COMPONENT') {
    const seen = new Set<string>()
    const kept = diagram.components.filter(node => {
      if (!known.has(node.componentId)) {
        corrections.push(`Removed unknown component ${node.componentId}`)
        return false
      }
      if (seen.has(node.componentId)) {
        corrections.push(`Removed duplicate component ${node.componentId}`)
        return false
      }
      seen.add(node.componentId)
      return true
    })
    // Never normalize a figure out of existence: if repairs would empty it, keep
    // the original so validation reports the real defect instead of a blank figure.
    if (kept.length) diagram.components = kept
    const visible = new Set(diagram.components.map(node => node.componentId))

    // Claim-critical coverage is mandatory, and placing the component is
    // mechanical, so it is inserted rather than failing the figure.
    for (const id of diagram.claimCriticalComponentIds) {
      if (visible.has(id) || !known.has(id)) continue
      diagram.components.push({ componentId: id, optional: false, external: false })
      visible.add(id)
      corrections.push(`Added missing claim-critical component ${id}`)
    }

    diagram.components = diagram.components.map(node => ({
      ...node,
      displayLabel: trimNodeLabel(node.displayLabel, 'component'),
    }))

    const placed = new Set<string>()
    diagram.groups = diagram.groups.flatMap(group => {
      const rows = group.rows
        .map(row => ({
          componentIds: row.componentIds.filter(id => {
            if (!visible.has(id) || placed.has(id)) return false
            placed.add(id)
            return true
          }),
        }))
        .filter(row => row.componentIds.length)
      return rows.length ? [{ ...group, rows }] : []
    })

    const unplaced = diagram.components.map(node => node.componentId).filter(id => !placed.has(id))
    if (unplaced.length) {
      if (!diagram.groups.length) {
        diagram.groups = [{ id: 'subsystem-1', label: 'System Elements', rows: [] }]
      }
      const target = diagram.groups[diagram.groups.length - 1]
      target.rows = [...target.rows, ...chunk(unplaced, PATENT_DIAGRAM_STYLE.maximumComponentsPerRow).map(componentIds => ({ componentIds }))]
      corrections.push(`Placed ${unplaced.length} ungrouped component(s) into "${target.label}"`)
    }

    // Rows wider than the layout contract are re-flowed rather than rejected.
    diagram.groups = diagram.groups.map(group => {
      const rows = group.rows.flatMap(row =>
        row.componentIds.length > PATENT_DIAGRAM_STYLE.maximumComponentsPerRow
          ? chunk(row.componentIds, PATENT_DIAGRAM_STYLE.maximumComponentsPerRow).map(componentIds => ({ componentIds }))
          : [row])
      if (rows.length !== group.rows.length) corrections.push(`Re-flowed "${group.label}" to ${PATENT_DIAGRAM_STYLE.maximumComponentsPerRow} components per row`)
      return { ...group, rows }
    })

    const signatures = new Set<string>()
    diagram.relationships = diagram.relationships.flatMap(link => {
      if (!visible.has(link.fromId) || !visible.has(link.toId)) {
        corrections.push(`Removed connector referencing an element not shown in this figure`)
        return []
      }
      const label = trimConnectorLabel(link.label, 'connector')
      const signature = `${link.fromId}\u0000${link.toId}\u0000${label.toLowerCase()}\u0000${link.category}`
      if (signatures.has(signature)) {
        corrections.push(`Removed duplicate connector ${link.fromId} to ${link.toId}`)
        return []
      }
      signatures.add(signature)
      return [{ ...link, label }]
    })
  }

  if (diagram.kind === 'SEQUENCE') {
    const seen = new Set<string>()
    const kept = diagram.participants.filter(item => {
      if (!known.has(item.componentId)) {
        corrections.push(`Removed unknown participant ${item.componentId}`)
        return false
      }
      if (seen.has(item.componentId)) {
        corrections.push(`Removed duplicate participant ${item.componentId}`)
        return false
      }
      seen.add(item.componentId)
      return true
    })
    // The schema requires at least two participants; keep the original rather
    // than emit a structurally invalid diagram.
    if (kept.length >= 2) diagram.participants = kept
    const visible = new Set(diagram.participants.map(item => item.componentId))
    diagram.participants = diagram.participants.map(item => ({
      ...item,
      displayLabel: trimNodeLabel(item.displayLabel, 'participant'),
    }))
    const interactions = diagram.interactions.flatMap(item => {
      if (!visible.has(item.fromId) || !visible.has(item.toId)) {
        corrections.push('Removed interaction referencing a participant not shown in this figure')
        return []
      }
      return [{ ...item, label: trimConnectorLabel(item.label, 'interaction') || item.label }]
    })
    if (interactions.length) {
      // Renumber so ordering stays contiguous after any removal.
      diagram.interactions = interactions
        .sort((a, b) => a.order - b.order)
        .map((item, index) => ({ ...item, order: index + 1 }))
    }
  }

  if (diagram.kind === 'PROCESS') {
    const seenKeys = new Set<string>()
    const kept = diagram.nodes.filter(node => {
      if (seenKeys.has(node.key)) {
        corrections.push(`Removed duplicate process step ${node.key}`)
        return false
      }
      seenKeys.add(node.key)
      return true
    })
    if (kept.length) diagram.nodes = kept

    // Identifiers are assigned deterministically downstream, so an invalid or
    // duplicated one is cleared instead of failing the figure.
    const usedIdentifiers = new Set<string>()
    diagram.nodes = diagram.nodes.map(node => {
      const pattern = node.kind === 'DECISION' ? /^D\d+$/i : /^S\d+$/i
      let identifier = node.identifier
      if (identifier && !pattern.test(identifier)) {
        corrections.push(`Reassigned invalid step identifier ${identifier}`)
        identifier = undefined
      }
      if (identifier && usedIdentifiers.has(identifier.toUpperCase())) {
        corrections.push(`Reassigned duplicate step identifier ${identifier}`)
        identifier = undefined
      }
      if (identifier) usedIdentifiers.add(identifier.toUpperCase())
      // Stripping an invented component reference must be recorded: it leaves
      // the step unanchored, which validation flags as UNGROUNDED_STEP and the
      // generation path treats as a blocker. Silently dropping the reference
      // used to let hallucinated steps ship looking like legitimate ones.
      if (node.componentId && !known.has(node.componentId)) {
        corrections.push(`Removed unknown component reference ${node.componentId} from step ${node.key}`)
      }
      const unknownRelated = (node.relatedComponentIds || []).filter(id => !known.has(id))
      unknownRelated.forEach(id => corrections.push(`Removed unknown component reference ${id} from step ${node.key}`))
      // Same rule for cited evidence: stripping an invented citation silently
      // would launder an ungrounded step into a clean-looking one. Recording
      // the strip leaves the node uncited, which validation then reports and
      // the generation path blocks on.
      const citedEvidence = node.evidenceIds || []
      const keptEvidence = supportedEvidenceIds?.size ? citedEvidence.filter(id => supportedEvidenceIds.has(id)) : citedEvidence
      citedEvidence.filter(id => !keptEvidence.includes(id))
        .forEach(id => corrections.push(`Removed unrecognized disclosure evidence ${id} from step ${node.key}`))
      return {
        ...node,
        identifier,
        label: trimNodeLabel(node.label, 'step') || node.label,
        componentId: node.componentId && known.has(node.componentId) ? node.componentId : undefined,
        relatedComponentIds: (node.relatedComponentIds || []).filter(id => known.has(id)),
        evidenceIds: keptEvidence,
      }
    })

    const keys = new Set(diagram.nodes.map(node => node.key))
    const transitions = diagram.transitions.flatMap(link => {
      if (!keys.has(link.fromId) || !keys.has(link.toId)) {
        corrections.push('Removed transition referencing a step not shown in this figure')
        return []
      }
      return [{ ...link, label: trimConnectorLabel(link.label, 'transition') }]
    })
    if (transitions.length) diagram.transitions = transitions
  }

  if (diagram.kind === 'CONSTITUENT') {
    const seen = new Set<string>()
    const kept = diagram.constituents.filter(item => {
      if (!known.has(item.componentId)) {
        corrections.push(`Removed unknown constituent ${item.componentId}`)
        return false
      }
      if (seen.has(item.componentId)) {
        corrections.push(`Removed duplicate constituent ${item.componentId}`)
        return false
      }
      seen.add(item.componentId)
      return true
    })
    if (kept.length) diagram.constituents = kept
    const visible = new Set(diagram.constituents.map(item => item.componentId))
    diagram.constituents = diagram.constituents.map(item => ({
      ...item,
      displayLabel: trimNodeLabel(item.displayLabel, 'constituent'),
    }))
    diagram.relationships = diagram.relationships.flatMap(link => {
      if (!visible.has(link.fromId) || !visible.has(link.toId)) {
        corrections.push('Removed association referencing a constituent not shown in this figure')
        return []
      }
      return [{ ...link, label: trimConnectorLabel(link.label, 'association') }]
    })
  }

  diagram.evidenceIds = diagram.evidenceIds.filter(id => String(id || '').trim())

  return { diagram, corrections: Array.from(new Set(corrections)) }
}
