/**
 * Mind-map layout for the ideation canvas.
 *
 * Dimension cards have wildly different heights — a "what if" move with a long
 * IMPACT / LEADS TO / TENSION body is several times taller than a bare family
 * card — so any layout built on a fixed row height (the old NODE_HEIGHT = 180 /
 * server-side 430) overlaps as soon as a dimension expands.
 *
 * This lays out the tree from the *actual* rendered size of each node
 * (`node.measured` from React Flow v12), falling back to a content-based
 * estimate for nodes that have not been measured yet. Siblings are stacked
 * bottom-up by real subtree extent, so cards can never collide regardless of
 * how much text the model returns.
 */

import type { Node as ReactFlowNode } from '@xyflow/react'

export const LAYOUT = {
  /** Left margin of the root column. */
  START_X: 80,
  /** Top margin of the first root subtree. */
  START_Y: 80,
  /** Horizontal gap between the widest card of a column and the next column. */
  COLUMN_GAP: 140,
  /** Vertical gap between two sibling subtrees. */
  SIBLING_GAP: 48,
  /** Vertical gap between two independent root subtrees. */
  ROOT_GAP: 120,
  /** Position deltas below this are treated as "no change". */
  EPSILON: 0.5,
} as const

/** Fallback card widths per node type, used only until React Flow measures. */
const FALLBACK_WIDTH: Record<string, number> = {
  seed: 288,
  dimension: 380,
  operator: 340,
  idea: 288,
}

/** Floor heights per node type, used only until React Flow measures. */
const FALLBACK_HEIGHT: Record<string, number> = {
  seed: 90,
  dimension: 120,
  operator: 80,
  idea: 96,
}

type NodeData = Record<string, unknown>

function getData(node: ReactFlowNode): NodeData {
  return (node.data || {}) as NodeData
}

export function getParentId(node: ReactFlowNode): string | undefined {
  const data = getData(node)
  return (data.parentId as string) || (data.parentNodeId as string) || undefined
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Rough height of a text block rendered at `charsPerLine` characters per line.
 * Only used before a node has been measured — one frame later the real height
 * takes over.
 */
function textBlockHeight(text: string, charsPerLine: number, lineHeight: number): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / charsPerLine)) * lineHeight
}

/** Content-based height guess for an unmeasured node. */
function estimateHeight(node: ReactFlowNode): number {
  const type = node.type || 'dimension'
  const floor = FALLBACK_HEIGHT[type] ?? 120
  if (type !== 'dimension') return floor

  const data = getData(node)
  const payload = (data.payloadJson || data.payload || {}) as NodeData
  const isMove = payload.isSuggestedMove === true

  if (isMove) {
    // px-3/py-2.5 card at 380px: ~45 chars per title line, ~60 per body line.
    let h = 20 // vertical padding
    h += textBlockHeight(str(payload.move) || str(data.title), 45, 18)
    h += 8 + 13 + textBlockHeight(str(payload.impact), 60, 15)
    h += 6 + 13 + textBlockHeight(str(payload.leadsTo), 60, 15)
    if (str(payload.tension)) h += 6 + 13 + textBlockHeight(str(payload.tension), 60, 15)
    h += 26 // tag row
    h += 40 // "Add your direction" affordance
    return Math.max(floor, h)
  }

  // Family / legacy option card at 320px.
  let h = 16
  h += textBlockHeight(str(data.title), 38, 17)
  h += textBlockHeight(str(data.description), 46, 15)
  const tags = Array.isArray(data.tags) ? (data.tags as unknown[]) : []
  if (tags.length > 0 || str(data.family)) h += 22
  return Math.max(floor, h)
}

/** Measured height when React Flow has sized the node, estimate otherwise. */
export function getNodeHeight(node: ReactFlowNode): number {
  const measured = node.measured?.height ?? (node as { height?: number }).height
  if (typeof measured === 'number' && measured > 0) return measured
  return estimateHeight(node)
}

