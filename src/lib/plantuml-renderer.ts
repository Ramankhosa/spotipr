import crypto from 'crypto'
import plantumlEncoder from 'plantuml-encoder'

const ALLOWED_SKINPARAM_KEYS = /^skinparam\s+(backgroundColor|rectangleBackgroundColor|componentBackgroundColor|packageBackgroundColor|activityBackgroundColor|participantBackgroundColor|actorBackgroundColor|monochrome|shadowing|roundcorner|defaultFontName|defaultFontSize|ArrowColor|BorderColor|linetype|nodesep|ranksep|BorderThickness|PackageBorderThickness|PackageTitleFontStyle|RectanglePadding|PackagePadding|ArrowThickness)\b/i
const BANNED_SKINPARAM_PATTERNS = /^skinparam\s+(FontColor|.*Style(?!.*PackageTitleFontStyle))\b/i
const ALLOWED_SKINPARAM_BLOCKS = /^skinparam\s+(sequence|activity|rectangle|participant|package)\s*\{/i
const SKINPARAM_BLOCK_START = /^skinparam\s+\w+\s*(<<\w+>>)?\s*\{/i
const ORPHAN_SKINPARAM_BODY_PATTERNS = /^\s*(BorderStyle|BorderThickness|BorderColor|BackgroundColor|FontColor|FontSize|FontStyle|FontName|RoundCorner|Shadowing)\b/i

function countBraceDepthChange(line: string): number {
  let delta = 0
  for (const char of line) {
    if (char === '{') delta++
    else if (char === '}') delta--
  }
  return delta
}

function validateNoOrphanSkinparamLines(code: string): { valid: boolean; orphanLines: string[] } {
  const lines = code.split(/\r?\n/)
  const orphans: string[] = []
  let inValidBlock = false
  let braceDepth = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (ALLOWED_SKINPARAM_BLOCKS.test(trimmed)) {
      inValidBlock = true
      braceDepth = countBraceDepthChange(trimmed)
      continue
    }
    if (inValidBlock) {
      braceDepth += countBraceDepthChange(trimmed)
      if (braceDepth <= 0) {
        inValidBlock = false
        braceDepth = 0
      }
      continue
    }
    if (ORPHAN_SKINPARAM_BODY_PATTERNS.test(trimmed)) orphans.push(trimmed)
  }

  return { valid: orphans.length === 0, orphanLines: orphans }
}

export function cleanPlantUmlForRendering(code: string): string {
  const lines = code.split(/\r?\n/)
  const result: string[] = []
  let inAllowedBlock = false
  let skipBlock = false
  let braceDepth = 0

  for (const line of lines) {
    const trimmed = line.trim()

    if (skipBlock) {
      braceDepth += countBraceDepthChange(trimmed)
      if (braceDepth <= 0) {
        skipBlock = false
        braceDepth = 0
      }
      continue
    }

    if (inAllowedBlock) {
      braceDepth += countBraceDepthChange(trimmed)
      if (!BANNED_SKINPARAM_PATTERNS.test(trimmed) && !/^\s*FontColor\b/i.test(trimmed)) {
        result.push(line)
      }
      if (braceDepth <= 0) {
        inAllowedBlock = false
        braceDepth = 0
      }
      continue
    }

    if (/^\s*(title|caption)\b/i.test(trimmed)) continue
    if (/^\s*!\s*(theme|include|import|pragma)\b/i.test(trimmed)) continue
    if (/^\s*\d+\s*--\s*$/.test(trimmed)) continue

    if (SKINPARAM_BLOCK_START.test(trimmed)) {
      const headerBraceChange = countBraceDepthChange(trimmed)
      if (ALLOWED_SKINPARAM_BLOCKS.test(trimmed)) {
        inAllowedBlock = true
        braceDepth = headerBraceChange
        result.push(line)
        if (braceDepth <= 0) {
          inAllowedBlock = false
          braceDepth = 0
        }
      } else {
        skipBlock = true
        braceDepth = headerBraceChange
        if (braceDepth <= 0) {
          skipBlock = false
          braceDepth = 0
        }
      }
      continue
    }

    if (/^\s*skinparam\b/i.test(trimmed)) {
      if (BANNED_SKINPARAM_PATTERNS.test(trimmed)) continue
      if (ALLOWED_SKINPARAM_KEYS.test(trimmed)) result.push(line)
      continue
    }

    result.push(line)
  }

  const sanitizedOutput = result.join('\n')
  const validation = validateNoOrphanSkinparamLines(sanitizedOutput)
  return validation.valid
    ? sanitizedOutput
    : result.filter(line => !ORPHAN_SKINPARAM_BODY_PATTERNS.test(line.trim())).join('\n')
}

export async function renderPlantUml(code: string, format: 'svg' | 'png' = 'svg'): Promise<{
  buffer: Buffer
  checksum: string
  contentType: string
  cleaned: string
}> {
  const cleaned = cleanPlantUmlForRendering(code)
  const encoded = plantumlEncoder.encode(cleaned)
  const base = process.env.PLANTUML_BASE_URL || 'https://www.plantuml.com/plantuml'
  const url = `${base}/${format}/${encoded}`
  const resp = await fetch(url, {
    cache: 'no-store',
    method: 'GET',
    headers: { Accept: format === 'svg' ? 'image/svg+xml' : 'image/png' }
  })
  if (!resp.ok) {
    const details = await resp.text().catch(() => '')
    const error = new Error('Upstream render failed') as Error & { upstreamStatus?: number; details?: string; cleaned?: string }
    error.upstreamStatus = resp.status
    error.details = details.slice(0, 300)
    error.cleaned = cleaned
    throw error
  }
  const buffer = Buffer.from(await resp.arrayBuffer())
  return {
    buffer,
    checksum: crypto.createHash('sha256').update(buffer).digest('hex'),
    contentType: format === 'svg' ? 'image/svg+xml' : 'image/png',
    cleaned
  }
}
