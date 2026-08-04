import { describe, it, expect } from 'vitest'
import type { Node as ReactFlowNode } from '@xyflow/react'
import { layoutMindMap, layoutSignature, LAYOUT } from './mindmap-layout'

type TestNode = ReactFlowNode & { measured?: { width: number; height: number } }

function node(
  id: string,
  parentId: string | undefined,
  height: number,
  extra: Partial<TestNode> = {}
): TestNode {
  return {
    id,
    type: 'dimension',
    position: { x: 0, y: 0 },
    data: parentId ? { parentId, title: id } : { title: id },
    measured: { width: 380, height },
    ...extra,
  } as TestNode
}

/** Every visible pair in the same column must have disjoint vertical extents. */
function overlaps(nodes: TestNode[], visibleIds: string[]): Array<[string, string]> {
  const visible = nodes.filter(n => visibleIds.includes(n.id))
  const hits: Array<[string, string]> = []
  for (let i = 0; i < visible.length; i++) {
    for (let j = i + 1; j < visible.length; j++) {
      const a = visible[i]
      const b = visible[j]
      const aRight = a.position.x + (a.measured?.width ?? 0)
      const bRight = b.position.x + (b.measured?.width ?? 0)
      const xOverlap = a.position.x < bRight && b.position.x < aRight
      const aBottom = a.position.y + (a.measured?.height ?? 0)
      const bBottom = b.position.y + (b.measured?.height ?? 0)
      const yOverlap = a.position.y < bBottom && b.position.y < aBottom
      if (xOverlap && yOverlap) hits.push([a.id, b.id])
    }
  }
  return hits
}

describe('layoutMindMap', () => {
  it('keeps wildly different sibling heights apart', () => {
    // The failing case from the canvas: one expansion returns cards of 350,
    // 660 and 420px against the old fixed 430px row.
    const nodes = [
      node('seed', undefined, 90, { type: 'seed', measured: { width: 288, height: 90 } }),
      node('dim', 'seed', 200),
      node('move-a', 'dim', 350),
      node('move-b', 'dim', 660),
      node('move-c', 'dim', 420),
    ]

    const out = layoutMindMap(nodes, new Set()) as TestNode[]

    expect(overlaps(out, out.map(n => n.id))).toEqual([])

    const a = out.find(n => n.id === 'move-a')!
    const b = out.find(n => n.id === 'move-b')!
    const c = out.find(n => n.id === 'move-c')!
    expect(b.position.y - (a.position.y + 350)).toBeCloseTo(LAYOUT.SIBLING_GAP, 5)
    expect(c.position.y - (b.position.y + 660)).toBeCloseTo(LAYOUT.SIBLING_GAP, 5)
  })

  it('separates columns and centres a parent on its children', () => {
    const nodes = [
      node('root', undefined, 100),
      node('c1', 'root', 200),
      node('c2', 'root', 200),
    ]

    const out = layoutMindMap(nodes, new Set()) as TestNode[]
    const root = out.find(n => n.id === 'root')!
    const c1 = out.find(n => n.id === 'c1')!
    const c2 = out.find(n => n.id === 'c2')!

    expect(c1.position.x).toBe(root.position.x + 380 + LAYOUT.COLUMN_GAP)
    expect(c2.position.x).toBe(c1.position.x)

    const childSpan = (c1.position.y + 100 + c2.position.y + 100) / 2
    expect(root.position.y + 50).toBeCloseTo(childSpan, 5)
  })

  it('reclaims the space of a collapsed branch', () => {
    const nodes = [
      node('root', undefined, 100),
      node('a', 'root', 200),
      node('a1', 'a', 600),
      node('b', 'root', 200),
    ]

    const expanded = layoutMindMap(nodes, new Set()) as TestNode[]
    const collapsed = layoutMindMap(nodes, new Set(['a'])) as TestNode[]

    const gapWhenExpanded =
      expanded.find(n => n.id === 'b')!.position.y - expanded.find(n => n.id === 'a')!.position.y
    const gapWhenCollapsed =
      collapsed.find(n => n.id === 'b')!.position.y - collapsed.find(n => n.id === 'a')!.position.y

    expect(gapWhenCollapsed).toBeLessThan(gapWhenExpanded)
    // Hidden children are excluded, so siblings sit one card apart.
    expect(gapWhenCollapsed).toBeCloseTo(200 + LAYOUT.SIBLING_GAP, 5)
    expect(overlaps(collapsed, ['root', 'a', 'b'])).toEqual([])
  })

  it('never overlaps across a deep, ragged tree', () => {
    const heights = [140, 620, 300, 480, 210, 700, 160, 390]
    const nodes: TestNode[] = [node('root', undefined, 120)]
    heights.forEach((h, i) => {
      nodes.push(node(`l1-${i}`, 'root', h))
      // Every other branch gets grandchildren of its own.
      if (i % 2 === 0) {
        nodes.push(node(`l2-${i}-a`, `l1-${i}`, h * 0.6))
        nodes.push(node(`l2-${i}-b`, `l1-${i}`, 520))
      }
    })

    const out = layoutMindMap(nodes, new Set()) as TestNode[]
    expect(overlaps(out, out.map(n => n.id))).toEqual([])
  })

  it('falls back to a content estimate before nodes are measured', () => {
    const long = 'x'.repeat(600)
    const unmeasured: TestNode[] = [
      { id: 'root', type: 'dimension', position: { x: 0, y: 0 }, data: { title: 'root' } } as TestNode,
      {
        id: 'big',
        type: 'dimension',
        position: { x: 0, y: 0 },
        data: {
          parentId: 'root',
          title: 'big',
          payloadJson: { isSuggestedMove: true, move: long, impact: long, leadsTo: long, tension: long },
        },
      } as TestNode,
      {
        id: 'small',
        type: 'dimension',
        position: { x: 0, y: 0 },
        data: { parentId: 'root', title: 'small' },
      } as TestNode,
    ]

    const out = layoutMindMap(unmeasured, new Set())
    const big = out.find(n => n.id === 'big')!
    const small = out.find(n => n.id === 'small')!
    // The tall card reserves real space instead of a flat row height.
    expect(small.position.y - big.position.y).toBeGreaterThan(400)
  })

  it('returns the same array when nothing moved', () => {
    const nodes = [node('root', undefined, 100), node('child', 'root', 200)]
    const once = layoutMindMap(nodes, new Set())
    const twice = layoutMindMap(once, new Set())
    expect(twice).toBe(once)
  })

  it('signature ignores positions but tracks measured height and collapse', () => {
    const nodes = [node('root', undefined, 100), node('child', 'root', 200)]
    const base = layoutSignature(nodes, new Set())

    const moved = nodes.map(n => ({ ...n, position: { x: 999, y: 999 } }))
    expect(layoutSignature(moved, new Set())).toBe(base)

    const grown = nodes.map(n =>
      n.id === 'child' ? { ...n, measured: { width: 380, height: 500 } } : n
    )
    expect(layoutSignature(grown, new Set())).not.toBe(base)
    expect(layoutSignature(nodes, new Set(['root']))).not.toBe(base)
  })
})
