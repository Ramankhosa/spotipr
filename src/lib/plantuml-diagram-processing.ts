export type PlantUmlValidationError = { type: string; message: string; line?: number }

export type PlantUmlRepairResult = {
  ok: boolean
  code?: string
  repaired: boolean
  errors?: PlantUmlValidationError[]
}

export type PlantUmlRepairFn = (args: {
  code: string
  validationErrors: PlantUmlValidationError[]
  figureTitle?: string
  description?: string
  numerals?: string[]
  plantumlErrorText?: string
  requestHeaders?: Record<string, string>
}) => Promise<PlantUmlRepairResult>

export type RepairSummary = {
  attempted: number
  repaired: number
  failed: number
}

export type ProcessedPlantUmlResult = {
  ok: boolean
  code?: string
  repaired: boolean
  repairReason?: string
  errors?: PlantUmlValidationError[]
  warnings: string[]
  repairSummary: RepairSummary
}

export type ProcessPlantUmlOptions = {
  rawCode: string
  diagramType?: string
  figureTitle?: string
  description?: string
  numerals?: string[]
  plantumlErrorText?: string
  requestHeaders?: Record<string, string>
  forceRepair?: boolean
  repair?: PlantUmlRepairFn
}

const FORBIDDEN_PLANTUML_KEYWORDS = /\b(if|else|endif|alt|loop|fork|repeat|while|switch|note|box|title|caption)\b/i
const SKINPARAM_BLOCK_START = /^skinparam\s+\w+\s*(<<\w+>>)?\s*\{/i
const ORPHAN_SKINPARAM_BODY_PATTERNS = /^\s*(BorderStyle|BorderThickness|BorderColor|BackgroundColor|FontColor|FontSize|FontStyle|FontName|RoundCorner|Shadowing)\b/i

const FIXED_SKINPARAM_BLOCK = `skinparam shadowing false
skinparam defaultFontName Arial
skinparam defaultFontSize 12
skinparam ArrowColor #000000
skinparam linetype ortho
skinparam nodesep 30
skinparam ranksep 30
skinparam rectangle {
  BackgroundColor #FFFFFF
  BorderColor #000000
}
skinparam package {
  BackgroundColor #F8F8F8
  BorderColor #000000
}
skinparam activity {
  BackgroundColor #FFFFFF
  BorderColor #000000
}
skinparam participant {
  BackgroundColor #FFFFFF
  BorderColor #000000
}`

const DIAGRAM_HARD_CAPS: Record<string, { maxElements: number }> = {
  BLOCK: { maxElements: 10 },
  FLOW: { maxElements: 8 },
  ACTIVITY: { maxElements: 8 },
  SEQUENCE: { maxElements: 5 },
  CONSTITUENT: { maxElements: 10 },
}

const SEQUENCE_MAX_MESSAGES = 12

export function emptyRepairSummary(): RepairSummary {
  return { attempted: 0, repaired: 0, failed: 0 }
}

export function mergeRepairSummary(target: RepairSummary, source?: Partial<RepairSummary> | null): RepairSummary {
  if (!source) return target
  target.attempted += source.attempted || 0
  target.repaired += source.repaired || 0
  target.failed += source.failed || 0
  return target
}

export function containsForbiddenPlantUmlKeywords(plantuml: string): { hasForbidden: boolean; matches: string[] } {
  const matches: string[] = []

  for (const line of plantuml.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith("'") || trimmed.startsWith('//')) continue

    const lineWithoutQuotes = trimmed
      .replace(/"[^"]*"/g, '""')
      .replace(/'[^']*'/g, "''")

    const match = lineWithoutQuotes.match(FORBIDDEN_PLANTUML_KEYWORDS)
    if (match) matches.push(match[0])
  }

  return { hasForbidden: matches.length > 0, matches: Array.from(new Set(matches)) }
}

export function extractPlantUmlBlock(text: string): string {
  const full = text.match(/@startuml[\s\S]*?@enduml/i)
  if (full) return full[0]

  const start = text.search(/@startuml/i)
  if (start >= 0) return text.slice(start)

  return text
}

function countBraceDepthChange(line: string): number {
  let delta = 0
  for (const char of line) {
    if (char === '{') delta++
    else if (char === '}') delta--
  }
  return delta
}

