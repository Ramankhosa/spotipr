/**
 * Whitespace Studio — binary k-means ("k-majority") over 512-bit patent vectors.
 *
 * Pure functions, no I/O, no randomness source other than the caller-supplied
 * seed: the same sample must always produce the same clusters, because a map
 * that changes between reloads reads as noise even when both layouts are valid.
 *
 * Vectors arrive as pgvector bit strings ("0101...", 512 chars), are packed into
 * Uint32Array (16 words), and all distance work is XOR + popcount. Centroid
 * update is a per-bit majority vote across members. Complexity per Lloyd
 * iteration at k=24, n=50k is ~19M word ops — milliseconds in Node.
 *
 * Why not HDBSCAN: no maintained TS implementation at this scale, density
 * estimation in integer Hamming space is poorly calibrated (heavy ties), and a
 * "noise" label is a UX liability. k-means + cohesion grading + (later)
 * recursion delivers the same product value transparently.
 */

export const BITS = 512
export const WORDS = BITS / 32

/** Mulberry32 — deterministic PRNG, good enough for seeding and sampling. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Packs a pgvector bit string ("0101...") into words. Throws on wrong length. */
export function packBitString(bits: string): Uint32Array {
  if (bits.length !== BITS) throw new Error(`Expected ${BITS}-bit vector, got ${bits.length}`)
  const words = new Uint32Array(WORDS)
  for (let w = 0; w < WORDS; w++) {
    let value = 0
    const base = w * 32
    for (let b = 0; b < 32; b++) {
      if (bits.charCodeAt(base + b) === 49 /* '1' */) value |= 1 << (31 - b)
    }
    words[w] = value >>> 0
  }
  return words
}

/** Serialises packed words to hex for storage (WhitespaceClusterMember.bits). */
export function wordsToHex(words: Uint32Array): string {
  let out = ''
  for (let w = 0; w < words.length; w++) out += words[w].toString(16).padStart(8, '0')
  return out
}

export function hexToWords(hex: string): Uint32Array {
  const words = new Uint32Array(hex.length / 8)
  for (let w = 0; w < words.length; w++) {
    words[w] = Number.parseInt(hex.slice(w * 8, w * 8 + 8), 16) >>> 0
  }
  return words
}

function popcount32(v: number): number {
  v = v - ((v >>> 1) & 0x55555555)
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333)
  v = (v + (v >>> 4)) & 0x0f0f0f0f
  return (v * 0x01010101) >>> 24
}

/** Hamming distance between two packed vectors, in bits (0..512). */
export function hamming(a: Uint32Array, b: Uint32Array, offsetA = 0, offsetB = 0): number {
  let distance = 0
  for (let w = 0; w < WORDS; w++) {
    distance += popcount32((a[offsetA + w] ^ b[offsetB + w]) >>> 0)
  }
  return distance
}

export interface KMeansResult {
  /** Cluster index per input vector, -1 never occurs (every vector is assigned). */
  assignments: Int32Array
  /** Packed binary centroids, k × WORDS. */
  centroids: Uint32Array
  /** Real-valued mean per bit, k × BITS — kept for layout and fine ranking. */
  centroidMeans: Float32Array
  k: number
  iterations: number
}

/**
 * k-means++ seeding in Hamming space: each next centre is drawn with probability
 * proportional to squared distance from the nearest existing centre.
 */
function seedCentroids(data: Uint32Array, n: number, k: number, random: () => number): Uint32Array {
  const centroids = new Uint32Array(k * WORDS)
  const first = Math.floor(random() * n)
  centroids.set(data.subarray(first * WORDS, first * WORDS + WORDS), 0)

  const nearest = new Float64Array(n).fill(Number.POSITIVE_INFINITY)
  for (let c = 1; c < k; c++) {
    let total = 0
    for (let i = 0; i < n; i++) {
      const d = hamming(data, centroids, i * WORDS, (c - 1) * WORDS)
      if (d < nearest[i]) nearest[i] = d
      total += nearest[i] * nearest[i]
    }
    let pick = random() * total
    let chosen = n - 1
    for (let i = 0; i < n; i++) {
      pick -= nearest[i] * nearest[i]
      if (pick <= 0) {
        chosen = i
        break
      }
    }
    centroids.set(data.subarray(chosen * WORDS, chosen * WORDS + WORDS), c * WORDS)
  }
  return centroids
}

export interface KMeansIterationInfo {
  /** 1-based Lloyd pass that just finished. */
  iteration: number
  /** Points whose assignment changed in this pass; 0 means the loop stops here. */
  changed: number
  maxIterations: number
}

