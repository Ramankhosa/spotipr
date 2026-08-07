/**
 * Figure image resolution, shared by the specification export and the Drawings annexure.
 *
 * Figures are written to several locations depending on how they were produced (generated
 * diagrams, sketches, uploads), so finding one means trying an ordered list of candidates.
 * Both exports resolve through here so the annexure embeds byte-identical images to the
 * ones the specification would have shown — the whole point of moving figures out of the
 * spec is that they are the SAME figures in a different document.
 */

import { promises as fs } from 'fs'
import path from 'path'
import { imageSize } from 'image-size'

export interface FigureRef {
  figureNo: number
  caption?: string
  title?: string
  imagePath?: string | null
  imageFilename?: string | null
  type?: string
}

/**
 * Ordered candidate paths for a figure's image file. Order matters: an explicit stored path
 * wins over a conventional location.
 */
export function figureImageCandidates(
  figure: FigureRef,
  ctx: { patentId: string; projectId?: string | null }
): string[] {
  const candidates: string[] = []

  if (figure.imagePath) {
    const normalizedPath = path.isAbsolute(figure.imagePath)
      ? figure.imagePath
      : path.join(process.cwd(), figure.imagePath.replace(/^[/\\]+/, ''))
    candidates.push(normalizedPath)
    if (figure.imagePath.startsWith('/uploads/')) {
      candidates.push(path.join(process.cwd(), 'public', figure.imagePath.replace(/^[/\\]+/, '')))
    }
  }

  if (figure.imageFilename) {
    candidates.push(path.join(process.cwd(), 'uploads', 'patents', ctx.patentId, 'figures', figure.imageFilename))
    if (ctx.projectId) {
      candidates.push(path.join(process.cwd(), 'uploads', 'projects', ctx.projectId, 'patents', ctx.patentId, 'figures', figure.imageFilename))
    }
    // Sketches are written under public/uploads/sketches.
    if (figure.type === 'sketch') {
      candidates.push(path.join(process.cwd(), 'public', 'uploads', 'sketches', figure.imageFilename))
    }
  }

  return candidates.filter(Boolean)
}

export interface LoadedFigureImage {
  buffer: Buffer
  sourcePath: string
  /** Intrinsic pixel dimensions, measured from the bytes. Never guessed. */
  width: number | null
  height: number | null
}

/**
 * Read the first candidate that exists. Returns null rather than throwing — a missing image
 * must not take down an export that is otherwise valid; the caller reports which figures
 * were skipped.
 *
 * Dimensions are measured from the file itself rather than trusting stored metadata, which
 * can be null or stale after a figure is regenerated. Getting this wrong is what distorts a
 * drawing: without true dimensions the renderer has to assume a ratio, and any figure that
 * is not that ratio gets stretched.
 */
export async function loadFigureImage(
  figure: FigureRef,
  ctx: { patentId: string; projectId?: string | null }
): Promise<LoadedFigureImage | null> {
  for (const candidatePath of figureImageCandidates(figure, ctx)) {
    try {
      const buffer = await fs.readFile(candidatePath)
      const { width, height } = measureImage(buffer)
      return { buffer, sourcePath: candidatePath, width, height }
    } catch {
      // try the next candidate
    }
  }
  return null
}

/**
 * Intrinsic pixel size of an image buffer, honouring EXIF orientation.
 *
 * A JPEG photographed sideways reports its pre-rotation dimensions; orientations 5-8 mean
 * the rendered image is rotated a quarter turn, so width and height must swap or the figure
 * comes out stretched the wrong way round.
 */
export function measureImage(buffer: Buffer): { width: number | null; height: number | null } {
  try {
    const dims = imageSize(buffer)
    if (!dims?.width || !dims?.height) return { width: null, height: null }
    const rotated = typeof dims.orientation === 'number' && dims.orientation >= 5 && dims.orientation <= 8
    return rotated
      ? { width: dims.height, height: dims.width }
      : { width: dims.width, height: dims.height }
  } catch {
    return { width: null, height: null }
  }
}

export function imageTypeFor(filePath: string): 'png' | 'jpg' {
  return /\.jpe?g$/i.test(filePath) ? 'jpg' : 'png'
}
