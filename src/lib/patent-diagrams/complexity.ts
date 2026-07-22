import { analyzeDiagramComplexity } from './validation'
import type { PatentDiagram } from './types'

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter(item => {
    const value = key(item)
    if (seen.has(value)) return false
    seen.add(value)
    return true
  })
}

export function decomposePatentDiagram(diagram: PatentDiagram, force = false): PatentDiagram[] {
  if (!force && !analyzeDiagramComplexity(diagram).requiresSplit) return [diagram]

  if (diagram.kind === 'COMPONENT') {
    const targetComponents = force ? 8 : 16
    const groupSegments = diagram.groups.flatMap(group => {
      const segments: typeof diagram.groups = []
      let rows: typeof group.rows = []
      let count = 0
      group.rows.forEach(row => {
        if (rows.length && count + row.componentIds.length > targetComponents) {
          segments.push({ ...group, id: `${group.id}-part-${segments.length + 1}`, rows })
          rows = []
          count = 0
        }
        rows.push(row)
        count += row.componentIds.length
      })
      if (rows.length) segments.push({ ...group, id: segments.length ? `${group.id}-part-${segments.length + 1}` : group.id, rows })
      return segments
    })
    const groupChunks: typeof diagram.groups[] = []
    let pending: typeof diagram.groups = []
    let pendingCount = 0
    groupSegments.forEach(group => {
      const count = group.rows.reduce((sum, row) => sum + row.componentIds.length, 0)
      if (pending.length && (force || pending.length >= 2 || pendingCount + count > targetComponents)) {
        groupChunks.push(pending)
        pending = []
        pendingCount = 0
      }
      pending.push(group)
      pendingCount += count
    })
    if (pending.length) groupChunks.push(pending)
    const detailIndexByComponent = new Map<string, number>()
    groupChunks.forEach((groups, index) => groups.forEach(group => group.rows.forEach(row => row.componentIds.forEach(id => detailIndexByComponent.set(id, index)))))
    const detailFigures = groupChunks.map((groups, index) => {
      const ids = new Set(groups.flatMap(group => group.rows.flatMap(row => row.componentIds)))
      return {
        ...diagram,
        key: `${diagram.key}-detail-${index + 1}`,
        title: `${diagram.title} — Detail ${index + 1}`,
        detailLevel: 'DETAIL' as const,
        groups,
        components: diagram.components.filter(node => ids.has(node.componentId)),
        relationships: diagram.relationships.filter(link => detailIndexByComponent.get(link.fromId) === index && detailIndexByComponent.get(link.toId) === index),
        claimCriticalComponentIds: diagram.claimCriticalComponentIds.filter(id => ids.has(id)),
      }
    })

    const crossRelationships = diagram.relationships.filter(link => detailIndexByComponent.get(link.fromId) !== detailIndexByComponent.get(link.toId))
    const relationshipChunks: typeof diagram.relationships[] = []
    let relationshipChunk: typeof diagram.relationships = []
    let endpointIds = new Set<string>()
    let groupIds = new Set<string>()
    const originalGroupByComponent = new Map<string, string>()
    diagram.groups.forEach(group => group.rows.forEach(row => row.componentIds.forEach(id => originalGroupByComponent.set(id, group.id))))
    crossRelationships.forEach(link => {
      const nextEndpoints = new Set([...Array.from(endpointIds), link.fromId, link.toId])
      const nextGroups = new Set([...Array.from(groupIds), originalGroupByComponent.get(link.fromId), originalGroupByComponent.get(link.toId)].filter(Boolean) as string[])
      if (relationshipChunk.length && (nextEndpoints.size > 16 || nextGroups.size > 4 || relationshipChunk.length >= 25)) {
        relationshipChunks.push(relationshipChunk)
        relationshipChunk = []
        endpointIds = new Set()
        groupIds = new Set()
      }
      relationshipChunk.push(link)
      endpointIds.add(link.fromId)
      endpointIds.add(link.toId)
      const fromGroup = originalGroupByComponent.get(link.fromId)
      const toGroup = originalGroupByComponent.get(link.toId)
      if (fromGroup) groupIds.add(fromGroup)
      if (toGroup) groupIds.add(toGroup)
    })
    if (relationshipChunk.length) relationshipChunks.push(relationshipChunk)
    const interfaceFigures = relationshipChunks.map((relationships, index) => {
      const ids = new Set(relationships.flatMap(link => [link.fromId, link.toId]))
      const groups = diagram.groups.flatMap(group => {
        const rows = group.rows.flatMap(row => {
          const componentIds = row.componentIds.filter(id => ids.has(id))
          return componentIds.length ? [{ componentIds }] : []
        })
        return rows.length ? [{ ...group, rows }] : []
      })
      return {
        ...diagram,
        key: `${diagram.key}-interface-${index + 1}`,
        title: `${diagram.title} — Interface Detail ${index + 1}`,
        detailLevel: 'DETAIL' as const,
        groups,
        components: diagram.components.filter(node => ids.has(node.componentId)),
        relationships,
        claimCriticalComponentIds: diagram.claimCriticalComponentIds.filter(id => ids.has(id)),
      }
    })

    const representativeByGroup = new Map<string, string>()
    diagram.groups.forEach(group => {
      const representative = group.rows.flatMap(row => row.componentIds)[0]
      if (representative) representativeByGroup.set(group.id, representative)
    })
    const groupByComponent = new Map<string, string>()
    diagram.groups.forEach(group => group.rows.forEach(row => row.componentIds.forEach(id => groupByComponent.set(id, group.id))))
    const overviewIds = Array.from(representativeByGroup.values())
    const overviewIdSet = new Set(overviewIds)
    const overviewRelationships = uniqueBy(diagram.relationships.flatMap(link => {
      const fromGroup = groupByComponent.get(link.fromId)
      const toGroup = groupByComponent.get(link.toId)
      const fromId = fromGroup ? representativeByGroup.get(fromGroup) : undefined
      const toId = toGroup ? representativeByGroup.get(toGroup) : undefined
      if (!fromId || !toId || fromId === toId) return []
      return [{ ...link, fromId, toId }]
    }), link => `${link.fromId}\u0000${link.toId}\u0000${link.category}`)
    const overview = {
      ...diagram,
      key: `${diagram.key}-overview`,
      title: `${diagram.title} — Overview`,
      detailLevel: 'OVERVIEW' as const,
      groups: diagram.groups.map(group => {
        const representative = representativeByGroup.get(group.id)
        return { ...group, rows: representative ? [{ componentIds: [representative] }] : group.rows.slice(0, 1) }
      }),
      components: diagram.components
        .filter(node => overviewIdSet.has(node.componentId))
        .map(node => {
          const group = diagram.groups.find(candidate => representativeByGroup.get(candidate.id) === node.componentId)
          return { ...node, displayLabel: group?.label || node.displayLabel }
        }),
      relationships: overviewRelationships,
      claimCriticalComponentIds: [],
    }
    const decomposed = [...detailFigures, ...interfaceFigures]
    return diagram.detailLevel !== 'OVERVIEW' && decomposed.length > 1 ? [overview, ...decomposed] : decomposed
  }

  if (diagram.kind === 'SEQUENCE') {
    const chunks: typeof diagram.interactions[] = []
    let chunk: typeof diagram.interactions = []
    let participantIds = new Set<string>()
    let alternativeConditions = new Set<string>()
    for (const interaction of diagram.interactions) {
      const nextParticipants = new Set([...Array.from(participantIds), interaction.fromId, interaction.toId])
      const condition = interaction.alternative?.condition
      const nextConditions = new Set([...Array.from(alternativeConditions), ...(condition ? [condition] : [])])
      if (chunk.length && (chunk.length >= (force ? 8 : 12) || nextParticipants.size > 7 || nextConditions.size > 1)) {
        chunks.push(chunk)
        chunk = []
        participantIds = new Set()
        alternativeConditions = new Set()
      }
      chunk.push(interaction)
      participantIds.add(interaction.fromId)
      participantIds.add(interaction.toId)
      if (condition) alternativeConditions.add(condition)
    }
    if (chunk.length) chunks.push(chunk)
    return chunks.map((interactions, index) => {
      const ids = new Set(interactions.flatMap(item => [item.fromId, item.toId]))
      return {
        ...diagram,
        key: `${diagram.key}-phase-${index + 1}`,
        title: `${diagram.title} — Phase ${index + 1}`,
        participants: diagram.participants.filter(item => ids.has(item.componentId)),
        interactions: interactions.map((item, order) => ({ ...item, order: order + 1 })),
        claimCriticalComponentIds: diagram.claimCriticalComponentIds.filter(id => ids.has(id)),
      }
    })
  }

  if (diagram.kind === 'PROCESS') {
    const chunks: typeof diagram.nodes[] = []
    const chunkSize = force ? 7 : 10
    for (let index = 0; index < diagram.nodes.length; index += chunkSize) chunks.push(diagram.nodes.slice(index, index + chunkSize))
    const indexByNode = new Map<string, number>()
    chunks.forEach((nodes, index) => nodes.forEach(node => indexByNode.set(node.key, index)))
    const phaseFigures = chunks.map((nodes, index) => {
      const keys = new Set(nodes.map(node => node.key))
      const componentIds = new Set(nodes.flatMap(node => [node.componentId, ...node.relatedComponentIds].filter(Boolean) as string[]))
      return {
        ...diagram,
        key: `${diagram.key}-phase-${index + 1}`,
        title: `${diagram.title} — Phase ${index + 1}`,
        nodes,
        transitions: diagram.transitions.filter(item => indexByNode.get(item.fromId) === index && indexByNode.get(item.toId) === index),
        claimCriticalComponentIds: diagram.claimCriticalComponentIds.filter(id => componentIds.has(id)),
      }
    })
    const bridgeTransitions = diagram.transitions.filter(item => indexByNode.get(item.fromId) !== indexByNode.get(item.toId))
    const bridgeChunks: typeof diagram.transitions[] = []
    let bridgeChunk: typeof diagram.transitions = []
    let bridgeKeys = new Set<string>()
    bridgeTransitions.forEach(transition => {
      const nextKeys = new Set([...Array.from(bridgeKeys), transition.fromId, transition.toId])
      if (bridgeChunk.length && nextKeys.size > 10) {
        bridgeChunks.push(bridgeChunk)
        bridgeChunk = []
        bridgeKeys = new Set()
      }
      bridgeChunk.push(transition)
      bridgeKeys.add(transition.fromId)
      bridgeKeys.add(transition.toId)
    })
    if (bridgeChunk.length) bridgeChunks.push(bridgeChunk)
    const bridgeFigures = bridgeChunks.map((transitions, index) => {
      const keys = new Set(transitions.flatMap(item => [item.fromId, item.toId]))
      const nodes = diagram.nodes.filter(node => keys.has(node.key))
      const componentIds = new Set(nodes.flatMap(node => [node.componentId, ...node.relatedComponentIds].filter(Boolean) as string[]))
      return {
        ...diagram,
        key: `${diagram.key}-transition-${index + 1}`,
        title: `${diagram.title} — Transition Detail ${index + 1}`,
        nodes,
        transitions,
        claimCriticalComponentIds: diagram.claimCriticalComponentIds.filter(id => componentIds.has(id)),
      }
    })
    return [...phaseFigures, ...bridgeFigures]
  }

  const chunks: typeof diagram.constituents[] = []
  const chunkSize = force ? 8 : 12
  for (let index = 0; index < diagram.constituents.length; index += chunkSize) chunks.push(diagram.constituents.slice(index, index + chunkSize))
  const indexByConstituent = new Map<string, number>()
  chunks.forEach((constituents, index) => constituents.forEach(item => indexByConstituent.set(item.componentId, index)))
  const groupFigures = chunks.map((constituents, index) => {
    const ids = new Set(constituents.map(item => item.componentId))
    return {
      ...diagram,
      key: `${diagram.key}-group-${index + 1}`,
      title: `${diagram.title} — Group ${index + 1}`,
      constituents,
      relationships: diagram.relationships.filter(link => indexByConstituent.get(link.fromId) === index && indexByConstituent.get(link.toId) === index),
      claimCriticalComponentIds: diagram.claimCriticalComponentIds.filter(id => ids.has(id)),
    }
  })
  const bridgeRelationships = diagram.relationships.filter(link => indexByConstituent.get(link.fromId) !== indexByConstituent.get(link.toId))
  const bridgeChunks: typeof diagram.relationships[] = []
  let bridgeChunk: typeof diagram.relationships = []
  let bridgeIds = new Set<string>()
  bridgeRelationships.forEach(relationship => {
    const nextIds = new Set([...Array.from(bridgeIds), relationship.fromId, relationship.toId])
    if (bridgeChunk.length && nextIds.size > 12) {
      bridgeChunks.push(bridgeChunk)
      bridgeChunk = []
      bridgeIds = new Set()
    }
    bridgeChunk.push(relationship)
    bridgeIds.add(relationship.fromId)
    bridgeIds.add(relationship.toId)
  })
  if (bridgeChunk.length) bridgeChunks.push(bridgeChunk)
  const bridgeFigures = bridgeChunks.map((relationships, index) => {
    const ids = new Set(relationships.flatMap(link => [link.fromId, link.toId]))
    return {
      ...diagram,
      key: `${diagram.key}-association-${index + 1}`,
      title: `${diagram.title} — Association Detail ${index + 1}`,
      constituents: diagram.constituents.filter(item => ids.has(item.componentId)),
      relationships,
      claimCriticalComponentIds: diagram.claimCriticalComponentIds.filter(id => ids.has(id)),
    }
  })
  return [...groupFigures, ...bridgeFigures]
}
