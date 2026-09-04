/**
 * Invention Miner — problem components, the substrate every engine counts over.
 *
 * A "problem" is not one statement. Forty families complaining about burst
 * release write it forty different ways, and counting statements instead of
 * components would report forty problems each admitted once — the exact
 * opposite of the truth. So the engines count over CONNECTED COMPONENTS of a
 * k-nearest-neighbour graph on the problem statements of the field.
 *
 * THREE DECISIONS IN HERE ARE LOAD-BEARING.
 *
 *  1. THE CUT COMES FROM THE FIELD'S OWN 1-NN DISTRIBUTION, NEVER A CONSTANT.
 *     Absolute embedding distances are not comparable across technology
 *     domains — a pharma field's statements sit far closer together than a
 *     software field's — so a global threshold merges everything in one and
 *     shatters the other. The cut is the MEDIAN 1-NN distance of this field's
 *     own statements: by construction about half the statements have a nearest
 *     neighbour inside it, which is the loosest cut that still refuses to link
 *     an isolated statement to anything.
 *
 *     It is deliberately NOT `mean − z·sd` over PAIRWISE distances. On a
 *     topically homogeneous set — which every scoped field is, by definition —
 *     the pairwise distribution is narrow and unimodal, so `mean − z·sd` lands
 *     inside the bulk and links nearly every pair: one component, every count a
 *     mixture. The 1-NN distribution is a different distribution (it measures
 *     local density, not global spread) and it is the one that says how close
 *     "close" is in this field.
 *
 *  2. UNION-FIND IN JS, OVER SQL'S EDGE LIST. The graph has ~8N edges, so the
 *     components are a linear-time pass in memory; asking SQL for them means a
 *     recursive CTE that walks the same edges with a planner in the way. Pure,
 *     deterministic, and tested — which the recursive CTE would not be.
 *
 *  3. THE BIMODALITY GUARD. A scope like "stent" (vascular grafts AND textile
 *     braiding) or "transformer" (electrical machines AND language models)
 *     holds two senses whose statements are far apart. Those cross-sense pairs
 *     RAISE the 1-NN median — a statement in the smaller sense finds its
 *     nearest neighbour further away — so the cut widens and union-find MERGES
 *     the two senses into one component. Every count over that component is
 *     then a mixture of two technologies and none of them mean anything. The
 *     guard catches it after the fact, by classification: a component whose two
 *     largest CPC subclass groups barely share families is two things, and it
 *     is split or excluded, never quietly counted.
 *
 * Everything exported here is pure. The SQL that produces the edge list lives
 * in the stage, which owns the transaction and the index settings.
 */

/** An undirected edge of the k-NN graph, with its normalised [0,1] distance. */
export interface StatementEdge {
  a: string
  b: string
  distance: number
}

export interface NearestNeighbourCut {
  /** Nodes whose 1-NN distance went into the distribution. */
  observations: number
  p05: number
  p50: number
  /** The linking threshold. Equal to p50 — named separately because it is a decision. */
  cut: number
}

/**
 * p05 and p50 of a 1-NN distance distribution, and the cut taken from it.
 *
 * `sorted[floor(n·q)]` — the same nearest-rank rule the studio's own
 * `fieldNeighborPercentiles` uses, so a miner percentile and a whitespace
 * percentile computed over the same numbers agree. p05 is reported but not
 * used for the cut: it is what tells a reader how tight this field is, and the
 * gap between p05 and p50 is the field's own scale.
 *
 * Fewer than `minObservations` nodes is NOT a cut. A median over eight numbers
 * is noise, and a noisy cut silently decides how many problems the field has,
 * so the caller is handed `null` and refuses rather than guessing.
 */
export const MIN_CUT_OBSERVATIONS = 30