/**
 * Lloyd iterations with per-bit majority-vote centroid update. Empty clusters
 * are re-seeded mid-run from the points farthest from their centroids (each
 * from a DIFFERENT point), so k stays k while iterating; any cluster still
 * empty under the final assignment is dropped before returning, so the
 * returned k can be smaller than requested but never names an empty area.
 */
export function binaryKMeans(
  data: Uint32Array,
  n: number,
  k: number,
  options: {
    maxIterations?: number
    seed?: number
    /**
     * Called synchronously at the end of every Lloyd pass, before the
     * convergence check. A progress hook only: it never sees the assignment,
     * so a caller that narrates cannot change the result.
     */
    onIteration?: (info: KMeansIterationInfo) => void
  } = {}
): KMeansResult {
  if (n === 0 || k === 0) {
    return {
      assignments: new Int32Array(0),
      centroids: new Uint32Array(0),
      centroidMeans: new Float32Array(0),
      k: 0,
      iterations: 0,
    }
  }
  const effectiveK = Math.min(k, n)
  const maxIterations = options.maxIterations ?? 20
  const random = mulberry32(options.seed ?? 7)

  let centroids = seedCentroids(data, n, effectiveK, random)
  const assignments = new Int32Array(n).fill(-1)
  const bitVotes = new Int32Array(effectiveK * BITS)
  const sizes = new Int32Array(effectiveK)
  let iterations = 0

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    iterations = iteration + 1
    let changed = 0

    for (let i = 0; i < n; i++) {
      let best = 0
      let bestDistance = Number.POSITIVE_INFINITY
      for (let c = 0; c < effectiveK; c++) {
        const d = hamming(data, centroids, i * WORDS, c * WORDS)
        if (d < bestDistance) {
          bestDistance = d
          best = c
        }
      }
      if (assignments[i] !== best) {
        assignments[i] = best
        changed++
      }
    }

    // Majority vote per bit.
    bitVotes.fill(0)
    sizes.fill(0)
    for (let i = 0; i < n; i++) {
      const c = assignments[i]
      sizes[c]++
      const base = i * WORDS
      for (let w = 0; w < WORDS; w++) {
        const word = data[base + w]
        const voteBase = c * BITS + w * 32
        for (let b = 0; b < 32; b++) {
          if ((word >>> (31 - b)) & 1) bitVotes[voteBase + b]++
        }
      }
    }

    const next = new Uint32Array(effectiveK * WORDS)
    // Points already used to re-seed a dead centre THIS iteration: two dead
    // centres seeded from the same globally-worst point are the same centroid
    // twice, and one of them is guaranteed dead again next iteration.
    const reseeded = new Set<number>()
    for (let c = 0; c < effectiveK; c++) {
      if (sizes[c] === 0) {
        // Re-seed a dead centre from the worst-fitted point not yet used.
        let worst = -1
        let worstDistance = -1
        for (let i = 0; i < n; i++) {
          if (reseeded.has(i)) continue
          const d = hamming(data, centroids, i * WORDS, assignments[i] * WORDS)
          if (d > worstDistance) {
            worstDistance = d
            worst = i
          }
        }
        if (worst >= 0) {
          reseeded.add(worst)
          next.set(data.subarray(worst * WORDS, worst * WORDS + WORDS), c * WORDS)
        }
        continue
      }
      const half = sizes[c] / 2
      for (let w = 0; w < WORDS; w++) {
        let word = 0
        const voteBase = c * BITS + w * 32
        for (let b = 0; b < 32; b++) {
          if (bitVotes[voteBase + b] > half) word |= 1 << (31 - b)
        }
        next[c * WORDS + w] = word >>> 0
      }
    }
    centroids = next

    options.onIteration?.({ iteration: iterations, changed, maxIterations })
    if (changed === 0) break
  }

  // Zero-member clusters must not be returned: a centre re-seeded on the exit
  // iteration (or dead exactly at maxIterations) has no members under the final
  // assignment, and the caller persists every cluster as a real area — one with
  // no members, no medoids, and a deep dive that fails. Drop them and renumber
  // so every returned cluster index has at least one member.
  sizes.fill(0)
  for (let i = 0; i < n; i++) sizes[assignments[i]]++
  const remap = new Int32Array(effectiveK).fill(-1)
  let liveK = 0
  for (let c = 0; c < effectiveK; c++) {
    if (sizes[c] > 0) remap[c] = liveK++
  }

  const liveCentroids = liveK === effectiveK ? centroids : new Uint32Array(liveK * WORDS)
  const centroidMeans = new Float32Array(liveK * BITS)
  for (let c = 0; c < effectiveK; c++) {
    const target = remap[c]
    if (target < 0) continue
    if (liveK !== effectiveK) {
      liveCentroids.set(centroids.subarray(c * WORDS, c * WORDS + WORDS), target * WORDS)
    }
    for (let b = 0; b < BITS; b++) {
      centroidMeans[target * BITS + b] = bitVotes[c * BITS + b] / sizes[c]
    }
  }
  if (liveK !== effectiveK) {
    for (let i = 0; i < n; i++) assignments[i] = remap[assignments[i]]
  }

  return { assignments, centroids: liveCentroids, centroidMeans, k: liveK, iterations }
}