function getNodeWidth(node: ReactFlowNode): number {
  const measured = node.measured?.width ?? (node as { width?: number }).width
  if (typeof measured === 'number' && measured > 0) return measured
  return FALLBACK_WIDTH[node.type || 'dimension'] ?? 380
}

/**
 * True when any ancestor of `nodeId` is collapsed — such nodes are not rendered
 * and must not reserve vertical space.
 */
export function hasCollapsedAncestor(
  nodeId: string,
  nodeById: Map<string, ReactFlowNode>,
  collapsed: ReadonlySet<string>,
  visited = new Set<string>()
): boolean {
  if (visited.has(nodeId)) return false
  visited.add(nodeId)

  const node = nodeById.get(nodeId)
  if (!node) return false

  const parentId = getParentId(node)
  if (!parentId) return false
  if (collapsed.has(parentId)) return true
  return hasCollapsedAncestor(parentId, nodeById, collapsed, visited)
}

/**
 * Re-flow the mind map so no two visible cards overlap.
 *
 * Returns the same array instance when nothing moved, so callers can pass the
 * result straight to `setNodes` without causing a render loop.
 */
export function layoutMindMap(
  nodes: ReactFlowNode[],
  collapsedNodes: ReadonlySet<string>
): ReactFlowNode[] {
  if (nodes.length === 0) return nodes

  const nodeById = new Map<string, ReactFlowNode>()
  nodes.forEach(node => nodeById.set(node.id, node))

  // Visible = no collapsed ancestor. Collapsed nodes themselves stay visible.
  const visible = nodes.filter(node => !hasCollapsedAncestor(node.id, nodeById, collapsedNodes))
  if (visible.length === 0) return nodes

  const visibleIds = new Set(visible.map(n => n.id))

  // Children keep their current top-to-bottom order so a manual drag (or the
  // order the model returned them in) survives the re-flow.
  const childrenOf = new Map<string, ReactFlowNode[]>()
  const roots: ReactFlowNode[] = []
  visible.forEach(node => {
    const parentId = getParentId(node)
    if (parentId && visibleIds.has(parentId) && parentId !== node.id) {
      const siblings = childrenOf.get(parentId) || []
      siblings.push(node)
      childrenOf.set(parentId, siblings)
    } else {
      roots.push(node)
    }
  })
  const byCurrentY = (a: ReactFlowNode, b: ReactFlowNode) =>
    (a.position?.y ?? 0) - (b.position?.y ?? 0) || a.id.localeCompare(b.id)
  childrenOf.forEach(siblings => siblings.sort(byCurrentY))
  roots.sort(byCurrentY)

  const visibleChildren = (nodeId: string): ReactFlowNode[] =>
    collapsedNodes.has(nodeId) ? [] : childrenOf.get(nodeId) || []

  // --- Columns: every depth is as wide as its widest card. ------------------
  const depthOf = new Map<string, number>()
  const assignDepth = (node: ReactFlowNode, depth: number, seen: Set<string>) => {
    if (seen.has(node.id)) return
    seen.add(node.id)
    depthOf.set(node.id, depth)
    visibleChildren(node.id).forEach(child => assignDepth(child, depth + 1, seen))
  }
  const seenForDepth = new Set<string>()
  roots.forEach(root => assignDepth(root, 0, seenForDepth))

  const widthAtDepth = new Map<number, number>()
  depthOf.forEach((depth, nodeId) => {
    const node = nodeById.get(nodeId)
    if (!node) return
    widthAtDepth.set(depth, Math.max(widthAtDepth.get(depth) ?? 0, getNodeWidth(node)))
  })

  const xAtDepth = new Map<number, number>()
  const maxDepth = Math.max(0, ...Array.from(depthOf.values()))
  let cursorX = LAYOUT.START_X
  for (let depth = 0; depth <= maxDepth; depth++) {
    xAtDepth.set(depth, cursorX)
    cursorX += (widthAtDepth.get(depth) ?? 380) + LAYOUT.COLUMN_GAP
  }

  // --- Vertical: stack subtrees by their real extent. -----------------------
  const positions = new Map<string, { x: number; y: number }>()

  const shiftSubtree = (node: ReactFlowNode, dy: number, seen: Set<string>) => {
    if (seen.has(node.id)) return
    seen.add(node.id)
    const pos = positions.get(node.id)
    if (pos) pos.y += dy
    visibleChildren(node.id).forEach(child => shiftSubtree(child, dy, seen))
  }

  /** Places `node`'s subtree with its top edge at `top`; returns its height. */
  const place = (node: ReactFlowNode, top: number, stack: Set<string>): number => {
    const ownHeight = getNodeHeight(node)
    const x = xAtDepth.get(depthOf.get(node.id) ?? 0) ?? LAYOUT.START_X

    if (stack.has(node.id)) {
      positions.set(node.id, { x, y: top })
      return ownHeight
    }
    stack.add(node.id)

    const children = visibleChildren(node.id)
    if (children.length === 0) {
      positions.set(node.id, { x, y: top })
      stack.delete(node.id)
      return ownHeight
    }

    let cursorY = top
    children.forEach((child, idx) => {
      const childHeight = place(child, cursorY, stack)
      cursorY += childHeight + (idx < children.length - 1 ? LAYOUT.SIBLING_GAP : 0)
    })
    const childrenExtent = cursorY - top

    if (ownHeight >= childrenExtent) {
      // Parent is taller than everything it points at: centre the children on it.
      const dy = (ownHeight - childrenExtent) / 2
      const seen = new Set<string>()
      children.forEach(child => shiftSubtree(child, dy, seen))
      positions.set(node.id, { x, y: top })
      stack.delete(node.id)
      return ownHeight
    }

    // Otherwise centre the parent on the span of its first and last child.
    const first = positions.get(children[0].id)!
    const last = positions.get(children[children.length - 1].id)!
    const firstCentre = first.y + getNodeHeight(children[0]) / 2
    const lastCentre = last.y + getNodeHeight(children[children.length - 1]) / 2
    const y = Math.max(top, (firstCentre + lastCentre) / 2 - ownHeight / 2)
    positions.set(node.id, { x, y })
    stack.delete(node.id)
    return Math.max(childrenExtent, y + ownHeight - top)
  }

  let cursorY = LAYOUT.START_Y
  roots.forEach(root => {
    const height = place(root, cursorY, new Set<string>())
    cursorY += height + LAYOUT.ROOT_GAP
  })

  // --- Apply, keeping identity when nothing moved. --------------------------
  let changed = false
  const next = nodes.map(node => {
    const pos = positions.get(node.id)
    if (!pos) return node
    const dx = Math.abs((node.position?.x ?? 0) - pos.x)
    const dy = Math.abs((node.position?.y ?? 0) - pos.y)
    if (dx < LAYOUT.EPSILON && dy < LAYOUT.EPSILON) return node
    changed = true
    return { ...node, position: { x: pos.x, y: pos.y } }
  })

  return changed ? next : nodes
}

/**
 * Signature of everything the layout depends on: which nodes exist, how tall
 * they currently render, and what is collapsed. Re-run the layout when this
 * changes — not when positions change, otherwise the layout feeds itself.
 */
export function layoutSignature(
  nodes: ReactFlowNode[],
  collapsedNodes: ReadonlySet<string>
): string {
  return nodes
    .map(node => {
      const height = Math.round(node.measured?.height ?? 0)
      const width = Math.round(node.measured?.width ?? 0)
      const parentId = getParentId(node) || ''
      const collapsed = collapsedNodes.has(node.id) ? '1' : '0'
      return `${node.id}|${parentId}|${width}x${height}|${collapsed}`
    })
    .join(';')
}