export function nearestNeighbourCut(
  oneNnDistances: readonly number[],
  minObservations: number = MIN_CUT_OBSERVATIONS
): NearestNeighbourCut | null {
  const values = oneNnDistances.filter(value => Number.isFinite(value) && value >= 0).sort((a, b) => a - b)
  if (values.length < Math.max(1, minObservations)) return null
  const at = (q: number) => values[Math.min(values.length - 1, Math.floor(values.length * q))]
  const p50 = at(0.5)
  return { observations: values.length, p05: at(0.05), p50, cut: p50 }
}

/**
 * The 1-NN distance of every node that has at least one edge, from the k-NN
 * edge list. Nodes with no edge at all contribute nothing: their nearest
 * neighbour is beyond whatever the retrieval looked at, which is an absence of
 * measurement rather than a large distance.
 */
export function oneNearestDistances(nodes: readonly string[], edges: readonly StatementEdge[]): number[] {
  const nearest = new Map<string, number>()
  const known = new Set(nodes)
  for (const edge of edges) {
    if (!Number.isFinite(edge.distance)) continue
    for (const node of [edge.a, edge.b]) {
      if (!known.has(node)) continue
      const current = nearest.get(node)
      if (current === undefined || edge.distance < current) nearest.set(node, edge.distance)
    }
  }
  return Array.from(nearest.values())
}

export interface Component {
  /** Position in the returned ordering. Never persisted — see `componentKey`. */
  index: number
  members: string[]
}

/**
 * Connected components by union-find, DETERMINISTIC in three separate senses,
 * because a lead's identity is derived from a component and a lead that changes
 * identity on a re-run loses the attorney's review:
 *
 *   - members are sorted ascending inside each component;
 *   - components are ordered by size descending, then by first member ascending;
 *   - the union rule is size-then-id, so the same input always produces the
 *     same forest regardless of edge order.
 *
 * Union by size with path compression: effectively linear in the edge count.
 */
export function connectedComponents(
  nodes: readonly string[],
  edges: readonly StatementEdge[],
  cut: number
): Component[] {
  const unique = Array.from(new Set(nodes)).sort()
  const parent = new Map<string, string>()
  const size = new Map<string, number>()
  for (const node of unique) {
    parent.set(node, node)
    size.set(node, 1)
  }

  const find = (node: string): string => {
    let root = node
    while (parent.get(root) !== root) root = parent.get(root) as string
    // Path compression, second pass — iterative so a long chain cannot blow the
    // stack on a field whose statements form a near-linear similarity chain.
    let walk = node
    while (parent.get(walk) !== root) {
      const next = parent.get(walk) as string
      parent.set(walk, root)
      walk = next
    }
    return root
  }

  const union = (a: string, b: string): void => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA === rootB) return
    const sizeA = size.get(rootA) as number
    const sizeB = size.get(rootB) as number
    // Size first, id second: a tie broken by id makes the forest independent of
    // the order the edges arrived in.
    const [big, small] = sizeA > sizeB || (sizeA === sizeB && rootA < rootB) ? [rootA, rootB] : [rootB, rootA]
    parent.set(small, big)
    size.set(big, sizeA + sizeB)
  }

  for (const edge of edges) {
    if (!Number.isFinite(edge.distance) || edge.distance > cut) continue
    if (!parent.has(edge.a) || !parent.has(edge.b)) continue
    union(edge.a, edge.b)
  }

  const grouped = new Map<string, string[]>()
  for (const node of unique) {
    const root = find(node)
    const bucket = grouped.get(root)
    if (bucket) bucket.push(node)
    else grouped.set(root, [node])
  }

  return Array.from(grouped.values())
    .map(members => members.sort())
    .sort((a, b) => b.length - a.length || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map((members, index) => ({ index, members }))
}

// ---------------------------------------------------------------------------
// The bimodality guard
// ---------------------------------------------------------------------------

/**
 * Below this share of families in common, the component's two largest
 * classification groups are two technologies, not two facets of one.
 *
 * 10% is a decision, not a measurement — see the report. It is deliberately
 * LOW: an ordinary component in a real field has its two biggest subclasses
 * overlapping on 40–90% of families (a device patent carries both its
 * apparatus and its use class), so a genuine sense split has to look nothing
 * like that before it is called one.
 */