export interface ClusterGeometry {
  /** Mean intra-cluster Hamming / BITS, per cluster. Lower is tighter. */
  cohesion: number[]
  /** Nearest inter-centroid Hamming / BITS, per cluster. Higher is more separate. */
  separation: number[]
  /** Sampled silhouette in [-1, 1], per cluster. */
  silhouette: number[]
  /** Member indices minimising summed Hamming to co-members, per cluster. */
  medoids: number[][]
}

/**
 * Cohesion, separation, sampled silhouette and medoids in one pass over the
 * assignment. Silhouette is computed over a capped subsample per cluster because
 * the exact statistic is O(n²) and the grade bands only need two decimal places.
 */
export function clusterGeometry(
  data: Uint32Array,
  n: number,
  result: KMeansResult,
  options: { medoidsPerCluster?: number; silhouetteSample?: number; seed?: number } = {}
): ClusterGeometry {
  const { assignments, centroids, k } = result
  const medoidsPerCluster = options.medoidsPerCluster ?? 12
  const silhouetteSample = options.silhouetteSample ?? 2000
  const random = mulberry32(options.seed ?? 11)

  const memberIndex: number[][] = Array.from({ length: k }, () => [])
  for (let i = 0; i < n; i++) memberIndex[assignments[i]].push(i)

  const cohesion: number[] = new Array(k).fill(0)
  const separation: number[] = new Array(k).fill(0)
  const silhouette: number[] = new Array(k).fill(0)
  const medoids: number[][] = Array.from({ length: k }, () => [])

  for (let c = 0; c < k; c++) {
    const members = memberIndex[c]
    if (!members.length) continue

    // Cohesion: mean distance to own centroid (proxy for mean pairwise, O(n)).
    let sum = 0
    for (const i of members) sum += hamming(data, centroids, i * WORDS, c * WORDS)
    cohesion[c] = sum / members.length / BITS

    // Separation: nearest other centroid.
    let nearest = Number.POSITIVE_INFINITY
    for (let other = 0; other < k; other++) {
      if (other === c) continue
      const d = hamming(centroids, centroids, c * WORDS, other * WORDS)
      if (d < nearest) nearest = d
    }
    separation[c] = Number.isFinite(nearest) ? nearest / BITS : 1

    // Medoids: summed distance to a capped subsample of co-members.
    const reference = members.length > 400 ? sample(members, 400, random) : members
    const scored = members
      .map(i => {
        let total = 0
        for (const j of reference) total += hamming(data, data, i * WORDS, j * WORDS)
        return { i, total }
      })
      .sort((a, b) => a.total - b.total)
    medoids[c] = scored.slice(0, medoidsPerCluster).map(entry => entry.i)
  }

  // Sampled silhouette: a(i) = distance to own centroid, b(i) = nearest other
  // centroid — the centroid approximation of the classic statistic.
  const sampled = n > silhouetteSample ? sample(Array.from({ length: n }, (_, i) => i), silhouetteSample, random) : Array.from({ length: n }, (_, i) => i)
  const silhouetteSum = new Float64Array(k)
  const silhouetteCount = new Int32Array(k)
  for (const i of sampled) {
    const own = assignments[i]
    const a = hamming(data, centroids, i * WORDS, own * WORDS)
    let b = Number.POSITIVE_INFINITY
    for (let c = 0; c < k; c++) {
      if (c === own) continue
      const d = hamming(data, centroids, i * WORDS, c * WORDS)
      if (d < b) b = d
    }
    const denominator = Math.max(a, b)
    if (denominator > 0 && Number.isFinite(b)) {
      silhouetteSum[own] += (b - a) / denominator
      silhouetteCount[own]++
    }
  }
  for (let c = 0; c < k; c++) {
    silhouette[c] = silhouetteCount[c] ? silhouetteSum[c] / silhouetteCount[c] : 0
  }

  return { cohesion, separation, silhouette, medoids }
}

