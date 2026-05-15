export const SUPPORT_DATA_SOURCE_KINDS = [
  'component',
  'subcomponent',
  'process_step',
  'material',
  'composition',
  'numeric_value',
  'condition',
  'alternative',
  'example',
  'table',
  'equation',
  'data_schema',
  'algorithm',
  'figure',
  'test_result',
  'bio_sequence',
  'deposit',
  'prior_art',
  'advantage',
  'risk',
  'do_not_claim',
  'missing_fact',
  'other',
] as const

export const SUPPORT_CLAIM_USE_VALUES = [
  'core',
  'dependent',
  'fallback',
  'do_not_claim',
  'background_only',
  'none',
] as const

export const SUPPORT_FIGURE_USE_VALUES = [
  'include',
  'optional',
  'do_not_show',
] as const

export const SUPPORT_STATUS_VALUES = [
  'source_stated',
  'directly_implied',
  'user_added',
  'not_stated',
  'unsupported',
  'deleted',
] as const

export const SUPPORT_SECTION_TARGETS = [
  'title',
  'preamble',
  'fieldOfInvention',
  'background',
  'objectsOfInvention',
  'summary',
  'technicalProblem',
  'technicalSolution',
  'advantageousEffects',
  'briefDescriptionOfDrawings',
  'detailedDescription',
  'bestMethod',
  'bestMode',
  'industrialApplicability',
  'claims',
  'abstract',
  'listOfNumerals',
  'crossReference',
] as const

export type SupportDataSourceKind = typeof SUPPORT_DATA_SOURCE_KINDS[number]
export type SupportClaimUse = typeof SUPPORT_CLAIM_USE_VALUES[number]
export type SupportFigureUse = typeof SUPPORT_FIGURE_USE_VALUES[number]
export type SupportStatus = typeof SUPPORT_STATUS_VALUES[number]
export type SupportSectionTarget = typeof SUPPORT_SECTION_TARGETS[number]

export type SupportDataSource = {
  id: string
  kind: SupportDataSourceKind
  label: string
  value: string
  sourceText?: string
  details?: Record<string, any>
  sectionTargets: string[]
  claimUse: SupportClaimUse
  figureUse: SupportFigureUse
  status: SupportStatus
}

export type SupportDataSourceEntry = {
  id: string
  value: string
  sourceField: string
  kind: SupportDataSourceKind
  label: string
}

const MAX_LABEL_CHARS = 160
const MAX_VALUE_CHARS = 2200
const MAX_SOURCE_TEXT_CHARS = 2200
const MAX_DETAIL_STRING_CHARS = 1600
const MAX_DETAIL_ARRAY_ITEMS = 120
const MAX_DETAIL_OBJECT_KEYS = 40

const SECTION_ALIASES: Record<string, string> = {
  briefdrawing: 'briefDescriptionOfDrawings',
  briefdrawings: 'briefDescriptionOfDrawings',
  briefdescriptionofdrawings: 'briefDescriptionOfDrawings',
  drawings: 'briefDescriptionOfDrawings',
  figures: 'briefDescriptionOfDrawings',
  detaileddescription: 'detailedDescription',
  detailed_description: 'detailedDescription',
  description: 'detailedDescription',
  bestmode: 'bestMethod',
  bestmethod: 'bestMethod',
  field: 'fieldOfInvention',
  technicalfield: 'fieldOfInvention',
  technicalproblem: 'technicalProblem',
  technicalsolution: 'technicalSolution',
  objects: 'objectsOfInvention',
  numerals: 'listOfNumerals',
  listofnumerals: 'listOfNumerals',
}

