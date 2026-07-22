import crypto from 'crypto'
import plantumlEncoder from 'plantuml-encoder'
import {
  injectFixedPlantUmlSkinparams,
  sanitizePlantUMLForProcessing,
} from '@/lib/plantuml-diagram-processing'

const DEFAULT_PUBLIC_PLANTUML_URL = 'https://www.plantuml.com/plantuml'
const DEFAULT_RENDER_TIMEOUT_MS = 20_000
const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024

export interface RenderedSvgInspection {
  width?: number
  height?: number
  viewBox?: string
  aspectRatio?: number
  colors: string[]
  elementBounds: Record<string, { x?: number; y?: number; width: number; height: number; strokeWidth?: number }>
}

function numericSvgDimension(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

export function inspectRenderedSvg(svg: string): RenderedSvgInspection {
  const root = svg.match(/<svg\b([^>]*)>/i)?.[1] || ''
  const width = numericSvgDimension(root.match(/\bwidth=["']([^"']+)/i)?.[1])
  const height = numericSvgDimension(root.match(/\bheight=["']([^"']+)/i)?.[1])
  const viewBox = root.match(/\bviewBox=["']([^"']+)/i)?.[1]
  let viewBoxWidth: number | undefined
  let viewBoxHeight: number | undefined
  if (viewBox) {
    const values = viewBox.trim().split(/[\s,]+/).map(Number)
    if (values.length === 4 && values.every(Number.isFinite)) {
      viewBoxWidth = values[2]
      viewBoxHeight = values[3]
    }
  }
  const resolvedWidth = width || viewBoxWidth
  const resolvedHeight = height || viewBoxHeight
  const colors = Array.from(new Set((svg.match(/#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi) || []).map(color => {
    const upper = color.toUpperCase()
    return upper.length === 4
      ? `#${upper[1]}${upper[1]}${upper[2]}${upper[2]}${upper[3]}${upper[3]}`
      : upper
  })))
  const elementBounds: Record<string, { x?: number; y?: number; width: number; height: number; strokeWidth?: number }> = {}
  const entityPattern = /<g\b((?=[^>]*\bclass=["'](?:entity|cluster)["'])[^>]*)>([\s\S]*?)<\/g>/gi
  let entityMatch: RegExpExecArray | null
  while ((entityMatch = entityPattern.exec(svg))) {
    const attributes = entityMatch[1]
    const qualifiedName = attributes.match(/\bdata-qualified-name=["']([^"']+)["']/i)?.[1]
    const legacyName = attributes.match(/\bid=["']elem_([^"']+)["']/i)?.[1]
    const alias = (qualifiedName?.split('.').pop() || legacyName || '').trim()
    if (!alias) continue
    const rect = entityMatch[2].match(/<rect\b[^>]*>/i)?.[0]
    if (!rect) continue
    const width = Number(rect.match(/\bwidth=["'](-?[0-9.]+)["']/i)?.[1])
    const height = Number(rect.match(/\bheight=["'](-?[0-9.]+)["']/i)?.[1])
    const x = Number(rect.match(/\bx=["'](-?[0-9.]+)["']/i)?.[1])
    const y = Number(rect.match(/\by=["'](-?[0-9.]+)["']/i)?.[1])
    const strokeWidth = Number(
      rect.match(/\bstroke-width=["'](-?[0-9.]+)["']/i)?.[1]
      || rect.match(/\bstroke-width\s*:\s*(-?[0-9.]+)/i)?.[1],
    )
    if (width > 0 && height > 0) elementBounds[alias] = {
      width,
      height,
      ...(Number.isFinite(x) ? { x } : {}),
      ...(Number.isFinite(y) ? { y } : {}),
      ...(Number.isFinite(strokeWidth) ? { strokeWidth } : {}),
    }
  }
  return {
    width: resolvedWidth,
    height: resolvedHeight,
    viewBox,
    aspectRatio: resolvedWidth && resolvedHeight ? resolvedWidth / resolvedHeight : undefined,
    colors,
    elementBounds,
  }
}

export const EXTREME_ASPECT_RATIO_MAXIMUM = 6
export const EXTREME_ASPECT_RATIO_MINIMUM = 0.15

export function validateRenderedPatentSvg(svg: string): { valid: boolean; errors: string[]; warnings: string[]; inspection: RenderedSvgInspection } {
  const inspection = inspectRenderedSvg(svg)
  const errors: string[] = []
  const warnings: string[] = []
  if (!/<svg\b/i.test(svg)) errors.push('Renderer did not return an SVG document')
  if (!inspection.viewBox) errors.push('Rendered SVG has no viewBox')
  if (!inspection.width || !inspection.height) errors.push('Rendered SVG has invalid dimensions')
  const prohibitedColors = inspection.colors.filter(color => color !== '#000000' && color !== '#FFFFFF')
  if (prohibitedColors.length) errors.push(`Rendered SVG contains non-filing colors: ${prohibitedColors.join(', ')}`)
  // Aspect ratio is a layout-quality signal, not a validity one — page fit is
  // measured directly by effectivePageFitFontSize. Failing the render here
  // would kill a figure that is merely wide, and would do it below the layer
  // that can downgrade it, so it is reported rather than thrown.
  if (inspection.aspectRatio && (inspection.aspectRatio > EXTREME_ASPECT_RATIO_MAXIMUM || inspection.aspectRatio < EXTREME_ASPECT_RATIO_MINIMUM)) {
    warnings.push(`Rendered SVG aspect ratio ${inspection.aspectRatio.toFixed(2)} is outside the preferred filing range`)
  }
  return { valid: errors.length === 0, errors, warnings, inspection }
}

export function cleanPlantUmlForRendering(code: string): string {
  const semanticSource = sanitizePlantUMLForProcessing(code)
  return injectFixedPlantUmlSkinparams(semanticSource)
}

let warnedPublicPlantUmlInProduction = false

function plantUmlBaseUrl(): string {
  const configured = String(process.env.PLANTUML_BASE_URL || '').trim().replace(/\/$/, '')
  if (configured) return configured
  const publicAllowed = String(process.env.ALLOW_PUBLIC_PLANTUML || '').trim().toLowerCase() === 'true'
  if (process.env.NODE_ENV === 'production' && !publicAllowed && !warnedPublicPlantUmlInProduction) {
    // Deploys must not hard-break rendering; self-hosting stays a recommendation
    // until PLANTUML_BASE_URL is provisioned. Diagram content reaches the public
    // server in decodable URLs, so this stays a loud, once-per-process warning.
    warnedPublicPlantUmlInProduction = true
    console.warn('[PlantUML] Using the public plantuml.com server in production. Set PLANTUML_BASE_URL to a private renderer to keep diagram content confidential.')
  }
  return DEFAULT_PUBLIC_PLANTUML_URL
}

export interface RenderPlantUmlOptions {
  // When true, a rendered SVG that violates filing constraints (non-monochrome
  // colors, missing dimensions, extreme aspect ratio) is a hard error. Managed
  // and raw-override figures enforce this; legacy/preview renders must not,
  // because pre-migration PlantUML dialects (activity beta) emit grays that no
  // skinparam fully overrides.
  enforceFilingSvg?: boolean
}

export async function renderPlantUml(code: string, format: 'svg' | 'png' = 'svg', options: RenderPlantUmlOptions = {}): Promise<{
  buffer: Buffer
  checksum: string
  contentType: string
  cleaned: string
  width?: number
  height?: number
  viewBox?: string
  elementBounds?: Record<string, { x?: number; y?: number; width: number; height: number; strokeWidth?: number }>
}> {
  const cleaned = cleanPlantUmlForRendering(code)
  const encoded = plantumlEncoder.encode(cleaned)
  const url = `${plantUmlBaseUrl()}/${format}/${encoded}`
  const timeoutMs = Math.max(1_000, Number(process.env.PLANTUML_RENDER_TIMEOUT_MS || DEFAULT_RENDER_TIMEOUT_MS))
  const maxBytes = Math.max(1024, Number(process.env.PLANTUML_RENDER_MAX_BYTES || DEFAULT_MAX_RESPONSE_BYTES))
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  let resp: Response
  try {
    resp = await fetch(url, {
      cache: 'no-store',
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: format === 'svg' ? 'image/svg+xml' : 'image/png' },
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error(`PlantUML render timed out after ${timeoutMs} ms`)
    throw error
  } finally {
    clearTimeout(timeout)
  }

  if (!resp.ok) {
    const details = await resp.text().catch(() => '')
    const error = new Error(`PlantUML render failed with HTTP ${resp.status}`) as Error & { upstreamStatus?: number; details?: string; cleaned?: string }
    error.upstreamStatus = resp.status
    error.details = details.slice(0, 1000)
    error.cleaned = cleaned
    throw error
  }

  const declaredLength = Number(resp.headers.get('content-length') || 0)
  if (declaredLength > maxBytes) throw new Error(`PlantUML response exceeds ${maxBytes} bytes`)
  const buffer = Buffer.from(await resp.arrayBuffer())
  if (!buffer.length) throw new Error('PlantUML renderer returned an empty response')
  if (buffer.length > maxBytes) throw new Error(`PlantUML response exceeds ${maxBytes} bytes`)

  const receivedType = String(resp.headers.get('content-type') || '').toLowerCase()
  const expectedType = format === 'svg' ? 'image/svg+xml' : 'image/png'
  if (receivedType && !receivedType.includes(expectedType)) {
    throw new Error(`PlantUML returned ${receivedType}; expected ${expectedType}`)
  }

  let dimensions: { width?: number; height?: number; viewBox?: string; elementBounds?: Record<string, { x?: number; y?: number; width: number; height: number; strokeWidth?: number }> } = {}
  if (format === 'svg') {
    const svg = buffer.toString('utf8')
    const validation = validateRenderedPatentSvg(svg)
    if (options.enforceFilingSvg && !validation.valid) throw new Error(validation.errors.join('; '))
    dimensions = validation.inspection
  } else {
    const signature = buffer.subarray(0, 8).toString('hex')
    if (signature !== '89504e470d0a1a0a') throw new Error('PlantUML returned an invalid PNG payload')
  }

  return {
    buffer,
    checksum: crypto.createHash('sha256').update(buffer).digest('hex'),
    contentType: expectedType,
    cleaned,
    ...dimensions,
  }
}