export const BIMODAL_SHARED_FAMILY_SHARE = 0.1

/** Below this many families a group is a handful of documents, not a sense. */
export const BIMODAL_MIN_GROUP_FAMILIES = 3

export type BimodalityVerdict =
  | { bimodal: false; reason: 'single-group' | 'too-small' | 'groups-overlap'; sharedShare: number | null }
  | {
      bimodal: true
      groupA: string
      groupB: string
      /** |A ∩ B| / |A ∪ B| over FAMILIES — Jaccard, so neither group's size dominates. */
      sharedShare: number
      /** Families to keep as the A-sense component. */
      partA: string[]
      /** Families to keep as the B-sense component. */
      partB: string[]
      /** Families in neither group. Dropped, and counted in the note. */
      unassigned: string[]
    }

/**
 * Is this component two technically unrelated groups wearing one problem?
 *
 * Measured over the FAMILIES of the component, keyed by CPC subclass. The two
 * largest subclass groups are compared by Jaccard over their family sets: a
 * component whose A61F families and D04B families are almost disjoint is two
 * senses of a word, and the counts over it are a mixture.
 *
 * A family carrying BOTH subclasses is assigned to the larger group, so the
 * partition is total and deterministic; families carrying neither are dropped
 * (they are what the two senses do not explain) and the caller names them in
 * the coverage note.
 */
export function componentBimodality(familySubclasses: ReadonlyMap<string, readonly string[]>): BimodalityVerdict {
  const byGroup = new Map<string, Set<string>>()
  // Array.from over every Map/Set walk in this module: tsconfig sets no
  // `target`, so tsc defaults to ES5 and rejects direct iteration of them.
  for (const [familyKey, subclasses] of Array.from(familySubclasses.entries())) {
    for (const subclass of Array.from(new Set(subclasses))) {
      if (!subclass) continue
      const bucket = byGroup.get(subclass)
      if (bucket) bucket.add(familyKey)
      else byGroup.set(subclass, new Set([familyKey]))
    }
  }

  const ranked = Array.from(byGroup.entries())
    .map(([subclass, families]) => ({ subclass, families }))
    // Size first, code second — a tie must not depend on Map insertion order.
    .sort((a, b) => b.families.size - a.families.size || (a.subclass < b.subclass ? -1 : 1))

  if (ranked.length < 2) return { bimodal: false, reason: 'single-group', sharedShare: null }

  const [first, second] = ranked
  if (second.families.size < BIMODAL_MIN_GROUP_FAMILIES) {
    return { bimodal: false, reason: 'too-small', sharedShare: null }
  }

  let intersection = 0
  for (const familyKey of Array.from(second.families)) if (first.families.has(familyKey)) intersection += 1
  const union = first.families.size + second.families.size - intersection
  const sharedShare = union > 0 ? intersection / union : 0
  if (sharedShare >= BIMODAL_SHARED_FAMILY_SHARE) {
    return { bimodal: false, reason: 'groups-overlap', sharedShare }
  }

  const partA: string[] = []
  const partB: string[] = []
  const unassigned: string[] = []
  for (const familyKey of Array.from(familySubclasses.keys()).sort()) {
    if (first.families.has(familyKey)) partA.push(familyKey)
    else if (second.families.has(familyKey)) partB.push(familyKey)
    else unassigned.push(familyKey)
  }

  return {
    bimodal: true,
    groupA: first.subclass,
    groupB: second.subclass,
    sharedShare,
    partA,
    partB,
    unassigned,
  }
}

/**
 * The exact sentence a split emits. Fixed here so the stage, the lead's
 * coverage limitations and the report cannot word it three ways.
 */
export function bimodalityNote(groupA: string, groupB: string): string {
  return (
    `This scope contains two technically unrelated groups (${groupA} and ${groupB}). ` +
    `Leads mixing them are not comparable — split the scope.`
  )
}
