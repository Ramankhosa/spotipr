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

/**
 * Read the first candidate that exists. Returns null rather than throwing — a missing image
 * must not take down an export that is otherwise valid; the caller reports which figures
 * were skipped.
 */
export async function loadFigureImage(
  figure: FigureRef,
  ctx: { patentId: string; projectId?: string | null }
): Promise<{ buffer: Buffer; sourcePath: string } | null> {
  for (const candidatePath of figureImageCandidates(figure, ctx)) {
    try {
      const buffer = await fs.readFile(candidatePath)
      return { buffer, sourcePath: candidatePath }
    } catch {
      // try the next candidate
    }
  }
  return null
}

export function imageTypeFor(filePath: string): 'png' | 'jpg' {
  return /\.jpe?g$/i.test(filePath) ? 'jpg' : 'png'
}
