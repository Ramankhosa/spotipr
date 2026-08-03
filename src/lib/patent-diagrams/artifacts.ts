import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { renderPlantUml } from '@/lib/plantuml-renderer'
import { PATENT_DIAGRAM_STYLE } from './style'
import { PATENT_DIAGRAM_COMPLEXITY } from './policy'
import type { DiagramRenderArtifacts } from './types'

export interface DiagramPagePolicy {
  paperSize: string
  marginTopCm: number
  marginBottomCm: number
  marginLeftCm: number
  marginRightCm: number
  minimumTextSizePt: number
}

export const DEFAULT_DIAGRAM_PAGE_POLICY: Readonly<DiagramPagePolicy> = Object.freeze({
  paperSize: 'A4',
  marginTopCm: 2.5,
  marginBottomCm: 1,
  marginLeftCm: 2.5,
  marginRightCm: 1.5,
  minimumTextSizePt: PATENT_DIAGRAM_COMPLEXITY.absoluteMinimumTextSizePt,
})

function paperDimensionsCm(paperSize: string): { width: number; height: number } {
  return String(paperSize).toUpperCase() === 'LETTER'
    ? { width: 21.59, height: 27.94 }
    : { width: 21, height: 29.7 }
}

export function effectivePageFitFontSize(
  svgWidth: number | undefined,
  svgHeight: number | undefined,
  policy: DiagramPagePolicy = DEFAULT_DIAGRAM_PAGE_POLICY,
): number | undefined {
  if (!svgWidth || !svgHeight) return undefined
  const paper = paperDimensionsCm(policy.paperSize)
  const printableWidthPx = Math.max(1, paper.width - policy.marginLeftCm - policy.marginRightCm) / 2.54 * 96
  const printableHeightPx = Math.max(1, paper.height - policy.marginTopCm - policy.marginBottomCm) / 2.54 * 96
  const scale = Math.min(1, printableWidthPx / svgWidth, printableHeightPx / svgHeight)
  return PATENT_DIAGRAM_STYLE.baseFontSize * 0.75 * scale
}

export async function resolveDiagramPagePolicy(countryCode: string): Promise<DiagramPagePolicy & { maximumElementsByType: Record<string, number> }> {
  const { prisma } = await import('@/lib/prisma')
  const config = await prisma.countryDiagramConfig.findUnique({
    where: { countryCode },
    include: { diagramHints: true },
  })
  if (!config) return { ...DEFAULT_DIAGRAM_PAGE_POLICY, maximumElementsByType: {} }
  return {
    paperSize: config.paperSize,
    marginTopCm: config.drawingMarginTopCm,
    marginBottomCm: config.drawingMarginBottomCm,
    marginLeftCm: config.drawingMarginLeftCm,
    marginRightCm: config.drawingMarginRightCm,
    minimumTextSizePt: Math.max(PATENT_DIAGRAM_COMPLEXITY.absoluteMinimumTextSizePt, config.minReferenceTextSizePt),
    maximumElementsByType: Object.fromEntries(config.diagramHints.flatMap(hint => hint.maxElements == null ? [] : [[hint.diagramType.toUpperCase(), hint.maxElements]])),
  }
}

export async function renderAndWriteDiagramArtifacts(input: {
  patentId: string
  figureNo: number
  language?: string
  plantumlCode: string
  pagePolicy?: DiagramPagePolicy
  // Managed/raw-override sources enforce filing SVG constraints; legacy
  // (IMPORTED_*) sources render best-effort because pre-migration dialects
  // emit grays that no injected skinparam fully overrides.
  enforceFilingSvg?: boolean
}): Promise<{
  artifacts: DiagramRenderArtifacts
  svg: Awaited<ReturnType<typeof renderPlantUml>>
  png: Awaited<ReturnType<typeof renderPlantUml>>
  effectiveFontSizePt?: number
}> {
  const [svg, png] = await Promise.all([
    renderPlantUml(input.plantumlCode, 'svg', { enforceFilingSvg: input.enforceFilingSvg !== false }),
    renderPlantUml(input.plantumlCode, 'png'),
  ])
  const baseDir = path.join(process.cwd(), 'uploads', 'patents', input.patentId, 'figures')
  await fs.mkdir(baseDir, { recursive: true })
  const suffix = input.language && input.language !== 'en' ? `_${input.language}` : ''
  // Unique names keep the new render isolated until its database transaction
  // commits; an older exported artifact is never overwritten in place.
  const stamp = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`
  const svgFilename = `figure_${input.figureNo}${suffix}_${stamp}.svg`
  const pngFilename = `figure_${input.figureNo}${suffix}_${stamp}.png`
  const svgPath = path.join(baseDir, svgFilename)
  const pngPath = path.join(baseDir, pngFilename)
  try {
    await Promise.all([fs.writeFile(svgPath, svg.buffer), fs.writeFile(pngPath, png.buffer)])
  } catch (error) {
    await Promise.allSettled([fs.unlink(svgPath), fs.unlink(pngPath)])
    throw error
  }
  const artifacts: DiagramRenderArtifacts = {
    svg: { filename: svgFilename, path: svgPath, checksum: svg.checksum, contentType: svg.contentType, width: svg.width, height: svg.height },
    png: { filename: pngFilename, path: pngPath, checksum: png.checksum, contentType: png.contentType },
  }
  return {
    artifacts,
    svg,
    png,
    effectiveFontSizePt: effectivePageFitFontSize(svg.width, svg.height, input.pagePolicy),
  }
}
