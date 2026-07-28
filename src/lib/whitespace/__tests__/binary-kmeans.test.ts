import { describe, expect, it } from 'vitest'
import {
  BITS,
  WORDS,
  binaryKMeans,
  clusterGeometry,
  coherenceGrade,
  hamming,
  hexToWords,
  layoutCentroids,
  mulberry32,
  packBitString,
  wordsToHex,
} from '../binary-kmeans'

function randomBitString(random: () => number, flipFrom?: string, flips = 0): string {
  if (flipFrom) {
    const chars = flipFrom.split('')
    for (let i = 0; i < flips; i++) {
      const at = Math.floor(random() * BITS)
      chars[at] = chars[at] === '0' ? '1' : '0'
    }
    return chars.join('')
  }
  let out = ''
  for (let i = 0; i < BITS; i++) out += random() < 0.5 ? '0' : '1'
  return out
}

describe('bit packing', () => {
  it('round-trips through hex', () => {
    const random = mulberry32(1)
    const bits = randomBitString(random)
    const packed = packBitString(bits)
    expect(hexToWords(wordsToHex(packed))).toEqual(packed)
  })

  it('computes Hamming distance exactly', () => {
    const zeros = packBitString('0'.repeat(BITS))
    const ones = packBitString('1'.repeat(BITS))
    expect(hamming(zeros, zeros)).toBe(0)
    expect(hamming(zeros, ones)).toBe(BITS)

    const one = packBitString('1' + '0'.repeat(BITS - 1))
    expect(hamming(zeros, one)).toBe(1)
  })

  it('rejects wrong-length vectors', () => {
    expect(() => packBitString('01')).toThrow()
  })
})

describe('binaryKMeans', () => {
  it('separates two well-separated groups', () => {
    const random = mulberry32(2)
    const seedA = randomBitString(random)
    const seedB = randomBitString(random)
    const n = 200
    const data = new Uint32Array(n * WORDS)
    for (let i = 0; i < n; i++) {
      const bits = randomBitString(random, i < n / 2 ? seedA : seedB, 20)
      data.set(packBitString(bits), i * WORDS)
    }

    const result = binaryKMeans(data, n, 2, { seed: 3 })
    expect(result.k).toBe(2)

    // Every member of group A shares a cluster; same for B; and they differ.
    const first = result.assignments[0]
    for (let i = 1; i < n / 2; i++) expect(result.assignments[i]).toBe(first)
    const second = result.assignments[n / 2]
    for (let i = n / 2 + 1; i < n; i++) expect(result.assignments[i]).toBe(second)
    expect(first).not.toBe(second)
  })

  it('is deterministic for a given seed', () => {
    const random = mulberry32(4)
    const n = 120
    const data = new Uint32Array(n * WORDS)
    for (let i = 0; i < n; i++) data.set(packBitString(randomBitString(random)), i * WORDS)

    const a = binaryKMeans(data, n, 5, { seed: 9 })
    const b = binaryKMeans(data, n, 5, { seed: 9 })
    expect(Array.from(a.assignments)).toEqual(Array.from(b.assignments))
    expect(Array.from(a.centroids)).toEqual(Array.from(b.centroids))
  })

  it('caps k at n and survives k=1 and n=0', () => {
    const random = mulberry32(5)
    const data = new Uint32Array(3 * WORDS)
    for (let i = 0; i < 3; i++) data.set(packBitString(randomBitString(random)), i * WORDS)
    expect(binaryKMeans(data, 3, 10, { seed: 1 }).k).toBe(3)
    expect(binaryKMeans(data, 3, 1, { seed: 1 }).k).toBe(1)
    expect(binaryKMeans(new Uint32Array(0), 0, 4).k).toBe(0)
  })
})

describe('clusterGeometry', () => {
  it('produces medoids that belong to their own cluster, and sane bands', () => {
    const random = mulberry32(6)
    const seedA = randomBitString(random)
    const seedB = randomBitString(random)
    const n = 100
    const data = new Uint32Array(n * WORDS)
    for (let i = 0; i < n; i++) {
      data.set(packBitString(randomBitString(random, i < n / 2 ? seedA : seedB, 15)), i * WORDS)
    }
    const result = binaryKMeans(data, n, 2, { seed: 7 })
    const geometry = clusterGeometry(data, n, result)

    for (let c = 0; c < result.k; c++) {
      expect(geometry.medoids[c].length).toBeGreaterThan(0)
      for (const medoid of geometry.medoids[c]) {
        expect(result.assignments[medoid]).toBe(c)
      }
      expect(geometry.cohesion[c]).toBeGreaterThanOrEqual(0)
      expect(geometry.cohesion[c]).toBeLessThanOrEqual(1)
      expect(geometry.silhouette[c]).toBeGreaterThan(0) // clean separation
    }
  })
})

describe('layoutCentroids', () => {
  it('keeps every point inside the unit box', () => {
    const k = 8
    const random = mulberry32(8)
    const means = new Float32Array(k * BITS).map(() => random())
    const layout = layoutCentroids(means, k)
    expect(layout).toHaveLength(k)
    for (const point of layout) {
      expect(point.x).toBeGreaterThanOrEqual(0)
      expect(point.x).toBeLessThanOrEqual(1)
      expect(point.y).toBeGreaterThanOrEqual(0)
      expect(point.y).toBeLessThanOrEqual(1)
    }
  })
})

describe('coherenceGrade', () => {
  it('grades tight-and-separate as well-defined and loose as diffuse', () => {
    expect(coherenceGrade(0.15, 0.2, 0.4)).toBe('well-defined')
    expect(coherenceGrade(0.4, 0.02, -0.1)).toBe('diffuse')
  })
})
