import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { whitenToPaperWhite } from '../whiten'

// whitenToPaperWhite only touches document.createElement('canvas') and the 2d
// context's drawImage/getImageData/putImageData, so a small stub lets the real
// pixel pipeline run under node without a DOM canvas implementation.

type StubImage = { naturalWidth: number; naturalHeight: number; data: Uint8ClampedArray }

let putData: Uint8ClampedArray | null = null

function makeImage(width: number, height: number, fill: [number, number, number, number]): StubImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0]
    data[i + 1] = fill[1]
    data[i + 2] = fill[2]
    data[i + 3] = fill[3]
  }
  return { naturalWidth: width, naturalHeight: height, data }
}

function setPixel(img: StubImage, x: number, y: number, rgba: [number, number, number, number]) {
  const i = (y * img.naturalWidth + x) * 4
  img.data[i] = rgba[0]
  img.data[i + 1] = rgba[1]
  img.data[i + 2] = rgba[2]
  img.data[i + 3] = rgba[3]
}

function pixelAt(data: Uint8ClampedArray, width: number, x: number, y: number) {
  const i = (y * width + x) * 4
  return [data[i], data[i + 1], data[i + 2], data[i + 3]]
}

class FakeCanvas {
  width = 0
  height = 0
  private source: StubImage | null = null

  getContext(kind: string) {
    if (kind !== '2d') return null
    return {
      drawImage: (img: StubImage) => {
        this.source = img
      },
      getImageData: (_x: number, _y: number, w: number, h: number) => {
        if (!this.source) throw new Error('nothing drawn')
        return { data: this.source.data.slice(), width: w, height: h }
      },
      putImageData: (imageData: { data: Uint8ClampedArray }) => {
        putData = imageData.data
      }
    }
  }
}

beforeEach(() => {
  putData = null
  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      if (tag !== 'canvas') throw new Error(`unexpected createElement(${tag})`)
      return new FakeCanvas()
    }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('whitenToPaperWhite', () => {
  it('rescales a cream background to pure white and keeps line work dark', () => {
    // Cream/ivory background typical of AI-generated sketches.
    const img = makeImage(40, 40, [250, 243, 227, 255])
    // Black line pixels.
    setPixel(img, 10, 10, [0, 0, 0, 255])
    setPixel(img, 11, 10, [20, 18, 15, 255])
    // Mid-gray anti-aliasing pixel.
    setPixel(img, 12, 10, [128, 124, 114, 255])

    const result = whitenToPaperWhite(img as unknown as HTMLImageElement)
    expect(result?.applied).toBe(true)
    expect(putData).not.toBeNull()

    const bg = pixelAt(putData!, 40, 0, 0)
    expect(bg).toEqual([255, 255, 255, 255])

    const black = pixelAt(putData!, 40, 10, 10)
    expect(black).toEqual([0, 0, 0, 255])

    // Anti-aliased grays scale proportionally instead of blowing out.
    const aa = pixelAt(putData!, 40, 12, 10)
    expect(aa[0]).toBeGreaterThan(120)
    expect(aa[0]).toBeLessThan(150)
    expect(aa[3]).toBe(255)
  })

  it('snaps the legacy #F8F8F8 package fill to white inside a pure-white diagram', () => {
    const img = makeImage(40, 40, [255, 255, 255, 255])
    for (let y = 5; y < 15; y++) {
      for (let x = 5; x < 15; x++) {
        setPixel(img, x, y, [248, 248, 248, 255])
      }
    }

    const result = whitenToPaperWhite(img as unknown as HTMLImageElement)
    expect(result?.applied).toBe(true)
    expect(pixelAt(putData!, 40, 10, 10)).toEqual([255, 255, 255, 255])
    expect(pixelAt(putData!, 40, 0, 0)).toEqual([255, 255, 255, 255])
  })

  it('flattens transparency onto white before normalizing', () => {
    const img = makeImage(20, 20, [255, 255, 255, 255])
    // Fully transparent pixel should become opaque white.
    setPixel(img, 3, 3, [0, 0, 0, 0])
    // Half-transparent black becomes mid gray over white.
    setPixel(img, 4, 4, [0, 0, 0, 128])

    const result = whitenToPaperWhite(img as unknown as HTMLImageElement)
    expect(result?.applied).toBe(true)
    expect(pixelAt(putData!, 20, 3, 3)).toEqual([255, 255, 255, 255])
    const half = pixelAt(putData!, 20, 4, 4)
    expect(half[3]).toBe(255)
    expect(half[0]).toBeGreaterThan(100)
    expect(half[0]).toBeLessThan(150)
  })

  it('leaves images without a dominant light background untouched', () => {
    const dark = makeImage(30, 30, [40, 40, 40, 255])
    expect(whitenToPaperWhite(dark as unknown as HTMLImageElement)).toBeNull()

    // A saturated blue background is light-ish but not paper; guard rejects it.
    const blue = makeImage(30, 30, [120, 150, 240, 255])
    expect(whitenToPaperWhite(blue as unknown as HTMLImageElement)).toBeNull()
  })

  it('returns null for zero-sized images', () => {
    const empty = { naturalWidth: 0, naturalHeight: 0, data: new Uint8ClampedArray(0) }
    expect(whitenToPaperWhite(empty as unknown as HTMLImageElement)).toBeNull()
  })
})
