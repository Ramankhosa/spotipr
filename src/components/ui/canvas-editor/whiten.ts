// Patent figures are black-on-white line art, but the rasters that reach the
// editor rarely have a true-white background: AI-generated sketches come back
// cream/ivory, scanned or photographed figures carry paper tint, and legacy
// PlantUML renders used a light-gray package fill. The editor's eraser paints
// pure #FFFFFF, so every erase stroke left a visibly brighter patch.
//
// whitenToPaperWhite() estimates the dominant light background colour and
// applies a per-channel white-point correction (classic scanned-document
// levels) so that background becomes exactly #FFFFFF while dark line work and
// anti-aliasing scale proportionally. The result is what gets displayed,
// edited, and exported — so erasing becomes invisible and saved figures are
// uniformly paper white.

export interface WhitenResult {
  element: HTMLCanvasElement
  applied: boolean
}

// Pixels at least this bright (all channels) and this neutral are candidates
// for the background estimate.
const BG_CANDIDATE_MIN = 180
const BG_CANDIDATE_MAX_CHROMA = 40
// The dominant light colour must cover this share of sampled pixels and be at
// least this bright to be treated as "the paper" — photographs or dark-theme
// images fail the guard and are left untouched.
const BG_MIN_COVERAGE = 0.15
const BG_MIN_LUMINANCE = 200
// After the white-point pass, near-white low-chroma residue (e.g. the legacy
// #F8F8F8 package fill inside an otherwise white diagram) is snapped to white.
const SNAP_MIN = 244
const SNAP_MAX_CHROMA = 12

export function whitenToPaperWhite(img: HTMLImageElement): WhitenResult | null {
  const width = img.naturalWidth
  const height = img.naturalHeight
  if (!width || !height) return null

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  let imageData: ImageData
  try {
    ctx.drawImage(img, 0, 0)
    imageData = ctx.getImageData(0, 0, width, height)
  } catch {
    // Tainted canvas or out-of-memory: leave the original image untouched.
    return null
  }

  const data = imageData.data
  const pixelCount = width * height

  // ── Pass 1: flatten transparency onto white, sample for the background ──
  // Sampling stride keeps the estimate under ~250k pixels on large figures.
  const stride = Math.max(1, Math.floor(Math.sqrt(pixelCount / 250_000)))
  const bucketCounts = new Map<number, number>()
  const bucketSums = new Map<number, [number, number, number]>()
  let sampled = 0

  for (let y = 0; y < height; y++) {
    const rowStart = y * width
    for (let x = 0; x < width; x++) {
      const i = (rowStart + x) * 4
      const a = data[i + 3]
      if (a < 255) {
        const inv = 255 - a
        data[i] = Math.round((data[i] * a + 255 * inv) / 255)
        data[i + 1] = Math.round((data[i + 1] * a + 255 * inv) / 255)
        data[i + 2] = Math.round((data[i + 2] * a + 255 * inv) / 255)
        data[i + 3] = 255
      }
      if (y % stride !== 0 || x % stride !== 0) continue
      sampled++
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const min = Math.min(r, g, b)
      const max = Math.max(r, g, b)
      if (min < BG_CANDIDATE_MIN || max - min > BG_CANDIDATE_MAX_CHROMA) continue
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
      bucketCounts.set(key, (bucketCounts.get(key) || 0) + 1)
      const sums = bucketSums.get(key)
      if (sums) {
        sums[0] += r
        sums[1] += g
        sums[2] += b
      } else {
        bucketSums.set(key, [r, g, b])
      }
    }
  }

  let bestKey = -1
  let bestCount = 0
  bucketCounts.forEach((count, key) => {
    if (count > bestCount) {
      bestCount = count
      bestKey = key
    }
  })
  if (bestKey < 0 || sampled === 0 || bestCount / sampled < BG_MIN_COVERAGE) return null

  const sums = bucketSums.get(bestKey)!
  const bgR = Math.max(1, Math.round(sums[0] / bestCount))
  const bgG = Math.max(1, Math.round(sums[1] / bestCount))
  const bgB = Math.max(1, Math.round(sums[2] / bestCount))
  const luminance = 0.2126 * bgR + 0.7152 * bgG + 0.0722 * bgB
  if (luminance < BG_MIN_LUMINANCE) return null

  // ── Pass 2: per-channel white-point LUT, then snap near-white residue ──
  const lutR = new Uint8ClampedArray(256)
  const lutG = new Uint8ClampedArray(256)
  const lutB = new Uint8ClampedArray(256)
  for (let v = 0; v < 256; v++) {
    lutR[v] = Math.min(255, Math.round((v * 255) / bgR))
    lutG[v] = Math.min(255, Math.round((v * 255) / bgG))
    lutB[v] = Math.min(255, Math.round((v * 255) / bgB))
  }

  for (let i = 0; i < data.length; i += 4) {
    let r = lutR[data[i]]
    let g = lutG[data[i + 1]]
    let b = lutB[data[i + 2]]
    const min = Math.min(r, g, b)
    const max = Math.max(r, g, b)
    if (min >= SNAP_MIN && max - min <= SNAP_MAX_CHROMA) {
      r = 255
      g = 255
      b = 255
    }
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
  }

  ctx.putImageData(imageData, 0, 0)
  return { element: canvas, applied: true }
}