function sample<T>(items: T[], count: number, random: () => number): T[] {
  if (items.length <= count) return items
  const copy = items.slice()
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, count)
}

/**
 * 2D layout for ≤40 centroids: PCA over the real-valued centroid means via power
 * iteration, then a light deterministic repulsion pass so no two points overlap.
 * The map is a selector, never evidence (WIPO Pub. 946 §8.6.2) — nothing reads
 * meaning into these coordinates, so approximate PCA is entirely sufficient.
 */
export function layoutCentroids(centroidMeans: Float32Array, k: number): Array<{ x: number; y: number }> {
  if (k === 0) return []
  if (k === 1) return [{ x: 0.5, y: 0.5 }]

  // Centre the data.
  const mean = new Float64Array(BITS)
  for (let c = 0; c < k; c++) {
    for (let b = 0; b < BITS; b++) mean[b] += centroidMeans[c * BITS + b]
  }
  for (let b = 0; b < BITS; b++) mean[b] /= k
  const centred = new Float64Array(k * BITS)
  for (let c = 0; c < k; c++) {
    for (let b = 0; b < BITS; b++) centred[c * BITS + b] = centroidMeans[c * BITS + b] - mean[b]
  }

  const random = mulberry32(13)
  const component = (deflate: Float64Array | null): Float64Array => {
    let v = new Float64Array(BITS).map(() => random() - 0.5)
    for (let iteration = 0; iteration < 30; iteration++) {
      if (deflate) {
        // Remove the first component's direction.
        let dot = 0
        for (let b = 0; b < BITS; b++) dot += v[b] * deflate[b]
        for (let b = 0; b < BITS; b++) v[b] -= dot * deflate[b]
      }
      // v <- Xᵀ X v
      const scores = new Float64Array(k)
      for (let c = 0; c < k; c++) {
        let s = 0
        for (let b = 0; b < BITS; b++) s += centred[c * BITS + b] * v[b]
        scores[c] = s
      }
      const next = new Float64Array(BITS)
      for (let c = 0; c < k; c++) {
        for (let b = 0; b < BITS; b++) next[b] += centred[c * BITS + b] * scores[c]
      }
      let norm = 0
      for (let b = 0; b < BITS; b++) norm += next[b] * next[b]
      norm = Math.sqrt(norm) || 1
      for (let b = 0; b < BITS; b++) next[b] /= norm
      v = next
    }
    return v
  }

  const first = component(null)
  const second = component(first)

  const points = Array.from({ length: k }, (_, c) => {
    let x = 0
    let y = 0
    for (let b = 0; b < BITS; b++) {
      x += centred[c * BITS + b] * first[b]
      y += centred[c * BITS + b] * second[b]
    }
    return { x, y }
  })

  // Deterministic repulsion: push apart any pair closer than a minimum gap.
  for (let pass = 0; pass < 40; pass++) {
    let moved = false
    for (let a = 0; a < k; a++) {
      for (let b = a + 1; b < k; b++) {
        const dx = points[b].x - points[a].x
        const dy = points[b].y - points[a].y
        const distance = Math.sqrt(dx * dx + dy * dy)
        const minimum = 0.5
        if (distance < minimum) {
          const push = (minimum - distance) / 2 || 0.25
          const nx = distance > 0 ? dx / distance : Math.cos(a * 2.4 + b)
          const ny = distance > 0 ? dy / distance : Math.sin(a * 2.4 + b)
          points[a].x -= nx * push
          points[a].y -= ny * push
          points[b].x += nx * push
          points[b].y += ny * push
          moved = true
        }
      }
    }
    if (!moved) break
  }

  // Normalise into [0.05, 0.95]².
  const xs = points.map(p => p.x)
  const ys = points.map(p => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  return points.map(p => ({
    x: 0.05 + 0.9 * (maxX > minX ? (p.x - minX) / (maxX - minX) : 0.5),
    y: 0.05 + 0.9 * (maxY > minY ? (p.y - minY) / (maxY - minY) : 0.5),
  }))
}

/**
 * Coherence grade shown to users in place of raw geometry. Bands chosen so that
 * "well-defined" means both tight and separate, and anything ambiguous lands in
 * the middle rather than flattering the clustering.
 */
export function coherenceGrade(cohesion: number, separation: number, silhouette: number): 'well-defined' | 'usable' | 'diffuse' {
  if (silhouette >= 0.25 && cohesion <= 0.22) return 'well-defined'
  if (silhouette >= 0.05 && cohesion <= 0.3 && separation >= 0.08) return 'usable'
  return 'diffuse'
}
