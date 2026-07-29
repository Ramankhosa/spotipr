import { patentDiagramSchema, type PatentDiagram } from './types'

export interface DiagramDownstreamFacts {
  sourceMode: string
  semanticModel?: PatentDiagram
  nodes: unknown[]
  edges: unknown[]
}

export function diagramFactsForDownstream(plan: any, source: any): DiagramDownstreamFacts {
  if (source?.sourceMode === 'MANAGED' && plan?.semanticModel) {
    const parsed = patentDiagramSchema.safeParse(plan.semanticModel)
    if (parsed.success) {
      return {
        sourceMode: 'MANAGED',
        semanticModel: parsed.data,
        nodes: Array.isArray(plan.nodes) ? plan.nodes : [],
        edges: Array.isArray(plan.edges) ? plan.edges.filter((edge: any) => edge?.layoutOnly !== true) : [],
      }
    }
  }
  return {
    sourceMode: source?.sourceMode || 'IMPORTED_RAW',
    nodes: Array.isArray(plan?.nodes) ? plan.nodes : [],
    edges: Array.isArray(plan?.edges) ? plan.edges.filter((edge: any) => edge?.layoutOnly !== true) : [],
  }
}

export function summarizePatentDiagram(diagram: PatentDiagram): string {
  if (diagram.kind === 'COMPONENT') {
    return `${diagram.purpose} Subsystems: ${diagram.groups.map(group => group.label).join('; ')}. Relationships: ${diagram.relationships.map(link => `${link.fromId} ${link.label || link.category} ${link.toId}`).join('; ')}.`
  }
  if (diagram.kind === 'SEQUENCE') {
    return `${diagram.purpose} Ordered interactions: ${[...diagram.interactions].sort((a, b) => a.order - b.order).map(item => `${item.fromId} ${item.label} ${item.toId}`).join('; ')}.`
  }
  if (diagram.kind === 'PROCESS') {
    // Only a real reference sign is passed downstream. This used to fall back to
    // the node's internal key ("stable-step-key"), which put a token that means
    // nothing to a reader — and matches no component — into the drafted text.
    return `${diagram.purpose} Ordered process: ${diagram.nodes.map(node =>
      node.identifier ? `${node.identifier}: ${node.label}` : node.label).join('; ')}.`
  }
  return `${diagram.purpose} Constituents: ${diagram.constituents.map(item => `${item.componentId}${item.technicalRole ? ` (${item.technicalRole})` : ''}`).join('; ')}.`
}

export function summarizeDiagramPlan(plan: any, source?: any): string {
  const facts = diagramFactsForDownstream(plan, source)
  if (facts.semanticModel) return summarizePatentDiagram(facts.semanticModel)
  const nodes = facts.nodes.map((node: any) => node?.label || node?.name || node?.id).filter(Boolean)
  const edges = facts.edges.map((edge: any) => `${edge?.from || edge?.fromId || '?'} ${edge?.label || 'relates to'} ${edge?.to || edge?.toId || '?'}`)
  return [
    String(plan?.description || '').trim(),
    nodes.length ? `Elements: ${nodes.join('; ')}.` : '',
    edges.length ? `Relationships: ${edges.join('; ')}.` : '',
  ].filter(Boolean).join(' ')
}