function cleanString(value: unknown, maxChars = MAX_VALUE_CHARS) {
  if (value === null || value === undefined) return ''
  const cleaned = String(value)
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
  return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars).trim()}...` : cleaned
}

function enumValue<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  const normalized = cleanString(value, 80).toLowerCase().replace(/[\s-]+/g, '_')
  return (allowed as readonly string[]).includes(normalized) ? normalized as T[number] : fallback
}

function normalizeKind(value: unknown): SupportDataSourceKind {
  const normalized = cleanString(value, 80).toLowerCase().replace(/[\s-]+/g, '_')
  const aliases: Record<string, SupportDataSourceKind> = {
    range: 'numeric_value',
    numeric: 'numeric_value',
    number: 'numeric_value',
    formula: 'equation',
    formulae: 'equation',
    dataset: 'test_result',
    metric: 'test_result',
    schema: 'data_schema',
    api_schema: 'data_schema',
    data_field: 'data_schema',
    pseudocode: 'algorithm',
    sequence: 'bio_sequence',
    biological_sequence: 'bio_sequence',
    drawing: 'figure',
    figures: 'figure',
  }
  const mapped = aliases[normalized] || normalized
  return (SUPPORT_DATA_SOURCE_KINDS as readonly string[]).includes(mapped)
    ? mapped as SupportDataSourceKind
    : 'other'
}

function normalizeSectionTarget(value: unknown): string {
  const raw = cleanString(value, 80)
  if (!raw) return ''
  const compact = raw.replace(/[_\-\s.]/g, '').toLowerCase()
  const alias = SECTION_ALIASES[raw] || SECTION_ALIASES[compact]
  if (alias) return alias
  const exact = SUPPORT_SECTION_TARGETS.find(target => target === raw)
  if (exact) return exact
  const caseInsensitive = SUPPORT_SECTION_TARGETS.find(target => target.toLowerCase() === raw.toLowerCase())
  return caseInsensitive || ''
}

function unique(values: string[]) {
  const seen = new Set<string>()
  const out: string[] = []
  values.forEach((value) => {
    const cleaned = cleanString(value, 120)
    const key = cleaned.toLowerCase()
    if (!cleaned || seen.has(key)) return
    seen.add(key)
    out.push(cleaned)
  })
  return out
}

function sanitizeDetails(value: unknown, depth = 0): any {
  if (depth > 5) return undefined
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string') return cleanString(value, MAX_DETAIL_STRING_CHARS)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_DETAIL_ARRAY_ITEMS)
      .map(item => sanitizeDetails(item, depth + 1))
      .filter(item => item !== undefined)
  }
  if (typeof value === 'object') {
    const out: Record<string, any> = {}
    Object.entries(value as Record<string, unknown>)
      .slice(0, MAX_DETAIL_OBJECT_KEYS)
      .forEach(([key, item]) => {
        const cleanedKey = cleanString(key, 80).replace(/[^\w.\- ]+/g, '').trim()
        if (!cleanedKey) return
        const cleanedValue = sanitizeDetails(item, depth + 1)
        if (cleanedValue !== undefined) out[cleanedKey] = cleanedValue
      })
    return Object.keys(out).length ? out : undefined
  }
  return undefined
}

function valueFromDetails(kind: SupportDataSourceKind, details: any) {
  if (!details || typeof details !== 'object') return ''
  if (kind === 'table') {
    const rows = Array.isArray(details.rows) ? details.rows.length : 0
    const headers = Array.isArray(details.headers) ? details.headers.length : 0
    return `Table with ${headers || 'unknown'} columns and ${rows} rows`
  }
  if (kind === 'equation') return cleanString(details.expression || details.formula || '', MAX_VALUE_CHARS)
  if (kind === 'algorithm' && Array.isArray(details.steps)) return `${details.steps.length} ordered algorithm steps`
  if (kind === 'data_schema' && Array.isArray(details.fields)) return `${details.fields.length} data schema fields`
  if (kind === 'composition' && Array.isArray(details.constituents)) return `${details.constituents.length} constituents`
  if (kind === 'bio_sequence') {
    const sequence = cleanString(details.sequence || '', 200)
    return sequence ? `Biological sequence ${details.sequenceId || ''} (${sequence.length} characters)`.trim() : ''
  }
  if (kind === 'figure') return cleanString([details.figureNo, details.view, details.caption].filter(Boolean).join(' - '), MAX_VALUE_CHARS)
  return ''
}

function defaultSectionTargets(kind: SupportDataSourceKind, claimUse: SupportClaimUse, figureUse: SupportFigureUse) {
  if (claimUse === 'core') return ['claims', 'summary', 'technicalSolution', 'detailedDescription']
  if (claimUse === 'dependent' || claimUse === 'fallback') return ['claims', 'detailedDescription']
  if (claimUse === 'do_not_claim') return ['claims', 'detailedDescription']
  if (claimUse === 'background_only' || kind === 'prior_art') return ['background', 'technicalProblem']
  if (kind === 'figure' || figureUse !== 'do_not_show') return ['briefDescriptionOfDrawings', 'detailedDescription']
  if (kind === 'advantage' || kind === 'test_result') return ['advantageousEffects', 'detailedDescription']
  if (kind === 'risk' || kind === 'missing_fact') return ['claims', 'detailedDescription']
  if (kind === 'component' || kind === 'subcomponent' || kind === 'process_step') return ['claims', 'detailedDescription']
  return ['detailedDescription']
}

function defaultClaimUse(kind: SupportDataSourceKind, status: SupportStatus): SupportClaimUse {
  if (status === 'unsupported' || kind === 'do_not_claim') return 'do_not_claim'
  if (kind === 'prior_art') return 'background_only'
  if (kind === 'risk' || kind === 'missing_fact') return 'none'
  if (kind === 'component' || kind === 'process_step' || kind === 'composition') return 'dependent'
  return 'none'
}

function defaultFigureUse(kind: SupportDataSourceKind) {
  if (kind === 'figure') return 'include' as const
  if (kind === 'component' || kind === 'subcomponent' || kind === 'process_step') return 'optional' as const
  return 'do_not_show' as const
}

function supportDedupeKey(item: Omit<SupportDataSource, 'id'>) {
  return [
    item.kind,
    item.label.toLowerCase(),
    item.value.toLowerCase(),
    item.claimUse,
    item.status,
    item.sectionTargets.join('|').toLowerCase(),
  ].join('\u0000')
}

function sourceId(index: number) {
  return `SDS-${String(index + 1).padStart(3, '0')}`
}

export function coerceSupportDataSources(value: unknown): SupportDataSource[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const normalized: Array<Omit<SupportDataSource, 'id'>> = []

  value.forEach((raw) => {
    if (!raw) return
    const record: Record<string, unknown> = typeof raw === 'object'
      ? raw as Record<string, unknown>
      : { value: raw }
    const kind = normalizeKind(record.kind || record.type || record.sourceType)
    const status = enumValue(record.status, SUPPORT_STATUS_VALUES, 'source_stated')
    const claimUse = enumValue(record.claimUse || record.claimTreatment, SUPPORT_CLAIM_USE_VALUES, defaultClaimUse(kind, status))
    const figureUse = enumValue(record.figureUse || record.figureTreatment, SUPPORT_FIGURE_USE_VALUES, defaultFigureUse(kind))
    const details = sanitizeDetails(record.details || record.structuredValue)
    const valueText = cleanString(
      record.value ||
      record.description ||
      record.sourceText ||
      valueFromDetails(kind, details),
      MAX_VALUE_CHARS
    )
    const label = cleanString(
      record.label ||
      record.name ||
      record.title ||
      (valueText ? valueText.slice(0, 80) : kind.replace(/_/g, ' ')),
      MAX_LABEL_CHARS
    )
    if (!label || (!valueText && !details)) return

    const sectionTargets = unique(
      Array.isArray(record.sectionTargets)
        ? record.sectionTargets.map(normalizeSectionTarget)
        : typeof record.sectionTargets === 'string'
          ? record.sectionTargets.split(/[,|]/).map(normalizeSectionTarget)
          : defaultSectionTargets(kind, claimUse, figureUse)
    )
    const item: Omit<SupportDataSource, 'id'> = {
      kind,
      label,
      value: valueText || valueFromDetails(kind, details) || label,
      ...(record.sourceText ? { sourceText: cleanString(record.sourceText, MAX_SOURCE_TEXT_CHARS) } : {}),
      ...(details ? { details } : {}),
      sectionTargets: sectionTargets.length ? sectionTargets : defaultSectionTargets(kind, claimUse, figureUse),
      claimUse,
      figureUse,
      status,
    }
    const key = supportDedupeKey(item)
    if (seen.has(key)) return
    seen.add(key)
    normalized.push(item)
  })

  return normalized.map((item, index) => ({ id: sourceId(index), ...item }))
}

function parseMarkdownTable(block: string) {
  const lines = block.split('\n').map(line => line.trim()).filter(Boolean)
  if (lines.length < 2) return null
  const split = (line: string) => line.replace(/^\||\|$/g, '').split('|').map(cell => cell.trim())
  const headers = split(lines[0])
  const separator = split(lines[1])
  if (headers.length < 2 || !separator.every(cell => /^:?-{2,}:?$/.test(cell))) return null
  const rows = lines.slice(2).map(split).filter(row => row.length >= 2)
  return rows.length ? { headers, rows } : null
}

function tableBlocksFromText(rawIdea: string) {
  const blocks: string[] = []
  const lines = rawIdea.replace(/\r\n/g, '\n').split('\n')
  let current: string[] = []
  lines.forEach((line) => {
    if (line.includes('|')) {
      current.push(line)
    } else if (current.length) {
      if (current.length >= 2) blocks.push(current.join('\n'))
      current = []
    }
  })
  if (current.length >= 2) blocks.push(current.join('\n'))
  return blocks
}

function delimitedBlocksFromText(rawIdea: string, delimiter: ',' | '\t') {
  const blocks: string[] = []
  const lines = rawIdea.replace(/\r\n/g, '\n').split('\n')
  let current: string[] = []
  const hasDelimiter = (line: string) => line.split(delimiter).length >= 3
  lines.forEach((line) => {
    if (hasDelimiter(line)) {
      current.push(line)
    } else if (current.length) {
      if (current.length >= 2) blocks.push(current.join('\n'))
      current = []
    }
  })
  if (current.length >= 2) blocks.push(current.join('\n'))
  return blocks
}

function parseDelimitedTable(block: string, delimiter: ',' | '\t') {
  const rows = block.split('\n')
    .map(line => line.split(delimiter).map(cell => cell.trim()))
    .filter(row => row.length >= 3)
  if (rows.length < 2) return null
  const columnCount = rows[0].length
  if (rows.filter(row => Math.abs(row.length - columnCount) <= 1).length < 2) return null
  return { headers: rows[0], rows: rows.slice(1) }
}

function codeBlocksFromText(rawIdea: string) {
  const blocks: Array<{ language: string; code: string }> = []
  const regex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(rawIdea)) !== null) {
    blocks.push({ language: match[1] || '', code: match[2].trim() })
  }
  return blocks
}

function addRiskIfMatches(rawIdea: string, pattern: RegExp, label: string, value: string, out: any[]) {
  const match = rawIdea.match(pattern)
  if (!match) return
  out.push({
    kind: 'risk',
    label,
    value,
    sourceText: match[0],
    sectionTargets: ['claims', 'detailedDescription'],
    claimUse: 'do_not_claim',
    figureUse: 'do_not_show',
    status: 'source_stated',
  })
}

export function extractSupportDataSourceCandidates(rawIdea: string): SupportDataSource[] {
  const out: any[] = []
  const text = rawIdea || ''

  tableBlocksFromText(text).forEach((block, index) => {
    const parsed = parseMarkdownTable(block)
    if (!parsed) return
    out.push({
      kind: 'table',
      label: `source table ${index + 1}`,
      value: `Table with ${parsed.headers.length} columns and ${parsed.rows.length} rows`,
      sourceText: block,
      details: parsed,
      sectionTargets: ['detailedDescription'],
      claimUse: 'dependent',
      figureUse: 'do_not_show',
      status: 'source_stated',
    })
  })

  delimitedBlocksFromText(text, ',').forEach((block, index) => {
    const parsed = parseDelimitedTable(block, ',')
    if (!parsed) return
    out.push({
      kind: 'table',
      label: `CSV table ${index + 1}`,
      value: `Delimited table with ${parsed.headers.length} columns and ${parsed.rows.length} rows`,
      sourceText: block,
      details: parsed,
      sectionTargets: ['detailedDescription'],
      claimUse: 'dependent',
      figureUse: 'do_not_show',
      status: 'source_stated',
    })
  })

  delimitedBlocksFromText(text, '\t').forEach((block, index) => {
    const parsed = parseDelimitedTable(block, '\t')
    if (!parsed) return
    out.push({
      kind: 'table',
      label: `TSV table ${index + 1}`,
      value: `Delimited table with ${parsed.headers.length} columns and ${parsed.rows.length} rows`,
      sourceText: block,
      details: parsed,
      sectionTargets: ['detailedDescription'],
      claimUse: 'dependent',
      figureUse: 'do_not_show',
      status: 'source_stated',
    })
  })

  codeBlocksFromText(text).forEach((block, index) => {
    const lower = block.language.toLowerCase()
    const looksSchema = /^(json|xml|yaml|yml|csv|tsv)$/.test(lower) || /^[\s{[]/.test(block.code)
    out.push({
      kind: looksSchema ? 'data_schema' : 'algorithm',
      label: looksSchema ? `source data schema ${index + 1}` : `source algorithm ${index + 1}`,
      value: cleanString(block.code, 900),
      sourceText: block.code,
      details: looksSchema ? { language: block.language || 'text', snippet: block.code } : { steps: block.code.split('\n').filter(Boolean) },
      sectionTargets: ['detailedDescription'],
      claimUse: 'dependent',
      figureUse: looksSchema ? 'do_not_show' : 'optional',
      status: 'source_stated',
    })
  })

  const equationLines = text.split('\n')
    .map(line => line.trim())
    .filter(line => line.length <= 180 && /[A-Za-z0-9)\]]\s*[=<>≤≥]\s*[-+A-Za-z0-9(]/.test(line) && /[+\-*/^()[\]]|\b(?:log|exp|sin|cos|max|min|sum)\b/i.test(line))
    .slice(0, 12)
  equationLines.forEach((line, index) => {
    out.push({
      kind: 'equation',
      label: `source equation ${index + 1}`,
      value: line,
      sourceText: line,
      details: { expression: line },
      sectionTargets: ['claims', 'detailedDescription'],
      claimUse: 'dependent',
      figureUse: 'do_not_show',
      status: 'source_stated',
    })
  })

  const sequenceMatches = text.match(/\b(?:SEQ\s+ID\s+NO[:.]?\s*\d+\s*)?[ACGTUNacgtun]{40,}\b/g) || []
  sequenceMatches.slice(0, 8).forEach((sequence, index) => {
    out.push({
      kind: 'bio_sequence',
      label: `source sequence ${index + 1}`,
      value: `Biological sequence with ${sequence.replace(/\s+/g, '').length} residues`,
      sourceText: sequence,
      details: { sequence: sequence.replace(/\s+/g, '') },
      sectionTargets: ['claims', 'detailedDescription'],
      claimUse: 'dependent',
      figureUse: 'do_not_show',
      status: 'source_stated',
    })
  })

  const depositMatch = text.match(/\b(?:deposit|deposited|accession|MTCC|ATCC|DSMZ|NCIMB|Budapest Treaty)\b[^.\n]{0,180}/i)
  if (depositMatch) {
    out.push({
      kind: 'deposit',
      label: 'biological deposit information',
      value: depositMatch[0],
      sourceText: depositMatch[0],
      sectionTargets: ['claims', 'detailedDescription'],
      claimUse: 'dependent',
      figureUse: 'do_not_show',
      status: 'source_stated',
    })
  }

  // TODO: These risk detectors are currently India-focused. Add jurisdiction-aware
  // detectors when Stage 0 receives active jurisdiction context.
  addRiskIfMatches(text, /\bcomputer\s+program\s+per\s+se\b/i, 'India Section 3(k) computer program risk', 'Computer program per se language may need technical-effect and hardware-interaction framing for India.', out)
  addRiskIfMatches(text, /\b(?:business\s+method|method\s+of\s+doing\s+business)\b/i, 'India Section 3(k) business method risk', 'Business-method subject matter may need claim-scope review for India.', out)
  addRiskIfMatches(text, /\b(?:method\s+of\s+treatment|treating\s+a\s+(?:patient|human|animal)|diagnostic\s+method|method\s+of\s+diagnosis)\b/i, 'India Section 3(i) treatment or diagnosis risk', 'Treatment or diagnosis method language may need non-method claim framing for India.', out)
  addRiskIfMatches(text, /\b(?:plant\s+variety|animal\s+variety|seed\s+variety|essentially\s+biological)\b/i, 'India Section 3(j) plant or animal subject-matter risk', 'Plant/animal varieties and essentially biological processes may need route review for India.', out)
  addRiskIfMatches(text, /\btraditional\s+knowledge\b/i, 'India traditional knowledge risk', 'Traditional knowledge language requires claim-scope and novelty-source review.', out)
  addRiskIfMatches(text, /\bmere\s+admixture\b/i, 'India mere admixture risk', 'Mere admixture language may require synergy or technical-effect support.', out)

  return coerceSupportDataSources(out)
}

export function completeSupportDataSources(
  rawIdea: string,
  normalizedData: Record<string, unknown>
): { supportDataSources: SupportDataSource[]; normalizationReviewWarnings: string[] } {
  const existing = coerceSupportDataSources(normalizedData?.supportDataSources)
  const combined = coerceSupportDataSources([
    ...existing,
    ...extractSupportDataSourceCandidates(rawIdea),
  ])
  const before = new Set(existing.map(item => supportDedupeKey(item)))
  const warnings = combined
    .filter(item => !before.has(supportDedupeKey(item)) && ['table', 'equation', 'data_schema', 'algorithm', 'bio_sequence', 'deposit', 'risk'].includes(item.kind))
    .map(item => `Detected support data "${item.label}" in the source. Please verify it is correctly routed before drafting.`)
  return { supportDataSources: combined, normalizationReviewWarnings: unique(warnings) }
}

function isGuardrail(item: SupportDataSource) {
  return item.status === 'unsupported' ||
    item.kind === 'risk' ||
    item.kind === 'do_not_claim' ||
    item.kind === 'missing_fact' ||
    item.claimUse === 'do_not_claim'
}

function sectionMatches(item: SupportDataSource, sectionKey: string) {
  const section = normalizeSectionTarget(sectionKey) || sectionKey
  if (item.status === 'deleted') return false
  if (section === 'claims') {
    return item.sectionTargets.includes('claims') ||
      ['core', 'dependent', 'fallback', 'do_not_claim'].includes(item.claimUse) ||
      isGuardrail(item)
  }
  if (section === 'detailedDescription') return true
  if (section === 'briefDescriptionOfDrawings') return item.figureUse !== 'do_not_show' || item.kind === 'figure'
  if (section === 'listOfNumerals') return false
  if (section === 'background' || section === 'technicalProblem') {
    return item.sectionTargets.includes(section) || item.claimUse === 'background_only' || item.kind === 'prior_art'
  }
  if (section === 'abstract') {
    return item.sectionTargets.includes('abstract') && !isGuardrail(item)
  }
  if (section === 'bestMethod' || section === 'bestMode') {
    return item.sectionTargets.includes('bestMethod') &&
      item.status === 'source_stated' &&
      /\b(best|preferred|preferably)\b/i.test(`${item.label} ${item.value}`)
  }
  return item.sectionTargets.includes(section)
}

function compactDetails(kind: SupportDataSourceKind, details: Record<string, any> | undefined) {
  if (!details) return ''
  if (kind === 'table') {
    const headers = Array.isArray(details.headers) ? details.headers : []
    const rows = Array.isArray(details.rows) ? details.rows.slice(0, 8) : []
    const lines = [
      headers.length ? `headers=${headers.join(' | ')}` : '',
      ...rows.map((row: any) => Array.isArray(row) ? `row=${row.join(' | ')}` : `row=${cleanString(row, 180)}`),
    ].filter(Boolean)
    if (Array.isArray(details.rows) && details.rows.length > rows.length) lines.push(`...${details.rows.length - rows.length} more rows omitted`)
    return lines.join('; ')
  }
  if (kind === 'equation') {
    const variables = details.variables && typeof details.variables === 'object'
      ? Object.entries(details.variables).slice(0, 12).map(([key, value]) => `${key}=${cleanString(value, 120)}`).join('; ')
      : ''
    const constraints = Array.isArray(details.constraints) ? details.constraints.slice(0, 8).join('; ') : ''
    return [details.expression ? `expression=${details.expression}` : '', variables ? `variables=${variables}` : '', constraints ? `constraints=${constraints}` : ''].filter(Boolean).join('; ')
  }
  if (kind === 'algorithm' && Array.isArray(details.steps)) return details.steps.slice(0, 10).map((step: any, index: number) => `${index + 1}. ${cleanString(step, 180)}`).join('; ')
  if (kind === 'data_schema' && Array.isArray(details.fields)) return details.fields.slice(0, 16).map((field: any) => typeof field === 'object' ? Object.values(field).filter(Boolean).join(' | ') : cleanString(field, 120)).join('; ')
  if (kind === 'composition' && Array.isArray(details.constituents)) return details.constituents.slice(0, 16).map((part: any) => typeof part === 'object' ? Object.values(part).filter(Boolean).join(' | ') : cleanString(part, 120)).join('; ')
  if (kind === 'bio_sequence') return [details.sequenceId ? `id=${details.sequenceId}` : '', details.organism ? `organism=${details.organism}` : '', details.sequence ? `sequence=${cleanString(details.sequence, 240)}` : ''].filter(Boolean).join('; ')
  return cleanString(JSON.stringify(details), 800)
}

function formatSupportLine(item: SupportDataSource) {
  const status = item.status === 'user_added' ? 'user-added' : item.status.replace(/_/g, ' ')
  const details = compactDetails(item.kind, item.details)
  return [
    `- [${item.id}] ${item.kind.replace(/_/g, ' ')} | ${item.label} | claim=${item.claimUse} | figure=${item.figureUse} | status=${status}: ${item.value}`,
    details ? `  Details: ${details}` : '',
    item.sourceText && item.sourceText !== item.value ? `  Source: ${cleanString(item.sourceText, 420)}` : '',
  ].filter(Boolean).join('\n')
}

export function hasSupportDataSources(normalizedData: unknown) {
  return !!(
    normalizedData &&
    typeof normalizedData === 'object' &&
    Array.isArray((normalizedData as any).supportDataSources) &&
    (normalizedData as any).supportDataSources.length
  )
}

export function buildSupportDataSourcePromptBlock(
  normalizedData: unknown,
  sectionKey: string,
  heading = 'SUPPORT DATA SOURCES (SECTION-FILTERED SOURCE SUPPORT)'
) {
  if (!normalizedData || typeof normalizedData !== 'object') return ''
  const sources = coerceSupportDataSources((normalizedData as any).supportDataSources)
  if (!sources.length) return ''
  const filtered = sources.filter(item => sectionMatches(item, sectionKey))
  if (!filtered.length) return ''

  const section = normalizeSectionTarget(sectionKey) || sectionKey
  const positives = filtered.filter((item) => {
    if (isGuardrail(item) || item.status === 'unsupported' || item.status === 'not_stated') return false
    if (section === 'claims') return ['core', 'dependent', 'fallback'].includes(item.claimUse)
    if (section === 'background' || section === 'technicalProblem') {
      return item.claimUse === 'background_only' || item.kind === 'prior_art' || item.sectionTargets.includes(section)
    }
    return true
  }).slice(0, 40)
  const guardrails = filtered.filter(isGuardrail).slice(0, 20)
  const lines = [
    heading,
    'Use these SDS IDs as traceable source support. Do not invent missing facts. Do not treat optional, unsupported, deleted, or do-not-claim items as mandatory invention elements.',
  ]
  if (positives.length) {
    lines.push('Positive support:')
    lines.push(...positives.map(formatSupportLine))
  }
  if (guardrails.length) {
    lines.push('Guardrails / exclusions / risks:')
    lines.push(...guardrails.map(formatSupportLine))
  }
  return lines.join('\n')
}

export function buildSupportDataSourceEntries(normalizedData: unknown): SupportDataSourceEntry[] {
  if (!normalizedData || typeof normalizedData !== 'object') return []
  return coerceSupportDataSources((normalizedData as any).supportDataSources)
    .filter(item =>
      item.status !== 'deleted' &&
      item.status !== 'unsupported' &&
      !isGuardrail(item) &&
      (item.sectionTargets.includes('claims') || ['core', 'dependent', 'fallback'].includes(item.claimUse))
    )
    .map(item => ({
      id: item.id,
      value: item.value,
      sourceField: `supportDataSources.${item.kind}`,
      kind: item.kind,
      label: item.label,
    }))
}

export function previewSupportDataSource(item: SupportDataSource) {
  const details = item.details || {}
  if (item.kind === 'table') {
    const columns = Array.isArray(details.headers) ? details.headers.length : 0
    const rows = Array.isArray(details.rows) ? details.rows.length : 0
    return `Table: ${columns || '?'} columns x ${rows} rows`
  }
  if (item.kind === 'equation') {
    const variables = details.variables && typeof details.variables === 'object' ? Object.keys(details.variables).length : 0
    return `Equation: ${cleanString(details.expression || item.value, 90)}${variables ? `; variables: ${variables}` : ''}`
  }
  if (item.kind === 'data_schema') {
    const fields = Array.isArray(details.fields) ? details.fields : []
    return `${fields.length} fields${fields.length ? `: ${fields.slice(0, 4).map((field: any) => typeof field === 'object' ? field.name || Object.values(field)[0] : field).join(', ')}` : ''}`
  }
  if (item.kind === 'algorithm') {
    const steps = Array.isArray(details.steps) ? details.steps.length : 0
    return `${steps || '?'} ordered steps`
  }
  if (item.kind === 'composition') {
    const constituents = Array.isArray(details.constituents) ? details.constituents.length : 0
    return `${constituents || '?'} constituents`
  }
  if (item.kind === 'bio_sequence') {
    const sequence = cleanString(details.sequence || '', 5000).replace(/\s+/g, '')
    return `${details.sequenceId || 'Sequence'}${sequence ? `, ${sequence.length} residues` : ''}`
  }
  if (item.kind === 'figure') {
    return [details.figureNo, details.view, details.caption || item.value].filter(Boolean).join(', ')
  }
  return cleanString(item.value, 120)
}