export function sanitizePlantUMLForProcessing(input: string): string {
  const block = extractPlantUmlBlock(input)
  const lines = block.split(/\r?\n/)
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
        if (braceDepth <= 0) {
          skipSkinparamBlock = false
          braceDepth = 0
        }
      }
      continue
    }

    if (/^\s*!\s*(theme|include|import|pragma)\b/i.test(trimmed)) continue
    if (/^\s*(title|caption)\b/i.test(trimmed)) continue
    if (/^\s*(note|box)\b/i.test(trimmed)) continue
    if (/^\s*\w+\s*(?:--|->|<-|-->|<--|-\w+->)\s*$/.test(trimmed)) continue
    if (ORPHAN_SKINPARAM_BODY_PATTERNS.test(trimmed)) continue

    result.push(line)
  }

  return result.join('\n').trim()
}

export function injectFixedPlantUmlSkinparams(plantuml: string): string {
  const lines = plantuml.split(/\r?\n/)
  const result: string[] = []
  let injected = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (/^\s*skinparam\b/i.test(trimmed)) continue

    if (trimmed.toLowerCase() === '@startuml' && !injected) {
      result.push(line)
      result.push(FIXED_SKINPARAM_BLOCK)
      result.push('')
      injected = true
      continue
    }

    result.push(line)
  }

  return result.join('\n').trim()
}

export function enforcePlantUmlDiagramCaps(plantuml: string, diagramType = 'BLOCK'): string {
  const type = diagramType.toUpperCase()
  const caps = DIAGRAM_HARD_CAPS[type]
  if (!caps) return plantuml

  const lines = plantuml.split(/\r?\n/)
  const result: string[] = []
  let elementCount = 0
  let messageCount = 0
  let participantCount = 0
  let skipBraceDepth = 0

  for (const line of lines) {
    const trimmed = line.trim()

    if (skipBraceDepth > 0) {
      skipBraceDepth += countBraceDepthChange(trimmed)
      continue
    }

    if (type === 'BLOCK' || type === 'FLOW' || type === 'CONSTITUENT') {
      if (/^\s*rectangle\b/i.test(trimmed)) {
        elementCount++
        if (elementCount > caps.maxElements) {
          const braceChange = countBraceDepthChange(trimmed)
          if (braceChange > 0) skipBraceDepth = braceChange
          continue
        }
      }
    } else if (type === 'ACTIVITY') {
      if (/^\s*:.*;\s*$/.test(trimmed)) {
        elementCount++
        if (elementCount > caps.maxElements) continue
      }
    } else if (type === 'SEQUENCE') {
      if (/^\s*(participant|actor)\b/i.test(trimmed)) {
        participantCount++
        if (participantCount > caps.maxElements) continue
      }
      if (/->|-->|<-|<--/.test(trimmed) && !/^\s*(participant|actor)\b/i.test(trimmed)) {
        messageCount++
        if (messageCount > SEQUENCE_MAX_MESSAGES) continue
      }
    }

    result.push(line)
  }

  return result.join('\n').trim()
}

