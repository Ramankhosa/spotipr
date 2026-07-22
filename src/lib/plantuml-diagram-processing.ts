import { compilePatentDiagramStyle } from '@/lib/patent-diagrams/style'

const SKINPARAM_BLOCK_START = /^skinparam\s+\w+\s*(<<\w+>>)?\s*\{/i
const ORPHAN_SKINPARAM_BODY_PATTERNS = /^\s*(BorderStyle|BorderThickness|BorderColor|BackgroundColor|FontColor|FontSize|FontStyle|FontName|RoundCorner|Shadowing)\b/i
const FIXED_SKINPARAM_BLOCK = compilePatentDiagramStyle()

function extractPlantUmlBlock(text: string): string {
  const full = text.match(/@startuml[\s\S]*?@enduml/i)
  if (full) return full[0]
  const start = text.search(/@startuml/i)
  return start >= 0 ? text.slice(start) : text
}

function countBraceDepthChange(line: string): number {
  let delta = 0
  for (const char of line) {
    if (char === '{') delta++
    else if (char === '}') delta--
  }
  return delta
}

/**
 * Removes presentation and executable directives while preserving semantic
 * declarations and relationships. Raw validation happens before this function;
 * this is the one renderer-facing source sanitizer.
 */
export function sanitizePlantUMLForProcessing(input: string): string {
  const lines = extractPlantUmlBlock(input).split(/\r?\n/)
  const result: string[] = []
  let skipSkinparamBlock = false
  let braceDepth = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (skipSkinparamBlock) {
      braceDepth += countBraceDepthChange(trimmed)
      if (braceDepth <= 0) {
        skipSkinparamBlock = false
        braceDepth = 0
      }
      continue
    }
    if (/^\s*skinparam\b/i.test(trimmed)) {
      if (SKINPARAM_BLOCK_START.test(trimmed)) {
        skipSkinparamBlock = true
        braceDepth = countBraceDepthChange(trimmed)
      }
      continue
    }
    if (/^\s*!\s*(theme|include|import|pragma|define|function|procedure|unquoted|startsub|endsub)\b/i.test(trimmed)) continue
    if (/^\s*(title|caption)\b/i.test(trimmed)) continue
    if (ORPHAN_SKINPARAM_BODY_PATTERNS.test(trimmed)) continue
    result.push(line)
  }
  return result.join('\n').trim()
}

/** Injects the immutable PatentNest filing style exactly once. */
export function injectFixedPlantUmlSkinparams(plantuml: string): string {
  const result: string[] = []
  let injected = false
  for (const line of plantuml.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (/^\s*skinparam\b/i.test(trimmed)) continue
    if (trimmed.toLowerCase() === '@startuml' && !injected) {
      result.push(line, FIXED_SKINPARAM_BLOCK, '')
      injected = true
      continue
    }
    result.push(line)
  }
  return result.join('\n').trim()
}
