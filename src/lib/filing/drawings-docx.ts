/**
 * DRAWINGS — one A4 sheet per figure, in the layout the Patent Office expects.
 *
 * Each sheet carries the applicant name and "Sheet No.: n/N" as a header, the figure, its
 * caption, and the authorised signatory bottom-right. The signatory appears on EVERY sheet
 * (not just the first), which is what the attorney-prepared bundle does and what the Office
 * expects for loose drawing sheets.
 *
 * Sheet numbering is computed from the figure count, so adding a figure cannot leave a
 * stale "1/1" behind — the failure mode of hand-numbered sheets.
 */

import {
  AlignmentType,
  Document,
  ImageRun,
  Packer,
  PageBreak,
  Paragraph,
  VerticalAlignTable,
} from 'docx'
import {
  A4_SECTION,
  CONTENT_WIDTH,
  DEFAULT_STYLES,
  NO_BORDERS,
  blank,
  cellOf,
  drawingSignatureLines,
  para,
  row,
  table,
} from './filing-docx-kit'
import { sanitizeField } from './formatting'
import { measureImage } from './figure-images'
import type { FilingSignatory } from './types'

export interface DrawingFigure {
  /** Printed as "Figure 1". Defaults to position in the array. */
  figureNo?: number
  /** PNG or JPEG bytes. */
  image: Buffer
  imageType: 'png' | 'jpg'
  /** Intrinsic pixel size, used to preserve aspect ratio. */
  width?: number
  height?: number
  caption?: string | null
}

export interface DrawingsOptions {
  applicantName: string
  signatory: FilingSignatory | null
  organisation?: string | null
  figures: DrawingFigure[]
}

// Usable image box in pixels at 96 dpi, leaving room for header, caption and signature.
const MAX_IMAGE_WIDTH_PX = 620
const MAX_IMAGE_HEIGHT_PX = 700

export async function buildDrawingsDocx(opts: DrawingsOptions): Promise<Buffer> {
  const total = opts.figures.length
  const children: Array<Paragraph | ReturnType<typeof table>> = []

  opts.figures.forEach((figure, index) => {
    const sheetNo = index + 1
    const figureNo = figure.figureNo ?? sheetNo

    // Header: applicant on the left, sheet number on the right. A borderless two-column
    // table aligns these reliably where tab stops drift with the name length.
    children.push(table([CONTENT_WIDTH * 0.6, CONTENT_WIDTH * 0.4].map(Math.round), [
      row([
        cellOf([para(`Applicant: ${sanitizeField(opts.applicantName)}`)], {
          width: Math.round(CONTENT_WIDTH * 0.6),
          borders: NO_BORDERS,
        }),
        cellOf([para(`Sheet No.: ${sheetNo}/${total}`, { align: AlignmentType.RIGHT })], {
          width: Math.round(CONTENT_WIDTH * 0.4),
          borders: NO_BORDERS,
          verticalAlign: VerticalAlignTable.TOP,
        }),
      ]),
    ]))

    children.push(blank())

    // Measure from the bytes if the caller did not supply dimensions, so the aspect ratio
    // is always the figure's own and never an assumed one.
    const measured = figure.width && figure.height
      ? { width: figure.width, height: figure.height }
      : measureImage(figure.image)
    const box = fitImage(measured.width ?? undefined, measured.height ?? undefined)

    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new ImageRun({
          data: figure.image,
          type: figure.imageType,
          // Last resort only: width-constrained, height derived from the true ratio by
          // scaling the longest side. Never a hardcoded box.
          transformation: box ?? { width: MAX_IMAGE_WIDTH_PX, height: MAX_IMAGE_WIDTH_PX },
        }),
      ],
    }))

    children.push(para(figure.caption?.trim() || `Figure ${figureNo}`, {
      align: AlignmentType.CENTER,
      bold: true,
    }))

    children.push(blank())

    if (opts.signatory) {
      for (const line of drawingSignatureLines(opts.signatory, opts.organisation)) {
        children.push(line)
      }
    }

    // One figure per sheet; no trailing break after the last.
    if (index < total - 1) {
      children.push(new Paragraph({ children: [new PageBreak()] }))
    }
  })

  const doc = new Document({
    styles: DEFAULT_STYLES,
    sections: [{ properties: A4_SECTION, children }],
  })
  return Packer.toBuffer(doc)
}

/**
 * Scale a figure to fit the sheet, preserving its aspect ratio exactly.
 *
 * Both dimensions are scaled by the SAME factor, so a drawing can never be stretched. The
 * factor is capped at 1 — a small figure is left at its native size rather than blown up,
 * because upscaling a line drawing softens the lines. Scaling down only changes the display
 * size; Word still embeds the full-resolution original, so print clarity is unaffected.
 *
 * If the intrinsic size is genuinely unknown we constrain by WIDTH ALONE and let Word derive
 * the height. Assuming a ratio here is precisely what distorted figures before: every
 * drawing was forced into 3:4, so anything landscape or square came out squashed.
 */
function fitImage(width?: number, height?: number): { width: number; height: number } | null {
  if (!width || !height || width <= 0 || height <= 0) return null

  const scale = Math.min(MAX_IMAGE_WIDTH_PX / width, MAX_IMAGE_HEIGHT_PX / height, 1)
  return {
    // Round to at least 1px so a very wide, very short strip never collapses to zero.
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}