export function inferPlantUmlDiagramType(code: string): string {
  if (/^\s*(start|stop|:.*;\s*$)/m.test(code)) return 'ACTIVITY'
  if (/^\s*(participant|actor)\b/mi.test(code)) return 'SEQUENCE'
  if (/^\s*(\[\*\]|state\s+")/mi.test(code)) return 'STATE'
  if (/\b(?:formulation|constituent|carrier|excipient|active agent)\b/i.test(code)) return 'CONSTITUENT'
  return 'BLOCK'
}

export function validatePlantUmlStructureForProcessing(code: string): { ok: boolean; errors: PlantUmlValidationError[] } {
  const errors: PlantUmlValidationError[] = []
  const startCount = (code.match(/@startuml/gi) || []).length
  const endCount = (code.match(/@enduml/gi) || []).length

  if (startCount !== 1 || endCount !== 1) {
    errors.push({ type: 'bounds', message: 'Diagram must contain exactly one @startuml and one @enduml' })
  }

  const lines = code.split(/\r?\n/)
  const contentLines = lines.filter(line => {
    const trimmed = line.trim()
    return trimmed && !/^@startuml|@enduml/i.test(trimmed) && !/^skinparam\b/i.test(trimmed)
  })

  const isActivityDiagram = lines.some(line => /^\s*(start|stop|:.*;\s*)$/i.test(line.trim()))
  const isSequenceDiagram = lines.some(line => /^\s*(participant|actor)\b/i.test(line.trim()))
  const isBlockDiagram = lines.some(line => /^\s*rectangle\b/i.test(line.trim()))

  if (!isActivityDiagram && !isSequenceDiagram && isBlockDiagram) {
    const rectangleCount = lines.filter(line => /^\s*rectangle\b/i.test(line.trim())).length
    const arrowCount = lines.filter(line => /-->|->|<--|<-|--/.test(line)).length
    if (rectangleCount < 3) errors.push({ type: 'min_content', message: `Block diagram needs at least 3 rectangles (found ${rectangleCount})` })
    if (arrowCount < 1) errors.push({ type: 'min_content', message: `Block diagram needs at least 1 connection (found ${arrowCount})` })
  }

  if (isSequenceDiagram) {
    const participantCount = lines.filter(line => /^\s*(participant|actor)\b/i.test(line.trim())).length
    const messageCount = lines.filter(line => /->|-->|<-|<--/.test(line) && !/^\s*(participant|actor)\b/i.test(line.trim())).length
    if (participantCount < 2) errors.push({ type: 'min_content', message: `Sequence diagram needs at least 2 participants/actors (found ${participantCount})` })
    if (messageCount < 2) errors.push({ type: 'min_content', message: `Sequence diagram needs at least 2 messages (found ${messageCount})` })
  }

  if (isActivityDiagram) {
    const hasStart = lines.some(line => /^\s*start\s*$/i.test(line.trim()))
    const hasStop = lines.some(line => /^\s*(stop|end)\s*$/i.test(line.trim()))
    const actionCount = lines.filter(line => /^:.*;\s*$/.test(line.trim())).length
    if (!hasStart) errors.push({ type: 'min_content', message: 'Activity diagram must have "start"' })
    if (!hasStop) errors.push({ type: 'min_content', message: 'Activity diagram must have "stop" or "end"' })
    if (actionCount < 3) errors.push({ type: 'min_content', message: `Activity diagram needs at least 3 action steps (found ${actionCount})` })
  }

  if (contentLines.length === 0) {
    errors.push({ type: 'empty', message: 'Diagram has no renderable content' })
  }

  lines.forEach((line, idx) => {
    const trimmed = line.trim()
    if (/^:.*;\s*$/.test(trimmed)) return
    if (!isActivityDiagram && /(?:--|->|<-|-->|<--|-\w+->)\s*$/.test(trimmed)) {
      errors.push({ type: 'dangling_connector', message: 'Dangling connector without target', line: idx + 1 })
    }
  })

  const blockPairs = [
    { start: /^\s*if\s*\(/i, end: /^\s*endif\b/i, name: 'if' },
    { start: /^\s*alt\b/i, end: /^\s*end\s+alt\b/i, name: 'alt' },
    { start: /^\s*loop\b/i, end: /^\s*end\s+loop\b/i, name: 'loop' },
    { start: /^\s*fork\b/i, end: /^\s*end\s+fork\b/i, name: 'fork' },
    { start: /^\s*while\s*\(/i, end: /^\s*endwhile\b/i, name: 'while' },
    { start: /^\s*repeat\b/i, end: /^\s*repeat\s+while\b/i, name: 'repeat' },
  ]

  const stack: Array<{ name: string; line: number }> = []
  lines.forEach((line, idx) => {
    for (const pair of blockPairs) {
      if (pair.start.test(line)) stack.push({ name: pair.name, line: idx + 1 })
      if (pair.end.test(line)) {
        const last = stack.pop()
        if (!last || last.name !== pair.name) {
          errors.push({ type: 'block_balance', message: `Unexpected "${line.trim()}"`, line: idx + 1 })
          if (last) stack.push(last)
        }
      }
    }
  })

  for (const unclosed of stack) {
    errors.push({ type: 'block_balance', message: `Unclosed block "${unclosed.name}"`, line: unclosed.line })
  }

  return { ok: errors.length === 0, errors }
}

function validationReason(errors: PlantUmlValidationError[]): string {
  return errors.map(e => `${e.type}${e.line ? `@${e.line}` : ''}: ${e.message}`).join('; ')
}

function repairErrorsFromForbidden(matches: string[]): PlantUmlValidationError[] {
  return matches.map(match => ({
    type: 'forbidden_construct',
    message: `Forbidden PlantUML construct "${match}" must be rewritten as a linear patent-safe diagram`,
  }))
}

function finalizeCandidate(code: string, diagramType: string): { ok: boolean; code?: string; errors?: PlantUmlValidationError[]; forbidden?: string[] } {
  let working = sanitizePlantUMLForProcessing(code)
  const forbidden = containsForbiddenPlantUmlKeywords(working)
  if (forbidden.hasForbidden) {
    return { ok: false, errors: repairErrorsFromForbidden(forbidden.matches), forbidden: forbidden.matches }
  }

  working = injectFixedPlantUmlSkinparams(working)
  working = enforcePlantUmlDiagramCaps(working, diagramType)

  const validation = validatePlantUmlStructureForProcessing(working)
  if (!validation.ok) return { ok: false, errors: validation.errors }

  return { ok: true, code: working }
}

export async function processGeneratedPlantUml(options: ProcessPlantUmlOptions): Promise<ProcessedPlantUmlResult> {
  const repairSummary = emptyRepairSummary()
  const warnings: string[] = []
  const diagramType = (options.diagramType || inferPlantUmlDiagramType(options.rawCode)).toUpperCase()
  let working = sanitizePlantUMLForProcessing(options.rawCode)

  const forbidden = containsForbiddenPlantUmlKeywords(working)
  const initialValidation = validatePlantUmlStructureForProcessing(working)
  const initialErrors = [
    ...(forbidden.hasForbidden ? repairErrorsFromForbidden(forbidden.matches) : []),
    ...initialValidation.errors,
    ...(options.forceRepair ? [{ type: 'render_error', message: options.plantumlErrorText || 'Render failed' }] : []),
  ]
  const needsRepair = options.forceRepair || forbidden.hasForbidden || !initialValidation.ok
  let repaired = false
  let repairReason = ''

  if (needsRepair) {
    repairReason = forbidden.hasForbidden
      ? `forbidden constructs: ${forbidden.matches.join(', ')}`
      : initialValidation.ok && options.forceRepair
        ? `render error: ${options.plantumlErrorText || 'Render failed'}`
        : validationReason(initialValidation.errors)

    if (!options.repair) {
      return { ok: false, repaired: false, repairReason, errors: initialErrors, warnings, repairSummary }
    }

    repairSummary.attempted++
    const repairResult = await options.repair({
      code: working,
      validationErrors: initialErrors,
      figureTitle: options.figureTitle,
      description: options.description,
      numerals: options.numerals,
      plantumlErrorText: options.plantumlErrorText,
      requestHeaders: options.requestHeaders,
    })

    if (!repairResult.ok || !repairResult.code) {
      repairSummary.failed++
      return {
        ok: false,
        repaired: false,
        repairReason,
        errors: repairResult.errors || initialErrors,
        warnings,
        repairSummary,
      }
    }

    working = repairResult.code
    repaired = true
    repairSummary.repaired++
    warnings.push(`Diagram repaired automatically (${repairReason || 'validation failure'}).`)
  }

  let finalized = finalizeCandidate(working, diagramType)

  if (!finalized.ok && !repaired && options.repair) {
    repairReason = validationReason(finalized.errors || [])
    repairSummary.attempted++
    const repairResult = await options.repair({
      code: sanitizePlantUMLForProcessing(working),
      validationErrors: finalized.errors || [],
      figureTitle: options.figureTitle,
      description: options.description,
      numerals: options.numerals,
      plantumlErrorText: options.plantumlErrorText,
      requestHeaders: options.requestHeaders,
    })

    if (repairResult.ok && repairResult.code) {
      repaired = true
      repairSummary.repaired++
      working = repairResult.code
      warnings.push(`Diagram repaired automatically (${repairReason || 'post-processing validation failure'}).`)
      finalized = finalizeCandidate(working, diagramType)
    } else {
      repairSummary.failed++
      return {
        ok: false,
        repaired: false,
        repairReason,
        errors: repairResult.errors || finalized.errors,
        warnings,
        repairSummary,
      }
    }
  }

  if (!finalized.ok || !finalized.code) {
    if (repaired) repairSummary.failed++
    return {
      ok: false,
      repaired,
      repairReason,
      errors: finalized.errors,
      warnings,
      repairSummary,
    }
  }

  return {
    ok: true,
    code: finalized.code,
    repaired,
    repairReason: repaired ? repairReason : undefined,
    warnings,
    repairSummary,
  }
}
